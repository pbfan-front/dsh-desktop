import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BusinessWorkflowRuntime } from './business-workflow-runtime'
import type { BusinessScenarioWorkflowStartInput, BusinessWorkflowRun } from '../shared/business-workflow'
import { approveBusinessScenarioPlan } from './business-scenario-plan'

const safeRunId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

export interface BusinessWorkflowIpcOptions {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  runtime: () => BusinessWorkflowRuntime | undefined
  assertTrustedEvent: (event: IpcMainInvokeEvent) => void
  startScenario?: (input: BusinessScenarioWorkflowStartInput) => Promise<BusinessWorkflowRun>
}

export function registerBusinessWorkflowHandlers(options: BusinessWorkflowIpcOptions): void {
  registerStartScenario(options)
  register(options, 'business-workflow:list', (runtime, sessionId) => {
    if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200)) {
      throw new Error('Workflow sessionId is invalid.')
    }
    return { runs: runtime.listRuns().filter(run => sessionId === undefined || run.context.sessionId === sessionId) }
  })
  register(options, 'business-workflow:get', (runtime, runId) => ({
    run: runtime.getRun(parseRunId(runId)) ?? null
  }))
  register(options, 'business-workflow:approve-proposal', async (runtime, runId, selection) => {
    try { return { run: await approveBusinessScenarioPlan(runtime, parseRunId(runId), selection) } }
    catch (error) { throw workflowIpcError(error) }
  })
  register(options, 'business-workflow:resume', async (runtime, runId, checkpointOutput) => {
    try {
      return { run: await runtime.resume(parseRunId(runId), checkpointOutput) }
    } catch (error) {
      // Electron preserves Error.message, not a plain workflow-gate object's
      // custom fields. Keep bounded diagnostics without returning a fake run.
      throw workflowIpcError(error)
    }
  })
  register(options, 'business-workflow:retry', async (runtime, runId, retryInput) => ({
    run: await runtime.retry(parseRunId(runId), retryInput)
  }))
  register(options, 'business-workflow:cancel', async (runtime, runId) => ({
    run: await runtime.cancel(parseRunId(runId))
  }))
}

function workflowIpcError(error: unknown): unknown {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && !(error instanceof Error)) {
    const code = 'code' in error && typeof error.code === 'string' ? `${error.code.slice(0, 100)}: ` : ''
    return new Error(`${code}${error.message.slice(0, 2000)}`)
  }
  return error
}

function registerStartScenario(options: BusinessWorkflowIpcOptions): void {
  const channel = 'business-workflow:start-scenario'
  options.ipcMain.removeHandler(channel)
  options.ipcMain.handle(channel, (event, input: unknown) => {
    options.assertTrustedEvent(event)
    if (!options.startScenario) throw new Error('Business scenario workflow is not available.')
    return options.startScenario(input as BusinessScenarioWorkflowStartInput).then((run) => ({ run }))
  })
}

function register(
  options: BusinessWorkflowIpcOptions,
  channel: string,
  handler: (runtime: BusinessWorkflowRuntime, ...args: unknown[]) => unknown
): void {
  options.ipcMain.removeHandler(channel)
  options.ipcMain.handle(channel, (event, ...args) => {
    options.assertTrustedEvent(event)
    const runtime = options.runtime()
    if (!runtime) throw new Error('Business workflow runtime is not available.')
    return handler(runtime, ...args)
  })
}

function parseRunId(value: unknown): string {
  if (typeof value !== 'string' || !safeRunId.test(value)) {
    throw new Error('Workflow runId is missing or unsafe.')
  }
  return value
}
