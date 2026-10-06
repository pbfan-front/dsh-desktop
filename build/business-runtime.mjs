import http from 'node:http'
import { appendFile, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join, resolve, relative, isAbsolute, extname } from 'node:path'

// This process serves an exported package only. It does not launch npm or a dev server.
export async function startBusinessRuntime({ packageRoot, userRoot, token, port = 0 }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('A private business control token is required')
  packageRoot = await realpath(packageRoot)
  const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'))
  const within = async (root, file) => {
    const target = await realpath(resolve(root, file))
    const rel = relative(root, target)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path outside business package')
    return target
  }
  const source = process.env.DSH_BUSINESS_SOURCE_ROOT
    ? await realpath(process.env.DSH_BUSINESS_SOURCE_ROOT)
    : await within(packageRoot, manifest.sourceRoot)
  userRoot = resolve(userRoot || process.env.DSH_BUSINESS_USER_ROOT || join(packageRoot, '.user-data'))
  await mkdir(userRoot, { recursive: true })
  const workflowToken = process.env.DSH_BUSINESS_WORKFLOW_TOKEN
  if (typeof workflowToken !== 'string' || workflowToken.length < 32) throw new Error('A private Desktop workflow token is required')
  if (!/^\/[a-zA-Z0-9_-]+\/$/.test(manifest.businessPath)) throw new Error('Invalid business entry path')
  const configuredAppUrl = process.env.DSH_BUSINESS_APP_URL
  let developmentAppUrl
  if (configuredAppUrl) {
    const candidate = new URL(configuredAppUrl)
    if (candidate.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(candidate.hostname) || candidate.username || candidate.password) {
      throw new Error('DSH_BUSINESS_APP_URL must be an unauthenticated loopback HTTP URL')
    }
    developmentAppUrl = candidate.href
  }
  const web = await within(packageRoot, manifest.webRoot)
  const platform = await within(packageRoot, manifest.platformRoot)
  const require = createRequire(join(platform, 'package.json'))
  const createMock = require(join(packageRoot, 'localMockMiddleware.cjs'))
  let middleware = createMock({ projectRoot: source, overlayRoot: userRoot })
  const codeIntellRoot = join(source, '.codeIntell')
  let codeRoutes = []
  let codeIndex = {}
  let codeIntellDerived = { fileApiEntries: [], apiCallerEntries: [] }
  let codeIntellLifecycleStamp = ''
  let codeIntellStatus = { state: 'unavailable', fresh: false, compatible: false, buildId: null, generatedAt: null,
    coverage: null, lastCheckedAt: null, lastLoadedAt: null, error: 'CodeIntell has not been loaded.' }
  const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex')
  const refreshCodeIntell = async (force = false) => {
    const checkedAt = new Date().toISOString()
    try {
      const lifecycleText = await readFile(join(codeIntellRoot, 'lifecycle.json'), 'utf8')
      const stamp = createHash('sha256').update(lifecycleText).digest('hex')
      if (!force && stamp === codeIntellLifecycleStamp && codeIntellStatus.state === 'ready') {
        codeIntellStatus = { ...codeIntellStatus, lastCheckedAt: checkedAt }
        return codeIntellStatus
      }
      const lifecycle = JSON.parse(lifecycleText)
      if (lifecycle.schemaVersion !== 1) throw new Error(`Unsupported CodeIntell lifecycle schema: ${lifecycle.schemaVersion}`)
      if (lifecycle.mode === 'release' && lifecycle.buildId !== manifest.buildId) throw new Error('CodeIntell build ID does not match the business package')
      if (lifecycle.mode === 'release' && lifecycle.sourceDigestSha256 !== manifest.provenance?.sourceDigestSha256) throw new Error('CodeIntell source digest does not match the business package')
      if (lifecycle.mode === 'release' && lifecycle.businessWebEntrySha256 !== manifest.provenance?.businessWebEntrySha256) throw new Error('CodeIntell is not bound to the current business Web build')
      for (const [name, hash] of Object.entries(lifecycle.artifacts || {})) {
        if (!/^[a-z0-9.-]+\.json$/i.test(name) || await sha256(join(codeIntellRoot, name)) !== hash) throw new Error(`CodeIntell artifact is corrupt: ${name}`)
      }
      const [routes, index] = await Promise.all([
        readFile(join(codeIntellRoot, 'routes.json'), 'utf8').then(JSON.parse),
        readFile(join(codeIntellRoot, 'index.json'), 'utf8').then(JSON.parse)
      ])
      if (!Array.isArray(routes) || !index || typeof index !== 'object' || Array.isArray(index)) throw new Error('CodeIntell artifacts have an incompatible shape')
      codeRoutes = routes
      codeIndex = index
      codeIntellDerived = {
        fileApiEntries: Object.entries(index.fileToApis || {}),
        apiCallerEntries: Object.entries(index.apiCallers || {}).flatMap(([apiUrl, callers]) => (callers || []).flatMap(caller => {
          const callerId = String(caller)
          const callerFile = callerId.replace(/^fn:/, '').split('::')[0]
          const symbol = callerId.split('::').at(-1)
          return symbol ? [{ apiUrl, callerId, callerFile, callerFileLower: callerFile.toLowerCase(), symbol, symbolLower: symbol.toLowerCase() }] : []
        }))
      }
      codeIntellLifecycleStamp = stamp
      codeIntellStatus = { state: 'ready', fresh: true, compatible: true, mode: lifecycle.mode || 'unknown',
        buildId: lifecycle.buildId || manifest.buildId, generatedAt: lifecycle.generatedAt || null,
        sourceDigestSha256: lifecycle.sourceDigestSha256 || null, coverage: lifecycle.coverage || null,
        lastCheckedAt: checkedAt, lastLoadedAt: checkedAt, error: null }
    } catch (error) {
      codeIntellStatus = { ...codeIntellStatus, state: 'degraded', fresh: false, compatible: false,
        lastCheckedAt: checkedAt, error: error instanceof Error ? error.message : String(error) }
    }
    return codeIntellStatus
  }
  await refreshCodeIntell(true)
  const analysisEvidence = new Map()
  const sessionAnalysisReuse = new Map()
  let analysisMutationRevision = 0
  const invalidateSessionAnalysisReuse = () => {
    analysisMutationRevision += 1
    sessionAnalysisReuse.clear()
  }
  const workflowRequests = new Map()
  const handleWorkflowResponse = message => {
    if (message?.type !== 'workflow-response' || typeof message.id !== 'string') return
    const pending = workflowRequests.get(message.id)
    if (!pending) return
    workflowRequests.delete(message.id)
    clearTimeout(pending.timer)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Desktop workflow request failed'))
  }
  process.on('message', handleWorkflowResponse)
  const requestDesktopWorkflow = (action, payload) => new Promise((resolveRequest, rejectRequest) => {
    if (!process.send) return rejectRequest(new Error('Desktop workflow bridge is unavailable'))
    const id = randomUUID()
    const timer = setTimeout(() => {
      workflowRequests.delete(id)
      rejectRequest(new Error('Desktop workflow request timed out'))
    }, 30_000)
    timer.unref()
    workflowRequests.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    process.send({ type: 'workflow-request', id, action, payload })
  })
  const analysisPreferenceFile = join(userRoot, 'analysis-preferences.json')
  const workflowPreferenceFile = join(userRoot, 'workflow-preferences.json')
  const workflowAuditFile = join(userRoot, 'workflow-mode-audit.jsonl')
  const analysisCacheFile = join(userRoot, 'analysis-candidate-cache.json')
  const USER_DATA_SCHEMA_VERSION = 2
  const USER_DATA_PACKAGE_KIND = 'dsh-business-user-mocks'
  const profileFile = join(source, 'src/baseTypes/api/mock-profiles.json')
  const userProfileFile = join(userRoot, 'src/baseTypes/api/mock-profiles.json')
  const readWorkflowPreferences = async () => {
    try {
      const value = JSON.parse(await readFile(workflowPreferenceFile, 'utf8'))
      return { schemaVersion: 1, mode: value.mode === 'legacy' ? 'legacy' : 'workflow', updatedAt: value.updatedAt || null }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`[business-runtime] ignored invalid workflow preferences: ${error.message}`)
      return { schemaVersion: 1, mode: 'workflow', updatedAt: null }
    }
  }
  const auditWorkflowMode = async (entry) => {
    await appendFile(workflowAuditFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  const readProfiles = async file => {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'))
      return Array.isArray(data.profiles) ? data.profiles : Object.entries(data.profiles || {}).map(([id, value]) => ({ ...value, id }))
    } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  const readProfileDocument = async file => {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'))
      return { exists: true, schemaVersion: Number(data.schemaVersion || data.version || 1), profiles: Array.isArray(data.profiles) ? data.profiles : Object.entries(data.profiles || {}).map(([id, value]) => ({ ...value, id })) }
    } catch (error) { if (error.code === 'ENOENT') return { exists: false, schemaVersion: USER_DATA_SCHEMA_VERSION, profiles: [] }; throw error }
  }
  const catalog = async () => {
    const byId = new Map((await readProfiles(profileFile)).map(item => [item.id, item]))
    for (const item of await readProfiles(userProfileFile)) byId.set(item.id, item)
    return [...byId.values()]
  }
  const profileSummaries = async () => Promise.all((await catalog()).map(async profile => {
    const apis = await Promise.all(Object.entries(profile.apis || {}).map(async ([apiUrl, selection]) => {
      const relativePath = apiMockRelative(apiUrl)
      const configs = []
      for (const file of [join(source, relativePath), join(userRoot, relativePath)]) {
        try { configs.push(JSON.parse(await readFile(file, 'utf8'))) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      const scenarioMap = new Map()
      for (const config of configs) {
        const values = Array.isArray(config.scenarios)
          ? config.scenarios
          : Object.entries(config.scenarios || {}).map(([id, value]) => ({ ...value, id }))
        for (const scenario of values) if (scenario?.id) scenarioMap.set(scenario.id, scenario)
      }
      const scenarios = [...scenarioMap.values()]
      const requested = typeof selection === 'string' ? [selection] : selection.sequence || [selection.scenario]
      const metadata = plainObject(configs.at(-1)?._dsh) ? configs.at(-1)._dsh : null
      return { apiUrl, scenarioId: requested[0] || '', mockPath: relativePath, exists: configs.length > 0,
        scenarioExists: requested.every(id => scenarios.some(item => item.id === id)), scenarios,
        label: configs.at(-1)?.label, driverFields: profile.driverFields?.[apiUrl],
        compatibility: metadata?.compatibility || (metadata ? 'unknown' : 'built-in'), conflictingFields: metadata?.conflictingFields || [] }
    }))
    const issueCount = apis.filter(item => !item.exists || !item.scenarioExists || item.compatibility === 'needs-repair').length
    return { ...profile, label: profile.label || profile.id, page: profile.page || 'other', action: profile.action || 'view',
      actionLabel: profile.actionLabel || '查看详情', branchLabel: profile.branchLabel || profile.label || profile.id,
      actionFlows: Array.isArray(profile.actionFlows) ? profile.actionFlows : [], notes: Array.isArray(profile.notes) ? profile.notes : [],
      apis, ok: issueCount === 0, issueCount }
  }))
  const safeId = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/.test(value)
  const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  const safeText = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  const safeRoute = value => typeof value === 'string' && /^\/[a-zA-Z0-9_./-]*$/.test(value) && !value.includes('..') && !value.startsWith('//')
  const apiMockRelative = apiUrl => {
    const parts = apiUrl.replace(/^\/+/, '').split('/').filter(Boolean)
    while (parts[0] === 'mock') parts.shift()
    if (parts[0] === 'mesp-wpm') parts.shift()
    if (parts.length !== 2 || parts.some(part => !/^[a-zA-Z0-9_.-]+$/.test(part))) throw new Error(`Unsupported API URL: ${apiUrl}`)
    return join('src/baseTypes/api', parts[0], parts[1].replace(/\.json$/, ''), 'mock.json')
  }
  const atomicJson = async (file, value) => {
    await mkdir(join(file, '..'), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, file)
  }
  const readAnalysisPreferences = async () => {
    try {
      const value = JSON.parse(await readFile(analysisPreferenceFile, 'utf8'))
      return { schemaVersion: 1, mode: value.mode === 'assisted' ? 'assisted' : 'strict', sessionReuse: value.sessionReuse !== false }
    } catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1, mode: 'strict', sessionReuse: true }
      throw error
    }
  }
  const analysisCacheState = (async () => {
    try {
      const value = JSON.parse(await readFile(analysisCacheFile, 'utf8'))
      return value?.schemaVersion === 1 && plainObject(value.entries) ? value : { schemaVersion: 1, entries: {} }
    } catch {
      return { schemaVersion: 1, entries: {} }
    }
  })()
  const readAnalysisCache = () => analysisCacheState
  let analysisCacheDirty = false
  let analysisCachePersistTimer
  let analysisCachePersistQueue = Promise.resolve()
  const flushAnalysisCache = async () => {
    if (analysisCachePersistTimer) {
      clearTimeout(analysisCachePersistTimer)
      analysisCachePersistTimer = undefined
    }
    if (analysisCacheDirty) {
      analysisCacheDirty = false
      const cache = await readAnalysisCache()
      const snapshot = { schemaVersion: 1, entries: { ...cache.entries } }
      analysisCachePersistQueue = analysisCachePersistQueue.catch(() => {}).then(() => atomicJson(analysisCacheFile, snapshot))
        .catch(error => {
          analysisCacheDirty = true
          throw error
        })
    }
    await analysisCachePersistQueue
  }
  const scheduleAnalysisCachePersistence = () => {
    if (analysisCachePersistTimer) clearTimeout(analysisCachePersistTimer)
    analysisCachePersistTimer = setTimeout(() => {
      analysisCachePersistTimer = undefined
      void flushAnalysisCache().catch(error => console.warn(`[business-runtime] failed to persist analysis cache: ${error.message}`))
    }, 500)
    analysisCachePersistTimer.unref()
  }
  const contentHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const scenarioArray = config => Array.isArray(config?.scenarios)
    ? config.scenarios
    : Object.entries(config?.scenarios || {}).map(([id, value]) => ({ ...value, id }))
  const mockConfigCacheFile = join(userRoot, '.mock-config-cache.json')
  const mockConfigFileCache = new Map()
  const mockConfigCacheStats = { hits: 0, misses: 0, invalidations: 0, restoredHits: 0 }
  let mockConfigCacheDirty = false
  try {
    const persisted = JSON.parse(await readFile(mockConfigCacheFile, 'utf8'))
    if (persisted?.schemaVersion === 1 && persisted.projectId === manifest.projectId
      && persisted.buildId === manifest.buildId && persisted.sourceRoot === source && Array.isArray(persisted.entries)) {
      for (const entry of persisted.entries.slice(-500)) {
        if (!plainObject(entry) || typeof entry.file !== 'string' || typeof entry.fingerprint !== 'string' || !plainObject(entry.config)) continue
        mockConfigFileCache.set(entry.file, { fingerprint: entry.fingerprint, config: entry.config, restored: true })
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`[business-runtime] ignored invalid Mock config cache: ${error.message}`)
  }
  let mockConfigCachePersistQueue = Promise.resolve()
  let mockConfigCachePersistTimer
  const persistMockConfigCache = async () => {
    if (mockConfigCacheDirty) {
      mockConfigCacheDirty = false
      const document = { schemaVersion: 1, projectId: manifest.projectId, buildId: manifest.buildId, sourceRoot: source,
        entries: [...mockConfigFileCache.entries()].map(([file, value]) => ({ file, fingerprint: value.fingerprint, config: value.config })) }
      mockConfigCachePersistQueue = mockConfigCachePersistQueue.catch(() => {}).then(() => atomicJson(mockConfigCacheFile, document)).catch(error => {
        mockConfigCacheDirty = true
        console.warn(`[business-runtime] failed to persist Mock config cache: ${error.message}`)
      })
    }
    await mockConfigCachePersistQueue
  }
  const scheduleMockConfigCachePersistence = () => {
    if (mockConfigCachePersistTimer) return
    mockConfigCachePersistTimer = setTimeout(() => {
      mockConfigCachePersistTimer = undefined
      void persistMockConfigCache()
    }, 500)
    mockConfigCachePersistTimer.unref()
  }
  const readCachedMockFile = async file => {
    let metadata
    try { metadata = await stat(file) } catch (error) {
      if (error.code === 'ENOENT') {
        if (mockConfigFileCache.delete(file)) mockConfigCacheDirty = true
        return null
      }
      throw error
    }
    const fingerprint = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`
    const cached = mockConfigFileCache.get(file)
    if (cached?.fingerprint === fingerprint) {
      mockConfigCacheStats.hits += 1
      if (cached.restored) mockConfigCacheStats.restoredHits += 1
      return { file, config: cached.config }
    }
    if (cached) mockConfigCacheStats.invalidations += 1
    const config = JSON.parse(await readFile(file, 'utf8'))
    mockConfigCacheStats.misses += 1
    mockConfigFileCache.set(file, { fingerprint, config, restored: false })
    mockConfigCacheDirty = true
    while (mockConfigFileCache.size > 500) mockConfigFileCache.delete(mockConfigFileCache.keys().next().value)
    return { file, config }
  }
  const readMockConfig = async relativePath => {
    for (const file of [join(userRoot, relativePath), join(source, relativePath)]) {
      const result = await readCachedMockFile(file)
      if (result) return result
    }
    return null
  }
  const readFreshMockConfig = async relativePath => {
    for (const file of [join(userRoot, relativePath), join(source, relativePath)]) {
      try { return { file, config: JSON.parse(await readFile(file, 'utf8')) } }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return null
  }
  const validSemanticExpectations = (rules, routePath, query) => Array.isArray(rules) && rules.length <= 16 && rules.every(rule =>
    plainObject(rule) && safeText(rule.id, 128) && rule.routePath === routePath && rule.intentEquals === query
    && safeRoute(rule.apiUrl) && Array.isArray(rule.fieldAssertions) && rule.fieldAssertions.length <= 16
    && rule.fieldAssertions.every(assertion => plainObject(assertion) && Array.isArray(assertion.path)
      && assertion.path.length >= 1 && assertion.path.length <= 12
      && assertion.path.every(part => typeof part === 'number'
        ? Number.isSafeInteger(part) && part >= 0 && part <= 1000
        : typeof part === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(part)
          && !['__proto__', 'constructor', 'prototype'].includes(part))
      && (assertion.equals === null || ['string', 'number', 'boolean'].includes(typeof assertion.equals)))
    && Array.isArray(rule.sourceScenarioIds) && rule.sourceScenarioIds.length <= 32
    && rule.sourceScenarioIds.every(id => safeText(id, 128)))
  const checkScenarioSemanticValues = (rules, item, sourceScenario) => {
    const applicable = rules.filter(rule => rule.apiUrl === item.apiUrl && rule.fieldAssertions.length)
    if (!applicable.length) return { status: 'matched' }
    if (!sourceScenario) return { status: 'unknown', apiUrl: item.apiUrl, scenarioId: item.sourceScenarioId }
    for (const rule of applicable) {
      if (!rule.sourceScenarioIds.includes(item.sourceScenarioId)) return { status: 'conflict', apiUrl: item.apiUrl, scenarioId: item.sourceScenarioId, ruleId: rule.id }
      for (const assertion of rule.fieldAssertions) {
        let value = sourceScenario.data
        let present = true
        for (const part of assertion.path) {
          if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) { present = false; break }
          value = value[part]
        }
        if (!present || (value !== null && !['string', 'number', 'boolean'].includes(typeof value))) {
          return { status: 'unknown', apiUrl: item.apiUrl, scenarioId: item.sourceScenarioId, ruleId: rule.id, path: assertion.path }
        }
        if (value !== assertion.equals) return { status: 'conflict', apiUrl: item.apiUrl, scenarioId: item.sourceScenarioId, ruleId: rule.id, path: assertion.path }
      }
    }
    return { status: 'matched' }
  }
  const checkFreshSemanticSources = async (rules, scenarios) => {
    for (const item of scenarios) {
      if (!item?.sourceScenarioId) continue
      const applicable = rules.filter(rule => rule.apiUrl === item.apiUrl && rule.fieldAssertions.length)
      if (!applicable.length) continue
      if (!safeRoute(item.apiUrl) || !safeText(item.sourceScenarioId, 128)) return { status: 'unknown', apiUrl: item.apiUrl, scenarioId: item.sourceScenarioId }
      const existing = await readFreshMockConfig(apiMockRelative(item.apiUrl))
      const sourceScenario = existing && scenarioArray(existing.config).find(value => value.id === item.sourceScenarioId)
      const result = checkScenarioSemanticValues(rules, item, sourceScenario)
      if (result.status !== 'matched') return result
    }
    return { status: 'matched' }
  }
  const sourceTextFileCache = new Map()
  const sourceTextCacheStats = { hits: 0, misses: 0, invalidations: 0 }
  const readCachedSourceText = async relativePath => {
    const file = join(source, relativePath)
    const metadata = await stat(file)
    const fingerprint = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`
    const cached = sourceTextFileCache.get(file)
    if (cached?.fingerprint === fingerprint) {
      sourceTextCacheStats.hits += 1
      return { text: cached.text, fingerprint }
    }
    if (cached) sourceTextCacheStats.invalidations += 1
    const text = await readFile(file, 'utf8')
    sourceTextCacheStats.misses += 1
    sourceTextFileCache.set(file, { fingerprint, text })
    while (sourceTextFileCache.size > 300) sourceTextFileCache.delete(sourceTextFileCache.keys().next().value)
    return { text, fingerprint }
  }
  const typeFilesForMock = relativePath => {
    const directory = relativePath.replace(/\/mock\.json$/, '')
    return { request: `${directory}/Req.ts`, response: `${directory}/Rsp.ts` }
  }
  const readOptionalText = async file => {
    try { return await readFile(join(source, file), 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  const extractInterfaces = text => {
    const interfaces = new Map()
    const pattern = /(?:export\s+)?(?:default\s+)?interface\s+([A-Za-z_$][\w$]*)[^\{]*\{/g
    for (const match of text.matchAll(pattern)) {
      let depth = 1; let index = match.index + match[0].length
      for (; index < text.length && depth > 0; index += 1) {
        if (text[index] === '{') depth += 1
        else if (text[index] === '}') depth -= 1
      }
      if (depth === 0) interfaces.set(match[1], text.slice(match.index + match[0].length, index - 1))
    }
    return interfaces
  }
  const generatePayloadFromResponseType = (text, apiUrl) => {
    const interfaces = extractInterfaces(text)
    const defaultName = text.match(/export\s+default\s+interface\s+([A-Za-z_$][\w$]*)/)?.[1]
      || text.match(/export\s+default\s+([A-Za-z_$][\w$]*)/)?.[1]
    if (!defaultName || !interfaces.has(defaultName)) throw new Error(`Rsp.ts for ${apiUrl} has no supported default response interface`)
    const buildType = (rawType, depth, stack) => {
      const type = rawType.trim().replace(/\s+/g, ' ')
      if (depth > 8) return null
      if (/^(string|String)(\s*\|\s*(null|undefined))*$/.test(type)) return ''
      if (/^(number|Number)(\s*\|\s*(null|undefined))*$/.test(type)) return 0
      if (/^(boolean|Boolean)(\s*\|\s*(null|undefined))*$/.test(type)) return false
      const arrayType = type.match(/^(?:Array<(.+)>|(.+)\[\])$/)
      if (arrayType) return []
      if (/^Record<|^\{\s*\[/.test(type)) return {}
      const named = type.split('|').map(item => item.trim()).find(item => interfaces.has(item))
      if (!named || stack.has(named)) return null
      return buildInterface(named, depth + 1, new Set([...stack, named]))
    }
    const buildInterface = (name, depth, stack) => {
      const body = interfaces.get(name) || ''
      const result = {}
      const property = /(?:^|[;\n])\s*(?:readonly\s+)?["']?([A-Za-z_$][\w$]*)["']?\s*\??\s*:\s*([^;\n]+)\s*;?/g
      for (const match of body.matchAll(property)) result[match[1]] = buildType(match[2], depth, stack)
      return result
    }
    return buildInterface(defaultName, 0, new Set([defaultName]))
  }
  const generatedMockConfig = async (apiUrl, relativePath) => {
    const types = typeFilesForMock(relativePath)
    const [requestText, responseText] = await Promise.all([readOptionalText(types.request), readOptionalText(types.response)])
    if (!responseText) throw new Error(`Cannot create first mock for ${apiUrl}: Rsp.ts was not found`)
    const payload = generatePayloadFromResponseType(responseText, apiUrl)
    const method = apiUrl.split('/').at(-1).replace(/\.json$/, '')
    const baseData = { status: '0', msg: `local mock: ${method}`, data: payload }
    return {
      config: { label: method, defaultScenario: 'generated_default', baseData, scenarios: [] },
      typeEvidence: { request: requestText ? types.request : null, response: types.response },
    }
  }
  const normalizeScenarioData = (input, template, apiUrl) => {
    if (!plainObject(input)) throw new Error(`Scenario data for ${apiUrl} must be a JSON object`)
    if (!plainObject(template)) throw new Error(`Existing mock for ${apiUrl} has no object baseData/template`)
    const templatePayload = template.data
    const inputPayload = input.data
    if (plainObject(inputPayload) && plainObject(inputPayload.data) && plainObject(templatePayload) && !Object.hasOwn(templatePayload, 'data')) {
      throw new Error(`Scenario data for ${apiUrl} contains a duplicated data envelope`)
    }
    return { ...template, ...input }
  }
  const restoreRollback = async rollback => {
    const { rm } = await import('node:fs/promises')
    for (const item of [...rollback.files].reverse()) {
      if (item.content === null) await rm(item.file, { force: true })
      else await atomicJson(item.file, JSON.parse(item.content))
    }
  }
  const readSourceMock = async relativePath => {
    try { return JSON.parse(await readFile(join(source, relativePath), 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  const mockTemplate = config => config?.baseData || scenarioArray(config)[0]?.data || null
  const incompatiblePaths = (value, template, prefix = '') => {
    if (!plainObject(value) || !plainObject(template)) return []
    const issues = []
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(template, key)) { issues.push(prefix ? `${prefix}.${key}` : key); continue }
      if (plainObject(child) && plainObject(template[key])) issues.push(...incompatiblePaths(child, template[key], prefix ? `${prefix}.${key}` : key))
    }
    return issues
  }
  let userDataStatus = { schemaVersion: USER_DATA_SCHEMA_VERSION, migrated: false, operationId: null, conflicts: [] }
  const migrateUserData = async () => {
    const document = await readProfileDocument(userProfileFile)
    const profiles = document.profiles
    const originalProfilesJson = JSON.stringify(profiles)
    const rollback = { operationId: randomUUID(), kind: 'schema-migration', files: [] }
    const changes = new Map()
    const remember = async file => {
      if (rollback.files.some(item => item.file === file)) return
      try { rollback.files.push({ file, content: await readFile(file, 'utf8') }) } catch (error) { if (error.code === 'ENOENT') rollback.files.push({ file, content: null }); else throw error }
    }
    const conflicts = []
    for (const profile of profiles) {
      profile.schemaVersion = USER_DATA_SCHEMA_VERSION
      for (const apiUrl of Object.keys(profile.apis || {})) {
        const relativePath = apiMockRelative(apiUrl)
        const overlayFile = join(userRoot, relativePath)
        let overlay
        try { overlay = JSON.parse(await readFile(overlayFile, 'utf8')) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
        const sourceMock = await readSourceMock(relativePath)
        const currentHash = sourceMock ? contentHash(sourceMock) : null
        const previous = plainObject(overlay._dsh) ? overlay._dsh : {}
        const next = { ...previous, schemaVersion: USER_DATA_SCHEMA_VERSION, projectId: manifest.projectId }
        if (!previous.baseMockHash) {
          next.baseMockHash = currentHash
          next.baseBuildId = manifest.buildId
          next.compatibility = currentHash ? 'legacy-migrated' : 'source-missing'
        } else if (previous.baseMockHash !== currentHash) {
          const template = mockTemplate(sourceMock)
          const unknown = [...new Set(scenarioArray(overlay).flatMap(item => incompatiblePaths(item.data, template)))]
          if (sourceMock && unknown.length === 0) {
            next.baseMockHash = currentHash
            next.baseBuildId = manifest.buildId
            next.compatibility = 'auto-migrated'
            next.migratedAt = new Date().toISOString()
          } else {
            next.compatibility = 'needs-repair'
            next.currentBuildId = manifest.buildId
            next.conflictingFields = unknown
            conflicts.push({ profileId: profile.id, apiUrl, reason: sourceMock ? 'response-fields-changed' : 'source-mock-removed', fields: unknown })
          }
        } else {
          next.compatibility = 'compatible'
          next.baseBuildId = manifest.buildId
        }
        const nextOverlay = { ...overlay, schemaVersion: USER_DATA_SCHEMA_VERSION, _dsh: next }
        if (JSON.stringify(nextOverlay) !== JSON.stringify(overlay)) changes.set(overlayFile, nextOverlay)
      }
    }
    const nextDocument = { schemaVersion: USER_DATA_SCHEMA_VERSION, projectId: manifest.projectId, updatedAt: new Date().toISOString(), profiles }
    if (document.exists && (document.schemaVersion !== USER_DATA_SCHEMA_VERSION || JSON.stringify(profiles) !== originalProfilesJson)) changes.set(userProfileFile, nextDocument)
    if (changes.size) {
      for (const file of changes.keys()) await remember(file)
      const rollbackFile = join(userRoot, '.rollbacks', `${rollback.operationId}.json`)
      await remember(rollbackFile)
      try {
        for (const [file, value] of changes) await atomicJson(file, value)
        await atomicJson(rollbackFile, rollback)
        userDataStatus = { schemaVersion: USER_DATA_SCHEMA_VERSION, migrated: true, operationId: rollback.operationId, conflicts }
      } catch (error) {
        await restoreRollback(rollback)
        throw new Error(`User Mock migration rolled back: ${error.message}`)
      }
    } else userDataStatus = { schemaVersion: USER_DATA_SCHEMA_VERSION, migrated: false, operationId: null, conflicts }
  }
  const exportUserData = async () => {
    const { profiles } = await readProfileDocument(userProfileFile)
    const mocks = {}
    for (const profile of profiles) {
      for (const apiUrl of Object.keys(profile.apis || {})) {
        if (Object.hasOwn(mocks, apiUrl)) continue
        try { mocks[apiUrl] = JSON.parse(await readFile(join(userRoot, apiMockRelative(apiUrl)), 'utf8')) } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
      }
    }
    return { kind: USER_DATA_PACKAGE_KIND, schemaVersion: USER_DATA_SCHEMA_VERSION, projectId: manifest.projectId,
      sourceBuildId: manifest.buildId, exportedAt: new Date().toISOString(), profiles, mocks }
  }
  const objectFields = value => plainObject(value) ? Object.keys(value).slice(0, 80) : []
  const payloadFields = value => {
    if (!plainObject(value)) return []
    const fields = objectFields(value)
    for (const [key, child] of Object.entries(value)) {
      if (plainObject(child)) fields.push(...Object.keys(child).slice(0, 30).map(field => `${key}.${field}`))
      if (Array.isArray(child) && plainObject(child[0])) fields.push(...Object.keys(child[0]).slice(0, 30).map(field => `${key}[].${field}`))
    }
    return [...new Set(fields)].slice(0, 120)
  }
  const leafFieldValues = (value, prefix = '', depth = 0, output = new Map()) => {
    if (depth > 4 || output.size >= 160) return output
    if (Array.isArray(value)) {
      if (value.length) leafFieldValues(value[0], `${prefix}[]`, depth + 1, output)
      else if (prefix) output.set(prefix, value)
      return output
    }
    if (!plainObject(value)) {
      if (prefix) output.set(prefix, value)
      return output
    }
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key
      leafFieldValues(child, path, depth + 1, output)
      if (output.size >= 160) break
    }
    return output
  }
  const payloadLeafFields = value => leafFieldValues(plainObject(value?.data) ? value.data : value)
  const changedPayloadFields = (baseData, scenarioData, preparedBase) => {
    const base = preparedBase || payloadLeafFields(baseData)
    const scenario = payloadLeafFields(scenarioData)
    return [...new Set([...base.keys(), ...scenario.keys()].filter(field => JSON.stringify(base.get(field)) !== JSON.stringify(scenario.get(field))))].slice(0, 80)
  }
  const fieldConsumptionIndex = sources => {
    const evidenceByField = new Map()
    const pattern = /(?:\.\s*([A-Za-z_$][\w$]*)\b|\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]|\b([A-Za-z_$][\w$]*)\s*:)/g
    let occurrenceCount = 0
    let indexedLineCount = 0
    for (const sourceEntry of sources) {
      const newlineOffsets = []
      for (let offset = sourceEntry.text.indexOf('\n'); offset >= 0; offset = sourceEntry.text.indexOf('\n', offset + 1)) newlineOffsets.push(offset)
      indexedLineCount += newlineOffsets.length + 1
      const lineNumberAt = offset => {
        let low = 0
        let high = newlineOffsets.length
        while (low < high) {
          const middle = Math.floor((low + high) / 2)
          if (newlineOffsets[middle] < offset) low = middle + 1
          else high = middle
        }
        return low + 1
      }
      for (const match of sourceEntry.text.matchAll(pattern)) {
        const field = match[1] || match[2] || match[3]
        const matches = evidenceByField.get(field) || []
        if (matches.length >= 3) continue
        matches.push({ file: sourceEntry.file, line: lineNumberAt(match.index),
          syntax: match[0].trim(), source: 'bounded-source-field-consumption' })
        evidenceByField.set(field, matches)
        occurrenceCount += 1
      }
    }
    return { evidenceByField, occurrenceCount, indexedLineCount }
  }
  const fieldConsumptionIndexCache = new Map()
  const routeTitle = route => String(route.title || route.comment || route.name || '').trim()
  const routeCandidate = route => ({ routePath: route.path, ...(routeTitle(route) ? { pageTitle: routeTitle(route) } : {}) })
  const normalizedHint = value => String(value || '').toLowerCase().replace(/[\s/\\?&#=_-]+/gu, '')
  const configuredTargetAliases = Array.isArray(manifest.targetAliases) ? manifest.targetAliases : []
  const routeAliases = route => {
    const configured = configuredTargetAliases.find(item => item?.routePath === route.path)
    return [routeTitle(route), route.name, route.path, route.component, ...(Array.isArray(configured?.aliases) ? configured.aliases : [])]
      .map(normalizedHint).filter(Boolean)
  }
  const observedRoutePath = sessionId => {
    const raw = String(pageObservations.get(sessionId)?.route || '')
    const hashRoute = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw
    const routePath = hashRoute.split('?')[0]
    return safeRoute(routePath) ? routePath : undefined
  }
  const targetResolutionError = (code, message, candidates = []) => {
    const error = new Error(`${code}: ${message}${candidates.length ? ` Candidates: ${JSON.stringify(candidates.slice(0, 8))}` : ''}`)
    error.code = code
    error.candidates = candidates.slice(0, 8).map(routeCandidate)
    return error
  }
  const resolveTarget = async (input, sessionId = 'default') => {
    await refreshCodeIntell()
    if (codeIntellStatus.state !== 'ready') throw new Error(`CodeIntell unavailable: ${codeIntellStatus.error}`)
    const explicitRoute = String(input?.routePath || '').trim()
    const pageHint = String(input?.targetPage || '').trim()
    const query = String(input?.query || '').trim()
    const currentRoute = observedRoutePath(sessionId)
    const exactRoute = routePath => codeRoutes.filter(route => route.path === routePath)
    const result = (route, source, confidence, candidates = [route]) => ({
      ...routeCandidate(route),
      source,
      confidence,
      ...(currentRoute ? { currentRoute } : {}),
      candidates: candidates.map(routeCandidate)
    })

    if (explicitRoute) {
      if (!safeRoute(explicitRoute)) throw targetResolutionError('E_TARGET_ROUTE_INVALID', 'routePath must be a safe absolute business route.')
      const matches = exactRoute(explicitRoute)
      if (matches.length === 1) return result(matches[0], 'explicit-route', 'high')
      throw targetResolutionError('E_TARGET_ROUTE_NOT_FOUND', `No exact CodeIntell route matches ${explicitRoute}.`,
        codeRoutes.filter(route => route.path.includes(explicitRoute) || explicitRoute.includes(route.path)))
    }

    const matchHint = (hint, source) => {
      const normalized = normalizedHint(hint)
      if (!normalized) return undefined
      const exact = codeRoutes.filter(route => routeAliases(route).includes(normalized))
      if (exact.length === 1) return result(exact[0], source, 'high')
      if (exact.length > 1) throw targetResolutionError('E_TARGET_ROUTE_AMBIGUOUS', `Multiple routes exactly match ${hint}.`, exact)
      const fuzzy = codeRoutes.filter(route => {
        return routeAliases(route).some(alias => alias.length >= 2 && (normalized.includes(alias) || alias.includes(normalized)))
      }).sort((left, right) => Math.max(...routeAliases(right).map(alias => alias.length))
        - Math.max(...routeAliases(left).map(alias => alias.length)))
      if (fuzzy.length === 1) return result(fuzzy[0], source, source === 'page-hint' ? 'high' : 'medium')
      if (fuzzy.length > 1) {
        const topLength = Math.max(...routeAliases(fuzzy[0]).filter(alias => normalized.includes(alias) || alias.includes(normalized)).map(alias => alias.length))
        const top = fuzzy.filter(route => Math.max(...routeAliases(route).filter(alias => normalized.includes(alias) || alias.includes(normalized)).map(alias => alias.length)) === topLength)
        if (top.length === 1) return result(top[0], source, 'medium', fuzzy)
        throw targetResolutionError('E_TARGET_ROUTE_AMBIGUOUS', `The target ${hint} matches multiple business pages. Select an exact route or page.`, fuzzy)
      }
      return undefined
    }

    if (pageHint) {
      const pageTarget = matchHint(pageHint, 'page-hint')
      if (pageTarget) return pageTarget
      throw targetResolutionError('E_TARGET_PAGE_NOT_FOUND', `No CodeIntell route matches targetPage ${pageHint}.`)
    }

    const intentTarget = matchHint(query, 'query-intent')
    if (intentTarget) return intentTarget

    if (currentRoute) {
      const currentMatches = exactRoute(currentRoute)
      if (currentMatches.length === 1) return result(currentMatches[0], 'current-preview', 'medium')
    }
    throw targetResolutionError('E_TARGET_ROUTE_REQUIRED', 'The business intent does not identify one page and no valid current preview is available. Provide routePath or targetPage.')
  }
  const analyzeTarget = async (input, sessionId = 'default') => {
    const analysisStartedAt = performance.now()
    const roundDuration = value => Math.round(value * 100) / 100
    const codeIntellRefreshStartedAt = performance.now()
    await refreshCodeIntell()
    const codeIntellRefreshMs = roundDuration(performance.now() - codeIntellRefreshStartedAt)
    if (codeIntellStatus.state !== 'ready') throw new Error(`CodeIntell unavailable: ${codeIntellStatus.error}`)
    const routePath = String(input?.routePath || '').trim()
    const query = String(input?.query || '').trim().toLowerCase()
    const queryTerms = [...new Set([query, ...query.split(/[\s,，。；;、/]+/u)])].filter(term => term.length > 1)
    const queryScore = (text, points = 40, limit = 120) => Math.min(limit,
      queryTerms.reduce((score, term) => score + (String(text).toLowerCase().includes(term) ? points : 0), 0))
    if (!safeRoute(routePath)) throw new Error('routePath must be a safe absolute business route')
    const explicitApis = Array.isArray(input?.apiUrls) ? input.apiUrls : []
    const semanticExpectations = input?.semanticExpectations ?? []
    if (!validSemanticExpectations(semanticExpectations, routePath, input.query)) {
      throw new Error('Invalid semantic expectations for target analysis')
    }
    const preferencesStartedAt = performance.now()
    const preferences = await readAnalysisPreferences()
    const reuseEnabled = preferences.sessionReuse && semanticExpectations.length === 0
    const reuseKey = contentHash({
      sessionId,
      sourceDigest: codeIntellStatus.sourceDigestSha256 || codeIntellLifecycleStamp,
      analysisMode: preferences.mode,
      analysisMutationRevision,
      routePath,
      normalizedQuery: normalizedHint(query),
      explicitApis: [...explicitApis].filter(value => typeof value === 'string').sort()
    })
    const reusable = reuseEnabled ? sessionAnalysisReuse.get(reuseKey) : undefined
    const preferencesAndReuseLookupMs = roundDuration(performance.now() - preferencesStartedAt)
    if (reusable && reusable.expiresAt > Date.now()) {
      const evidenceId = randomUUID()
      const expiresAtMs = Date.now() + 30 * 60_000
      analysisEvidence.set(evidenceId, {
        routePath: reusable.evidence.routePath,
        apis: new Map(reusable.evidence.apis),
        expiresAt: expiresAtMs
      })
      return {
        ...reusable.result,
        evidenceId,
        expiresAt: new Date(expiresAtMs).toISOString(),
        analysisReuse: {
          enabled: true,
          reused: true,
          scope: 'same-session-exact-input',
          originalAnalyzedAt: reusable.analyzedAt,
          sourceRevalidated: true
        },
        analysisTimings: {
          reused: true,
          codeIntellRefreshMs,
          preferencesAndReuseLookupMs,
          totalMs: roundDuration(performance.now() - analysisStartedAt)
        }
      }
    }
    if (reusable) sessionAnalysisReuse.delete(reuseKey)
    const evidenceDiscoveryStartedAt = performance.now()
    const routeCandidates = codeRoutes
      .map(route => ({ ...route, score: route.path === routePath ? 100 : route.path.includes(routePath) || routePath.includes(route.path) ? 40 : 0 }))
      .filter(route => route.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
    if (!routeCandidates.length) throw new Error(`No CodeIntell route matches ${routePath}`)
    const route = routeCandidates[0]
    const componentFile = `src/${String(route.component || '').replace(/^\/+/, '')}`
    const componentDir = componentFile.replace(/\/[^/]+$/, '')
    const routeSegments = route.path.split('/').filter(Boolean)
    const routeToken = routeSegments.at(-1)?.toLowerCase() || ''
    const interactorPrefix = `src/interactors/${routeSegments.slice(0, 2).join('/')}`
    const apiMap = new Map()
    const relevantFiles = new Set([componentFile])
    for (const [file, bindings] of codeIntellDerived.fileApiEntries) {
      let baseScore = 0
      if (file === componentFile) baseScore = 120
      else if (file.startsWith(`${componentDir}/`)) baseScore = 100
      else if (file.startsWith(`${interactorPrefix}/`) || file === `${interactorPrefix}.ts` || file === `${interactorPrefix}.tsx`) baseScore = 80
      if (!baseScore) continue
      relevantFiles.add(file)
      for (const binding of bindings || []) {
        if (!binding?.url) continue
        const text = `${binding.url} ${binding.via || ''} ${file}`.toLowerCase()
        const score = baseScore + queryScore(text)
        const current = apiMap.get(binding.url)
        if (!current || current.score < score) apiMap.set(binding.url, { apiUrl: binding.url, score, evidence: [{ file, via: binding.via || '', source: 'codeIntell.fileToApis' }] })
        else if (current.evidence.length < 5) current.evidence.push({ file, via: binding.via || '', source: 'codeIntell.fileToApis' })
      }
    }
    const sourceReadConcurrency = 8
    const sourceReadStartedAt = performance.now()
    const sourceCacheStatsBeforeRead = { ...sourceTextCacheStats }
    const relevantFileList = [...relevantFiles]
    const relevantSource = []
    for (let index = 0; index < relevantFileList.length; index += sourceReadConcurrency) {
      const batch = await Promise.all(relevantFileList.slice(index, index + sourceReadConcurrency).map(async file => {
        try {
          const cachedSource = await readCachedSourceText(file)
          return { file, text: cachedSource.text, fingerprint: cachedSource.fingerprint }
        } catch { return undefined }
      }))
      relevantSource.push(...batch.filter(Boolean))
    }
    const sourceReadMs = roundDuration(performance.now() - sourceReadStartedAt)
    const sourceReadPlan = {
      strategy: 'bounded-parallel-metadata-validated-cache',
      concurrency: sourceReadConcurrency,
      requestedCount: relevantFileList.length,
      readCount: relevantSource.length,
      batchCount: Math.ceil(relevantFileList.length / sourceReadConcurrency),
      hits: sourceTextCacheStats.hits - sourceCacheStatsBeforeRead.hits,
      misses: sourceTextCacheStats.misses - sourceCacheStatsBeforeRead.misses,
      invalidations: sourceTextCacheStats.invalidations - sourceCacheStatsBeforeRead.invalidations,
      entries: sourceTextFileCache.size,
      maxEntries: 300
    }
    const sourceReferenceBySymbol = new Map()
    let sourceReferenceLookupCount = 0
    let sourceReferenceScanCount = 0
    const routeDomain = routeSegments[0]?.toLowerCase() || ''
    const dataServerDomainPrefix = routeDomain ? `src/dataserver/${routeDomain}/` : ''
    for (const caller of codeIntellDerived.apiCallerEntries) {
      sourceReferenceLookupCount += 1
      if (!sourceReferenceBySymbol.has(caller.symbol)) {
        sourceReferenceScanCount += 1
        sourceReferenceBySymbol.set(caller.symbol, relevantSource.find(item => item.text.includes(caller.symbol)))
      }
      const reference = sourceReferenceBySymbol.get(caller.symbol)
      const sameDataServerDomain = Boolean(dataServerDomainPrefix) && caller.callerFileLower.startsWith(dataServerDomainPrefix)
      if (!reference && !sameDataServerDomain) continue
      const current = apiMap.get(caller.apiUrl)
      const evidenceItem = reference
        ? { file: reference.file, via: caller.callerId, source: 'codeIntell.apiCallers+sourceSymbol' }
        : { file: caller.callerFile, via: caller.callerId, source: 'codeIntell.apiCallers+routeDomain' }
      const routeSymbolScore = routeToken && caller.symbolLower.includes(routeToken) ? 100 : 0
      const callerScore = (reference ? 110 : 60) + routeSymbolScore + queryScore(`${caller.apiUrl} ${caller.callerId}`)
      if (!current) apiMap.set(caller.apiUrl, { apiUrl: caller.apiUrl, score: callerScore, evidence: [evidenceItem] })
      else if (current.evidence.length < 5) { current.score = Math.max(current.score, callerScore); current.evidence.push(evidenceItem) }
    }
    // Some legacy dataServer modules pass enum members such as
    // `apiConfig.queryReceiptList` to fetch(). The index deliberately avoids
    // guessing through unresolved enum indirection, so recover only mappings
    // whose symbol is named by this route (or by already relevant source).
    // The URL still comes from checked-in source and must have an existing mock
    // below before it can become creation evidence.
    const domainApiConfig = `src/dataServer/${routeDomain}/apiconfig.ts`
    try {
      const configText = await readFile(join(source, domainApiConfig), 'utf8')
      const enumApiPattern = /\b([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+\.json)['"]/g
      for (const match of configText.matchAll(enumApiPattern)) {
        const symbol = match[1]
        const rawUrl = match[2]
        const referenced = relevantSource.find(item => item.text.includes(symbol))
        const routeNamed = Boolean(routeToken) && symbol.toLowerCase().includes(routeToken)
        if (!routeNamed && !referenced) continue
        const apiUrl = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
        const score = (routeNamed ? 140 : 90) + queryScore(`${symbol} ${apiUrl}`)
        const evidenceItem = {
          file: domainApiConfig,
          via: `config:${symbol}`,
          source: 'source.apiConfigSymbol'
        }
        const current = apiMap.get(apiUrl)
        if (!current) apiMap.set(apiUrl, { apiUrl, score, evidence: [evidenceItem] })
        else if (current.evidence.length < 5) {
          current.score = Math.max(current.score, score)
          current.evidence.push(evidenceItem)
        }
      }
    } catch {}
    for (const apiUrl of explicitApis) {
      if (typeof apiUrl !== 'string') continue
      if (!apiMap.has(apiUrl)) throw new Error([
        `E_API_ROUTE_EVIDENCE_GAP: explicit API lacks current CodeIntell/source evidence for this route: ${apiUrl}.`,
        'Stop analysis for this API; do not search generated CodeIntell files or retry URL variants.',
        'This is commonly a dynamic or untrackable call. Report the evidence gap and offer either a reviewed business-source Mock change or a separate CodeIntell dynamic-call enhancement.'
      ].join(' '))
      apiMap.get(apiUrl).score += 160
    }
    const evidenceDiscoveryMs = roundDuration(performance.now() - evidenceDiscoveryStartedAt)
    const accelerationStartedAt = performance.now()
    const acceleration = {
      mode: preferences.mode,
      usedCache: false,
      usedRecentRequests: false,
      cacheKey: null,
      prioritizedApiUrls: [],
      sourceRevalidated: true,
      fallback: preferences.mode === 'strict' ? 'strict-mode' : null
    }
    if (preferences.mode === 'assisted') {
      const sourceDigest = codeIntellStatus.sourceDigestSha256 || codeIntellLifecycleStamp
      const cacheKey = contentHash({ sourceDigest, routePath: route.path, queryTerms })
      acceleration.cacheKey = cacheKey
      const cache = await readAnalysisCache()
      const cached = cache.entries[cacheKey]
      const recentApis = evidence
        .filter(item => item.sessionId === sessionId && typeof item.path === 'string' && item.path.endsWith('.json'))
        .slice(-30)
        .map(item => item.path)
      const cachedApis = cached?.sourceDigest === sourceDigest && Array.isArray(cached.apiUrls) ? cached.apiUrls : []
      for (const apiUrl of [...new Set([...recentApis, ...cachedApis])]) {
        const candidate = apiMap.get(apiUrl)
        if (!candidate) continue
        candidate.score += recentApis.includes(apiUrl) ? 220 : 80
        acceleration.prioritizedApiUrls.push(apiUrl)
      }
      acceleration.usedCache = cachedApis.some(apiUrl => apiMap.has(apiUrl))
      acceleration.usedRecentRequests = recentApis.some(apiUrl => apiMap.has(apiUrl))
      if (!acceleration.usedCache && !acceleration.usedRecentRequests) acceleration.fallback = 'no-valid-hints'
    }
    const accelerationHintsMs = roundDuration(performance.now() - accelerationStartedAt)
    const apis = []
    const fieldImpactAnalysis = { strategy: 'single-pass-per-api-field-index', lookupCount: 0, cacheHitCount: 0,
      sourceIndexBuildCount: 0, sourceIndexReuseCount: 0, indexedFieldCount: 0, indexedOccurrenceCount: 0, indexedLineCount: 0,
      runtimeSourceIndexReuseCount: 0, baselineBuildCount: 0, scenarioDiffCount: 0 }
    const sharedConsumptionIndexes = new Map()
    const rankedCandidates = [...apiMap.values()].sort((a, b) => b.score - a.score).slice(0, 100)
    const preparationConcurrency = 8
    const preparationStartedAt = Date.now()
    const cacheStatsBeforePreparation = { ...mockConfigCacheStats }
    const preparedCandidates = []
    for (let index = 0; index < rankedCandidates.length; index += preparationConcurrency) {
      const preparedBatch = await Promise.all(rankedCandidates.slice(index, index + preparationConcurrency).map(async candidate => {
        let relativePath
        try { relativePath = apiMockRelative(candidate.apiUrl) } catch { return undefined }
        const existing = await readMockConfig(relativePath)
        let generated
        if (!existing) {
          try { generated = await generatedMockConfig(candidate.apiUrl, relativePath) } catch { return undefined }
        }
        return { candidate, relativePath, existing, generated, config: existing?.config || generated.config }
      }))
      preparedCandidates.push(...preparedBatch.filter(Boolean))
    }
    const candidatePreparation = {
      strategy: 'bounded-parallel-read',
      concurrency: preparationConcurrency,
      candidateCount: rankedCandidates.length,
      preparedCount: preparedCandidates.length,
      batchCount: Math.ceil(rankedCandidates.length / preparationConcurrency),
      durationMs: Date.now() - preparationStartedAt,
      mockConfigCache: {
        strategy: 'filesystem-metadata-validated',
        hits: mockConfigCacheStats.hits - cacheStatsBeforePreparation.hits,
        misses: mockConfigCacheStats.misses - cacheStatsBeforePreparation.misses,
        invalidations: mockConfigCacheStats.invalidations - cacheStatsBeforePreparation.invalidations,
        restoredHits: mockConfigCacheStats.restoredHits - cacheStatsBeforePreparation.restoredHits,
        entries: mockConfigFileCache.size,
        maxEntries: 500,
        persistence: 'user-root-exact-fingerprint',
        persistenceScheduling: 'debounced-background-with-close-flush',
        persistenceDelayMs: 500
      }
    }
    const shortlistedCandidates = preparedCandidates.map(prepared => {
      const scenarios = scenarioArray(prepared.config)
      const searchable = `${prepared.candidate.apiUrl} ${prepared.config.label || ''} ${scenarios.map(item => `${item.id} ${item.label || ''}`).join(' ')}`.toLowerCase()
      prepared.candidate.score += queryScore(searchable, 60, 180)
      return { ...prepared, scenarios }
    }).sort((left, right) => right.candidate.score - left.candidate.score).slice(0, 20)
    candidatePreparation.fieldAnalysisCandidateCount = shortlistedCandidates.length
    candidatePreparation.deferredCandidateCount = Math.max(0, preparedCandidates.length - shortlistedCandidates.length)
    const scenarioAnalysisStartedAt = performance.now()
    for (const { candidate, relativePath, existing, generated, config, scenarios } of shortlistedCandidates) {
      const template = config.baseData || scenarios[0]?.data || {}
      const baseLeafFields = payloadLeafFields(template)
      fieldImpactAnalysis.baselineBuildCount += 1
      const consumerFiles = new Set([componentFile, ...candidate.evidence.map(item => item.file).filter(Boolean)])
      const consumerSources = relevantSource.filter(item => consumerFiles.has(item.file))
      const consumerSourceKey = consumerSources.map(item => `${item.file}\u0001${item.fingerprint}`).sort().join('\u0000')
      const fieldEvidenceCache = new Map()
      let consumptionIndex
      const ensureConsumptionIndex = () => {
        if (consumptionIndex) return consumptionIndex
        const sharedIndex = sharedConsumptionIndexes.get(consumerSourceKey)
        if (sharedIndex) {
          fieldImpactAnalysis.sourceIndexReuseCount += 1
          consumptionIndex = sharedIndex
          return consumptionIndex
        }
        const runtimeCachedIndex = fieldConsumptionIndexCache.get(consumerSourceKey)
        if (runtimeCachedIndex) {
          fieldImpactAnalysis.runtimeSourceIndexReuseCount += 1
          consumptionIndex = runtimeCachedIndex
          sharedConsumptionIndexes.set(consumerSourceKey, consumptionIndex)
          return consumptionIndex
        }
        consumptionIndex = fieldConsumptionIndex(consumerSources)
        sharedConsumptionIndexes.set(consumerSourceKey, consumptionIndex)
        fieldConsumptionIndexCache.set(consumerSourceKey, consumptionIndex)
        while (fieldConsumptionIndexCache.size > 100) fieldConsumptionIndexCache.delete(fieldConsumptionIndexCache.keys().next().value)
        fieldImpactAnalysis.sourceIndexBuildCount += 1
        fieldImpactAnalysis.indexedFieldCount += consumptionIndex.evidenceByField.size
        fieldImpactAnalysis.indexedOccurrenceCount += consumptionIndex.occurrenceCount
        fieldImpactAnalysis.indexedLineCount += consumptionIndex.indexedLineCount
        return consumptionIndex
      }
      const cachedFieldEvidence = field => {
        fieldImpactAnalysis.lookupCount += 1
        if (fieldEvidenceCache.has(field)) {
          fieldImpactAnalysis.cacheHitCount += 1
          return fieldEvidenceCache.get(field)
        }
        const terminal = field.replace(/\[\]/g, '').split('.').at(-1)
        const fieldEvidence = terminal && /^[A-Za-z_$][\w$]*$/.test(terminal)
          ? ensureConsumptionIndex().evidenceByField.get(terminal) || []
          : []
        fieldEvidenceCache.set(field, fieldEvidence)
        return fieldEvidence
      }
      const scenarioSummaries = scenarios.slice(0, 50).map(item => {
        fieldImpactAnalysis.scenarioDiffCount += 1
        const changedFields = changedPayloadFields(template, item.data, baseLeafFields)
        const fieldEvidence = changedFields.map(field => ({ field, evidence: cachedFieldEvidence(field) }))
        const consumedFields = fieldEvidence.filter(item => item.evidence.length > 0).map(item => item.field)
        const unprovenFields = fieldEvidence.filter(item => item.evidence.length === 0).map(item => item.field)
        return { id: item.id, label: item.label || item.id, changedFields,
          fieldImpact: { level: consumedFields.length === 0 ? 'unproven' : unprovenFields.length ? 'partial' : 'consumed',
            consumedFields, unprovenFields, coverage: changedFields.length ? consumedFields.length / changedFields.length : 0,
            evidence: fieldEvidence.filter(item => item.evidence.length > 0).slice(0, 12) } }
      })
      apis.push({ ...candidate, mockPath: relativePath, mockExists: Boolean(existing), canGenerate: Boolean(existing || generated), typeEvidence: generated?.typeEvidence,
        label: config.label || candidate.apiUrl,
        envelopeFields: objectFields(template), fields: payloadFields(template.data),
        scenarios: scenarioSummaries })
    }
    apis.sort((a, b) => b.score - a.score)
    if (!apis.length) throw new Error(`CodeIntell found no existing API mocks for ${route.path}`)
    const scenarioFieldAnalysisMs = roundDuration(performance.now() - scenarioAnalysisStartedAt)
    const rankingStartedAt = performance.now()
    const normalizedQuery = normalizedHint(input.query)
    const scenarioIntentMatch = scenario => {
      const labels = [...new Set([scenario.label, scenario.id].map(normalizedHint).filter(Boolean))]
      let score = 0
      const reasons = []
      for (const label of labels) {
        if (label.length >= 2 && normalizedQuery.includes(label)) {
          score = Math.max(score, 180)
          reasons.push('full-label')
        }
        const core = label
          .replace(/^(?:体验平台|默认)/u, '')
          .replace(/(?:返回|响应|数据|场景|mock)$/iu, '')
        if (core.length >= 2 && normalizedQuery.includes(core)) {
          score = Math.max(score, 120)
          reasons.push('business-state')
        }
        const bigrams = new Set(Array.from({ length: Math.max(0, label.length - 1) }, (_, index) => label.slice(index, index + 2)))
        const overlap = [...bigrams].filter(token => normalizedQuery.includes(token))
        if (overlap.length >= 2) {
          score = Math.max(score, Math.min(110, 60 + overlap.length * 10))
          reasons.push('phrase-overlap')
        }
      }
      return score ? { score, reasons: [...new Set(reasons)] } : undefined
    }
    const existingScenarioMatches = apis.flatMap(api => api.scenarios.flatMap(scenario => {
      const match = scenarioIntentMatch(scenario)
      if (!match) return []
      const consumedFieldCount = scenario.fieldImpact?.consumedFields?.length || 0
      const impactCoverage = Number(scenario.fieldImpact?.coverage || 0)
      const impactScore = consumedFieldCount ? Math.min(50, 20 + consumedFieldCount * 5 + Math.round(impactCoverage * 20)) : 0
      return [{ apiUrl: api.apiUrl, scenarioId: scenario.id, label: scenario.label,
        score: api.score + match.score + impactScore,
        matchScore: match.score,
        impactScore,
        impactCoverage,
        consumedFieldCount,
        reasons: [...match.reasons, ...(impactScore ? ['field-impact-consumed'] : [])] }]
    })).sort((left, right) => right.score - left.score).slice(0, 12)
    const matchedApiUrls = [...new Set(existingScenarioMatches.map(item => item.apiUrl))]
    const confidentExistingMatch = (existingScenarioMatches[0]?.matchScore || 0) >= 120
    const focusApiUrls = explicitApis.length
      ? [...new Set(explicitApis.filter(apiUrl => apis.some(api => api.apiUrl === apiUrl)))]
      : matchedApiUrls.length ? matchedApiUrls.slice(0, 6) : apis.slice(0, 6).map(api => api.apiUrl)
    const analysisPlan = {
      strategy: explicitApis.length ? 'explicit-api' : existingScenarioMatches.length ? 'existing-scenario-match' : 'evidence-ranked',
      confidence: explicitApis.length ? 'high' : confidentExistingMatch ? 'medium' : 'low',
      focusApiUrls,
      alternativeApiUrls: apis.map(api => api.apiUrl).filter(apiUrl => !focusApiUrls.includes(apiUrl)),
      existingScenarioMatches,
      evidenceCandidateCount: apis.length,
      scenarioRanking: {
        strategy: 'intent-source-and-field-impact',
        fieldImpactMaxBonus: 50,
        note: 'Field consumption evidence improves ranking but never replaces intent matching or final iframe verification.'
      },
      fieldImpactAnalysis: {
        ...fieldImpactAnalysis,
        avoidedSourceScans: Math.max(0, fieldImpactAnalysis.lookupCount - fieldImpactAnalysis.sourceIndexBuildCount),
        avoidedSourceIndexBuilds: fieldImpactAnalysis.sourceIndexReuseCount + fieldImpactAnalysis.runtimeSourceIndexReuseCount,
        runtimeSourceIndexCache: { entries: fieldConsumptionIndexCache.size, maxEntries: 100,
          validation: 'source-file-metadata-fingerprint' },
        avoidedBaselineTraversals: Math.max(0, fieldImpactAnalysis.scenarioDiffCount - fieldImpactAnalysis.baselineBuildCount)
      },
      candidatePreparation,
      sourceReadPlan,
      evidenceDiscoveryIndex: {
        strategy: 'lifecycle-derived-callers-with-request-symbol-memo',
        fileApiEntryCount: codeIntellDerived.fileApiEntries.length,
        apiCallerEntryCount: codeIntellDerived.apiCallerEntries.length,
        sourceReferenceLookupCount,
        sourceReferenceScanCount,
        avoidedSourceReferenceScans: Math.max(0, sourceReferenceLookupCount - sourceReferenceScanCount)
      },
      repositorySearch: explicitApis.length || confidentExistingMatch ? 'not-needed' : 'only-if-focus-candidates-are-insufficient',
      guidance: existingScenarioMatches.length
        ? 'Review the matched existing scenarios before proposing new Mock data. Keep all writes behind the workflow checkpoint.'
        : 'Start with focusApiUrls. Search source only when the bounded evidence packet cannot represent the requested business state.'
    }
    const strongestMatch = existingScenarioMatches[0]
    const nextMatch = existingScenarioMatches[1]
    const uniqueConfidentMatch = confidentExistingMatch && strongestMatch
      && strongestMatch.apiUrl === focusApiUrls[0]
      && (!nextMatch || strongestMatch.score - nextMatch.score >= 40)
    const candidateScenario = strongestMatch
      ? apis.find(api => api.apiUrl === strongestMatch.apiUrl)?.scenarios.find(scenario => scenario.id === strongestMatch.scenarioId)
      : undefined
    const strongestScenario = uniqueConfidentMatch ? candidateScenario : undefined
    const strongestScenarioHasFieldImpact = Boolean(strongestScenario?.fieldImpact?.consumedFields?.length)
    analysisPlan.fieldImpact = strongestMatch ? {
      status: candidateScenario?.fieldImpact?.level || 'unproven',
      candidateOnly: !uniqueConfidentMatch,
      evidenceKind: 'bounded-source-field-consumption',
      apiUrl: strongestMatch.apiUrl,
      scenarioId: strongestMatch.scenarioId,
      changedFieldCount: candidateScenario?.changedFields?.length || 0,
      consumedFieldCount: candidateScenario?.fieldImpact?.consumedFields?.length || 0,
      unprovenFieldCount: candidateScenario?.fieldImpact?.unprovenFields?.length || 0,
      fieldListLimit: 24,
      changedFields: (candidateScenario?.changedFields || []).slice(0, 24),
      consumedFields: (candidateScenario?.fieldImpact?.consumedFields || []).slice(0, 24),
      unprovenFields: (candidateScenario?.fieldImpact?.unprovenFields || []).slice(0, 24),
      coverage: candidateScenario?.fieldImpact?.coverage || 0,
      finalUiVerificationRequired: true
    } : {
      status: 'pending-plan-fields',
      evidenceKind: 'bounded-source-field-consumption',
      changedFields: [], consumedFields: [], unprovenFields: [], coverage: 0,
      finalUiVerificationRequired: true
    }
    const focusApis = focusApiUrls.map(apiUrl => apis.find(api => api.apiUrl === apiUrl)).filter(Boolean)
    const allFocusApisGeneratable = focusApis.length > 0 && focusApis.every(api => api.canGenerate)
    const allFocusApisHaveSourceEvidence = focusApis.length > 0 && focusApis.every(api => Array.isArray(api.evidence) && api.evidence.length > 0)
    const qualityGaps = []
    if (!normalizedQuery) qualityGaps.push('business-intent-empty')
    if (!focusApis.length) qualityGaps.push('focus-api-missing')
    if (!allFocusApisGeneratable) qualityGaps.push('focus-api-not-generatable')
    if (!allFocusApisHaveSourceEvidence) qualityGaps.push('source-evidence-missing')
    if (!explicitApis.length && !confidentExistingMatch) qualityGaps.push('intent-match-not-confident')
    if (confidentExistingMatch && !uniqueConfidentMatch) qualityGaps.push('existing-scenario-match-ambiguous')
    if (uniqueConfidentMatch && !strongestScenarioHasFieldImpact) qualityGaps.push('matched-scenario-field-impact-unproven')
    let qualityScore = 20
    if (normalizedQuery) qualityScore += 10
    if (focusApis.length) qualityScore += 15
    if (allFocusApisGeneratable) qualityScore += 15
    if (allFocusApisHaveSourceEvidence) qualityScore += 15
    if (explicitApis.length) qualityScore += 25
    else if (uniqueConfidentMatch) qualityScore += 25
    else if (confidentExistingMatch) qualityScore += 10
    qualityScore = Math.max(0, Math.min(100, qualityScore
      - (qualityGaps.includes('existing-scenario-match-ambiguous') ? 10 : 0)
      - (qualityGaps.includes('matched-scenario-field-impact-unproven') ? 20 : 0)))
    const ready = Boolean(normalizedQuery && focusApis.length && allFocusApisGeneratable && allFocusApisHaveSourceEvidence
      && (explicitApis.length || (uniqueConfidentMatch && strongestScenarioHasFieldImpact)))
    const reviewable = Boolean(normalizedQuery && focusApis.length && allFocusApisGeneratable && allFocusApisHaveSourceEvidence)
    analysisPlan.qualityGate = {
      score: qualityScore,
      level: ready ? 'ready' : reviewable ? 'review' : 'insufficient',
      decision: ready ? 'proceed-with-confirmation' : reviewable ? 'review-focused-evidence' : 'refine-target-before-creation',
      autoDraftAllowed: ready && uniqueConfidentMatch,
      gaps: qualityGaps,
      factors: {
        explicitApiCount: explicitApis.length,
        focusApiCount: focusApis.length,
        focusApisGeneratable: allFocusApisGeneratable,
        focusApisHaveSourceEvidence: allFocusApisHaveSourceEvidence,
        confidentExistingMatch,
        uniqueConfidentMatch,
        candidateHasFieldImpact: Boolean(candidateScenario?.fieldImpact?.consumedFields?.length),
        strongestScenarioHasFieldImpact
      },
      guidance: ready
        ? 'Confirm the focused plan; existing workflow write and preview gates still apply.'
        : reviewable
          ? 'Review focused evidence and alternatives. Request full workflow detail only when the bounded evidence remains ambiguous.'
          : 'Do not create a scenario yet. Refine the target page/API or repair the reported evidence gap.'
    }
    const compareSemanticCandidate = match => {
      const applicable = semanticExpectations.filter(rule => rule.apiUrl === match.apiUrl)
      if (!applicable.length) return { status: 'not-declared', reuseAdvice: 'no-semantic-rule-for-api', rules: [] }
      const scenario = shortlistedCandidates.find(item => item.candidate.apiUrl === match.apiUrl)
        ?.scenarios.find(item => item.id === match.scenarioId)
      const rules = applicable.map(rule => {
        const assertions = rule.fieldAssertions.map(assertion => {
          let actual = scenario?.data
          let present = Boolean(scenario)
          for (const part of assertion.path) {
            if (!present || !actual || typeof actual !== 'object' || !Object.hasOwn(actual, part)) { present = false; break }
            actual = actual[part]
          }
          const scalar = present && (actual === null || ['string', 'number', 'boolean'].includes(typeof actual))
          const status = !scalar ? 'unknown' : actual === assertion.equals ? 'matched' : 'conflict'
          return { path: assertion.path, expected: assertion.equals,
            ...(scalar && (typeof actual !== 'string' || actual.length <= 64) ? { actual } : {}),
            status }
        })
        const status = assertions.some(item => item.status === 'conflict') ? 'conflict'
          : assertions.length && assertions.every(item => item.status === 'matched') ? 'matched' : 'unknown'
        return { ruleId: rule.id, status, approvedSource: rule.sourceScenarioIds.includes(match.scenarioId), assertions }
      })
      const status = rules.some(item => item.status === 'conflict') ? 'conflict'
        : rules.every(item => item.status === 'matched') ? 'matched' : 'unknown'
      return { status, reuseAdvice: status === 'conflict' ? 'do-not-reuse'
        : status === 'matched' && rules.every(item => item.approvedSource) ? 'eligible-for-reviewed-source-reuse'
          : status === 'matched' ? 'values-match-but-source-not-allowlisted' : 'manual-value-review-required',
      rules }
    }
    if (semanticExpectations.length) {
      analysisPlan.semanticValueChecks = {
        method: 'plugin-declared-exact-scalar-assertions',
        note: 'Only declared paths are classified. Matched values do not prove final UI behavior; missing paths remain unknown. Source ID approval is reported separately.',
        candidates: existingScenarioMatches.slice(0, 3).map(match => ({ apiUrl: match.apiUrl,
          scenarioId: match.scenarioId, ...compareSemanticCandidate(match) })),
        approvedSources: [...new Map(semanticExpectations.flatMap(rule => rule.sourceScenarioIds.map(scenarioId => {
          const key = `${rule.apiUrl}\u0000${scenarioId}`
          return [key, { apiUrl: rule.apiUrl, scenarioId,
            ...compareSemanticCandidate({ apiUrl: rule.apiUrl, scenarioId }) }]
        }))).values()]
      }
    }
    if (analysisPlan.qualityGate.level === 'review') {
      analysisPlan.reviewPacket = {
        status: 'manual-review-required',
        autoReuseEligibility: { uniqueConfidentMatch: Boolean(uniqueConfidentMatch),
          candidateHasFieldImpact: Boolean(candidateScenario?.fieldImpact?.consumedFields?.length),
          explanation: 'strongestScenarioHasFieldImpact requires a unique confident match; false does not imply that the leading candidate lacks field-consumption evidence.' },
        reason: qualityGaps.map(gap => ({ code: gap, explanation: {
          'intent-match-not-confident': 'No existing Scenario has a sufficiently strong intent match; field consumption does not establish business-state correctness.',
          'existing-scenario-match-ambiguous': 'Multiple existing Scenarios are close in rank; inspect their Mock state before choosing one.',
          'matched-scenario-field-impact-unproven': 'The leading Scenario has no proven consumption of its changed fields on this page.'
        }[gap] || 'Review the reported evidence gap before confirming a plan.' })),
        candidates: existingScenarioMatches.slice(0, 3).map(match => {
          const scenario = apis.find(api => api.apiUrl === match.apiUrl)?.scenarios.find(item => item.id === match.scenarioId)
          const impact = scenario?.fieldImpact
          return { apiUrl: match.apiUrl, scenarioId: match.scenarioId, label: match.label,
            intentMatchScore: match.matchScore, rankingScore: match.score,
            rankingBreakdown: { apiEvidenceScore: match.score - match.matchScore - match.impactScore,
              intentMatchScore: match.matchScore, fieldImpactScore: match.impactScore },
            matchReasons: match.reasons.filter(reason => reason !== 'field-impact-consumed'),
            ...(semanticExpectations.length ? { semanticComparison: compareSemanticCandidate(match) } : {}),
            fieldImpact: { level: impact?.level || 'unproven', coverage: impact?.coverage || 0,
              changedFieldCount: scenario?.changedFields?.length || 0,
              consumedFieldCount: impact?.consumedFields?.length || 0,
              unprovenFieldCount: impact?.unprovenFields?.length || 0,
              interpretation: 'Counts describe changed fields in this Scenario, not the fields required by the requested UI state. Unproven means no consumption was found in the bounded source set, not that the field is unused or necessary.',
              consumedFields: (impact?.consumedFields || []).slice(0, 12),
              sourceEvidence: (impact?.evidence || []).slice(0, 4).map(item => ({ field: item.field,
                evidence: (item.evidence || []).slice(0, 1) })) } }
        }),
        checksBeforeConfirmation: [
          'Compare the intended business state with the actual Mock values in the selected Scenario; names and scores alone are insufficient.',
          'Check changed fields that are consumed by this page and explain any relevant unproven fields.',
          'Keep Profile creation behind confirm-plan and verify the final iframe text and real Scenario requests after applying.'
        ]
      }
    }
    if (analysisPlan.qualityGate.autoDraftAllowed) {
      const draftHash = contentHash({ routePath: route.path, query: input.query || '', apiUrl: strongestMatch.apiUrl, scenarioId: strongestMatch.scenarioId }).slice(0, 12)
      analysisPlan.suggestedPlan = {
        kind: 'reuse-existing-scenario',
        requiresConfirmation: true,
        profileId: `scenario_${draftHash}`,
        label: String(input.query || strongestMatch.label || '业务体验场景').slice(0, 200),
        page: (routeToken || 'business').slice(0, 64),
        scenarios: [{
          id: `scenario_${draftHash}`,
          apiUrl: strongestMatch.apiUrl,
          label: String(strongestMatch.label || strongestMatch.scenarioId).slice(0, 200),
          sourceScenarioId: strongestMatch.scenarioId
        }]
      }
    }
    const rankingAndQualityMs = roundDuration(performance.now() - rankingStartedAt)
    const persistenceStartedAt = performance.now()
    const evidenceId = randomUUID()
    const analyzedAt = new Date().toISOString()
    const expiresAtMs = Date.now() + 30 * 60_000
    const result = { evidenceId, expiresAt: new Date(expiresAtMs).toISOString(), query: input.query || '',
      route: { path: route.path, title: route.title || route.comment || route.name, component: componentFile, moduleFile: route.moduleFile },
      routeCandidates: routeCandidates.map(item => ({ path: item.path, title: item.title || item.comment || item.name, component: `src/${item.component}` })),
      apis, analysisPlan,
      acceleration,
      analysisReuse: { enabled: reuseEnabled, reused: false, scope: 'same-session-exact-input', analyzedAt, sourceRevalidated: true }
    }
    const resultPreparedAt = performance.now()
    const evidenceRecord = { routePath: route.path,
      apis: new Map(apis.map(api => [api.apiUrl, { mockPath: api.mockPath, mockExists: api.mockExists, typeEvidence: api.typeEvidence }])),
      expiresAt: expiresAtMs }
    analysisEvidence.set(evidenceId, evidenceRecord)
    const evidenceStoredAt = performance.now()
    if (reuseEnabled) {
      sessionAnalysisReuse.set(reuseKey, { result, evidence: evidenceRecord, expiresAt: Date.now() + 5 * 60_000, analyzedAt })
      while (sessionAnalysisReuse.size > 50) sessionAnalysisReuse.delete(sessionAnalysisReuse.keys().next().value)
    }
    const reuseStoredAt = performance.now()
    let hintReadMs = 0
    let hintSortMs = 0
    let hintScheduleMs = 0
    if (preferences.mode === 'assisted' && acceleration.cacheKey) {
      const hintReadStartedAt = performance.now()
      const cache = await readAnalysisCache()
      hintReadMs = roundDuration(performance.now() - hintReadStartedAt)
      cache.entries[acceleration.cacheKey] = {
        sourceDigest: codeIntellStatus.sourceDigestSha256 || codeIntellLifecycleStamp,
        routePath: route.path,
        query: input.query || '',
        apiUrls: apis.slice(0, 12).map(api => api.apiUrl),
        updatedAt: new Date().toISOString()
      }
      const hintSortStartedAt = performance.now()
      const entries = Object.entries(cache.entries)
        .sort((left, right) => {
          const newer = String(right[1].updatedAt)
          const older = String(left[1].updatedAt)
          return newer < older ? -1 : newer > older ? 1 : 0
        })
        .slice(0, 100)
      cache.entries = Object.fromEntries(entries)
      const hintSortedAt = performance.now()
      hintSortMs = roundDuration(hintSortedAt - hintSortStartedAt)
      analysisCacheDirty = true
      scheduleAnalysisCachePersistence()
      hintScheduleMs = roundDuration(performance.now() - hintSortedAt)
    }
    const hintUpdatedAt = performance.now()
    scheduleMockConfigCachePersistence()
    const mockScheduledAt = performance.now()
    result.analysisTimings = {
      reused: false,
      codeIntellRefreshMs,
      preferencesAndReuseLookupMs,
      evidenceDiscoveryMs,
      sourceReadMs,
      accelerationHintsMs,
      candidatePreparationMs: candidatePreparation.durationMs,
      scenarioFieldAnalysisMs,
      rankingAndQualityMs,
      persistenceMs: roundDuration(performance.now() - persistenceStartedAt),
      persistencePhases: {
        resultAssemblyMs: roundDuration(resultPreparedAt - persistenceStartedAt),
        evidenceStoreMs: roundDuration(evidenceStoredAt - resultPreparedAt),
        reuseStoreMs: roundDuration(reuseStoredAt - evidenceStoredAt),
        assistedHintUpdateMs: roundDuration(hintUpdatedAt - reuseStoredAt),
        assistedHintReadMs: hintReadMs,
        assistedHintSortMs: hintSortMs,
        assistedHintScheduleMs: hintScheduleMs,
        mockCacheScheduleMs: roundDuration(mockScheduledAt - hintUpdatedAt)
      },
      totalMs: roundDuration(performance.now() - analysisStartedAt),
      counts: {
        routeCandidates: routeCandidates.length,
        relevantSourceFiles: relevantSource.length,
        evidenceApiCandidates: apiMap.size,
        preparedMockCandidates: preparedCandidates.length,
        rankedApis: apis.length,
        matchedScenarios: existingScenarioMatches.length
      }
    }
    return result
  }
  await migrateUserData()
  const defaultSessionId = 'default'
  const runtimeStateFile = join(userRoot, '.preview-runtime-state.json')
  let persistedSessionStates = {}
  try {
    const restored = JSON.parse(await readFile(runtimeStateFile, 'utf8'))
    if (plainObject(restored?.sessions)) persistedSessionStates = restored.sessions
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`[business-runtime] ignored invalid preview state: ${error.message}`)
  }
  const availableProfileIdsAtStartup = new Set((await catalog()).map(profile => profile.id))
  const sessionStates = new Map()
  const pageObservations = new Map()
  const verificationResults = new Map()
  const creationRecords = new Map()
  const businessAppUrl = route => {
    const target = new URL(developmentAppUrl || `${origin}${manifest.businessPath}`)
    target.hash = route
    return target.href
  }
  const initialState = () => ({ revision: 0, profileId: '', url: businessAppUrl(manifest.entryRoute), verified: false })
  const safeSessionId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value) ? value : defaultSessionId
  const cookieValue = (req, name) => String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1)
  const requestSessionId = (req, url) => safeSessionId(req.headers['x-dsh-session'] || url.searchParams.get('__dshSession') || decodeURIComponent(cookieValue(req, 'dsh_business_session') || ''))
  const stateFor = sessionId => {
    if (!sessionStates.has(sessionId)) {
      const restored = persistedSessionStates[sessionId]
      if (plainObject(restored) && typeof restored.route === 'string' && restored.route.startsWith('/') && !restored.route.startsWith('//')) {
        const target = new URL(businessAppUrl(restored.route.slice(0, 500)))
        const restoredProfileId = typeof restored.profileId === 'string' && availableProfileIdsAtStartup.has(restored.profileId)
          ? restored.profileId
          : ''
        if (restoredProfileId) target.searchParams.set('__mockProfile', restoredProfileId)
        target.searchParams.set('__dshSession', sessionId)
        sessionStates.set(sessionId, { revision: Number.isInteger(restored.revision) ? restored.revision : 0,
          profileId: restoredProfileId, url: target.href, verified: false })
      } else sessionStates.set(sessionId, initialState())
    }
    return sessionStates.get(sessionId)
  }
  const persistSessionStates = async () => {
    const sessions = {}
    for (const [sessionId, value] of sessionStates) {
      let route = manifest.entryRoute
      try { route = new URL(value.url).hash.replace(/^#/, '') || manifest.entryRoute } catch {}
      sessions[sessionId] = { revision: value.revision, profileId: value.profileId, route: route.slice(0, 500) }
    }
    persistedSessionStates = sessions
    await atomicJson(runtimeStateFile, { schemaVersion: 1, projectId: manifest.projectId, sessions, updatedAt: new Date().toISOString() })
  }
  const evidence = []
  const externalEvidenceFile = join(userRoot, '.runtime-evidence.jsonl')
  const externalEvidence = async () => {
    try {
      const lines = (await readFile(externalEvidenceFile, 'utf8')).trim().split('\n').slice(-200)
      return lines.flatMap(line => {
        try {
          const value = JSON.parse(line)
          return plainObject(value) ? [value] : []
        } catch { return [] }
      })
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`[business-runtime] ignored invalid external evidence: ${error.message}`)
      return []
    }
  }
  const scenarioResult = async (sessionId, state, pageObservation) => {
    const profile = (await profileSummaries()).find(item => item.id === state.profileId)
    const requests = [...evidence, ...(await externalEvidence())].filter(item => item.sessionId === sessionId
      && item.profileId === state.profileId && (item.revision === undefined || item.revision === state.revision))
    const matchedScenarios = new Set(requests.map(item => item.scenarioId).filter(Boolean))
    const apiBindings = (profile?.apis || []).map(api => ({
      apiUrl: api.apiUrl, scenarioId: api.scenarioId, hit: matchedScenarios.has(api.scenarioId),
      fields: api.driverFields || [], compatibility: api.compatibility, conflictingFields: api.conflictingFields || []
    }))
    const requestHit = apiBindings.length > 0 && apiBindings.every(api => api.hit)
    const verification = verificationResults.get(sessionId) || null
    let failureCategory = null
    if (!profile) failureCategory = 'profile-not-applied'
    else if (!requestHit) failureCategory = 'api-not-hit'
    else if (verification && !verification.checks.route) failureCategory = 'route-mismatch'
    else if (verification && (!verification.checks.observationCurrent
      || verification.checks.containsText.some(item => !item.passed)
      || verification.checks.absentText.some(item => !item.passed))) failureCategory = 'ui-assertion-failed'
    else if (!state.verified) failureCategory = 'verification-pending'
    const stages = {
      created: { passed: Boolean(profile), detail: profile ? `场景 ${profile.id} 已存在` : '尚未创建或选择场景' },
      applied: { passed: Boolean(profile), detail: profile ? `Profile ${profile.id} 已应用` : '尚未应用 Profile' },
      requestHit: { passed: requestHit, detail: `${apiBindings.filter(api => api.hit).length}/${apiBindings.length} 个 API 分支已真实命中` },
      verified: { passed: state.verified === true, detail: state.verified ? '路由、请求和页面断言均通过' : '页面尚未完成验证或断言未通过' }
    }
    return { sessionId, revision: state.revision, profileId: state.profileId, status: state.verified ? 'verified' : failureCategory,
      failureCategory, stages, creation: creationRecords.get(state.profileId) || null, apiBindings,
      requests: requests.slice(-30), page: pageObservation && { ...pageObservation, text: pageObservation.text.slice(0, 1000) }, verification }
  }
  let nextHandler
  const respond = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
  const validateMockRequest = async (apiUrl, profileId, scenarioId) => {
    const headers = {}
    let statusCode = 200
    let payload
    await new Promise((resolveRequest, rejectRequest) => {
      const response = {
        setHeader(name, value) { headers[String(name).toLowerCase()] = String(value) },
        status(value) { statusCode = value; return this },
        json(value) { payload = value; resolveRequest() },
        send(value) { payload = value; resolveRequest() },
        redirect() { rejectRequest(new Error(`Unexpected redirect while validating ${apiUrl}`)) }
      }
      try {
        middleware({ path: apiUrl, query: { __mockProfile: profileId }, headers: {}, method: 'POST' }, response)
      } catch (error) { rejectRequest(error) }
    })
    if (statusCode !== 200) throw new Error(`Mock request validation returned HTTP ${statusCode} for ${apiUrl}`)
    if (decodeURIComponent(headers['x-local-mock-profile'] || '') !== profileId) throw new Error(`Mock request did not select Profile ${profileId}`)
    if (decodeURIComponent(headers['x-local-mock-scenario'] || '') !== scenarioId) throw new Error(`Mock request did not hit Scenario ${scenarioId}`)
    if (plainObject(payload?.data) && plainObject(payload.data.data)) throw new Error(`Mock request produced a duplicated data envelope for ${apiUrl}`)
    return { apiUrl, profileId, scenarioId, status: statusCode }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin)
      const sessionId = requestSessionId(req, url)
      let state = stateFor(sessionId)
      let pageObservation = pageObservations.get(sessionId) || null
      if (req.headers.host !== new URL(origin).host) return respond(res, 403, { error: 'Invalid host' })
      if (req.headers.origin && req.headers.origin !== origin) return respond(res, 403, { error: 'Invalid origin' })
      if (req.headers['sec-fetch-site'] === 'cross-site') return respond(res, 403, { error: 'Cross-site request' })
      if (url.pathname.startsWith('/__desktop/')) {
        const publicRead = req.method === 'GET' && ['/__desktop/state', '/__desktop/result-ui'].includes(url.pathname)
        const trustedUI = ['/__desktop/apply-ui', '/__desktop/page-observation-ui'].includes(url.pathname) && req.method === 'POST' && req.headers.origin === origin && req.headers['sec-fetch-site'] === 'same-origin'
        if (!publicRead && !trustedUI && req.headers.authorization !== `Bearer ${token}`) return respond(res, 401, { error: 'Unauthorized' })
        if (url.pathname.startsWith('/__desktop/workflow/') && req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 262144) return respond(res, 413, { error: 'Request too large' }) }
          const payload = body ? JSON.parse(body) : {}
          const action = {
            '/__desktop/workflow/start-scenario': 'start-scenario',
            '/__desktop/workflow/resume': 'resume',
            '/__desktop/workflow/retry': 'retry',
            '/__desktop/workflow/cancel': 'cancel',
            '/__desktop/workflow/list': 'list',
            '/__desktop/workflow/get': 'get'
          }[url.pathname]
          if (!action) return respond(res, 404, { error: 'Unknown workflow command' })
          const workflowPayload = action === 'start-scenario' && plainObject(payload)
            ? { ...payload, sessionId }
            : payload
          try {
            await auditWorkflowMode({ mode: 'workflow', action, sessionId, outcome: 'allowed' })
            return respond(res, 200, await requestDesktopWorkflow(action, workflowPayload))
          }
          catch (error) { return respond(res, 422, { error: error.message }) }
        }
        if (url.pathname === '/__desktop/context') return respond(res, 200, { projectId: manifest.projectId, buildId: manifest.buildId, sourceRoot: source, userRoot, sessionId, state, userData: userDataStatus, codeIntell: await refreshCodeIntell(), analysis: await readAnalysisPreferences(), workflow: await readWorkflowPreferences() })
        if (url.pathname === '/__desktop/code-intell/status') return respond(res, 200, await refreshCodeIntell())
        if (url.pathname === '/__desktop/workflow-mode' && req.method === 'GET') {
          return respond(res, 200, { ...(await readWorkflowPreferences()), defaultMode: 'workflow', auditFile: workflowAuditFile })
        }
        if (url.pathname === '/__desktop/workflow-mode/set' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) return respond(res, 413, { error: 'Request too large' }) }
          const input = JSON.parse(body)
          if (!['workflow', 'legacy'].includes(input.mode)) return respond(res, 422, { error: 'mode must be workflow or legacy' })
          const value = { schemaVersion: 1, mode: input.mode, updatedAt: new Date().toISOString() }
          await atomicJson(workflowPreferenceFile, value)
          await auditWorkflowMode({ mode: input.mode, action: 'set-mode', sessionId, outcome: 'allowed' })
          return respond(res, 200, { ...value, defaultMode: 'workflow', auditFile: workflowAuditFile })
        }
        if (url.pathname === '/__desktop/analysis-mode' && req.method === 'GET') {
          const preferences = await readAnalysisPreferences()
          const cache = await readAnalysisCache()
          return respond(res, 200, { ...preferences, cacheEntries: Object.keys(cache.entries).length,
            guarantee: 'Cache and real requests rank candidates only; current CodeIntell/source evidence is always revalidated.' })
        }
        if (url.pathname === '/__desktop/analysis-mode/set' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) return respond(res, 413, { error: 'Request too large' }) }
          const input = JSON.parse(body)
          if (!['strict', 'assisted'].includes(input.mode)) return respond(res, 422, { error: 'mode must be strict or assisted' })
          if (input.sessionReuse !== undefined && typeof input.sessionReuse !== 'boolean') return respond(res, 422, { error: 'sessionReuse must be boolean when provided' })
          const current = await readAnalysisPreferences()
          await atomicJson(analysisPreferenceFile, { schemaVersion: 1, mode: input.mode,
            sessionReuse: input.sessionReuse ?? current.sessionReuse, updatedAt: new Date().toISOString() })
          invalidateSessionAnalysisReuse()
          return respond(res, 200, { ...(await readAnalysisPreferences()), cacheEntries: Object.keys((await readAnalysisCache()).entries).length })
        }
        if (url.pathname === '/__desktop/analysis-cache/clear' && req.method === 'POST') {
          const cache = await readAnalysisCache()
          cache.entries = {}
          analysisCacheDirty = true
          await flushAnalysisCache()
          invalidateSessionAnalysisReuse()
          return respond(res, 200, { ...(await readAnalysisPreferences()), cacheEntries: 0 })
        }
        if (url.pathname === '/__desktop/user-data/status') return respond(res, 200, { ...userDataStatus, projectId: manifest.projectId, buildId: manifest.buildId,
          userRoot, persistence: 'Preserved across upgrades and reinstall unless the application user-data directory is explicitly deleted.' })
        if (url.pathname === '/__desktop/user-data/export') return respond(res, 200, await exportUserData())
        if (url.pathname === '/__desktop/user-data/import' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 5_000_000) return respond(res, 413, { error: 'Import package is too large' }) }
          const input = JSON.parse(body)
          const bundle = input.package
          if (!plainObject(bundle) || bundle.kind !== USER_DATA_PACKAGE_KIND || bundle.schemaVersion !== USER_DATA_SCHEMA_VERSION) return respond(res, 422, { error: 'Unsupported user Mock package schema' })
          if (bundle.projectId !== manifest.projectId) return respond(res, 422, { error: `Package project ${bundle.projectId} does not match ${manifest.projectId}` })
          if (!Array.isArray(bundle.profiles) || !plainObject(bundle.mocks)) return respond(res, 422, { error: 'Import package requires profiles and mocks' })
          const replaceExisting = input.replaceExisting === true
          const currentProfiles = await readProfiles(userProfileFile)
          const currentIds = new Set(currentProfiles.map(profile => profile.id))
          const importedIds = new Set()
          const normalizedProfiles = []
          const mockWrites = new Map()
          for (const profile of bundle.profiles) {
            if (!safeId(profile?.id) || !safeText(profile?.label) || !safeText(profile?.page, 64) || !safeRoute(profile?.routePath)) return respond(res, 422, { error: 'Imported Profile has invalid id, label, page or routePath' })
            if (importedIds.has(profile.id)) return respond(res, 422, { error: `Duplicate imported Profile: ${profile.id}` })
            if (!replaceExisting && currentIds.has(profile.id)) return respond(res, 409, { error: `Profile already exists: ${profile.id}` })
            importedIds.add(profile.id)
            const apis = {}
            for (const [apiUrl, selection] of Object.entries(profile.apis || {})) {
              let relativePath; try { relativePath = apiMockRelative(apiUrl) } catch (error) { return respond(res, 422, { error: error.message }) }
              const config = bundle.mocks[apiUrl]
              if (!plainObject(config)) return respond(res, 422, { error: `Imported Mock is missing for ${apiUrl}` })
              const requested = typeof selection === 'string' ? [selection] : Array.isArray(selection?.sequence) ? selection.sequence : [selection?.scenario]
              const ids = new Set(scenarioArray(config).map(item => item.id))
              if (!requested.length || requested.some(id => !safeId(id) || !ids.has(id))) return respond(res, 422, { error: `Imported scenario binding is invalid for ${apiUrl}` })
              apis[apiUrl] = selection
              mockWrites.set(relativePath, { ...config, schemaVersion: USER_DATA_SCHEMA_VERSION })
            }
            if (!Object.keys(apis).length) return respond(res, 422, { error: `Imported Profile has no API bindings: ${profile.id}` })
            normalizedProfiles.push({ ...profile, schemaVersion: USER_DATA_SCHEMA_VERSION, apis })
          }
          const operationId = randomUUID()
          const rollback = { operationId, kind: 'user-data-import', files: [] }
          const remember = async file => { if (rollback.files.some(item => item.file === file)) return; try { rollback.files.push({ file, content: await readFile(file, 'utf8') }) } catch (error) { if (error.code === 'ENOENT') rollback.files.push({ file, content: null }); else throw error } }
          await remember(userProfileFile)
          for (const relativePath of mockWrites.keys()) await remember(join(userRoot, relativePath))
          const profiles = currentProfiles.filter(profile => !importedIds.has(profile.id)).concat(normalizedProfiles)
          try {
            for (const [relativePath, config] of mockWrites) await atomicJson(join(userRoot, relativePath), config)
            await atomicJson(userProfileFile, { schemaVersion: USER_DATA_SCHEMA_VERSION, projectId: manifest.projectId, updatedAt: new Date().toISOString(), profiles })
            await migrateUserData()
            middleware = createMock({ projectRoot: source, overlayRoot: userRoot })
            const summaries = await profileSummaries()
            const invalid = summaries.filter(profile => importedIds.has(profile.id)
              && profile.apis.some(api => !api.exists || !api.scenarioExists))
            if (invalid.length) throw new Error(`Imported Profiles have invalid bindings: ${invalid.map(item => item.id).join(', ')}`)
            const rollbackFile = join(userRoot, '.rollbacks', `${operationId}.json`)
            await atomicJson(rollbackFile, rollback)
            invalidateSessionAnalysisReuse()
            return respond(res, 201, { operationId, importedProfiles: [...importedIds], status: userDataStatus })
          } catch (error) {
            await restoreRollback(rollback)
            await migrateUserData()
            middleware = createMock({ projectRoot: source, overlayRoot: userRoot })
            return respond(res, 422, { error: `User Mock import rolled back: ${error.message}` })
          }
        }
        if (url.pathname === '/__desktop/profiles') return respond(res, 200, { profiles: await catalog() })
        if (url.pathname === '/__desktop/evidence') return respond(res, 200, { sessionId, revision: state.revision, profileId: state.profileId, requests: evidence.filter(item => item.sessionId === sessionId).slice(-100), pageObservation })
        if (url.pathname === '/__desktop/result') return respond(res, 200, await scenarioResult(sessionId, state, pageObservation))
        const legacyWorkflowPaths = new Set(['/__desktop/analyze-target', '/__desktop/validate-semantic-source', '/__desktop/create-profile', '/__desktop/apply', '/__desktop/verify'])
        if (legacyWorkflowPaths.has(url.pathname) && req.method === 'POST') {
          const internalWorkflow = req.headers['x-dsh-workflow-token'] === workflowToken
          const preference = await readWorkflowPreferences()
          if (!internalWorkflow && preference.mode !== 'legacy') {
            await auditWorkflowMode({ mode: preference.mode, action: url.pathname, sessionId, outcome: 'blocked' })
            return respond(res, 409, { error: 'Legacy scenario tools are disabled in workflow mode. Use business_start_scenario_workflow or switch explicitly to legacy mode.' })
          }
          await auditWorkflowMode({ mode: internalWorkflow ? 'workflow' : 'legacy', action: url.pathname, sessionId, outcome: 'allowed' })
        }
        if (url.pathname === '/__desktop/validate-semantic-source' && req.method === 'POST') {
          let body = ''
          for await (const chunk of req) { body += chunk; if (body.length > 262144) return respond(res, 413, { error: 'Request too large' }) }
          const input = JSON.parse(body)
          if (!safeRoute(input?.routePath) || !validSemanticExpectations(input?.semanticExpectations, input.routePath, input.query)
            || !Array.isArray(input.scenarios) || input.scenarios.length > 12) return respond(res, 422, { error: 'Invalid semantic source validation request' })
          const result = await checkFreshSemanticSources(input.semanticExpectations, input.scenarios)
          return respond(res, result.status === 'matched' ? 200 : 422, result.status === 'matched' ? result : {
            error: 'Source Scenario Mock values changed or cannot be verified; re-analyze before confirming the plan.',
            code: 'WORKFLOW_SEMANTIC_SOURCE_CHANGED', ...result
          })
        }
        if (url.pathname === '/__desktop/resolve-target' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 32768) return respond(res, 413, { error: 'Request too large' }) }
          try { return respond(res, 200, await resolveTarget(JSON.parse(body), sessionId)) } catch (error) { return respond(res, 422, { error: error.message, code: error.code, candidates: error.candidates }) }
        }
        if (url.pathname === '/__desktop/analyze-target' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 32768) return respond(res, 413, { error: 'Request too large' }) }
          try { return respond(res, 200, await analyzeTarget(JSON.parse(body), sessionId)) } catch (error) { return respond(res, 422, { error: error.message }) }
        }
        if (url.pathname === '/__desktop/state') return respond(res, 200, state)
        if (url.pathname === '/__desktop/result-ui') return respond(res, 200, await scenarioResult(sessionId, state, pageObservation))
        if (url.pathname === '/__desktop/open-preview' && req.method === 'POST') {
          process.send?.({ type: 'show-preview' })
          return respond(res, 202, { status: 'opening', message: 'Business preview window requested.' })
        }
        if (url.pathname === '/__desktop/page-observation-ui' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 65536) return respond(res, 413, { error: 'Observation too large' }) }
          const value = JSON.parse(body)
          pageObservation = { revision: state.revision, profileId: state.profileId, route: String(value.route || '').slice(0, 500),
            title: String(value.title || '').slice(0, 200), text: String(value.text || '').slice(0, 50000), observedAt: new Date().toISOString() }
          pageObservations.set(sessionId, pageObservation)
          const observedBusinessRoute = pageObservation.route.includes('#')
            ? pageObservation.route.slice(pageObservation.route.indexOf('#') + 1)
            : pageObservation.route
          if (observedBusinessRoute.startsWith('/') && !observedBusinessRoute.startsWith('//')) {
            const target = new URL(businessAppUrl(observedBusinessRoute))
            if (state.profileId) target.searchParams.set('__mockProfile', state.profileId)
            target.searchParams.set('__dshSession', sessionId)
            state = { ...state, url: target.href }
            sessionStates.set(sessionId, state)
            await persistSessionStates()
          }
          return respond(res, 202, { status: 'recorded' })
        }
        if (url.pathname === '/__desktop/verify' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16384) return respond(res, 413, { error: 'Request too large' }) }
          const input = JSON.parse(body)
          const textList = value => Array.isArray(value) && value.length <= 20 && value.every(item => typeof item === 'string' && item.length <= 200) ? value : null
          const containsText = textList(input.containsText); const absentText = textList(input.absentText)
          if (!containsText || !absentText) return respond(res, 422, { error: 'containsText and absentText must be string arrays with at most 20 items' })
          const profile = (await catalog()).find(item => item.id === state.profileId)
          const expectedScenarios = Object.values(profile?.apis || {}).flatMap(value => typeof value === 'string' ? [value] : value.sequence || [value.scenario]).filter(Boolean)
          const matchedScenarios = new Set([...evidence, ...(await externalEvidence())]
            .filter(item => item.sessionId === sessionId && item.profileId === state.profileId).map(item => item.scenarioId))
          const checks = {
            currentProfile: Boolean(state.profileId && profile), observationCurrent: pageObservation?.revision === state.revision && pageObservation?.profileId === state.profileId,
            route: !input.route || pageObservation?.route.includes(input.route),
            containsText: containsText.map(text => ({ text, passed: Boolean(pageObservation?.text.includes(text)) })),
            absentText: absentText.map(text => ({ text, passed: !pageObservation?.text.includes(text) })),
            scenarios: expectedScenarios.map(scenarioId => ({ scenarioId, passed: matchedScenarios.has(scenarioId) }))
          }
          const verified = checks.currentProfile && checks.observationCurrent && checks.route && checks.containsText.every(item => item.passed) && checks.absentText.every(item => item.passed) && checks.scenarios.every(item => item.passed)
          state = { ...state, verified }
          sessionStates.set(sessionId, state)
          verificationResults.set(sessionId, { verified, checkedAt: new Date().toISOString(), expected: input, checks })
          return respond(res, verified ? 200 : 422, { verified, checks, pageObservation: pageObservation && { ...pageObservation, text: pageObservation.text.slice(0, 2000) } })
        }
        if (url.pathname === '/__desktop/create-profile' && req.method === 'POST') {
          let body = ''
          for await (const chunk of req) { body += chunk; if (body.length > 262144) return respond(res, 413, { error: 'Request too large' }) }
          const input = JSON.parse(body)
          if (!safeId(input?.profile?.id)) return respond(res, 422, { error: 'Invalid profile id' })
          if (!safeText(input.profile.label) || !safeText(input.profile.page, 64) || !safeRoute(input.profile.routePath)) return respond(res, 422, { error: 'profile requires a non-empty label, page and safe absolute routePath' })
          if (!Array.isArray(input.scenarios) || input.scenarios.length < 1 || input.scenarios.length > 12) return respond(res, 422, { error: 'scenarios must contain 1-12 items' })
          const sourceRules = input.semanticExpectations ?? []
          if (!validSemanticExpectations(sourceRules, input.profile.routePath, input.query)) return respond(res, 422, { error: 'Invalid semantic expectations for Profile creation' })
          if (sourceRules.length) {
            const result = await checkFreshSemanticSources(sourceRules, input.scenarios)
            if (result.status !== 'matched') return respond(res, 422, {
              error: 'Source Scenario Mock values changed or cannot be verified; re-analyze before creating a Profile.',
              code: 'WORKFLOW_SEMANTIC_SOURCE_CHANGED', ...result
            })
          }
          const analysis = analysisEvidence.get(input.evidenceId)
          if (!analysis || analysis.expiresAt < Date.now()) return respond(res, 422, { error: 'A current business_analyze_target evidenceId is required before creating a Profile' })
          if (analysis.routePath !== input.profile.routePath) return respond(res, 422, { error: `Profile routePath does not match analyzed route ${analysis.routePath}` })
          const operationId = randomUUID()
          const rollback = { operationId, files: [] }
          const remembered = new Set()
          const remember = async file => { if (remembered.has(file)) return; remembered.add(file); try { rollback.files.push({ file, content: await readFile(file, 'utf8') }) } catch (error) { if (error.code === 'ENOENT') rollback.files.push({ file, content: null }); else throw error } }
          const apiBindings = {}
          const mutations = []
          const seenMockPaths = new Set()
          for (const item of input.scenarios) {
            const hasData = plainObject(item?.data)
            const hasSourceScenario = safeText(item?.sourceScenarioId, 128)
            if (!safeId(item?.id) || !safeText(item?.apiUrl, 240) || !safeText(item?.label || item?.id)
              || hasData === Boolean(hasSourceScenario)) return respond(res, 422, { error: 'Each scenario needs a valid ASCII id, apiUrl, label and exactly one of object data or sourceScenarioId' })
            const apiEvidence = analysis.apis.get(item.apiUrl)
            if (!apiEvidence) return respond(res, 422, { error: `API was not established by business_analyze_target: ${item.apiUrl}` })
            const relativePath = apiMockRelative(item.apiUrl)
            if (apiEvidence.mockPath !== relativePath) return respond(res, 422, { error: `API mock path differs from analyzed evidence: ${item.apiUrl}` })
            if (seenMockPaths.has(relativePath)) return respond(res, 422, { error: `Only one scenario binding is allowed per API in a Profile: ${item.apiUrl}` })
            seenMockPaths.add(relativePath)
            let existing = hasSourceScenario && sourceRules.some(rule => rule.apiUrl === item.apiUrl && rule.fieldAssertions.length)
              ? await readFreshMockConfig(relativePath) : await readMockConfig(relativePath)
            if (!existing) {
              if (!apiEvidence.typeEvidence?.response) return respond(res, 422, { error: `API has no response type evidence for first Mock creation: ${item.apiUrl}` })
              try {
                const generated = await generatedMockConfig(item.apiUrl, relativePath)
                if (generated.typeEvidence.response !== apiEvidence.typeEvidence.response) throw new Error('Response type evidence changed after analysis')
                existing = { file: join(userRoot, relativePath), config: generated.config }
              } catch (error) { return respond(res, 422, { error: error.message }) }
            }
            const existingScenarios = scenarioArray(existing.config)
            const sourceScenario = hasSourceScenario ? existingScenarios.find(value => value.id === item.sourceScenarioId) : undefined
            if (hasSourceScenario && !sourceScenario) return respond(res, 422, { error: `Source Scenario does not exist for ${item.apiUrl}: ${item.sourceScenarioId}` })
            if (hasSourceScenario && sourceRules.length) {
              const result = checkScenarioSemanticValues(sourceRules, item, sourceScenario)
              if (result.status !== 'matched') return respond(res, 422, {
                error: 'Source Scenario Mock values changed or cannot be verified; re-analyze before creating a Profile.',
                code: 'WORKFLOW_SEMANTIC_SOURCE_CHANGED', ...result
              })
            }
            const template = existing.config.baseData || existingScenarios[0]?.data
            let data
            try { data = normalizeScenarioData(sourceScenario ? sourceScenario.data : item.data, template, item.apiUrl) } catch (error) { return respond(res, 422, { error: error.message }) }
            const scenarios = existingScenarios.filter(value => value.id !== item.id)
            scenarios.push({ id: item.id, label: item.label || item.id, data })
            const sourceMock = await readSourceMock(relativePath)
            mutations.push({ file: join(userRoot, relativePath), value: {
              ...existing.config,
              schemaVersion: USER_DATA_SCHEMA_VERSION,
              _dsh: { ...(plainObject(existing.config._dsh) ? existing.config._dsh : {}), schemaVersion: USER_DATA_SCHEMA_VERSION,
                projectId: manifest.projectId, baseBuildId: manifest.buildId, baseMockHash: sourceMock ? contentHash(sourceMock) : null,
                compatibility: sourceMock ? 'compatible' : 'source-missing', updatedAt: new Date().toISOString() },
              scenarios,
            } })
            apiBindings[item.apiUrl] = item.id
          }
          await remember(userProfileFile)
          for (const mutation of mutations) await remember(mutation.file)
          const profiles = (await readProfiles(userProfileFile)).filter(profile => profile.id !== input.profile.id)
          profiles.push({ ...input.profile, schemaVersion: USER_DATA_SCHEMA_VERSION, apis: apiBindings })
          const rollbackFile = join(userRoot, '.rollbacks', `${operationId}.json`)
          try {
            for (const mutation of mutations) await atomicJson(mutation.file, mutation.value)
            await atomicJson(userProfileFile, { schemaVersion: USER_DATA_SCHEMA_VERSION, projectId: manifest.projectId, updatedAt: new Date().toISOString(), profiles })
            middleware = createMock({ projectRoot: source, overlayRoot: userRoot })
            const summary = (await profileSummaries()).find(profile => profile.id === input.profile.id)
            if (!summary?.ok || summary.apis.length !== input.scenarios.length) throw new Error(`Created Profile failed binding validation (${summary?.issueCount ?? 'missing'} issue(s))`)
            const requestValidation = []
            for (const item of input.scenarios) requestValidation.push(await validateMockRequest(item.apiUrl, input.profile.id, item.id))
            await atomicJson(rollbackFile, rollback)
            analysisEvidence.delete(input.evidenceId)
            creationRecords.set(input.profile.id, { createdAt: new Date().toISOString(), evidenceId: input.evidenceId,
              routePath: analysis.routePath, apis: input.scenarios.map(item => ({ apiUrl: item.apiUrl, scenarioId: item.id,
                evidence: analysis.apis.get(item.apiUrl)?.typeEvidence || null })) })
            invalidateSessionAnalysisReuse()
            return respond(res, 201, { operationId, profileId: input.profile.id, scenarioCount: input.scenarios.length, rollbackFile,
              validation: { ok: true, apiBindings: summary.apis.map(api => ({ apiUrl: api.apiUrl, scenarioId: api.scenarioId })), requests: requestValidation } })
          } catch (error) {
            await restoreRollback(rollback)
            middleware = createMock({ projectRoot: source, overlayRoot: userRoot })
            return respond(res, 422, { error: `Profile creation rolled back: ${error.message}` })
          }
        }
        if (url.pathname === '/__desktop/rollback' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) body += chunk
          const { operationId } = JSON.parse(body)
          if (!/^[0-9a-f-]{36}$/.test(operationId || '')) return respond(res, 422, { error: 'Invalid operation id' })
          const rollbackFile = join(userRoot, '.rollbacks', `${operationId}.json`)
          const rollback = JSON.parse(await readFile(rollbackFile, 'utf8'))
          await restoreRollback(rollback)
          middleware = createMock({ projectRoot: source, overlayRoot: userRoot })
          invalidateSessionAnalysisReuse()
          const availableProfileIds = new Set((await catalog()).map(profile => profile.id))
          const resetSessionIds = []
          for (const [storedSessionId, storedState] of sessionStates) {
            if (!storedState.profileId || availableProfileIds.has(storedState.profileId)) continue
            let route = manifest.entryRoute
            try {
              const hash = new URL(storedState.url).hash.replace(/^#/, '')
              if (hash.startsWith('/') && !hash.startsWith('//')) route = hash
            } catch {}
            sessionStates.set(storedSessionId, {
              revision: storedState.revision + 1,
              profileId: '',
              url: businessAppUrl(route),
              verified: false,
            })
            pageObservations.delete(storedSessionId)
            verificationResults.delete(storedSessionId)
            resetSessionIds.push(storedSessionId)
          }
          if (resetSessionIds.length) await persistSessionStates()
          return respond(res, 200, { operationId, status: 'rolled-back', resetSessionIds })
        }
        if (['/__desktop/apply', '/__desktop/apply-ui'].includes(url.pathname) && req.method === 'POST') {
          let body = ''
          for await (const chunk of req) { body += chunk; if (body.length > 8192) return respond(res, 413, { error: 'Request too large' }) }
          const { profileId } = JSON.parse(body)
          const profile = (await catalog()).find(item => item.id === profileId)
          if (!profile) return respond(res, 404, { error: 'Unknown profile' })
          const bindings = Object.entries(profile.apis || {})
          if (bindings.length < 1) return respond(res, 422, { error: 'Profile contains no API bindings' })
          const isUserProfile = (await readProfiles(userProfileFile)).some(item => item.id === profileId)
          if (isUserProfile) {
            for (const [apiUrl, selection] of bindings) {
              let config; try { config = JSON.parse(await readFile(join(userRoot, apiMockRelative(apiUrl)), 'utf8')) } catch { return respond(res, 422, { error: `User scenario file missing for ${apiUrl}` }) }
              if (config?._dsh?.compatibility === 'needs-repair') return respond(res, 422, { error: `User scenario requires migration repair for ${apiUrl}: ${(config._dsh.conflictingFields || []).join(', ')}` })
              const ids = new Set((config.scenarios || []).map(item => item.id))
              const requested = typeof selection === 'string' ? [selection] : selection.sequence || [selection.scenario]
              if (requested.some(id => !ids.has(id))) return respond(res, 422, { error: `User scenario binding invalid for ${apiUrl}` })
            }
          } else {
            const check = await fetch(`${origin}/api/profiles`)
            const checked = await check.json()
            if (!checked.profiles?.find(item => item.id === profileId && item.ok)) return respond(res, 422, { error: 'Packaged Profile contains invalid API bindings' })
          }
          const route = profile.routePath || profile.entryPath?.replace(/^\/?#/, '') || manifest.entryRoute
          if (!route.startsWith('/') || route.startsWith('//')) return respond(res, 422, { error: 'Invalid profile route' })
          const target = new URL(businessAppUrl(route))
          target.searchParams.set('__mockProfile', profileId)
          target.searchParams.set('__dshSession', sessionId)
          state = { revision: state.revision + 1, profileId, url: target.href, verified: false }
          sessionStates.set(sessionId, state)
          await persistSessionStates()
          pageObservations.delete(sessionId)
          verificationResults.delete(sessionId)
          middleware = createMock({ projectRoot: source, overlayRoot: userRoot })
          return respond(res, 200, { ...state, url: origin + state.url, status: 'applied-command', message: 'Preview will reload. Business outcome has not yet been verified.' })
        }
        return respond(res, 404, { error: 'Unknown desktop command' })
      }
      if (url.pathname === '/api/profiles' && req.method === 'GET') {
        return respond(res, 200, { profiles: await profileSummaries(), operationMaps: [], entryUrl: developmentAppUrl || `${origin}${manifest.businessPath}` })
      }
      // P0 explicitly allows only preview reads and non-persistent switching.
      // Existing platform Agent/write routes are not reachable in the desktop prototype.
      if (url.pathname.startsWith('/api/')) {
        const reads = new Set(['/api/profiles', '/api/recordings', '/api/business-app-health'])
        if (req.method !== 'GET' || !reads.has(url.pathname)) return respond(res, 403, { error: 'P0: use Harness business tools; platform mutations are disabled' })
      }
      if (url.searchParams.has('__dshSession')) {
        res.setHeader('Set-Cookie', `dsh_business_session=${encodeURIComponent(sessionId)}; Path=/; SameSite=Strict`)
      }
      if (url.pathname.startsWith('/mock/') || (url.pathname.endsWith('.json') && !url.pathname.startsWith('/api/'))) {
        const parts = decodeURIComponent(url.pathname).split('/');
        if (parts.some(part => part === '..' || part.includes('\\') || part.includes('\0'))) return respond(res, 400, { error: 'Invalid API path' })
        req.path = url.pathname.replace(/^\/mock/, '')
        req.query = Object.fromEntries(url.searchParams)
        if (state.profileId) req.query.__mockProfile = state.profileId
        res.status = code => { res.statusCode = code; return res }
        res.send = value => res.end(value)
        res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
        res.redirect = (code, location) => { res.writeHead(code, { Location: location }); res.end() }
        res.once('finish', () => {
          evidence.push({ timestamp: new Date().toISOString(), sessionId, revision: state.revision, path: url.pathname, status: res.statusCode,
            profileId: decodeURIComponent(String(res.getHeader('x-local-mock-profile') || '')),
            scenarioId: decodeURIComponent(String(res.getHeader('x-local-mock-scenario') || '')) })
          if (evidence.length > 200) evidence.splice(0, evidence.length - 200)
        })
        middleware(req, res)
        return
      }
      if (!url.pathname.startsWith('/_next/') && url.pathname !== '/' && !url.pathname.startsWith('/api/')) {
        try {
          const file = await within(web, `.${decodeURIComponent(url.pathname)}${url.pathname.endsWith('/') ? 'index.html' : ''}`)
          if ((await stat(file)).isFile()) {
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream'
            res.writeHead(200, { 'Content-Type': mime })
            createReadStream(file).on('error', () => res.destroy()).pipe(res)
            return
          }
        } catch { return respond(res, 404, { error: 'Business asset not found' }) }
      }
      if (!nextHandler) return respond(res, 503, { error: 'Starting' })
      await nextHandler(req, res)
    } catch (error) { if (!res.headersSent) respond(res, 500, { error: error.message }); else res.destroy() }
  })
  let origin
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done) })
  origin = `http://127.0.0.1:${server.address().port}`
  process.env.MOCK_PLATFORM_PROJECT_ROOT = source
  process.env.MOCK_PLATFORM_APP_URL = developmentAppUrl || `${origin}${manifest.businessPath}`
  process.env.MOCK_PLATFORM_APP_PATH = manifest.businessPath
  process.env.MOCK_PLATFORM_USE_PROFILE_SESSION = '1'
  process.env.NODE_ENV = 'production'
  const nextConfig = JSON.parse(await readFile(join(platform, '.next/required-server-files.json'), 'utf8')).config
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)
  const next = require('next')({ dev: false, dir: platform, conf: nextConfig, customServer: true })
  try { await next.prepare(); nextHandler = next.getRequestHandler() } catch (error) { server.close(); throw error }
  return { origin, sourceRoot: source, userRoot, projectId: manifest.projectId, buildId: manifest.buildId,
    close: async () => {
      process.off('message', handleWorkflowResponse)
      for (const pending of workflowRequests.values()) { clearTimeout(pending.timer); pending.reject(new Error('Business runtime is stopping')) }
      workflowRequests.clear()
      if (mockConfigCachePersistTimer) {
        clearTimeout(mockConfigCachePersistTimer)
        mockConfigCachePersistTimer = undefined
      }
      await persistMockConfigCache()
      await flushAnalysisCache()
      server.closeAllConnections(); await new Promise(done => server.close(done)); await next.close()
    } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await startBusinessRuntime({ packageRoot: process.argv[2], userRoot: process.env.DSH_BUSINESS_USER_ROOT, token: process.env.DSH_BUSINESS_TOKEN })
  process.send?.({ type: 'ready', ...Object.fromEntries(Object.entries(runtime).filter(([key]) => key !== 'close')) })
  const stop = async () => { await runtime.close(); process.exit(0) }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  process.once('disconnect', stop)
}
