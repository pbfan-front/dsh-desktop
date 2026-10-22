import assert from 'node:assert/strict'
import { test } from 'vitest'
import { summarizeBusinessScenarioBaseline } from '../scripts/business-scenario-baseline.mjs'

const run = (status, elapsed, gaps = []) => ({
  workflowId: 'business-scenario-create', status, createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: new Date(Date.parse('2026-10-13T00:00:00.000Z') + elapsed).toISOString(),
  context: { query: 'private intent', analysis: { analysisPlan: { qualityGate: { level: gaps.length ? 'review' : 'ready', gaps },
    fieldImpact: { status: gaps.length ? 'unproven' : 'consumed' } }, analysisTimings: { totalMs: 20, sourceReadMs: 2 } },
    requestTimings: { resolveTargetMs: 3, analyzeTargetMs: 25 } },
  steps: [{ id: 'confirm-plan', status: 'completed', startedAt: '2026-10-13T00:00:00.100Z',
    completedAt: '2026-10-13T00:00:00.200Z' }]
})

test('reports aggregate timings and evidence gaps without leaking workflow content', () => {
  const report = summarizeBusinessScenarioBaseline([
    run('completed', 1000, ['source-evidence-missing', 'matched-scenario-field-impact-unproven']),
    run('cancelled', 100000, ['source-evidence-missing']),
    { ...run('completed', 2000), workflowId: 'unrelated' }
  ])
  assert.equal(report.runCount, 2)
  assert.equal(report.statuses.completed, 1)
  assert.equal(report.evidenceGaps['source-to-api'], 2)
  assert.equal(report.evidenceGaps['field-to-ui'], 1)
  assert.deepEqual(report.timings.completedWorkflowMs, { samples: 1, p50Ms: 1000, p95Ms: 1000 })
  assert.equal(report.timings.activeWorkflowMs.samples, 1)
  assert.equal(report.timings.checkpointWaitMs.p50Ms, 100)
  assert.deepEqual(report.timings.analyzeTargetMs, { samples: 2, p50Ms: 25, p95Ms: 25 })
  assert.equal(report.timings.humanPromptEntryToWorkflowStartMs.samples, 0)
  assert.equal(report.timings.humanPromptAdmissionToWorkflowStartMs.samples, 0)
  assert.equal(report.timings.humanPromptQueueWaitMs.samples, 0)
  assert.doesNotMatch(JSON.stringify(report), /private intent/)
})

test('records only valid persisted human-prompt intervals', () => {
  const measured = run('completed', 1000)
  measured.context.humanPromptAt = Date.parse(measured.createdAt) - 900
  measured.context.humanPromptAdmittedAt = Date.parse(measured.createdAt) - 1500
  measured.context.agentTurnStartAt = measured.context.humanPromptAdmittedAt + 300
  measured.context.agentFirstStepAt = measured.context.agentTurnStartAt + 100
  measured.context.agentFirstAssistantMessageAt = measured.context.humanPromptAt + 200
  measured.context.agentFirstToolCallAt = measured.context.agentFirstAssistantMessageAt + 300
  measured.context.workflowToolCallAt = measured.context.agentFirstToolCallAt + 200
  const invalid = run('completed', 1000)
  invalid.context.humanPromptAt = Date.parse(invalid.createdAt) + 1
  const report = summarizeBusinessScenarioBaseline([measured, invalid])
  assert.deepEqual(report.timings.humanPromptEntryToWorkflowStartMs, { samples: 1, p50Ms: 900, p95Ms: 900 })
  assert.deepEqual(report.timings.humanPromptAdmissionToWorkflowStartMs, { samples: 1, p50Ms: 1500, p95Ms: 1500 })
  assert.deepEqual(report.timings.humanPromptQueueWaitMs, { samples: 1, p50Ms: 300, p95Ms: 300 })
  assert.deepEqual(report.timings.agentTurnStartToWorkflowStartMs, { samples: 1, p50Ms: 1200, p95Ms: 1200 })
  assert.deepEqual(report.timings.agentTurnStartToFirstStepMs, { samples: 1, p50Ms: 100, p95Ms: 100 })
  assert.deepEqual(report.timings.firstStepToModelVisibleMessageMs, { samples: 1, p50Ms: 200, p95Ms: 200 })
  assert.deepEqual(report.timings.modelVisibleMessageToAssistantMessageMs, { samples: 1, p50Ms: 200, p95Ms: 200 })
  assert.deepEqual(report.timings.assistantMessageToFirstToolCallMs, { samples: 1, p50Ms: 300, p95Ms: 300 })
  assert.deepEqual(report.timings.firstToolCallToWorkflowToolCallMs, { samples: 1, p50Ms: 200, p95Ms: 200 })
  assert.deepEqual(report.timings.workflowToolCallToWorkflowStartMs, { samples: 1, p50Ms: 200, p95Ms: 200 })
})

test('empty and older runs stay measurable without inventing missing phase data', () => {
  const empty = summarizeBusinessScenarioBaseline([])
  assert.equal(empty.timings.completedWorkflowMs.samples, 0)
  assert.equal(empty.timings.completedWorkflowMs.p95Ms, null)
  const older = summarizeBusinessScenarioBaseline([{ ...run('waiting_for_user', 1000), context: {}, steps: [] }])
  assert.equal(older.qualityLevels.unavailable, 1)
  assert.equal(older.timings.analyzeTargetMs.samples, 0)
  const unknown = summarizeBusinessScenarioBaseline([{ ...run('waiting_for_user', 1000, ['future-gap']),
    context: { analysis: { analysisPlan: { qualityGate: { gaps: ['future-gap'] }, fieldImpact: { status: 'pending-plan-fields' } } } } }])
  assert.equal(unknown.evidenceGaps.other, 1)
  assert.equal(unknown.fieldImpact.pending, 1)
})

test('measures only an independently observed and verified preview', () => {
  const verified = run('completed', 10000)
  const start = Date.parse(verified.createdAt)
  verified.context.profileId = 'selected-profile'
  verified.context.humanPromptAt = start - 500
  verified.context.humanPromptAdmittedAt = start - 1000
  verified.steps[0].completedAt = new Date(start + 2000).toISOString()
  verified.steps.push({ id: 'create-profile', status: 'completed', startedAt: new Date(start + 2500).toISOString(),
    completedAt: new Date(start + 3000).toISOString() })
  verified.steps.push({ id: 'wait-for-preview', status: 'completed', startedAt: new Date(start + 4000).toISOString(),
    completedAt: new Date(start + 7000).toISOString() })
  verified.steps.push({ id: 'verify-preview', status: 'completed', startedAt: new Date(start + 7500).toISOString(),
    completedAt: new Date(start + 8000).toISOString(), output: { verified: true,
      checks: { currentProfile: true, observationCurrent: true, route: true,
        containsText: [{ passed: true }], absentText: [], scenarios: [{ passed: true }] },
      pageObservation: { profileId: 'selected-profile', observedAt: new Date(start + 6000).toISOString() } } })
  const stale = structuredClone(verified)
  stale.steps.at(-1).output.pageObservation.observedAt = new Date(start + 2000).toISOString()
  const wrongProfile = structuredClone(verified)
  wrongProfile.steps.at(-1).output.pageObservation.profileId = 'other-profile'
  const unverified = structuredClone(verified)
  unverified.steps.at(-1).output.verified = false
  const noRequest = structuredClone(verified)
  noRequest.steps.at(-1).output.checks.scenarios = []
  const failedCreate = structuredClone(verified)
  failedCreate.steps.find(item => item.id === 'create-profile').status = 'failed'
  const report = summarizeBusinessScenarioBaseline([verified, stale, wrongProfile, unverified, noRequest, failedCreate])
  assert.deepEqual(report.timings.humanPromptEntryToObservedPreviewMs, { samples: 1, p50Ms: 6500, p95Ms: 6500 })
  assert.deepEqual(report.timings.humanPromptAdmissionToObservedPreviewMs, { samples: 1, p50Ms: 7000, p95Ms: 7000 })
  assert.deepEqual(report.timings.workflowStartToObservedPreviewMs, { samples: 1, p50Ms: 6000, p95Ms: 6000 })
  assert.deepEqual(report.timings.profileCreatedToObservedPreviewMs, { samples: 1, p50Ms: 3000, p95Ms: 3000 })
  assert.deepEqual(report.timings.observedPreviewToVerificationMs, { samples: 1, p50Ms: 2000, p95Ms: 2000 })
  assert.deepEqual(report.timings.humanPromptAdmissionToVerifiedPreviewMs, { samples: 1, p50Ms: 9000, p95Ms: 9000 })
  assert.deepEqual(report.timings.planConfirmationToCreationStartMs, { samples: 5, p50Ms: 500, p95Ms: 500 })
  assert.deepEqual(report.timings.previewConfirmationToVerificationStartMs, { samples: 6, p50Ms: 500, p95Ms: 500 })
})
