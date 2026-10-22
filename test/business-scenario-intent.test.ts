import { describe, expect, it, vi } from 'vitest'
import { BusinessWorkflowRuntime } from '../src/main/business-workflow-runtime'
import { registerBusinessScenarioWorkflow } from '../src/main/business-scenario-workflow'
import type { BusinessPluginSemanticRule } from '../src/main/business-plugin-contract'

const rule: BusinessPluginSemanticRule = {
  id: 'normal', routePath: '/repay/receiptList', intentEquals: '借据列表正常展示', intentMatch: 'leading-clause',
  apiUrl: '/loanNbr/loanNbr.json', fieldAssertions: [{ path: ['data', 'list', 0, 'duestatus'], equals: '0' }],
  sourceScenarioIds: ['normal-approved']
}
const query = `${rule.intentEquals}：同一卡片显示借据号和正常。创建后保持默认，不执行交易。`
const plan = { profileId: 'intent_normal', label: 'Reviewed normal receipt', page: 'repay',
  scenarios: [{ id: 'normal-copy', apiUrl: rule.apiUrl, sourceScenarioId: 'normal-approved' }] }

function setup(rules: BusinessPluginSemanticRule[] = [rule], runtime = new BusinessWorkflowRuntime()) {
  const requestBusiness = vi.fn(async (path: string) => {
    if (path === '/__desktop/resolve-target') return { routePath: rule.routePath, source: 'explicit-route', confidence: 'high', candidates: [] }
    if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-1', analysisPlan: {
      semanticValueChecks: { approvedSources: [{ apiUrl: rule.apiUrl, scenarioId: 'normal-approved', status: 'matched' }] }
    } }
    return { operationId: 'created-once' }
  })
  const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'test.business', semanticRules: rules, requestBusiness })
  return { runtime, start, requestBusiness }
}

describe('declared business intent separated from preserved request details', () => {
  it('keeps the full query while checking the canonical intent at proposal and creation', async () => {
    const { start, runtime, requestBusiness } = setup()
    const run = await start({ query, routePath: rule.routePath })
    expect(run.context).toMatchObject({ query, semanticIntentContract: 1, semanticExpectations: [rule],
      intentResolution: { canonicalIntent: rule.intentEquals, source: 'declared-leading-clause', ruleIds: ['normal'] } })
    expect(requestBusiness).toHaveBeenCalledWith('/__desktop/analyze-target', expect.objectContaining({ query, semanticExpectations: [rule] }), undefined)
    const bad = { ...plan, scenarios: [{ ...plan.scenarios[0], sourceScenarioId: 'wrong-state' }] }
    await expect(runtime.proposeCheckpoint(run.id, bad)).rejects.toMatchObject({ code: 'WORKFLOW_SEMANTIC_MISMATCH' })
    await expect(runtime.resume(run.id, bad)).rejects.toMatchObject({ code: 'WORKFLOW_SEMANTIC_MISMATCH' })
    expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/create-profile')).toBe(false)
    const staged = await runtime.proposeCheckpoint(run.id, plan)
    expect(staged.currentStepId).toBe('confirm-plan')
    if (!staged.checkpointProposal) throw new Error('Expected the validated proposal')
    const created = await runtime.approveCheckpointProposal(run.id, staged.checkpointProposal.id)
    expect(created.currentStepId).toBe('wait-for-preview')
    expect(requestBusiness).toHaveBeenCalledWith('/__desktop/create-profile', expect.objectContaining({ query, semanticExpectations: [rule] }), undefined)
    expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/apply')).toBe(false)
  })

  it('leaves undeclared longer queries unmatched but retains legacy exact matching', async () => {
    const { start } = setup([{ ...rule, intentMatch: 'exact' }])
    expect((await start({ query, routePath: rule.routePath })).context.semanticExpectations).toEqual([])
    expect((await start({ query: rule.intentEquals, routePath: rule.routePath })).context.semanticExpectations).toHaveLength(1)
  })

  it('fails before analysis or writes when multiple declared intent clauses conflict', async () => {
    const { start, requestBusiness } = setup([rule, { ...rule, id: 'overdue', intentEquals: '借据列表展示逾期借据' }])
    const run = await start({ query: `${rule.intentEquals}；借据列表展示逾期借据`, routePath: rule.routePath })
    expect(run).toMatchObject({ status: 'failed', currentStepId: 'analyze-target' })
    expect(run.steps[0]?.error).toMatchObject({ code: 'WORKFLOW_INTENT_AMBIGUOUS', retryable: false })
    expect(requestBusiness).toHaveBeenCalledTimes(1)
  })

  it('does not change a reviewed run when plugin matching is removed after analysis', async () => {
    const activeRule = { ...rule }
    const rules = [activeRule]
    const { runtime, start, requestBusiness } = setup(rules)
    const run = await start({ query, routePath: rule.routePath })
    activeRule.intentMatch = 'exact'
    await expect(runtime.proposeCheckpoint(run.id, plan)).rejects.toMatchObject({ code: 'WORKFLOW_INTENT_CHANGED' })
    expect(runtime.getRun(run.id)?.currentStepId).toBe('confirm-plan')
    expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/create-profile')).toBe(false)
  })

  it('keeps confirmation waiting even if every matching rule is removed', async () => {
    const rules = [{ ...rule }]
    const { runtime, start, requestBusiness } = setup(rules)
    const run = await start({ query, routePath: rule.routePath })
    rules.splice(0)
    await expect(runtime.resume(run.id, plan)).rejects.toMatchObject({ code: 'WORKFLOW_INTENT_CHANGED' })
    expect(runtime.getRun(run.id)?.currentStepId).toBe('confirm-plan')
    expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/create-profile')).toBe(false)
  })

  it('does not silently weaken declared fields while keeping the same intent and rule ID', async () => {
    const activeRule = { ...rule, fieldAssertions: [...rule.fieldAssertions] }
    const { runtime, start } = setup([activeRule])
    const run = await start({ query, routePath: rule.routePath })
    activeRule.fieldAssertions = []
    await expect(runtime.proposeCheckpoint(run.id, plan)).rejects.toMatchObject({ code: 'WORKFLOW_INTENT_CHANGED' })
    expect(runtime.getRun(run.id)?.currentStepId).toBe('confirm-plan')
  })

  it('restores old runs without retroactively turning on clause matching', async () => {
    const first = setup([])
    const old = await first.start({ query, routePath: rule.routePath })
    delete old.context.semanticIntentContract
    delete old.context.intentResolution
    const runtime = new BusinessWorkflowRuntime()
    // A real restored run comes from JSON, not a presented object with undefined optional fields.
    runtime.restoreRuns([JSON.parse(JSON.stringify(old))])
    const { requestBusiness } = setup([rule], runtime)
    await runtime.proposeCheckpoint(old.id, plan)
    expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/validate-semantic-source')).toBe(false)
    expect(runtime.getRun(old.id)?.context).not.toHaveProperty('intentResolution')
  })
})
