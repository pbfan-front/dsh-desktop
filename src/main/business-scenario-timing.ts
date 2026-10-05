import type { BusinessWorkflowRun, BusinessWorkflowStepRun } from '../shared/business-workflow'
import { BUSINESS_SCENARIO_WORKFLOW_ID } from './business-scenario-workflow'

export interface BusinessScenarioTimingSummary {
  status: BusinessWorkflowRun['status']
  elapsedMs: number
  activeMs: number
  checkpointWaitMs: number
  phases: {
    resolveTargetMs?: number
    analyzeTargetMs?: number
    confirmPlanWaitMs?: number
    createProfileMs?: number
    applyProfileMs?: number
    previewWaitMs?: number
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
  const phases = {
    resolveTargetMs: finiteDuration(timings.resolveTargetMs),
    analyzeTargetMs: finiteDuration(timings.analyzeTargetMs),
    confirmPlanWaitMs: duration('confirm-plan'),
    createProfileMs: duration('create-profile'),
    applyProfileMs: duration('apply-profile'),
    previewWaitMs: duration('wait-for-preview'),
    verifyPreviewMs: duration('verify-preview')
  }
  const checkpointWaitMs = (phases.confirmPlanWaitMs ?? 0) + (phases.previewWaitMs ?? 0)
  const activeMs = ['analyze-target', 'create-profile', 'apply-profile', 'verify-preview']
    .reduce((total, id) => total + (duration(id) ?? 0), 0)
  const elapsedMs = Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.createdAt))
  return { status: run.status, elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0, activeMs, checkpointWaitMs, phases }
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
