import type { BusinessWorkflowRuntime } from './business-workflow-runtime'
import type { BusinessWorkflowRun } from '../shared/business-workflow'

function assertScenarioSession(runtime: BusinessWorkflowRuntime, runId: string, sessionId: unknown): BusinessWorkflowRun {
  const run = runtime.getRun(runId)
  if (!run || run.workflowId !== 'business-scenario-create' || run.status !== 'waiting_for_user' || run.currentStepId !== 'confirm-plan') {
    throw new Error('Scenario plan review is only available at confirm-plan.')
  }
  if (typeof sessionId !== 'string' || sessionId.length > 128 || sessionId !== (run.context.sessionId || 'default')) {
    throw new Error('Switch to the proposal’s conversation before reviewing this plan.')
  }
  return run
}

/** Stage only. No approval route is exposed to the Agent/HTTP control bridge. */
export async function proposeBusinessScenarioPlan(runtime: BusinessWorkflowRuntime, input: Record<string, unknown>): Promise<BusinessWorkflowRun> {
  if (typeof input.runId !== 'string') throw new Error('Workflow runId is required.')
  assertScenarioSession(runtime, input.runId, input.sessionId)
  return runtime.proposeCheckpoint(input.runId, input.plan)
}

/** The trusted UI sends an exact proposal identity, never a replacement plan. */
export async function approveBusinessScenarioPlan(runtime: BusinessWorkflowRuntime, runId: string, input: unknown): Promise<BusinessWorkflowRun> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Proposal confirmation is missing.')
  const selection = input as Record<string, unknown>
  if (Object.keys(selection).some(key => !['proposalId', 'sessionId'].includes(key))
    || typeof selection.proposalId !== 'string' || !/^[0-9a-f-]{36}$/.test(selection.proposalId)) {
    throw new Error('Confirm only the displayed proposalId and conversation; plan overrides are not accepted.')
  }
  assertScenarioSession(runtime, runId, selection.sessionId)
  return runtime.approveCheckpointProposal(runId, selection.proposalId)
}
