const WORKFLOW_ID = 'business-scenario-create'
const STATUSES = ['pending', 'running', 'waiting_for_user', 'completed', 'failed', 'cancelled']
const STEP_IDS = ['analyze-target', 'confirm-plan', 'create-profile', 'apply-profile', 'wait-for-preview', 'verify-preview']
const GAP_CATEGORIES = {
  'business-intent-empty': 'target-intent',
  'focus-api-missing': 'api-discovery',
  'focus-api-not-generatable': 'mock-readiness',
  'source-evidence-missing': 'source-to-api',
  'intent-match-not-confident': 'scenario-semantics',
  'existing-scenario-match-ambiguous': 'scenario-semantics',
  'matched-scenario-field-impact-unproven': 'field-to-ui'
}

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const betweenMs = (start, end) => Number.isSafeInteger(start) && Number.isSafeInteger(end)
  ? duration(end - start) : undefined
const between = (start, end) => {
  if (typeof start !== 'string' || typeof end !== 'string') return undefined
  const value = Date.parse(end) - Date.parse(start)
  return duration(value)
}
const step = (run, id) => Array.isArray(run.steps) ? run.steps.find(item => item?.id === id) : undefined
const stepMs = (run, id) => {
  const item = step(run, id)
  return item?.status === 'completed' ? between(item.startedAt, item.completedAt) : undefined
}
const stepGapMs = (run, completedId, startedId) => {
  const before = step(run, completedId)
  const after = step(run, startedId)
  return before?.status === 'completed' && after?.status === 'completed'
    ? between(before.completedAt, after.startedAt) : undefined
}
const verifiedPreviewTimes = run => {
  if (run.status !== 'completed') return undefined
  const verify = step(run, 'verify-preview')
  const created = step(run, 'create-profile')
  const output = record(verify?.output)
  const checks = record(output.checks)
  const observation = record(output.pageObservation)
  const allPassed = values => Array.isArray(values) && values.every(item => record(item).passed === true)
  const profileCreatedAt = Date.parse(created?.completedAt || '')
  const observedAt = Date.parse(observation.observedAt || '')
  const verifiedAt = Date.parse(verify?.completedAt || '')
  if (created?.status !== 'completed' || verify?.status !== 'completed' || output.verified !== true
    || checks.currentProfile !== true || checks.observationCurrent !== true || checks.route !== true
    || !allPassed(checks.containsText) || !allPassed(checks.absentText)
    || !allPassed(checks.scenarios) || checks.scenarios.length === 0
    || !run.context?.profileId || observation.profileId !== run.context.profileId
    || duration(profileCreatedAt - Date.parse(run.createdAt)) === undefined
    || duration(observedAt - profileCreatedAt) === undefined
    || duration(verifiedAt - observedAt) === undefined
    || duration(Date.parse(run.updatedAt) - verifiedAt) === undefined) return undefined
  return { profileCreatedAt, observedAt, verifiedAt }
}
const metric = values => {
  const sorted = values.filter(value => duration(value) !== undefined).sort((a, b) => a - b)
  if (!sorted.length) return { samples: 0, p50Ms: null, p95Ms: null }
  const rounded = value => Math.round(value * 100) / 100
  return { samples: sorted.length, p50Ms: rounded(sorted[Math.ceil(sorted.length * 0.5) - 1]),
    p95Ms: rounded(sorted[Math.ceil(sorted.length * 0.95) - 1]) }
}

// No route, query, profile, API URL, payload, run ID, or source text is emitted.
export function summarizeBusinessScenarioBaseline(runs) {
  if (!Array.isArray(runs)) throw new Error('Workflow runs must be an array')
  const selected = runs.filter(run => run?.workflowId === WORKFLOW_ID)
  const statuses = Object.fromEntries(STATUSES.map(status => [status, 0]))
  const qualityLevels = { ready: 0, review: 0, insufficient: 0, unavailable: 0 }
  const evidenceGaps = { ...Object.fromEntries([...new Set(Object.values(GAP_CATEGORIES))].map(gap => [gap, 0])), other: 0 }
  const fieldImpact = { consumed: 0, partial: 0, unproven: 0, pending: 0, unavailable: 0 }
  const stepErrorsById = { ...Object.fromEntries(STEP_IDS.map(id => [id, 0])), other: 0 }
  const measures = { completedWorkflowMs: [], activeWorkflowMs: [], checkpointWaitMs: [],
    humanPromptEntryToWorkflowStartMs: [], humanPromptAdmissionToWorkflowStartMs: [], humanPromptQueueWaitMs: [],
    humanPromptEntryToObservedPreviewMs: [], humanPromptAdmissionToObservedPreviewMs: [],
    workflowStartToObservedPreviewMs: [], profileCreatedToObservedPreviewMs: [],
    observedPreviewToVerificationMs: [], humanPromptAdmissionToVerifiedPreviewMs: [],
    agentTurnStartToWorkflowStartMs: [], agentTurnStartToFirstStepMs: [], firstStepToModelVisibleMessageMs: [],
    modelVisibleMessageToAssistantMessageMs: [], assistantMessageToFirstToolCallMs: [],
    firstToolCallToWorkflowToolCallMs: [], workflowToolCallToWorkflowStartMs: [],
    toConfirmPlanMs: [], resolveTargetMs: [], analyzeTargetMs: [],
    runtimeAnalysisMs: [], sourceReadMs: [], fieldAnalysisMs: [], createProfileMs: [], verifyPreviewMs: [],
    planWaitMs: [], previewWaitMs: [], planConfirmationToCreationStartMs: [],
    previewConfirmationToVerificationStartMs: [] }
  let analyzed = 0
  for (const run of selected) {
    if (Object.hasOwn(statuses, run.status)) statuses[run.status] += 1
    const context = record(run.context)
    const analysis = record(context.analysis)
    const plan = record(analysis.analysisPlan)
    const gate = record(plan.qualityGate)
    const impact = record(plan.fieldImpact)
    const requestTimings = record(context.requestTimings)
    const entryDelay = Number.isSafeInteger(context.humanPromptAt)
      ? Date.parse(run.createdAt) - context.humanPromptAt : undefined
    const admissionDelay = Number.isSafeInteger(context.humanPromptAdmittedAt)
      && entryDelay !== undefined && context.humanPromptAdmittedAt <= context.humanPromptAt
      ? Date.parse(run.createdAt) - context.humanPromptAdmittedAt : undefined
    const measuredEntry = duration(entryDelay)
    const measuredAdmission = duration(admissionDelay)
    const turnStartAt = betweenMs(context.agentTurnStartAt, context.humanPromptAt) !== undefined
      && (context.humanPromptAdmittedAt === undefined
        || betweenMs(context.humanPromptAdmittedAt, context.agentTurnStartAt) !== undefined)
      ? context.agentTurnStartAt : undefined
    const firstStepAt = betweenMs(turnStartAt, context.agentFirstStepAt) !== undefined
      && betweenMs(context.agentFirstStepAt, context.humanPromptAt) !== undefined
      ? context.agentFirstStepAt : undefined
    measures.humanPromptEntryToWorkflowStartMs.push(measuredEntry)
    measures.humanPromptAdmissionToWorkflowStartMs.push(measuredAdmission)
    const previewTimes = verifiedPreviewTimes(run)
    if (previewTimes) {
      measures.humanPromptEntryToObservedPreviewMs.push(measuredEntry === undefined ? undefined
        : betweenMs(context.humanPromptAt, previewTimes.observedAt))
      measures.humanPromptAdmissionToObservedPreviewMs.push(measuredAdmission === undefined ? undefined
        : betweenMs(context.humanPromptAdmittedAt, previewTimes.observedAt))
      measures.workflowStartToObservedPreviewMs.push(betweenMs(Date.parse(run.createdAt), previewTimes.observedAt))
      measures.profileCreatedToObservedPreviewMs.push(betweenMs(previewTimes.profileCreatedAt, previewTimes.observedAt))
      measures.observedPreviewToVerificationMs.push(betweenMs(previewTimes.observedAt, previewTimes.verifiedAt))
      measures.humanPromptAdmissionToVerifiedPreviewMs.push(measuredAdmission === undefined ? undefined
        : betweenMs(context.humanPromptAdmittedAt, previewTimes.verifiedAt))
    }
    measures.humanPromptQueueWaitMs.push(betweenMs(context.humanPromptAdmittedAt, turnStartAt))
    measures.agentTurnStartToWorkflowStartMs.push(betweenMs(turnStartAt, Date.parse(run.createdAt)))
    measures.agentTurnStartToFirstStepMs.push(betweenMs(turnStartAt, firstStepAt))
    measures.firstStepToModelVisibleMessageMs.push(betweenMs(firstStepAt, context.humanPromptAt))
    measures.modelVisibleMessageToAssistantMessageMs.push(betweenMs(context.humanPromptAt, context.agentFirstAssistantMessageAt))
    measures.assistantMessageToFirstToolCallMs.push(betweenMs(context.agentFirstAssistantMessageAt, context.agentFirstToolCallAt))
    measures.firstToolCallToWorkflowToolCallMs.push(betweenMs(context.agentFirstToolCallAt, context.workflowToolCallAt))
    measures.workflowToolCallToWorkflowStartMs.push(betweenMs(context.workflowToolCallAt, Date.parse(run.createdAt)))
    const analysisTimings = record(analysis.analysisTimings)
    if (Object.keys(analysis).length) analyzed += 1
    const level = Object.hasOwn(qualityLevels, gate.level) ? gate.level : 'unavailable'
    qualityLevels[level] += 1
    const impactStatus = impact.status === 'pending-plan-fields' ? 'pending'
      : Object.hasOwn(fieldImpact, impact.status) ? impact.status : 'unavailable'
    fieldImpact[impactStatus] += 1
    for (const category of new Set((Array.isArray(gate.gaps) ? gate.gaps : [])
      .map(gap => GAP_CATEGORIES[gap] || 'other'))) evidenceGaps[category] += 1
    const failedStep = Array.isArray(run.steps) ? run.steps.find(item => item?.status === 'failed') : undefined
    if (failedStep) stepErrorsById[Object.hasOwn(stepErrorsById, failedStep.id) ? failedStep.id : 'other'] += 1
    if (run.status === 'completed') {
      measures.completedWorkflowMs.push(between(run.createdAt, run.updatedAt))
      measures.activeWorkflowMs.push(['analyze-target', 'create-profile', 'apply-profile', 'verify-preview']
        .reduce((total, id) => total + (stepMs(run, id) ?? 0), 0))
      measures.checkpointWaitMs.push((stepMs(run, 'confirm-plan') ?? 0) + (stepMs(run, 'wait-for-preview') ?? 0))
      measures.planConfirmationToCreationStartMs.push(stepGapMs(run, 'confirm-plan', 'create-profile'))
      measures.previewConfirmationToVerificationStartMs.push(stepGapMs(run, 'wait-for-preview', 'verify-preview'))
    }
    measures.toConfirmPlanMs.push(between(run.createdAt, step(run, 'confirm-plan')?.startedAt))
    measures.resolveTargetMs.push(requestTimings.resolveTargetMs)
    measures.analyzeTargetMs.push(requestTimings.analyzeTargetMs)
    measures.runtimeAnalysisMs.push(analysisTimings.totalMs)
    measures.sourceReadMs.push(analysisTimings.sourceReadMs)
    measures.fieldAnalysisMs.push(analysisTimings.scenarioFieldAnalysisMs)
    measures.createProfileMs.push(stepMs(run, 'create-profile'))
    measures.verifyPreviewMs.push(stepMs(run, 'verify-preview'))
    measures.planWaitMs.push(stepMs(run, 'confirm-plan'))
    measures.previewWaitMs.push(stepMs(run, 'wait-for-preview'))
  }
  return {
    schemaVersion: 1, workflowId: WORKFLOW_ID, runCount: selected.length, analyzedCount: analyzed,
    statuses, qualityLevels, evidenceGaps, fieldImpact, stepErrorsById,
    timings: Object.fromEntries(Object.entries(measures).map(([name, values]) => [name, metric(values)])),
    limitations: [
      'prompt and Agent-step timings require same-turn direct-user events captured after instrumentation; assistant/message is model response completion, not first token, and intervals do not isolate model compute from network time',
      'completedWorkflowMs excludes cancelled, failed and waiting runs',
      'observed-preview timings require a completed verified preview with a current page observation; observation is not the first visible pixel and includes human confirmation and branch-selection waits',
      'confirmation-to-next-step gaps are wall-clock intervals outside both step durations; they are not attributed to Agent reasoning without independent evidence',
      'quality gaps are preflight evidence, not proof of final UI correctness',
      'stepErrorsById includes errors in subsequently cancelled or retried runs',
      'historical runs are not a curated regression corpus'
    ]
  }
}
