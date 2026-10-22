import { isDeepStrictEqual } from 'node:util'

function check(passed, reason) {
  return { status: passed ? 'passed' : 'failed', ...(!passed && reason ? { reason } : {}) }
}

function getPath(value, path) {
  return path.reduce((current, part) => current?.[part], value)
}

const measured = { status: 'not_measured' }
const time = value => typeof value === 'string' ? Date.parse(value) : NaN

function routeMatches(url, routePath) {
  if (typeof url !== 'string') return false
  const hash = url.indexOf('#')
  return (hash >= 0 ? url.slice(hash + 1) : url).split('?')[0] === routePath
}

function previewEvidenceCheck(run, scenario, matchingPlan, verificationStep, evidence) {
  if (!evidence) return measured
  const createdAt = time(run.steps?.find(step => step.id === 'create-profile')?.completedAt)
  const selectedAt = time(evidence.selectionAt)
  const responseAt = time(evidence.mockResponse?.timestamp)
  const capturedAt = time(evidence.page?.capturedAt)
  const verifiedAt = time(verificationStep?.completedAt)
  const state = evidence.state
  const response = evidence.mockResponse
  const page = evidence.page
  let urlCurrent = false
  try {
    const stateUrl = new URL(state.url)
    const pageUrl = new URL(page.url)
    urlCurrent = stateUrl.searchParams.get('__mockProfile') === run.context?.profileId
      && pageUrl.searchParams.get('__mockProfile') === run.context?.profileId
      && stateUrl.searchParams.get('__dshRevision') === String(state.revision)
      && pageUrl.searchParams.get('__dshRevision') === String(state.revision)
      && stateUrl.searchParams.get('__dshRevisionId') === state.revisionId
      && pageUrl.searchParams.get('__dshRevisionId') === state.revisionId
      && routeMatches(page.url, scenario.routePath)
  } catch { /* Missing or malformed URLs are not valid evidence. */ }
  return check(Number.isFinite(createdAt) && Number.isFinite(selectedAt) && Number.isFinite(responseAt)
    && Number.isFinite(capturedAt) && Number.isFinite(verifiedAt)
    && createdAt <= selectedAt && selectedAt <= responseAt && responseAt <= capturedAt && capturedAt <= verifiedAt
    && state?.profileId === run.context?.profileId && Number.isSafeInteger(state?.revision) && state.revision > 0
    && typeof state?.revisionId === 'string' && state.revisionId.length > 0 && urlCurrent
    && response?.profileId === run.context?.profileId && response?.scenarioId === matchingPlan?.id
    && response?.path === (scenario.requestPath || `/mock${scenario.apiUrl}`)
    && Number.isInteger(response?.statusCode) && response.statusCode >= 200 && response.statusCode < 300
    && typeof page?.text === 'string'
    && page.text === verificationStep?.output?.pageObservation?.text,
  'Browser response, selected revision, Profile, Scenario or observation does not belong to this completed run')
}

function linkedDomCheck(assertion, page) {
  if (!assertion) return measured
  if (!page) return measured
  const containers = page.domContainers
  return check(Array.isArray(containers) && containers.some(container =>
    container?.selector === assertion.containerSelector && Array.isArray(container.fields)
      && assertion.fields.every(field => {
        const actual = container.fields.find(item => item?.selector === field.selector)?.text
        return typeof actual === 'string' && (field.equals === undefined
          ? actual.includes(field.includes) : actual === field.equals)
      })), 'Required field values were not observed within the same DOM container')
}

export function evaluateBusinessExperience(run, scenario, previewEvidence) {
  if (!run || typeof run !== 'object') throw new Error('A workflow run is required')
  if (!scenario || typeof scenario !== 'object') throw new Error('A scenario specification is required')
  const steps = new Map((run.steps || []).map(step => [step.id, step]))
  if (scenario.expectedFailure) {
    const failure = steps.get(scenario.expectedFailure.stepId)
    const checks = {
      intent: check(run.context?.query === scenario.intent, 'Run intent differs from the failure case'),
      failureGate: check(run.status === 'failed' && failure?.status === 'failed'
        && failure.error?.code === scenario.expectedFailure.code, 'Expected workflow failure gate was not reached'),
      noMutation: check(!run.context?.profileId
        && !['create-profile', 'apply-profile'].some(id => steps.get(id)?.status === 'completed'),
      'Workflow created or applied a Profile before rejecting the case')
    }
    return { caseId: scenario.id, runId: run.id, runStatus: run.status, checks,
      outcome: run.status === 'pending' || run.status === 'running' || run.status === 'waiting_for_user'
        || run.status === 'cancelled' ? 'not_verified'
        : Object.values(checks).every(item => item.status === 'passed') ? 'passed' : 'failed' }
  }
  const verificationStep = steps.get('verify-preview')
  const verification = verificationStep?.output
  const observation = verification?.pageObservation
  const planScenarios = run.context?.plan?.scenarios || []
  const matchingPlan = planScenarios.find(item => item.apiUrl === scenario.apiUrl)
  const target = run.context?.target
  const browserEvidence = previewEvidenceCheck(run, scenario, matchingPlan, verificationStep, previewEvidence)
  const result = {
    caseId: scenario.id,
    runId: run.id,
    runStatus: run.status,
    checks: {
      target: target ? check(
        target.routePath === scenario.routePath && run.context?.query === scenario.intent,
        'Run intent or resolved route differs from the scenario specification'
      ) : { status: 'not_measured' },
      agentIntentResolution: target?.source === 'explicit-route' ? { status: 'not_measured', reason: 'Route was supplied explicitly' } : target ? check(target.routePath === scenario.routePath, 'Intent resolved to a different route') : { status: 'not_measured' },
      sourceScenario: scenario.sourceScenarioId ? check(matchingPlan?.sourceScenarioId === scenario.sourceScenarioId,
        'The plan did not reuse the human-approved source Scenario') : measured,
      mockPlan: matchingPlan?.data ? check(
        (scenario.mockFields || []).every(field => isDeepStrictEqual(getPath(matchingPlan.data, field.path), field.equals)),
        'Planned Mock fields do not match the scenario expectation'
      ) : previewEvidence ? check(browserEvidence.status === 'passed'
        && (scenario.mockFields || []).every(field => isDeepStrictEqual(
          getPath(previewEvidence.mockResponse?.body, field.path), field.equals)),
      'Browser-captured installed Mock fields do not match the reviewed expectation')
        : { status: matchingPlan ? 'not_measured' : run.status === 'completed' ? 'failed' : 'not_measured',
        reason: matchingPlan ? 'Source-clone plan needs an independently captured browser Mock response'
          : 'Expected API is absent from the plan' },
      browserEvidence: matchingPlan?.sourceScenarioId || previewEvidence ? browserEvidence : measured,
      requestHit: verification ? check(
        verification.verified === true
          && verification.checks?.scenarios?.some(item => item.scenarioId === matchingPlan?.id && item.passed === true) === true,
        'Expected Scenario has no verified real request hit'
      ) : { status: 'not_measured' },
      page: observation ? check(
        verification.checks?.observationCurrent === true
          && verification.checks?.route === true
          && routeMatches(observation.route, scenario.routePath)
          && (scenario.visibleText || []).every(value => observation.text?.includes(value))
          && (scenario.absentText || []).every(value => !observation.text?.includes(value)),
        'Rendered page does not satisfy required and forbidden text assertions'
      ) : { status: 'not_measured' },
      linkedDom: linkedDomCheck(scenario.domAssertion, previewEvidence?.page)
    }
  }
  const required = ['target', 'mockPlan', 'requestHit', 'page']
  if (scenario.sourceScenarioId) required.push('sourceScenario')
  if (scenario.sourceScenarioId || previewEvidence) required.push('browserEvidence')
  if (scenario.domAssertion) required.push('linkedDom')
  const outcomeChecks = required.map(key => result.checks[key].status)
  result.outcome = outcomeChecks.includes('failed') ? 'failed'
    : run.status === 'completed' && outcomeChecks.every(status => status === 'passed') ? 'passed' : 'not_verified'
  return result
}
