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
})
