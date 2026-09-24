import http from 'node:http'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
  const web = await within(packageRoot, manifest.webRoot)
  const platform = await within(packageRoot, manifest.platformRoot)
  const require = createRequire(join(platform, 'package.json'))
  const createMock = require(join(packageRoot, 'localMockMiddleware.cjs'))
  let middleware = createMock({ projectRoot: source, overlayRoot: userRoot })
  const codeIntellRoot = join(source, '.codeIntell')
  const [codeRoutes, codeIndex] = await Promise.all([
    readFile(join(codeIntellRoot, 'routes.json'), 'utf8').then(JSON.parse),
    readFile(join(codeIntellRoot, 'index.json'), 'utf8').then(JSON.parse)
  ])
  const analysisEvidence = new Map()
  const profileFile = join(source, 'src/baseTypes/api/mock-profiles.json')
  const userProfileFile = join(userRoot, 'src/baseTypes/api/mock-profiles.json')
  const readProfiles = async file => {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'))
      return Array.isArray(data.profiles) ? data.profiles : Object.entries(data.profiles || {}).map(([id, value]) => ({ ...value, id }))
    } catch (error) { if (error.code === 'ENOENT') return []; throw error }
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
      return { apiUrl, scenarioId: requested[0] || '', mockPath: relativePath, exists: configs.length > 0,
        scenarioExists: requested.every(id => scenarios.some(item => item.id === id)), scenarios,
        label: configs.at(-1)?.label, driverFields: profile.driverFields?.[apiUrl] }
    }))
    const issueCount = apis.filter(item => !item.exists || !item.scenarioExists).length
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
  const scenarioArray = config => Array.isArray(config?.scenarios)
    ? config.scenarios
    : Object.entries(config?.scenarios || {}).map(([id, value]) => ({ ...value, id }))
  const readMockConfig = async relativePath => {
    for (const file of [join(userRoot, relativePath), join(source, relativePath)]) {
      try { return { file, config: JSON.parse(await readFile(file, 'utf8')) } } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return null
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
    const explicitApis = Array.isArray(input?.apiUrls) ? input.apiUrls : []
    for (const apiUrl of explicitApis) {
      if (typeof apiUrl !== 'string') continue
      apiMap.set(apiUrl, { apiUrl, score: 160, evidence: [{ file: componentFile, via: 'explicit API supplied for CodeIntell/mock validation', source: 'request' }] })
    }
    const apis = []
    for (const candidate of [...apiMap.values()].sort((a, b) => b.score - a.score).slice(0, 100)) {
      let relativePath
      try { relativePath = apiMockRelative(candidate.apiUrl) } catch { continue }
      const existing = await readMockConfig(relativePath)
      if (!existing) continue
      const scenarios = scenarioArray(existing.config)
      const template = existing.config.baseData || scenarios[0]?.data || {}
      const searchable = `${candidate.apiUrl} ${existing.config.label || ''} ${scenarios.map(item => `${item.id} ${item.label || ''}`).join(' ')}`.toLowerCase()
      candidate.score += queryScore(searchable, 60, 180)
      apis.push({ ...candidate, mockPath: relativePath, label: existing.config.label || candidate.apiUrl,
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
    analysisEvidence.set(evidenceId, { routePath: route.path, apiUrls: new Set(apis.map(api => api.apiUrl)), expiresAt: Date.now() + 30 * 60_000 })
    return result
  }
  const defaultSessionId = 'default'
  const sessionStates = new Map()
  const pageObservations = new Map()
  const initialState = () => ({ revision: 0, profileId: '', url: `${manifest.businessPath}#${manifest.entryRoute}`, verified: false })
  const safeSessionId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value) ? value : defaultSessionId
  const cookieValue = (req, name) => String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1)
  const requestSessionId = (req, url) => safeSessionId(req.headers['x-dsh-session'] || url.searchParams.get('__dshSession') || decodeURIComponent(cookieValue(req, 'dsh_business_session') || ''))
  const stateFor = sessionId => {
    if (!sessionStates.has(sessionId)) sessionStates.set(sessionId, initialState())
    return sessionStates.get(sessionId)
  }
  const evidence = []
  let nextHandler
  const respond = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
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
        const publicRead = req.method === 'GET' && url.pathname === '/__desktop/state'
        const trustedUI = ['/__desktop/apply-ui', '/__desktop/page-observation-ui'].includes(url.pathname) && req.method === 'POST' && req.headers.origin === origin && req.headers['sec-fetch-site'] === 'same-origin'
        if (!publicRead && !trustedUI && req.headers.authorization !== `Bearer ${token}`) return respond(res, 401, { error: 'Unauthorized' })
        if (url.pathname === '/__desktop/context') return respond(res, 200, { projectId: manifest.projectId, buildId: manifest.buildId, sourceRoot: source, userRoot, sessionId, state })
        if (url.pathname === '/__desktop/profiles') return respond(res, 200, { profiles: await catalog() })
        if (url.pathname === '/__desktop/evidence') return respond(res, 200, { sessionId, revision: state.revision, profileId: state.profileId, requests: evidence.filter(item => item.sessionId === sessionId).slice(-100), pageObservation })
        if (url.pathname === '/__desktop/analyze-target' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 32768) return respond(res, 413, { error: 'Request too large' }) }
          try { return respond(res, 200, await analyzeTarget(JSON.parse(body))) } catch (error) { return respond(res, 422, { error: error.message }) }
        }
        if (url.pathname === '/__desktop/state') return respond(res, 200, state)
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
            if (!analysis.apiUrls.has(item.apiUrl)) return respond(res, 422, { error: `API was not established by business_analyze_target: ${item.apiUrl}` })
            const relativePath = apiMockRelative(item.apiUrl)
            if (seenMockPaths.has(relativePath)) return respond(res, 422, { error: `Only one scenario binding is allowed per API in a Profile: ${item.apiUrl}` })
            seenMockPaths.add(relativePath)
            const existing = await readMockConfig(relativePath)
            if (!existing) return respond(res, 422, { error: `API mock does not exist in the packaged project: ${item.apiUrl}` })
            const template = existing.config.baseData || scenarioArray(existing.config)[0]?.data
            let data
            try { data = normalizeScenarioData(item.data, template, item.apiUrl) } catch (error) { return respond(res, 422, { error: error.message }) }
            const scenarios = scenarioArray(existing.config).filter(value => value.id !== item.id)
            scenarios.push({ id: item.id, label: item.label || item.id, data })
            mutations.push({ file: join(userRoot, relativePath), value: { ...existing.config, scenarios } })
            apiBindings[item.apiUrl] = item.id
          }
          await remember(userProfileFile)
          for (const mutation of mutations) await remember(mutation.file)
          const profiles = (await readProfiles(userProfileFile)).filter(profile => profile.id !== input.profile.id)
          profiles.push({ ...input.profile, apis: apiBindings })
          const rollbackFile = join(userRoot, '.rollbacks', `${operationId}.json`)
          try {
            for (const mutation of mutations) await atomicJson(mutation.file, mutation.value)
            await atomicJson(userProfileFile, { version: 1, profiles })
            middleware = createMock({ projectRoot: source, overlayRoot: userRoot })
            const summary = (await profileSummaries()).find(profile => profile.id === input.profile.id)
            if (!summary?.ok || summary.apis.length !== input.scenarios.length) throw new Error(`Created Profile failed binding validation (${summary?.issueCount ?? 'missing'} issue(s))`)
            await atomicJson(rollbackFile, rollback)
            analysisEvidence.delete(input.evidenceId)
            return respond(res, 201, { operationId, profileId: input.profile.id, scenarioCount: input.scenarios.length, rollbackFile, validation: { ok: true, apiBindings: summary.apis.map(api => ({ apiUrl: api.apiUrl, scenarioId: api.scenarioId })) } })
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
          state = { revision: state.revision + 1, profileId, url: `${manifest.businessPath}?__mockProfile=${encodeURIComponent(profileId)}&__dshSession=${encodeURIComponent(sessionId)}#${route}`, verified: false }
          sessionStates.set(sessionId, state)
          pageObservations.delete(sessionId)
          middleware = createMock({ projectRoot: source, overlayRoot: userRoot })
          return respond(res, 200, { ...state, url: origin + state.url, status: 'applied-command', message: 'Preview will reload. Business outcome has not yet been verified.' })
        }
        return respond(res, 404, { error: 'Unknown desktop command' })
      }
      if (url.pathname === '/api/profiles' && req.method === 'GET') {
        return respond(res, 200, { profiles: await profileSummaries(), operationMaps: [], entryUrl: `${origin}${manifest.businessPath}` })
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
          evidence.push({ timestamp: new Date().toISOString(), sessionId, path: url.pathname, status: res.statusCode,
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
  process.env.MOCK_PLATFORM_APP_URL = `${origin}${manifest.businessPath}`
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
