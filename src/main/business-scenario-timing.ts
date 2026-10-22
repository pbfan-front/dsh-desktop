import type { BusinessWorkflowRun, BusinessWorkflowStepRun } from '../shared/business-workflow'
import { BUSINESS_SCENARIO_WORKFLOW_ID } from './business-scenario-workflow'

export interface BusinessScenarioTimingSummary {
  status: BusinessWorkflowRun['status']
  humanPromptEntryToWorkflowStartMs?: number
  humanPromptAdmissionToWorkflowStartMs?: number
  humanPromptEntryToObservedPreviewMs?: number
  humanPromptAdmissionToObservedPreviewMs?: number
  workflowStartToObservedPreviewMs?: number
  profileCreatedToObservedPreviewMs?: number
  observedPreviewToVerificationMs?: number
  humanPromptAdmissionToVerifiedPreviewMs?: number
  humanPromptQueueWaitMs?: number
  agentTurnStartToWorkflowStartMs?: number
  agentTurnStartToFirstStepMs?: number
  firstStepToModelVisibleMessageMs?: number
  modelVisibleMessageToAssistantMessageMs?: number
  assistantMessageToFirstToolCallMs?: number
  firstToolCallToWorkflowToolCallMs?: number
  workflowToolCallToWorkflowStartMs?: number
  elapsedMs: number
  activeMs: number
  checkpointWaitMs: number
  phases: {
    resolveTargetMs?: number
    analyzeTargetMs?: number
    confirmPlanWaitMs?: number
    planConfirmationToCreationStartMs?: number
    createProfileMs?: number
    applyProfileMs?: number
    previewWaitMs?: number
    previewConfirmationToVerificationStartMs?: number
    verifyPreviewMs?: number
  }
}

// Uses persisted wall-clock step boundaries so a restored run remains measurable.
// Checkpoint time is user/page wait, not analysis or Desktop execution time.
export function summarizeBusinessScenarioTiming(run: BusinessWorkflowRun): BusinessScenarioTimingSummary | undefined {
  if (run.workflowId !== BUSINESS_SCENARIO_WORKFLOW_ID) return undefined
  const steps = new Map(run.steps.map((step) => [step.id, step]))
  const timings = isRecord(run.context.requestTimings) ? run.context.requestTimings : {}
  const duration = (id: string): number | undefined => stepDuration(steps.get(id))
  const betweenSteps = (completedId: string, startedId: string): number | undefined => {
    const before = steps.get(completedId)
    const after = steps.get(startedId)
    const completedAt = Date.parse(before?.completedAt || '')
    const startedAt = Date.parse(after?.startedAt || '')
    return run.status === 'completed' && before?.status === 'completed' && after?.status === 'completed'
      ? finiteDuration(startedAt - completedAt) : undefined
  }
  const phases = {
    resolveTargetMs: finiteDuration(timings.resolveTargetMs),
    analyzeTargetMs: finiteDuration(timings.analyzeTargetMs),
    confirmPlanWaitMs: duration('confirm-plan'),
    planConfirmationToCreationStartMs: betweenSteps('confirm-plan', 'create-profile'),
    createProfileMs: duration('create-profile'),
    applyProfileMs: duration('apply-profile'),
    previewWaitMs: duration('wait-for-preview'),
    previewConfirmationToVerificationStartMs: betweenSteps('wait-for-preview', 'verify-preview'),
    verifyPreviewMs: duration('verify-preview')
  }
  const checkpointWaitMs = (phases.confirmPlanWaitMs ?? 0) + (phases.previewWaitMs ?? 0)
  const activeMs = ['analyze-target', 'create-profile', 'apply-profile', 'verify-preview']
    .reduce((total, id) => total + (duration(id) ?? 0), 0)
  const elapsedMs = Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.createdAt))
  const promptAt = run.context.humanPromptAt
  const admittedAt = run.context.humanPromptAdmittedAt
  const turnStartAt = run.context.agentTurnStartAt
  const entryDelay = typeof promptAt === 'number' && Number.isSafeInteger(promptAt)
    ? Date.parse(run.createdAt) - promptAt : undefined
  const admissionDelay = typeof admittedAt === 'number' && Number.isSafeInteger(admittedAt)
    && typeof promptAt === 'number' && entryDelay !== undefined && admittedAt <= promptAt
    ? Date.parse(run.createdAt) - admittedAt : undefined
  const humanPromptEntryToWorkflowStartMs = finiteDuration(entryDelay)
  const humanPromptAdmissionToWorkflowStartMs = finiteDuration(admissionDelay)
  const after = (start: unknown, end: unknown): number | undefined => typeof start === 'number'
    && typeof end === 'number' && Number.isSafeInteger(start) && Number.isSafeInteger(end)
    ? finiteDuration(end - start) : undefined
  const validTurnStartAt = after(turnStartAt, promptAt) !== undefined
    && (admittedAt === undefined || after(admittedAt, turnStartAt) !== undefined) ? turnStartAt : undefined
  const validFirstStepAt = after(validTurnStartAt, run.context.agentFirstStepAt) !== undefined
    && after(run.context.agentFirstStepAt, promptAt) !== undefined ? run.context.agentFirstStepAt : undefined
  const humanPromptQueueWaitMs = after(admittedAt, validTurnStartAt)
  const previewTimes = verifiedPreviewTimes(run, steps)
  const humanPromptEntryToObservedPreviewMs = previewTimes && humanPromptEntryToWorkflowStartMs !== undefined
    ? after(promptAt, previewTimes.observedAt) : undefined
  const humanPromptAdmissionToObservedPreviewMs = previewTimes && humanPromptAdmissionToWorkflowStartMs !== undefined
    ? after(admittedAt, previewTimes.observedAt) : undefined
  const workflowStartToObservedPreviewMs = previewTimes ? after(Date.parse(run.createdAt), previewTimes.observedAt) : undefined
  const profileCreatedToObservedPreviewMs = previewTimes ? after(previewTimes.profileCreatedAt, previewTimes.observedAt) : undefined
  const observedPreviewToVerificationMs = previewTimes ? after(previewTimes.observedAt, previewTimes.verifiedAt) : undefined
  const humanPromptAdmissionToVerifiedPreviewMs = previewTimes && humanPromptAdmissionToWorkflowStartMs !== undefined
    ? after(admittedAt, previewTimes.verifiedAt) : undefined
  const agentTurnStartToWorkflowStartMs = after(validTurnStartAt, Date.parse(run.createdAt))
  const agentTurnStartToFirstStepMs = after(validTurnStartAt, validFirstStepAt)
  const firstStepToModelVisibleMessageMs = after(validFirstStepAt, promptAt)
  const modelVisibleMessageToAssistantMessageMs = after(promptAt, run.context.agentFirstAssistantMessageAt)
  const assistantMessageToFirstToolCallMs = after(run.context.agentFirstAssistantMessageAt, run.context.agentFirstToolCallAt)
  const firstToolCallToWorkflowToolCallMs = after(run.context.agentFirstToolCallAt, run.context.workflowToolCallAt)
  const workflowToolCallToWorkflowStartMs = after(run.context.workflowToolCallAt, Date.parse(run.createdAt))
  return { status: run.status,
    ...(humanPromptEntryToWorkflowStartMs !== undefined ? { humanPromptEntryToWorkflowStartMs } : {}),
    ...(humanPromptAdmissionToWorkflowStartMs !== undefined ? { humanPromptAdmissionToWorkflowStartMs } : {}),
    ...(humanPromptEntryToObservedPreviewMs !== undefined ? { humanPromptEntryToObservedPreviewMs } : {}),
    ...(humanPromptAdmissionToObservedPreviewMs !== undefined ? { humanPromptAdmissionToObservedPreviewMs } : {}),
    ...(workflowStartToObservedPreviewMs !== undefined ? { workflowStartToObservedPreviewMs } : {}),
    ...(profileCreatedToObservedPreviewMs !== undefined ? { profileCreatedToObservedPreviewMs } : {}),
    ...(observedPreviewToVerificationMs !== undefined ? { observedPreviewToVerificationMs } : {}),
    ...(humanPromptAdmissionToVerifiedPreviewMs !== undefined ? { humanPromptAdmissionToVerifiedPreviewMs } : {}),
    ...(humanPromptQueueWaitMs !== undefined ? { humanPromptQueueWaitMs } : {}),
    ...(agentTurnStartToWorkflowStartMs !== undefined ? { agentTurnStartToWorkflowStartMs } : {}),
    ...(agentTurnStartToFirstStepMs !== undefined ? { agentTurnStartToFirstStepMs } : {}),
    ...(firstStepToModelVisibleMessageMs !== undefined ? { firstStepToModelVisibleMessageMs } : {}),
    ...(modelVisibleMessageToAssistantMessageMs !== undefined ? { modelVisibleMessageToAssistantMessageMs } : {}),
    ...(assistantMessageToFirstToolCallMs !== undefined ? { assistantMessageToFirstToolCallMs } : {}),
    ...(firstToolCallToWorkflowToolCallMs !== undefined ? { firstToolCallToWorkflowToolCallMs } : {}),
    ...(workflowToolCallToWorkflowStartMs !== undefined ? { workflowToolCallToWorkflowStartMs } : {}),
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0, activeMs, checkpointWaitMs, phases }
}

function verifiedPreviewTimes(run: BusinessWorkflowRun, steps: Map<string, BusinessWorkflowStepRun>):
  { profileCreatedAt: number; observedAt: number; verifiedAt: number } | undefined {
  if (run.status !== 'completed') return undefined
  const verify = steps.get('verify-preview')
  const created = steps.get('create-profile')
  const output = verify && isRecord(verify.output) ? verify.output : undefined
  const checks = output && isRecord(output.checks) ? output.checks : undefined
  const observation = output && isRecord(output.pageObservation) ? output.pageObservation : undefined
  const allPassed = (value: unknown): value is Array<Record<string, unknown>> =>
    Array.isArray(value) && value.every(item => isRecord(item) && item.passed === true)
  const profileId = run.context.profileId
  const profileCreatedAt = Date.parse(created?.completedAt || '')
  const observedAt = Date.parse(typeof observation?.observedAt === 'string' ? observation.observedAt : '')
  const verifiedAt = Date.parse(verify?.completedAt || '')
  if (created?.status !== 'completed' || verify?.status !== 'completed' || output?.verified !== true
    || checks?.currentProfile !== true || checks.observationCurrent !== true || checks.route !== true
    || !allPassed(checks.containsText) || !allPassed(checks.absentText)
    || !allPassed(checks.scenarios) || checks.scenarios.length === 0
    || typeof profileId !== 'string' || !profileId || observation?.profileId !== profileId
    || finiteDuration(profileCreatedAt - Date.parse(run.createdAt)) === undefined
    || finiteDuration(observedAt - profileCreatedAt) === undefined
    || finiteDuration(verifiedAt - observedAt) === undefined
    || finiteDuration(Date.parse(run.updatedAt) - verifiedAt) === undefined) return undefined
  return { profileCreatedAt, observedAt, verifiedAt }
}

function stepDuration(step: BusinessWorkflowStepRun | undefined): number | undefined {
  if (!step?.startedAt || !step.completedAt) return undefined
  const duration = Date.parse(step.completedAt) - Date.parse(step.startedAt)
  return finiteDuration(duration)
}

function finiteDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
