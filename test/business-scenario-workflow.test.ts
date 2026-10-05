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
