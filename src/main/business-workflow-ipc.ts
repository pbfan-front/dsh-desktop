import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BusinessWorkflowRuntime } from './business-workflow-runtime'
import type { BusinessScenarioWorkflowStartInput, BusinessWorkflowRun } from '../shared/business-workflow'

const safeRunId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

export interface BusinessWorkflowIpcOptions {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  runtime: () => BusinessWorkflowRuntime | undefined
  assertTrustedEvent: (event: IpcMainInvokeEvent) => void
  startScenario?: (input: BusinessScenarioWorkflowStartInput) => Promise<BusinessWorkflowRun>
}

export function registerBusinessWorkflowHandlers(options: BusinessWorkflowIpcOptions): void {
  registerStartScenario(options)
  register(options, 'business-workflow:list', (runtime) => ({ runs: runtime.listRuns() }))
  register(options, 'business-workflow:get', (runtime, runId) => ({
    run: runtime.getRun(parseRunId(runId)) ?? null
  }))
  register(options, 'business-workflow:resume', async (runtime, runId, checkpointOutput) => ({
    run: await runtime.resume(parseRunId(runId), checkpointOutput)
  }))
  register(options, 'business-workflow:retry', async (runtime, runId) => ({
    run: await runtime.retry(parseRunId(runId))
  }))
  register(options, 'business-workflow:cancel', async (runtime, runId) => ({
    run: await runtime.cancel(parseRunId(runId))
  }))
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
