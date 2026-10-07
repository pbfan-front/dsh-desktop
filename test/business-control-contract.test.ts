import { describe, expect, it } from 'vitest'
import { BUSINESS_CONTROL_ERROR, validSemanticExpectations, validSemanticSourceRequest } from '../src/shared/business-control-contract'

const rule = {
  id: 'receipt-normal-status', routePath: '/repay/receiptList', intentEquals: '借据列表正常展示',
  apiUrl: '/loanNbr/loanNbr.json', fieldAssertions: [{ path: ['data', 'list', 0, 'duestatus'], equals: '0' }],
  sourceScenarioIds: ['正常借据可以提前结清']
}
const request = { routePath: rule.routePath, query: rule.intentEquals, semanticExpectations: [rule],
  scenarios: [{ apiUrl: rule.apiUrl, sourceScenarioId: rule.sourceScenarioIds[0] }] }

describe('business control contract shared by Main and Runtime', () => {
  it('accepts the bounded source-validation request', () => {
    expect(validSemanticExpectations([rule], rule.routePath, rule.intentEquals)).toBe(true)
    expect(validSemanticSourceRequest(request)).toBe(true)
  })

  it('rejects mismatched targets and unsafe paths before crossing processes', () => {
    expect(validSemanticSourceRequest({ ...request, query: '其他业务状态' })).toBe(false)
    expect(validSemanticSourceRequest({ ...request, semanticExpectations: [{ ...rule,
      fieldAssertions: [{ path: ['__proto__'], equals: '0' }] }] })).toBe(false)
    expect(validSemanticSourceRequest({ ...request, scenarios: [{ ...request.scenarios[0], apiUrl: '/../private' }] })).toBe(false)
    expect(validSemanticSourceRequest({ ...request, scenarios: [] })).toBe(false)
  })

  it('shares stable error codes', () => {
    expect(BUSINESS_CONTROL_ERROR.targetRouteAmbiguous).toBe('E_TARGET_ROUTE_AMBIGUOUS')
    expect(BUSINESS_CONTROL_ERROR.semanticSourceChanged).toBe('WORKFLOW_SEMANTIC_SOURCE_CHANGED')
  })
})
