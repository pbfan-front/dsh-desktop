import { describe, expect, it } from 'vitest'
import { BUSINESS_CONTROL_ERROR, profileCreationRequestError, resolveSemanticIntent, validSemanticExpectations, validSemanticSourceRequest } from '../src/shared/business-control-contract'

const rule = {
  id: 'receipt-normal-status', routePath: '/repay/receiptList', intentEquals: '借据列表正常展示',
  apiUrl: '/loanNbr/loanNbr.json', fieldAssertions: [{ path: ['data', 'list', 0, 'duestatus'], equals: '0' }],
  sourceScenarioIds: ['正常借据可以提前结清']
}
const request = { routePath: rule.routePath, query: rule.intentEquals, semanticExpectations: [rule],
  scenarios: [{ apiUrl: rule.apiUrl, sourceScenarioId: rule.sourceScenarioIds[0] }] }
const creation = { evidenceId: 'evidence-1', query: rule.intentEquals,
  profile: { id: 'receipt_normal', label: '正常借据', page: 'receiptList', routePath: rule.routePath },
  scenarios: [{ id: 'receipt_normal_data', apiUrl: rule.apiUrl, data: {} }], semanticExpectations: [rule] }

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

  it('shares the Profile creation envelope and preserves its rejection reasons', () => {
    expect(profileCreationRequestError(creation)).toBeNull()
    expect(profileCreationRequestError({ ...creation, profile: { ...creation.profile, id: 'a'.repeat(65) } })).toBe('Invalid profile id')
    expect(profileCreationRequestError({ ...creation, profile: { ...creation.profile, routePath: '/../private' } })).toBe('profile requires a non-empty label, page and safe absolute routePath')
    expect(profileCreationRequestError({ ...creation, scenarios: [] })).toBe('scenarios must contain 1-12 items')
    expect(profileCreationRequestError({ ...creation, query: '其他业务状态' })).toBe('Invalid semantic expectations for Profile creation')
  })

  it.each(['：', ':', '，', ',', '。', '；', ';', '\n', '\r\n'])('recognizes only an opted-in exact leading clause before %j', separator => {
    const declared = { ...rule, intentMatch: 'leading-clause' as const }
    const query = `  ${rule.intentEquals} ${separator} 保持默认分支，不执行交易。`
    expect(resolveSemanticIntent([declared], rule.routePath, query)).toEqual({ status: 'matched',
      canonicalIntent: rule.intentEquals, source: 'declared-leading-clause', ruleIds: [rule.id] })
    expect(validSemanticSourceRequest({ ...request, query, semanticExpectations: [declared] })).toBe(true)
    expect(profileCreationRequestError({ ...creation, query, semanticExpectations: [declared] })).toBeNull()
    expect(resolveSemanticIntent([rule], rule.routePath, query).status).toBe('unmatched')
  })

  it.each(['不要借据列表正常展示：保持默认', '不是借据列表正常展示', '示例：借据列表正常展示',
    '“借据列表正常展示”：保持默认', '借据列表展示正常：保持默认', '借据列表正常展示更多：保持默认',
    ':借据列表正常展示', '借据列表正常展示/创建分支'])('does not guess intent from %j', query => {
    expect(resolveSemanticIntent([{ ...rule, intentMatch: 'leading-clause' }], rule.routePath, query).status).toBe('unmatched')
  })

  it('rejects conflicting declared clauses and keeps route scope exact', () => {
    const rules = [{ ...rule, intentMatch: 'leading-clause' as const },
      { ...rule, id: 'overdue', intentEquals: '借据列表展示逾期借据' }]
    const query = `${rule.intentEquals}；借据列表展示逾期借据`
    expect(resolveSemanticIntent(rules, rule.routePath, query).status).toBe('ambiguous')
    expect(validSemanticExpectations(rules, rule.routePath, query)).toBe(false)
    expect(resolveSemanticIntent(rules, '/repay/receiptListOther', rule.intentEquals).status).toBe('unmatched')
    expect(validSemanticExpectations([{ ...rule, intentMatch: 'fuzzy' }], rule.routePath, rule.intentEquals)).toBe(false)
    expect(validSemanticExpectations([{ ...rule, intentEquals: '业务：正常', intentMatch: 'leading-clause' }], rule.routePath, '业务：正常')).toBe(false)
  })
})
