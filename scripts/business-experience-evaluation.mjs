function check(passed, reason) {
  return { status: passed ? 'passed' : 'failed', ...(!passed && reason ? { reason } : {}) }
}

function getPath(value, path) {
  return path.reduce((current, part) => current?.[part], value)
}

export function evaluateBusinessExperience(run, scenario) {
  if (!run || typeof run !== 'object') throw new Error('A workflow run is required')
  if (!scenario || typeof scenario !== 'object') throw new Error('A scenario specification is required')
  const steps = new Map((run.steps || []).map(step => [step.id, step]))
  const verification = steps.get('verify-preview')?.output
  const observation = verification?.pageObservation
  const planScenarios = run.context?.plan?.scenarios || []
  const matchingPlan = planScenarios.find(item => item.apiUrl === scenario.apiUrl)
  const target = run.context?.target
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
      mockPlan: matchingPlan ? check(
        (scenario.mockFields || []).every(field => getPath(matchingPlan.data, field.path) === field.equals),
        'Planned Mock fields do not match the scenario expectation'
      ) : { status: run.status === 'completed' ? 'failed' : 'not_measured', reason: 'Expected API is absent from the plan' },
      requestHit: verification ? check(
        verification.verified === true
          && verification.checks?.scenarios?.some(item => item.scenarioId === matchingPlan?.id && item.passed === true) === true,
        'Expected Scenario has no verified real request hit'
      ) : { status: 'not_measured' },
      page: observation ? check(
        verification.checks?.observationCurrent === true
          && verification.checks?.route === true
          && observation.route === scenario.routePath
          && (scenario.visibleText || []).every(value => observation.text?.includes(value))
          && (scenario.absentText || []).every(value => !observation.text?.includes(value)),
        'Rendered page does not satisfy required and forbidden text assertions'
      ) : { status: 'not_measured' }
    }
  }
  const outcomeChecks = ['target', 'mockPlan', 'requestHit', 'page'].map(key => result.checks[key].status)
  result.outcome = outcomeChecks.includes('failed') ? 'failed'
    : run.status === 'completed' && outcomeChecks.every(status => status === 'passed') ? 'passed' : 'not_verified'
  return result
}
