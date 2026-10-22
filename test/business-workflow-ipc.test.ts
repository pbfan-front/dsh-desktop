import { describe, expect, it, vi } from 'vitest'
import { registerBusinessWorkflowHandlers } from '../src/main/business-workflow-ipc'
import { BusinessWorkflowRuntime } from '../src/main/business-workflow-runtime'
import type { BusinessWorkflowDefinition } from '../src/shared/business-workflow'

const definition: BusinessWorkflowDefinition = {
  id: 'scenario-create',
  version: '1.0.0',
  title: '创建场景',
  steps: [
    { id: 'inspect', type: 'deterministic', title: '分析页面' },
    { id: 'confirm', type: 'checkpoint', title: '确认方案' },
    { id: 'apply', type: 'deterministic', title: '写入场景' }
  ]
}

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    removeHandler: (channel: string) => handlers.delete(channel),
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  }
  const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'run-1' })
  runtime.registerWorkflow(definition, {
    inspect: () => ({ contextPatch: { route: '/credit/productCombine' } }),
    apply: ({ previousOutput }) => ({ output: previousOutput })
  })
  const assertTrustedEvent = vi.fn()
  registerBusinessWorkflowHandlers({
    ipcMain: ipcMain as never,
    runtime: () => runtime,
    assertTrustedEvent
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({ trusted: true }, ...args)
  return { runtime, assertTrustedEvent, invoke }
}

describe('business workflow IPC', () => {
  it('lists and reads runs while checking the sender', async () => {
    const { runtime, assertTrustedEvent, invoke } = setup()
    const paused = await runtime.start({ workflowId: definition.id, pluginId: 'demo.business' })

    expect(invoke('business-workflow:list')).toMatchObject({ runs: [{ id: paused.id }] })
    expect(invoke('business-workflow:get', paused.id)).toMatchObject({ run: { id: paused.id } })
    expect(assertTrustedEvent).toHaveBeenCalledTimes(2)
  })

  it('resumes and cancels only known, valid run identifiers', async () => {
    const { runtime, invoke } = setup()
    const first = await runtime.start({ workflowId: definition.id, pluginId: 'demo.business' })
    await expect(invoke('business-workflow:resume', first.id, { approved: true })).resolves.toMatchObject({
      run: { status: 'completed' }
    })

    const second = await runtime.start({ workflowId: definition.id, pluginId: 'demo.business' })
    await expect(invoke('business-workflow:cancel', second.id)).resolves.toMatchObject({
      run: { status: 'cancelled' }
    })
    expect(() => invoke('business-workflow:get', '../unsafe')).toThrow('runId is missing or unsafe')
  })

  it('rejects all operations when the sender is not trusted', () => {
    const { invoke, assertTrustedEvent } = setup()
    assertTrustedEvent.mockImplementation(() => {
      throw new Error('untrusted sender')
    })
    expect(() => invoke('business-workflow:list')).toThrow('untrusted sender')
    expect(() => invoke('business-workflow:approve-proposal', 'run-1', {
      proposalId: '00000000-0000-0000-0000-000000000000', sessionId: 'session-1'
    })).toThrow('untrusted sender')
  })

  it('preserves bounded plain workflow-gate errors across Electron resume IPC', async () => {
    const { runtime, invoke } = setup()
    const resume = vi.spyOn(runtime, 'resume').mockRejectedValue({
      code: 'WORKFLOW_GATE_FAILED', message: 'Preview revision changed', retryable: true
    })
    await expect(invoke('business-workflow:resume', 'run-1', { stepId: 'detail' })).rejects.toThrow(
      'WORKFLOW_GATE_FAILED: Preview revision changed'
    )
    resume.mockRejectedValueOnce({ code: 'x'.repeat(200), message: 'm'.repeat(3000) })
    await expect(invoke('business-workflow:resume', 'run-1')).rejects.toMatchObject({
      message: `${'x'.repeat(100)}: ${'m'.repeat(2000)}`
    })
    const original = new Error('original failure')
    resume.mockRejectedValueOnce(original)
    await expect(invoke('business-workflow:resume', 'run-1')).rejects.toBe(original)
  })

  it('forwards an explicit route selection to the retry validator for the same run', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'ambiguous-run' })
    const validateRetry = vi.fn(({ retryInput }) => {
      if (JSON.stringify(retryInput) !== JSON.stringify({ selectedRoutePath: '/repay/receiptList', confirmedByUser: true })) {
        throw new Error('Explicit route choice required')
      }
      return { contextPatch: { routePath: '/repay/receiptList' } }
    })
    let attempts = 0
    runtime.registerWorkflow({ id: 'route-choice', version: '1', title: 'Route choice', steps: [
      { id: 'analyze-target', type: 'deterministic', title: 'Analyze target' },
      { id: 'confirm-plan', type: 'checkpoint', title: 'Confirm plan' }
    ] }, {
      'analyze-target': () => {
        if (attempts++ === 0) throw Object.assign(new Error('Choose route'), {
          code: 'E_TARGET_ROUTE_AMBIGUOUS', retryable: true,
          candidates: [{ routePath: '/repay/receiptList' }]
        })
        return { output: { routePath: '/repay/receiptList' } }
      }
    }, {}, { retryValidators: { 'analyze-target': validateRetry } })
    registerBusinessWorkflowHandlers({
      ipcMain: {
        removeHandler: (channel: string) => handlers.delete(channel),
        handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) }
      } as never,
      runtime: () => runtime,
      assertTrustedEvent: vi.fn()
    })
    const started = await runtime.start({ workflowId: 'route-choice', pluginId: 'demo.business' })
    expect(started.status).toBe('failed')
    const invoke = (input?: unknown) => handlers.get('business-workflow:retry')?.({ trusted: true }, started.id, input)
    await expect(invoke()).rejects.toThrow('Explicit route choice required')
    await expect(invoke({ selectedRoutePath: '/repay/receiptList', confirmedByUser: true })).resolves.toMatchObject({
      run: { id: started.id, status: 'waiting_for_user', context: { routePath: '/repay/receiptList' } }
    })
    expect(validateRetry).toHaveBeenCalledTimes(2)
  })
})
