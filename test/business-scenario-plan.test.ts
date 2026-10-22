import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BusinessWorkflowRuntime } from '../src/main/business-workflow-runtime'
import { createPersistentBusinessWorkflowRuntime } from '../src/main/business-workflow-store'
import { registerBusinessScenarioWorkflow } from '../src/main/business-scenario-workflow'
import { approveBusinessScenarioPlan, proposeBusinessScenarioPlan } from '../src/main/business-scenario-plan'

const plan = { profileId: 'receipt_review', label: 'Reviewed normal receipt', page: 'repay',
  scenarios: [{ id: 'reviewed_normal', apiUrl: '/loanNbr/loanNbr.json', data: { duestatus: '0' } }],
  verificationSteps: [{ id: 'list', label: 'Normal receipt', route: '/repay/receiptList', containsText: ['正常'], absentText: ['系统繁忙'] }] }

async function setup(runtime = new BusinessWorkflowRuntime()) {
  const current = { quality: 'ready' }
  const requestBusiness = vi.fn(async (path: string) => {
    if (path === '/__desktop/resolve-target') return { routePath: '/repay/receiptList', source: 'explicit-route', confidence: 'high', candidates: [] }
    if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-1', analysisPlan: { qualityGate: { level: current.quality } } }
    return { ok: true }
  })
  const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'test.business', requestBusiness })
  const run = await start({ routePath: '/repay/receiptList', query: '正常借据', sessionId: 'session-1' })
  return { runtime, run, requestBusiness, current, stage: (value: unknown = plan, sessionId = 'session-1') =>
    proposeBusinessScenarioPlan(runtime, { runId: run.id, sessionId, plan: value }) }
}

describe('versioned scenario plan review', () => {
  it('validates and saves without creating, then confirms only the displayed stored plan', async () => {
    const { runtime, run, stage, requestBusiness } = await setup()
    const proposed = await stage()
    expect(proposed).toMatchObject({ status: 'waiting_for_user', currentStepId: 'confirm-plan', checkpointProposal: { output: plan } })
    expect(proposed.context.plan).toBeUndefined()
    expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/create-profile')).toBe(false)
    const created = await approveBusinessScenarioPlan(runtime, run.id, { proposalId: proposed.checkpointProposal?.id, sessionId: 'session-1' })
    expect(created).toMatchObject({ status: 'waiting_for_user', currentStepId: 'wait-for-preview', context: { profileId: plan.profileId, plan } })
    expect(created.checkpointProposal).toBeUndefined()
    expect(created.steps.find(step => step.id === 'confirm-plan')?.confirmedProposalId).toBe(proposed.checkpointProposal?.id)
    expect(requestBusiness.mock.calls.filter(([path]) => path === '/__desktop/create-profile')).toHaveLength(1)
    expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/apply')).toBe(false)
    await expect(approveBusinessScenarioPlan(runtime, run.id, { proposalId: proposed.checkpointProposal?.id, sessionId: 'session-1' })).rejects.toThrow('confirm-plan')
  })

  it('rejects another conversation, a replaced proposal, and any renderer plan override', async () => {
    const { runtime, run, stage, requestBusiness } = await setup()
    await expect(stage(plan, 'session-other')).rejects.toThrow('conversation')
    const first = await stage()
    const second = await stage({ ...plan, label: 'New reviewed version' })
    expect(first.checkpointProposal?.id).not.toBe(second.checkpointProposal?.id)
    await expect(approveBusinessScenarioPlan(runtime, run.id, { proposalId: first.checkpointProposal?.id, sessionId: 'session-1' })).rejects.toThrow('changed')
    await expect(approveBusinessScenarioPlan(runtime, run.id, { proposalId: second.checkpointProposal?.id, sessionId: 'session-other' })).rejects.toThrow('conversation')
    await expect(approveBusinessScenarioPlan(runtime, run.id, { proposalId: second.checkpointProposal?.id, sessionId: 'session-1', plan: {} })).rejects.toThrow('overrides')
    expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/create-profile')).toBe(false)
    expect(runtime.getRun(run.id)?.checkpointProposal?.output).toMatchObject({ label: 'New reviewed version' })
  })

  it.each([{}, { ...plan, scenarios: [] }, { ...plan, verificationSteps: [] }, { ...plan, verificationSteps: [{ ...plan.verificationSteps[0], route: '/wrong' }] }])(
    'rejects malformed proposals without replacing the last reviewable version', async invalid => {
      const { runtime, run, stage } = await setup()
      const first = await stage()
      await expect(stage(invalid)).rejects.toBeDefined()
      expect(runtime.getRun(run.id)?.checkpointProposal).toEqual(first.checkpointProposal)
    }
  )

  it('rejects insufficient evidence before presenting a creatable proposal', async () => {
    const runtime = new BusinessWorkflowRuntime()
    const { run } = await setup(runtime)
    const snapshot = runtime.getRun(run.id)!
    snapshot.context.analysis = { evidenceId: 'evidence-1', analysisPlan: { qualityGate: { level: 'insufficient' } } }
    const restored = new BusinessWorkflowRuntime()
    restored.restoreRuns([JSON.parse(JSON.stringify(snapshot))])
    registerBusinessScenarioWorkflow({ runtime: restored, pluginId: 'test.business', requestBusiness: vi.fn() })
    await expect(proposeBusinessScenarioPlan(restored, { runId: run.id, sessionId: 'session-1', plan })).rejects.toMatchObject({ code: 'WORKFLOW_ANALYSIS_INSUFFICIENT' })
    expect(restored.getRun(run.id)?.checkpointProposal).toBeUndefined()
  })

  it('restores a proposal from disk and revalidates before confirmation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-plan-review-'))
    try {
      const storagePath = join(directory, 'runs.json')
      const first = await createPersistentBusinessWorkflowRuntime({ storagePath })
      const { run, stage } = await setup(first.runtime)
      const proposal = (await stage()).checkpointProposal!
      const second = await createPersistentBusinessWorkflowRuntime({ storagePath })
      const verify = vi.fn(async (path: string) => {
        if (path === '/__desktop/create-profile') throw new Error('source changed before creation')
        return { ok: true }
      })
      registerBusinessScenarioWorkflow({ runtime: second.runtime, pluginId: 'test.business', requestBusiness: verify })
      expect(second.runtime.getRun(run.id)?.checkpointProposal).toEqual(proposal)
      const failed = await approveBusinessScenarioPlan(second.runtime, run.id, { proposalId: proposal.id, sessionId: 'session-1' })
      expect(failed).toMatchObject({ status: 'failed', currentStepId: 'create-profile' })
      expect(verify.mock.calls.some(([path]) => path === '/__desktop/apply')).toBe(false)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('retains legacy confirmation and removes a cancelled proposal', async () => {
    const { runtime, run, stage } = await setup()
    await stage()
    expect((await runtime.resume(run.id, plan)).currentStepId).toBe('wait-for-preview')
    expect(runtime.getRun(run.id)?.checkpointProposal).toBeUndefined()
    const other = await setup()
    await other.stage()
    expect((await other.runtime.cancel(other.run.id)).checkpointProposal).toBeUndefined()
    await expect(other.stage()).rejects.toThrow('confirm-plan')
  })

  it('does not keep an undurable proposal when persistence fails', async () => {
    let failing = false
    const runtime = new BusinessWorkflowRuntime({ onRunChanged: () => { if (failing) throw new Error('disk unavailable') } })
    const { run, stage } = await setup(runtime)
    const first = await stage()
    failing = true
    await expect(stage({ ...plan, label: 'Not durable' })).rejects.toThrow('disk unavailable')
    expect(runtime.getRun(run.id)?.checkpointProposal).toEqual(first.checkpointProposal)
    expect(runtime.getRun(run.id)?.updatedAt).toBe(first.updatedAt)
  })

  it('rechecks current declared source values when approving and retains the proposal on mismatch', async () => {
    let currentValue = '0'
    const runtime = new BusinessWorkflowRuntime()
    const requestBusiness = vi.fn(async (path: string) => {
      if (path === '/__desktop/resolve-target') return { routePath: '/repay/receiptList', source: 'explicit-route', confidence: 'high', candidates: [] }
      if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-1', analysisPlan: {
        qualityGate: { level: 'ready' }, semanticValueChecks: { approvedSources: [{ apiUrl: '/loanNbr/loanNbr.json', scenarioId: 'normal_source', status: 'matched' }] }
      } }
      if (path === '/__desktop/validate-semantic-source' && currentValue !== '0') throw new Error('Current source is no longer normal')
      return { ok: true }
    })
    const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'test.business', requestBusiness,
      semanticRules: [{ id: 'normal-rule', intentEquals: 'normal receipt', routePath: '/repay/receiptList', apiUrl: '/loanNbr/loanNbr.json',
        sourceScenarioIds: ['normal_source'], fieldAssertions: [{ path: ['data', 'duestatus'], equals: '0' }] }] })
    const run = await start({ query: 'normal receipt', routePath: '/repay/receiptList', sessionId: 'session-1' })
    const sourcePlan = { ...plan, scenarios: [{ id: 'reviewed_normal', apiUrl: '/loanNbr/loanNbr.json', sourceScenarioId: 'normal_source' }] }
    const staged = await proposeBusinessScenarioPlan(runtime, { runId: run.id, sessionId: 'session-1', plan: sourcePlan })
    currentValue = '1'
    await expect(approveBusinessScenarioPlan(runtime, run.id, { proposalId: staged.checkpointProposal?.id, sessionId: 'session-1' })).rejects.toThrow('no longer normal')
    expect(runtime.getRun(run.id)?.checkpointProposal).toEqual(staged.checkpointProposal)
    expect(runtime.getRun(run.id)?.currentStepId).toBe('confirm-plan')
    expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/create-profile')).toBe(false)
    expect(requestBusiness.mock.calls.filter(([path]) => path === '/__desktop/validate-semantic-source')).toHaveLength(2)
  })
})
