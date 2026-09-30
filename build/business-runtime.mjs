import http from 'node:http'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
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
  const USER_DATA_SCHEMA_VERSION = 2
  const USER_DATA_PACKAGE_KIND = 'dsh-business-user-mocks'
  const profileFile = join(source, 'src/baseTypes/api/mock-profiles.json')
  const userProfileFile = join(userRoot, 'src/baseTypes/api/mock-profiles.json')
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
  const contentHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const scenarioArray = config => Array.isArray(config?.scenarios)
    ? config.scenarios
    : Object.entries(config?.scenarios || {}).map(([id, value]) => ({ ...value, id }))
  const readMockConfig = async relativePath => {
    for (const file of [join(userRoot, relativePath), join(source, relativePath)]) {
      try { return { file, config: JSON.parse(await readFile(file, 'utf8')) } } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return null
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
  const analyzeTarget = async input => {
    await refreshCodeIntell()
    if (codeIntellStatus.state !== 'ready') throw new Error(`CodeIntell unavailable: ${codeIntellStatus.error}`)
    const routePath = String(input?.routePath || '').trim()
    const query = String(input?.query || '').trim().toLowerCase()
    const queryTerms = [...new Set([query, ...query.split(/[\s,，。；;、/]+/u)])].filter(term => term.length > 1)
    const queryScore = (text, points = 40, limit = 120) => Math.min(limit,
      queryTerms.reduce((score, term) => score + (String(text).toLowerCase().includes(term) ? points : 0), 0))
    if (!safeRoute(routePath)) throw new Error('routePath must be a safe absolute business route')
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
    for (const [file, bindings] of Object.entries(codeIndex.fileToApis || {})) {
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
    const relevantSource = []
    for (const file of relevantFiles) {
      try { relevantSource.push({ file, text: await readFile(join(source, file), 'utf8') }) } catch {}
    }
    for (const [apiUrl, callers] of Object.entries(codeIndex.apiCallers || {})) {
      for (const caller of callers || []) {
        const callerId = String(caller)
        const callerFile = callerId.replace(/^fn:/, '').split('::')[0]
        const symbol = callerId.split('::').at(-1)
        if (!symbol) continue
        const reference = relevantSource.find(item => item.text.includes(symbol))
        const routeDomain = routeSegments[0]?.toLowerCase() || ''
        const sameDataServerDomain = Boolean(routeDomain) && callerFile.toLowerCase().startsWith(`src/dataserver/${routeDomain}/`)
        if (!reference && !sameDataServerDomain) continue
        const current = apiMap.get(apiUrl)
        const evidenceItem = reference
          ? { file: reference.file, via: callerId, source: 'codeIntell.apiCallers+sourceSymbol' }
          : { file: callerFile, via: callerId, source: 'codeIntell.apiCallers+routeDomain' }
        const routeSymbolScore = routeToken && symbol.toLowerCase().includes(routeToken) ? 100 : 0
        const callerScore = (reference ? 110 : 60) + routeSymbolScore + queryScore(`${apiUrl} ${callerId}`)
        if (!current) apiMap.set(apiUrl, { apiUrl, score: callerScore, evidence: [evidenceItem] })
        else if (current.evidence.length < 5) { current.score = Math.max(current.score, callerScore); current.evidence.push(evidenceItem) }
      }
    }
    // Some legacy dataServer modules pass enum members such as
    // `apiConfig.queryReceiptList` to fetch(). The index deliberately avoids
    // guessing through unresolved enum indirection, so recover only mappings
    // whose symbol is named by this route (or by already relevant source).
    // The URL still comes from checked-in source and must have an existing mock
    // below before it can become creation evidence.
    const routeDomain = routeSegments[0]?.toLowerCase() || ''
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
    const explicitApis = Array.isArray(input?.apiUrls) ? input.apiUrls : []
    for (const apiUrl of explicitApis) {
      if (typeof apiUrl !== 'string') continue
      if (!apiMap.has(apiUrl)) throw new Error(`Explicit API lacks CodeIntell/source evidence for this route: ${apiUrl}`)
      apiMap.get(apiUrl).score += 160
    }
    const apis = []
    for (const candidate of [...apiMap.values()].sort((a, b) => b.score - a.score).slice(0, 100)) {
      let relativePath
      try { relativePath = apiMockRelative(candidate.apiUrl) } catch { continue }
      const existing = await readMockConfig(relativePath)
      let generated
      if (!existing) {
        try { generated = await generatedMockConfig(candidate.apiUrl, relativePath) } catch { continue }
      }
      const config = existing?.config || generated.config
      const scenarios = scenarioArray(config)
      const template = config.baseData || scenarios[0]?.data || {}
      const searchable = `${candidate.apiUrl} ${config.label || ''} ${scenarios.map(item => `${item.id} ${item.label || ''}`).join(' ')}`.toLowerCase()
      candidate.score += queryScore(searchable, 60, 180)
      apis.push({ ...candidate, mockPath: relativePath, mockExists: Boolean(existing), canGenerate: Boolean(existing || generated), typeEvidence: generated?.typeEvidence,
        label: config.label || candidate.apiUrl,
        envelopeFields: objectFields(template), fields: payloadFields(template.data),
        scenarios: scenarios.slice(0, 50).map(item => ({ id: item.id, label: item.label || item.id })) })
    }
    apis.sort((a, b) => b.score - a.score)
    apis.splice(20)
    if (!apis.length) throw new Error(`CodeIntell found no existing API mocks for ${route.path}`)
    const evidenceId = randomUUID()
    const result = { evidenceId, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), query: input.query || '',
      route: { path: route.path, title: route.title || route.comment || route.name, component: componentFile, moduleFile: route.moduleFile },
      routeCandidates: routeCandidates.map(item => ({ path: item.path, title: item.title || item.comment || item.name, component: `src/${item.component}` })), apis }
    analysisEvidence.set(evidenceId, { routePath: route.path,
      apis: new Map(apis.map(api => [api.apiUrl, { mockPath: api.mockPath, mockExists: api.mockExists, typeEvidence: api.typeEvidence }])),
      expiresAt: Date.now() + 30 * 60_000 })
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
        if (typeof restored.profileId === 'string' && restored.profileId) target.searchParams.set('__mockProfile', restored.profileId)
        target.searchParams.set('__dshSession', sessionId)
        sessionStates.set(sessionId, { revision: Number.isInteger(restored.revision) ? restored.revision : 0,
          profileId: typeof restored.profileId === 'string' ? restored.profileId : '', url: target.href, verified: false })
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
  const scenarioResult = async (sessionId, state, pageObservation) => {
    const profile = (await profileSummaries()).find(item => item.id === state.profileId)
    const requests = evidence.filter(item => item.sessionId === sessionId && item.revision === state.revision)
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
        if (url.pathname === '/__desktop/context') return respond(res, 200, { projectId: manifest.projectId, buildId: manifest.buildId, sourceRoot: source, userRoot, sessionId, state, userData: userDataStatus, codeIntell: await refreshCodeIntell() })
        if (url.pathname === '/__desktop/code-intell/status') return respond(res, 200, await refreshCodeIntell())
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
        if (url.pathname === '/__desktop/analyze-target' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 32768) return respond(res, 413, { error: 'Request too large' }) }
          try { return respond(res, 200, await analyzeTarget(JSON.parse(body))) } catch (error) { return respond(res, 422, { error: error.message }) }
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
          const matchedScenarios = new Set(evidence.filter(item => item.sessionId === sessionId && item.profileId === state.profileId).map(item => item.scenarioId))
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
            if (!safeId(item?.id) || !safeText(item?.apiUrl, 240) || !safeText(item?.label || item?.id) || !plainObject(item?.data)) return respond(res, 422, { error: 'Each scenario needs a valid ASCII id, apiUrl, label and object data' })
            const apiEvidence = analysis.apis.get(item.apiUrl)
            if (!apiEvidence) return respond(res, 422, { error: `API was not established by business_analyze_target: ${item.apiUrl}` })
            const relativePath = apiMockRelative(item.apiUrl)
            if (apiEvidence.mockPath !== relativePath) return respond(res, 422, { error: `API mock path differs from analyzed evidence: ${item.apiUrl}` })
            if (seenMockPaths.has(relativePath)) return respond(res, 422, { error: `Only one scenario binding is allowed per API in a Profile: ${item.apiUrl}` })
            seenMockPaths.add(relativePath)
            let existing = await readMockConfig(relativePath)
            if (!existing) {
              if (!apiEvidence.typeEvidence?.response) return respond(res, 422, { error: `API has no response type evidence for first Mock creation: ${item.apiUrl}` })
              try {
                const generated = await generatedMockConfig(item.apiUrl, relativePath)
                if (generated.typeEvidence.response !== apiEvidence.typeEvidence.response) throw new Error('Response type evidence changed after analysis')
                existing = { file: join(userRoot, relativePath), config: generated.config }
              } catch (error) { return respond(res, 422, { error: error.message }) }
            }
            const template = existing.config.baseData || scenarioArray(existing.config)[0]?.data
            let data
            try { data = normalizeScenarioData(item.data, template, item.apiUrl) } catch (error) { return respond(res, 422, { error: error.message }) }
            const scenarios = scenarioArray(existing.config).filter(value => value.id !== item.id)
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
          return respond(res, 200, { operationId, status: 'rolled-back' })
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
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await next.close() } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await startBusinessRuntime({ packageRoot: process.argv[2], userRoot: process.env.DSH_BUSINESS_USER_ROOT, token: process.env.DSH_BUSINESS_TOKEN })
  process.send?.({ type: 'ready', ...Object.fromEntries(Object.entries(runtime).filter(([key]) => key !== 'close')) })
  const stop = async () => { await runtime.close(); process.exit(0) }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  process.once('disconnect', stop)
}
