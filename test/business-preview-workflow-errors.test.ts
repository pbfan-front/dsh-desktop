import { describe, expect, it, vi } from 'vitest'
import { BusinessPreview } from '../src/main/business-preview'

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))

describe('business preview workflow process diagnostics', () => {
  it('keeps proposal gate messages bounded without serializing private payloads', async () => {
    const onWorkflowCommand = vi.fn().mockRejectedValue({
      code: 'WORKFLOW_ANALYSIS_INSUFFICIENT', message: 'Review source evidence first', privatePlan: 'must not echo'
    })
    const preview = new BusinessPreview({ packageRoot: '', sourceRoot: '', userRoot: '', entry: '', node: '', connectionFile: '',
      log: vi.fn(), onWorkflowCommand })
    const child = { send: vi.fn() }
    const request = { id: '00000000-0000-0000-0000-000000000001', action: 'propose-plan', payload: {} }
    const handle = (preview as unknown as { handleWorkflowRequest: (child: unknown, message: unknown) => Promise<void> })
      .handleWorkflowRequest.bind(preview)
    await handle(child, request)
    expect(child.send).toHaveBeenLastCalledWith({ type: 'workflow-response', id: request.id, ok: false,
      error: 'WORKFLOW_ANALYSIS_INSUFFICIENT: Review source evidence first' })
    onWorkflowCommand.mockRejectedValueOnce({ code: 'c'.repeat(200), message: 'm'.repeat(3000) })
    await handle(child, request)
    expect(child.send.mock.lastCall?.[0].error).toBe(`${'c'.repeat(100)}: ${'m'.repeat(2000)}`)
    onWorkflowCommand.mockRejectedValueOnce(new Error('original message'))
    await handle(child, request)
    expect(child.send.mock.lastCall?.[0].error).toBe('original message')
  })
})
