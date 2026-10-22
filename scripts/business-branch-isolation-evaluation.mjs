import { isDeepStrictEqual } from 'node:util'

const PHASES = {
  'default-branch': ['default-before', 'selected', 'default-after'],
  'branch-switch': ['selected-before', 'alternate', 'selected-after']
}

const validText = value => typeof value === 'string' && value.trim().length > 0
const validFields = fields => Array.isArray(fields) && fields.length > 0
  && fields.every(field => Array.isArray(field?.path) && field.path.length > 0 && Object.hasOwn(field, 'equals'))
const validTexts = values => Array.isArray(values) && values.every(validText)
const getPath = (value, path) => path.reduce((current, part) => current?.[part], value)
const passesFields = (value, fields) => fields.every(field => isDeepStrictEqual(getPath(value, field.path), field.equals))
const passesTexts = (text, expected) => expected.visibleText.every(value => text.includes(value))
  && expected.absentText.every(value => !text.includes(value))
const time = value => typeof value === 'string' ? Date.parse(value) : NaN

function hasContrast(selected, other) {
  return selected.mockFields.some(field => other.mockFields.some(compare =>
    isDeepStrictEqual(field.path, compare.path) && !isDeepStrictEqual(field.equals, compare.equals)))
    || selected.visibleText.some(value => other.absentText.includes(value))
    || other.visibleText.some(value => selected.absentText.includes(value))
}

export function assertBranchIsolationCase(item) {
  const phases = PHASES[item?.coverage?.behavior]
  if (!phases) return
  const isolation = item.branchIsolation
  const contrast = phases[0] === 'default-before' ? isolation?.default : isolation?.alternate
  if (!validText(isolation?.requestPath) || !/^\/mock\/[A-Za-z0-9/_-]+\.json$/.test(isolation.requestPath)
    || !validText(contrast?.scenarioId) || !validFields(contrast?.mockFields)
    || !validTexts(contrast?.visibleText) || !contrast.visibleText.length || !validTexts(contrast?.absentText)
    || !hasContrast(item, contrast)
    || (phases[0] === 'selected-before' && !validText(isolation?.alternateProfileId))) {
    throw new Error(`Case ${item.id} needs exact paired branch-isolation expectations`)
  }
}

export function planBusinessBranchTrace(run, scenario, profiles) {
  const phases = PHASES[scenario?.coverage?.behavior]
  if (!phases) throw new Error('Case is not a branch-isolation behavior')
  assertBranchIsolationCase(scenario)
  if (run?.status !== 'completed' || !Array.isArray(run.steps)
    || run.steps.find(step => step?.id === 'verify-preview')?.output?.verified !== true) {
    throw new Error('A completed run with verified preview is required')
  }
  if (run.context?.query !== scenario.intent
    || (run.context?.target?.routePath || run.context?.routePath) !== scenario.routePath
    || !Array.isArray(run.context?.plan?.scenarios)
    || !run.context.plan.scenarios.some(item => item?.apiUrl === scenario.apiUrl)) {
    throw new Error('The completed run does not match the reviewed page and API')
  }
  const selectedProfileId = run.context.profileId
  const alternateProfileId = scenario.branchIsolation.alternateProfileId
  if (!validText(selectedProfileId)
    || (phases[0] === 'selected-before' && alternateProfileId === selectedProfileId)) {
    throw new Error('The two branch Profiles must be distinct')
  }
  const plan = phases.map(phase => ({ phase, profileId: phase.startsWith('default') ? ''
    : phase === 'alternate' ? alternateProfileId : selectedProfileId }))
  for (const profileId of new Set(plan.map(item => item.profileId).filter(Boolean))) {
    const profile = Array.isArray(profiles) ? profiles.find(item => item?.id === profileId) : undefined
    if (!profile) throw new Error('A required branch Profile is not installed')
    if (profile.routePath !== scenario.routePath || !Object.hasOwn(profile.apis || {}, scenario.apiUrl)) {
      throw new Error('A required branch Profile does not target the case page and API')
    }
  }
  return { selectedProfileId, phases: plan }
}

function urlMatches(state, expectedProfileId) {
  try {
    const url = new URL(state.url)
    const outerProfile = url.searchParams.get('__mockProfile')
    const route = url.hash.replace(/^#/, '')
    const routeParams = new URLSearchParams(route.split('?')[1] || '')
    const innerProfile = routeParams.get('__mockProfile')
    return expectedProfileId ? outerProfile === expectedProfileId && !innerProfile
      : !outerProfile && !innerProfile
  } catch { return false }
}

function routeMatches(observedRoute, expectedRoute) {
  if (typeof observedRoute !== 'string') return false
  const route = observedRoute.includes('#') ? observedRoute.slice(observedRoute.indexOf('#') + 1) : observedRoute
  return route.split('?')[0] === expectedRoute
}

function snapshotChecks(snapshot, sessionId, previousRevision, previousObservedAt,
  expectedProfileId, expectedScenarioId, expected, scenario) {
  const state = snapshot?.state
  const result = snapshot?.result
  const response = snapshot?.mockResponse
  const evidence = snapshot?.evidence
  const observation = evidence?.pageObservation
  const revision = state?.revision
  const transitionAt = time(snapshot?.transitionAt)
  const observedAt = time(observation?.observedAt)
  const captureWindow = Number.isFinite(transitionAt) && Number.isFinite(observedAt)
    && transitionAt <= observedAt && (previousObservedAt === undefined || transitionAt > previousObservedAt)
  const withinWindow = timestamp => captureWindow && Number.isFinite(time(timestamp))
    && time(timestamp) >= transitionAt && time(timestamp) <= observedAt
  const stateCurrent = snapshot?.sessionId === sessionId && Number.isSafeInteger(revision)
    && revision >= 0 && (previousRevision === undefined || revision > previousRevision)
    && state.profileId === expectedProfileId && urlMatches(state, expectedProfileId)
  const resultCurrent = stateCurrent && result?.sessionId === sessionId && result.revision === revision
    && result.profileId === expectedProfileId && evidence?.sessionId === sessionId
    && evidence.revision === revision && evidence.profileId === expectedProfileId
  const runtimeRequestHit = Array.isArray(result?.requests) && result.requests.some(request =>
    request.sessionId === sessionId && (request.revision === undefined || request.revision === revision)
    && withinWindow(request.timestamp) && request.profileId === expectedProfileId
    && request.scenarioId === expectedScenarioId
    && [scenario.branchIsolation.requestPath, scenario.branchIsolation.requestPath.slice('/mock'.length),
      scenario.apiUrl].includes(request.path)
    && Number.isInteger(request.status) && request.status >= 200 && request.status < 300)
  // The business middleware intentionally omits no-Profile requests from its external evidence log.
  // A captured preview-network response is the only request evidence for the default phases.
  const browserRequestHit = expectedProfileId === '' && withinWindow(response?.timestamp)
    && response?.sessionId === sessionId && response?.path === scenario.branchIsolation.requestPath
    && response?.profileId === '' && response?.scenarioId === expectedScenarioId
    && response?.statusCode >= 200 && response.statusCode < 300
  const requestHit = resultCurrent && (runtimeRequestHit || browserRequestHit)
  const mockMatches = withinWindow(response?.timestamp) && response?.statusCode >= 200 && response.statusCode < 300
    && response?.sessionId === sessionId && response?.path === scenario.branchIsolation.requestPath
    && (response.revision === undefined || response.revision === revision)
    && response?.profileId === expectedProfileId && response?.scenarioId === expectedScenarioId
    && passesFields(response.body, expected.mockFields)
  const pageMatches = resultCurrent && captureWindow && observation?.revision === revision
    && observation.profileId === expectedProfileId && routeMatches(observation.route, scenario.routePath)
    && typeof observation.text === 'string' && passesTexts(observation.text, expected)
  return { revision, observedAt, checks: { stateCurrent: Boolean(stateCurrent), resultCurrent: Boolean(resultCurrent),
    requestHit: Boolean(requestHit), mockMatches: Boolean(mockMatches), pageMatches: Boolean(pageMatches) } }
}

// The trace is captured independently at each UI transition; no runtime mutation occurs here.
export function evaluateBranchIsolation(run, scenario, trace) {
  const phases = PHASES[scenario?.coverage?.behavior]
  if (!phases) throw new Error('Case is not a branch-isolation behavior')
  assertBranchIsolationCase(scenario)
  const selectedProfileId = run?.context?.profileId
  const selectedScenarioId = run?.context?.plan?.scenarios?.find(item => item.apiUrl === scenario.apiUrl)?.id
  const snapshots = trace?.snapshots
  const sessionId = snapshots?.[0]?.sessionId
  const previewVerified = run?.steps?.find(step => step?.id === 'verify-preview')?.output?.verified === true
  if (run?.status !== 'completed' || !previewVerified || !validText(selectedProfileId) || !validText(selectedScenarioId)
    || !validText(sessionId) || !Array.isArray(snapshots) || snapshots.length !== phases.length) {
    return { outcome: 'not_verified', checks: [] }
  }
  if (run.context.query !== scenario.intent
    || (run.context.target?.routePath || run.context.routePath) !== scenario.routePath) {
    return { outcome: 'failed', checks: [] }
  }
  if (phases[0] === 'selected-before' && scenario.branchIsolation.alternateProfileId === selectedProfileId) {
    return { outcome: 'failed', checks: [] }
  }
  const selected = { mockFields: scenario.mockFields, visibleText: scenario.visibleText, absentText: scenario.absentText }
  const isolation = scenario.branchIsolation
  const contrast = phases[0] === 'default-before' ? isolation.default : isolation.alternate
  let previousRevision
  let previousObservedAt
  const checks = phases.map((phase, index) => {
    const expectedProfileId = phase.startsWith('default') ? ''
      : phase === 'alternate' ? isolation.alternateProfileId : selectedProfileId
    const expected = phase.startsWith('default') || phase === 'alternate' ? contrast : selected
    const expectedScenarioId = phase.startsWith('default') || phase === 'alternate' ? contrast.scenarioId : selectedScenarioId
    const result = snapshotChecks(snapshots[index], sessionId, previousRevision, previousObservedAt, expectedProfileId,
      expectedScenarioId, expected, scenario)
    previousRevision = result.revision
    previousObservedAt = result.observedAt
    return { phase, ...result.checks }
  })
  return { outcome: checks.every(({ phase, ...items }) => Object.values(items).every(Boolean)) ? 'passed' : 'failed', checks }
}
