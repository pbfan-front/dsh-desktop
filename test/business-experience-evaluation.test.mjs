import { describe, expect, it } from 'vitest'
import { evaluateBusinessExperience } from '../scripts/business-experience-evaluation.mjs'

const scenario = {
  id: 'receipt-normal', intent: '借据列表正常展示', routePath: '/repay/receiptList', apiUrl: '/loanNbr/loanNbr.json',
  mockFields: [{ path: ['data', 'list', 0, 'duestatus'], equals: '0' }],
  visibleText: ['借据列表'], absentText: ['系统繁忙', '逾期']
}

function run(status = '0', pageText = '借据列表 正常') {
  return {
    id: 'run-1', status: 'completed',
    context: {
      query: scenario.intent, target: { routePath: scenario.routePath, source: 'explicit-route' },
      plan: { scenarios: [{ id: 'normal-loan', apiUrl: scenario.apiUrl, data: { data: { list: [{ duestatus: status }] } } }] }
    },
    steps: [{ id: 'verify-preview', output: {
      verified: true,
      checks: { observationCurrent: true, route: true, scenarios: [{ scenarioId: 'normal-loan', passed: true }] },
      pageObservation: { route: scenario.routePath, text: pageText }
    } }]
  }
}

describe('business experience evaluation', () => {
  it('accepts a matching Mock plan, request hit and page outcome', () => {
    const result = evaluateBusinessExperience(run(), scenario)
    expect(result.outcome).toBe('passed')
    expect(result.checks.agentIntentResolution.status).toBe('not_measured')
    const hashObserved = run()
    hashObserved.steps[0].output.pageObservation.route = '/mm2609240/#/repay/receiptList'
    expect(evaluateBusinessExperience(hashObserved, scenario).outcome).toBe('passed')
  })

  it('catches a business-semantic mismatch despite a passing preview verifier', () => {
    const result = evaluateBusinessExperience(run('1', '借据列表 逾期'), scenario)
    expect(result.outcome).toBe('failed')
    expect(result.checks.mockPlan.status).toBe('failed')
    expect(result.checks.requestHit.status).toBe('passed')
    expect(result.checks.page.status).toBe('failed')
  })

  it('does not mark an unfinished workflow as verified', () => {
    const input = run()
    input.status = 'cancelled'
    input.steps = []
    expect(evaluateBusinessExperience(input, scenario).outcome).toBe('not_verified')
  })

  it('does not count a source-clone plan as a checked Mock payload', () => {
    const input = run()
    delete input.context.plan.scenarios[0].data
    expect(evaluateBusinessExperience(input, scenario).checks.mockPlan.status).toBe('not_measured')
    expect(evaluateBusinessExperience(input, scenario).outcome).toBe('not_verified')
  })

  it('requires fresh browser Mock and same-container DOM evidence for an approved source clone', () => {
    const reviewed = { ...scenario, sourceScenarioId: '正常借据可以提前结清',
      requestPath: '/mock/mesp-wpm/loanNbr/loanNbr.json',
      mockFields: [...scenario.mockFields, { path: ['data', 'list', 0, 'loan_acct_no'], equals: 'JQ123' }],
      visibleText: ['借据列表', 'JQ123', '正常'], absentText: ['系统繁忙'],
      domAssertion: { containerSelector: '.receipt-item-wrapper', fields: [
        { selector: '.top-receipt', includes: 'JQ123' }, { selector: '.status span', equals: '正常' }
      ] } }
    const input = run('0', '借据列表 JQ123 正常')
    input.context.profileId = 'profile-created'
    input.context.plan.scenarios[0] = { id: 'normal-loan', apiUrl: scenario.apiUrl,
      sourceScenarioId: reviewed.sourceScenarioId }
    input.steps.unshift({ id: 'create-profile', completedAt: '2026-10-16T04:00:01.000Z' })
    input.steps.find(step => step.id === 'verify-preview').completedAt = '2026-10-16T04:00:05.000Z'
    const url = 'http://127.0.0.1:8094/mm?__mockProfile=profile-created&__dshRevision=2&__dshRevisionId=revision-new#/repay/receiptList'
    const evidence = { selectionAt: '2026-10-16T04:00:02.000Z',
      state: { profileId: 'profile-created', revision: 2, revisionId: 'revision-new', url },
      mockResponse: { timestamp: '2026-10-16T04:00:03.000Z', statusCode: 200,
        profileId: 'profile-created', scenarioId: 'normal-loan', path: reviewed.requestPath,
        body: { data: { list: [{ duestatus: '0', loan_acct_no: 'JQ123' }] } } },
      page: { capturedAt: '2026-10-16T04:00:04.000Z', url, text: '借据列表 JQ123 正常',
        domContainers: [{ selector: '.receipt-item-wrapper', fields: [
          { selector: '.top-receipt', text: '借据号 JQ123' }, { selector: '.status span', text: '正常' }
        ] }] } }
    expect(evaluateBusinessExperience(input, reviewed).outcome).toBe('not_verified')
    expect(evaluateBusinessExperience(input, reviewed, evidence).outcome).toBe('passed')
    const stale = structuredClone(evidence)
    stale.mockResponse.timestamp = '2026-10-16T04:00:00.000Z'
    expect(evaluateBusinessExperience(input, reviewed, stale).checks.browserEvidence.status).toBe('failed')
    const wrongRevision = structuredClone(evidence)
    wrongRevision.page.url = wrongRevision.page.url.replace('revision-new', 'revision-old')
    expect(evaluateBusinessExperience(input, reviewed, wrongRevision).outcome).toBe('failed')
    const wrongCard = structuredClone(evidence)
    wrongCard.page.domContainers[0].fields[1].text = '逾期'
    expect(evaluateBusinessExperience(input, reviewed, wrongCard).checks.linkedDom.status).toBe('failed')
    const wrongSource = structuredClone(input)
    wrongSource.context.plan.scenarios[0].sourceScenarioId = '多个优惠券提示'
    expect(evaluateBusinessExperience(wrongSource, reviewed, evidence).checks.sourceScenario.status).toBe('failed')
  })

  it('requires the exact failure gate and no Profile mutation for negative cases', () => {
    const negative = { id: 'ambiguous-route', intent: '借据列表正常展示',
      expectedFailure: { stepId: 'analyze-target', code: 'E_TARGET_ROUTE_AMBIGUOUS' } }
    const input = { id: 'run-2', status: 'failed', context: { query: negative.intent },
      steps: [{ id: 'analyze-target', status: 'failed', error: { code: 'E_TARGET_ROUTE_AMBIGUOUS' } }] }
    expect(evaluateBusinessExperience(input, negative).outcome).toBe('passed')
    expect(evaluateBusinessExperience({ ...input, context: { ...input.context, profileId: 'unexpected' } }, negative).outcome).toBe('failed')
    expect(evaluateBusinessExperience({ ...input, status: 'cancelled' }, negative).outcome).toBe('not_verified')
  })
})
