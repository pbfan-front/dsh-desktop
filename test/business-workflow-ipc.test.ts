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
  })
})
