import { describe, expect, it, vi } from 'vitest'
import { registerBusinessScenarioWorkflow } from '../src/main/business-scenario-workflow'
import { summarizeBusinessScenarioTiming } from '../src/main/business-scenario-timing'
import { BusinessWorkflowRuntime } from '../src/main/business-workflow-runtime'

const startInput = {
  routePath: '/credit/productCombine',
  query: '额度页核额失败',
  apiUrls: ['/quota/query.json'],
  sessionId: 'session-1'
}

const resolvedTarget = {
  routePath: '/credit/productCombine',
  pageTitle: '企业或个人借款',
  source: 'explicit-route',
  confidence: 'high',
  currentRoute: '/repay/receiptList',
  candidates: [{ routePath: '/credit/productCombine', pageTitle: '企业或个人借款' }]
}

const plan = {
  profileId: 'quota_failed',
  label: '核额失败',
  page: 'productCombine',
  scenarios: [{ id: 'quota_fail', apiUrl: '/quota/query.json', data: { result: 'FAIL' } }]
}

const verification = {
  route: '/credit/productCombine',
  containsText: ['核额失败'],
  absentText: ['系统繁忙']
}

describe('business scenario workflow', () => {
  it('keeps ambiguous route candidates in one run and analyzes only after user-confirmed selection', async () => {
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'run-ambiguous' })
    const candidates = [
      { routePath: '/repay/receiptList', pageTitle: '还款查询' },
      { routePath: '/loanPurpose/receiptList/:batchId', pageTitle: '借据列表' }
    ]
    const requestBusiness = vi.fn(async (path: string, body: unknown) => {
      if (path === '/__desktop/resolve-target') {
        if ((body as { routePath?: string }).routePath === '/repay/receiptList') {
          return { ...resolvedTarget, routePath: '/repay/receiptList' }
        }
        throw Object.assign(new Error('Multiple business pages match the intent.'), {
          code: 'E_TARGET_ROUTE_AMBIGUOUS', retryable: true, candidates
        })
      }
      if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-receipt' }
      throw new Error('No write should happen before plan confirmation.')
    })
    const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'com.dataelement.demo-test', requestBusiness })

    const ambiguous = await start({ query: '借据列表正常展示' })
    expect(ambiguous.status).toBe('failed')
    expect(ambiguous.currentStepId).toBe('analyze-target')
    expect(ambiguous.steps[0]?.error).toMatchObject({ code: 'E_TARGET_ROUTE_AMBIGUOUS', candidates })
    expect(requestBusiness).toHaveBeenCalledTimes(1)
    const restoredRuntime = new BusinessWorkflowRuntime()
    restoredRuntime.restoreRuns([JSON.parse(JSON.stringify(ambiguous))])
    registerBusinessScenarioWorkflow({ runtime: restoredRuntime, pluginId: 'com.dataelement.demo-test', requestBusiness })
    await expect(restoredRuntime.retry(ambiguous.id)).rejects.toThrow('Choose one')
    await expect(restoredRuntime.retry(ambiguous.id, { selectedRoutePath: '/repay/receiptList', confirmedByUser: false })).rejects.toThrow('User confirmation')
    await expect(restoredRuntime.retry(ambiguous.id, { selectedRoutePath: '/credit/productCombine', confirmedByUser: true })).rejects.toThrow('not one of the saved candidates')
    expect(restoredRuntime.getRun(ambiguous.id)?.status).toBe('failed')
    expect(requestBusiness).toHaveBeenCalledTimes(1)

    const resolved = await restoredRuntime.retry(ambiguous.id, { selectedRoutePath: '/repay/receiptList', confirmedByUser: true })
    expect(resolved.id).toBe(ambiguous.id)
    expect(resolved.status).toBe('waiting_for_user')
    expect(resolved.currentStepId).toBe('confirm-plan')
    expect(resolved.context).toMatchObject({ routePath: '/repay/receiptList',
      targetSelection: { routePath: '/repay/receiptList', source: 'user-confirmed-candidate' },
      target: { routePath: '/repay/receiptList' } })
    expect(requestBusiness).toHaveBeenCalledTimes(3)
    expect(requestBusiness.mock.calls.filter(([path]) => path === '/__desktop/analyze-target')).toHaveLength(1)
  })

  it('separates request work from plan and preview waiting in persisted runs', async () => {
    let wallMs = 0
    let monotonicMs = 0
    const runtime = new BusinessWorkflowRuntime({
      idFactory: () => 'run-timing',
      now: () => new Date(Date.UTC(2026, 9, 5) + wallMs)
    })
    const requestBusiness = vi.fn(async (path: string) => {
      const delay = path === '/__desktop/resolve-target' ? 20 : path === '/__desktop/analyze-target' ? 80 : 10
      wallMs += delay
      monotonicMs += delay
      if (path === '/__desktop/resolve-target') return resolvedTarget
      if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-1' }
      if (path === '/__desktop/verify') return { verified: true, checks: {
        currentProfile: true, observationCurrent: true, route: true,
        containsText: [{ text: '核额失败', passed: true }],
        absentText: [{ text: '系统繁忙', passed: true }],
        scenarios: [{ scenarioId: 'quota_fail', passed: true }]
      } }
      return { ok: true }
    })
    const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'com.dataelement.demo-test', requestBusiness, nowMs: () => monotonicMs })
    const analyzed = await start(startInput)
    expect(summarizeBusinessScenarioTiming(analyzed)?.phases).toMatchObject({ resolveTargetMs: 20, analyzeTargetMs: 80 })
    expect(summarizeBusinessScenarioTiming(analyzed)?.phases.confirmPlanWaitMs).toBeUndefined()

    wallMs += 5000
    const applied = await runtime.resume(analyzed.id, plan)
    wallMs += 2000
    const completed = await runtime.resume(applied.id, verification)
    const summary = summarizeBusinessScenarioTiming(completed)
    expect(summary).toMatchObject({ status: 'completed', elapsedMs: 7130, activeMs: 130, checkpointWaitMs: 7000 })
    expect(summary?.phases).toMatchObject({
      resolveTargetMs: 20, analyzeTargetMs: 80, confirmPlanWaitMs: 5000,
      createProfileMs: 10, applyProfileMs: 10, previewWaitMs: 2000, verifyPreviewMs: 10
    })
    expect(summarizeBusinessScenarioTiming(JSON.parse(JSON.stringify(completed)))).toEqual(summary)
    expect(summarizeBusinessScenarioTiming({ ...completed, workflowId: 'other-workflow' })).toBeUndefined()
  })

  it('connects analysis, confirmed creation, apply and page verification in order', async () => {
    let sequence = 0
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => `run-${++sequence}` })
    const requestBusiness = vi.fn(async (path: string) => {
      if (path === '/__desktop/resolve-target') return resolvedTarget
      if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-1', apis: ['/quota/query.json'] }
      if (path === '/__desktop/create-profile') return { operationId: 'operation-1', profileId: plan.profileId }
      if (path === '/__desktop/apply') return { status: 'applied-command' }
      return { verified: true, checks: {
        currentProfile: true,
        observationCurrent: true,
        route: true,
        containsText: verification.containsText.map(text => ({ text, passed: true })),
        absentText: verification.absentText.map(text => ({ text, passed: true })),
        scenarios: [{ scenarioId: 'quota_fail', passed: true }]
      } }
    })
    const start = registerBusinessScenarioWorkflow({
      runtime,
      pluginId: 'com.dataelement.demo-test',
      requestBusiness
    })

    const analyzed = await start(startInput)
    expect(analyzed.status).toBe('waiting_for_user')
    expect(analyzed.currentStepId).toBe('confirm-plan')
    expect(requestBusiness).toHaveBeenNthCalledWith(1, '/__desktop/resolve-target', {
      routePath: startInput.routePath,
      query: startInput.query
    }, startInput.sessionId)
    expect(requestBusiness).toHaveBeenNthCalledWith(2, '/__desktop/analyze-target', {
      routePath: startInput.routePath,
      query: startInput.query,
      apiUrls: startInput.apiUrls
    }, startInput.sessionId)

    const applied = await runtime.resume(analyzed.id, plan)
    expect(applied.status).toBe('waiting_for_user')
    expect(applied.currentStepId).toBe('wait-for-preview')
    expect(requestBusiness).toHaveBeenNthCalledWith(3, '/__desktop/create-profile', expect.objectContaining({
      evidenceId: 'evidence-1',
      profile: expect.objectContaining({ id: plan.profileId, routePath: resolvedTarget.routePath }),
      scenarios: plan.scenarios
    }), startInput.sessionId)
    expect(requestBusiness).toHaveBeenNthCalledWith(4, '/__desktop/apply', { profileId: plan.profileId }, startInput.sessionId)

    const completed = await runtime.resume(applied.id, verification)
    expect(completed.status).toBe('completed')
    expect(completed.steps.map((step) => step.status)).toEqual([
      'completed', 'completed', 'completed', 'completed', 'completed', 'completed'
    ])
    expect(requestBusiness).toHaveBeenNthCalledWith(5, '/__desktop/verify', verification, startInput.sessionId)
  })

  it('allows a cross-page page hint to resolve the target without forcing the current preview route', async () => {
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'run-page-hint' })
    const target = { ...resolvedTarget, routePath: '/loan/receiveAcct', pageTitle: '收款账户', source: 'page-hint' }
    const requestBusiness = vi.fn(async (path: string) => {
      if (path === '/__desktop/resolve-target') return target
      if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-receive-account' }
      return { ok: true }
    })
    const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'com.dataelement.demo-test', requestBusiness })

    const analyzed = await start({ targetPage: '收款账户', query: '创建收款账户校验失败场景', sessionId: 'session-1' })
    expect(analyzed.status).toBe('waiting_for_user')
    expect(analyzed.context.target).toMatchObject({
      routePath: '/loan/receiveAcct',
      currentRoute: '/repay/receiptList',
      source: 'page-hint'
    })
    expect(requestBusiness).toHaveBeenNthCalledWith(1, '/__desktop/resolve-target', {
      targetPage: '收款账户',
      query: '创建收款账户校验失败场景'
    }, 'session-1')
    expect(requestBusiness).toHaveBeenNthCalledWith(2, '/__desktop/analyze-target', {
      routePath: '/loan/receiveAcct',
      query: '创建收款账户校验失败场景',
      apiUrls: []
    }, 'session-1')

    const draft = {
      profileId: 'receive_account_failed',
      label: '收款账户校验失败',
      page: 'receiveAcct',
      scenarios: [{
        id: 'receive_account_failed_data',
        apiUrl: '/withdrawal/inputReceiveAcctCheck.json',
        label: '失败返回',
        sourceScenarioId: '失败返回'
      }]
    }
    const applied = await runtime.resume(analyzed.id, draft)
    expect(applied.status).toBe('waiting_for_user')
    expect(requestBusiness).toHaveBeenNthCalledWith(3, '/__desktop/create-profile', expect.objectContaining({
      scenarios: draft.scenarios,
      profile: expect.objectContaining({ routePath: '/loan/receiveAcct' })
    }), 'session-1')
  })

  it('stops safely before writes when the confirmed plan is invalid', async () => {
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'run-invalid' })
    const requestBusiness = vi.fn(async (path: string) => path === '/__desktop/resolve-target' ? resolvedTarget : ({ evidenceId: 'evidence-1' }))
    const start = registerBusinessScenarioWorkflow({
      runtime,
      pluginId: 'com.dataelement.demo-test',
      requestBusiness
    })

    const analyzed = await start(startInput)
    const failed = await runtime.resume(analyzed.id, { profileId: '../unsafe', scenarios: [] })
    expect(failed.status).toBe('failed')
    expect(failed.currentStepId).toBe('create-profile')
    expect(failed.steps[2]?.error?.message).toContain('profileId')
    expect(requestBusiness).toHaveBeenCalledTimes(2)
  })

  it('blocks writes deterministically when analysis quality is insufficient', async () => {
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'run-insufficient-analysis' })
    const requestBusiness = vi.fn(async (path: string) => {
      if (path === '/__desktop/resolve-target') return resolvedTarget
      return {
        evidenceId: 'evidence-insufficient',
        analysisPlan: { qualityGate: { level: 'insufficient', gaps: ['source-evidence-missing'] } }
      }
    })
    const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'com.dataelement.demo-test', requestBusiness })

    const analyzed = await start(startInput)
    const failed = await runtime.resume(analyzed.id, plan)

    expect(failed.status).toBe('failed')
    expect(failed.currentStepId).toBe('create-profile')
    expect(failed.steps[2]?.error).toMatchObject({
      code: 'WORKFLOW_ANALYSIS_INSUFFICIENT',
      retryable: false
    })
    expect(requestBusiness).toHaveBeenCalledTimes(2)
  })

  it('blocks a business-authored semantic mismatch before creating a Profile', async () => {
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'run-semantic' })
    const requestBusiness = vi.fn(async (path: string) => path === '/__desktop/resolve-target'
      ? { ...resolvedTarget, routePath: '/repay/receiptList' }
      : { evidenceId: 'evidence-1' })
    const start = registerBusinessScenarioWorkflow({
      runtime, pluginId: 'com.dataelement.demo-test', requestBusiness,
      semanticRules: [{
        id: 'receipt-normal-status', routePath: '/repay/receiptList', intentEquals: '借据列表正常展示',
        apiUrl: '/loanNbr/loanNbr.json',
        fieldAssertions: [{ path: ['data', 'list', 0, 'duestatus'], equals: '0' }],
        sourceScenarioIds: ['正常借据可以提前结清']
      }]
    })
    const analyzed = await start({ routePath: '/repay/receiptList', query: '借据列表正常展示' })
    expect(analyzed.context.semanticExpectations).toHaveLength(1)
    const badPlan = { ...plan, scenarios: [{ id: 'overdue', apiUrl: '/loanNbr/loanNbr.json', data: { data: { list: [{ duestatus: '1' }] } } }] }
    await expect(runtime.resume(analyzed.id, badPlan)).rejects.toMatchObject({ code: 'WORKFLOW_SEMANTIC_MISMATCH' })
    const waiting = runtime.getRun(analyzed.id)
    expect(waiting?.status).toBe('waiting_for_user')
    expect(waiting?.currentStepId).toBe('confirm-plan')
    expect(waiting?.steps[1]?.status).toBe('running')
    expect(requestBusiness).toHaveBeenCalledTimes(2)
    const correctedPlan = { ...badPlan, scenarios: [{ ...badPlan.scenarios[0], data: { data: { list: [{ duestatus: '0' }] } } }] }
    expect((await runtime.resume(analyzed.id, correctedPlan)).status).toBe('waiting_for_user')
    expect(requestBusiness).toHaveBeenCalledTimes(4)
  })

  it('accepts a matching direct payload or explicitly approved source Scenario', async () => {
    let runId = 0
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => `run-semantic-${++runId}` })
    const requestBusiness = vi.fn(async (path: string) => path === '/__desktop/resolve-target'
      ? { ...resolvedTarget, routePath: '/repay/receiptList' }
      : { evidenceId: 'evidence-1' })
    const start = registerBusinessScenarioWorkflow({
      runtime, pluginId: 'com.dataelement.demo-test', requestBusiness,
      semanticRules: [{
        id: 'receipt-normal-status', routePath: '/repay/receiptList', intentEquals: '借据列表正常展示',
        apiUrl: '/loanNbr/loanNbr.json',
        fieldAssertions: [{ path: ['data', 'list', 0, 'duestatus'], equals: '0' }],
        sourceScenarioIds: ['正常借据可以提前结清']
      }]
    })
    const input = { routePath: '/repay/receiptList', query: '借据列表正常展示' }
    const direct = await start(input)
    const directPlan = { ...plan, scenarios: [{ id: 'normal', apiUrl: '/loanNbr/loanNbr.json', data: { data: { list: [{ duestatus: '0' }] } } }] }
    expect((await runtime.resume(direct.id, directPlan)).status).toBe('waiting_for_user')
    const cloned = await start(input)
    const clonedPlan = { ...plan, scenarios: [{ id: 'normal', apiUrl: '/loanNbr/loanNbr.json', sourceScenarioId: '正常借据可以提前结清' }] }
    expect((await runtime.resume(cloned.id, clonedPlan)).status).toBe('waiting_for_user')
  })

  it('omits an absent optional sessionId from the persisted workflow context', async () => {
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'run-no-session' })
    const requestBusiness = vi.fn(async (path: string) => path === '/__desktop/resolve-target' ? resolvedTarget : ({ evidenceId: 'evidence-1' }))
    const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'com.dataelement.demo-test', requestBusiness })

    const run = await start({ routePath: startInput.routePath, query: startInput.query })
    expect(run.status).toBe('waiting_for_user')
    expect(run.context).not.toHaveProperty('sessionId')
  })

  it('keeps a failed business write retryable and resumes from that step only', async () => {
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'run-retry' })
    let createAttempts = 0
    const requestBusiness = vi.fn(async (path: string) => {
      if (path === '/__desktop/resolve-target') return resolvedTarget
      if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-1' }
      if (path === '/__desktop/create-profile' && ++createAttempts === 1) throw new Error('temporary write failure')
      return { ok: true }
    })
    const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'com.dataelement.demo-test', requestBusiness })

    const analyzed = await start(startInput)
    const failed = await runtime.resume(analyzed.id, plan)
    expect(failed.status).toBe('failed')
    expect(failed.currentStepId).toBe('create-profile')

    const retried = await runtime.retry(failed.id)
    expect(retried.status).toBe('waiting_for_user')
    expect(retried.currentStepId).toBe('wait-for-preview')
    expect(createAttempts).toBe(2)
    expect(requestBusiness.mock.calls.filter(([path]) => path === '/__desktop/analyze-target')).toHaveLength(1)
  })

  it('cannot complete when the verification handler returns success without real request evidence', async () => {
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'run-gate' })
    const requestBusiness = vi.fn(async (path: string) => {
      if (path === '/__desktop/resolve-target') return resolvedTarget
      if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-1' }
      if (path === '/__desktop/verify') return { verified: true, checks: {
        currentProfile: true, observationCurrent: true, route: true,
        containsText: [{ text: '核额失败', passed: true }], absentText: [], scenarios: []
      } }
      return { ok: true }
    })
    const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'com.dataelement.demo-test', requestBusiness })
    const analyzed = await start(startInput)
    const waiting = await runtime.resume(analyzed.id, plan)
    const rejected = await runtime.resume(waiting.id, verification)

    expect(rejected.status).toBe('failed')
    expect(rejected.currentStepId).toBe('verify-preview')
    expect(rejected.steps[5]?.error).toMatchObject({ code: 'WORKFLOW_GATE_REJECTED', retryable: true })
  })
})
