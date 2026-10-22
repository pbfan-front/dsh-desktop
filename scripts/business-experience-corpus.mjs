import { evaluateBusinessExperience } from './business-experience-evaluation.mjs'
import { assertBranchIsolationCase, evaluateBranchIsolation } from './business-branch-isolation-evaluation.mjs'

const TARGETS = ['explicit-route', 'intent-page', 'preview-fallback']
const BEHAVIORS = ['existing-reuse', 'new-profile', 'default-branch', 'branch-switch', 'failure-or-ambiguity']

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function counts(values) {
  return Object.fromEntries(values.map(value => [value, 0]))
}

function assertCase(value, ids) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !nonEmpty(value.id) || ids.has(value.id)) {
    throw new Error('Each business experience case needs a unique non-empty ID')
  }
  ids.add(value.id)
  if (!nonEmpty(value.intent)) throw new Error(`Case ${value.id} needs an intent`)
  if (value.expectedFailure) {
    if (!nonEmpty(value.expectedFailure.stepId) || !nonEmpty(value.expectedFailure.code)) {
      throw new Error(`Case ${value.id} needs an exact failure step and code`)
    }
  } else {
    if (!value.routePath?.startsWith('/') || !value.apiUrl?.startsWith('/')) {
      throw new Error(`Case ${value.id} needs a route and API URL`)
    }
    if (!Array.isArray(value.mockFields) || !Array.isArray(value.visibleText) || !Array.isArray(value.absentText)
      || !value.mockFields.length || !value.visibleText.length
      || value.mockFields.some(field => !Array.isArray(field?.path) || !field.path.length || !Object.hasOwn(field, 'equals'))
      || [...value.visibleText, ...value.absentText].some(item => !nonEmpty(item))) {
      throw new Error(`Case ${value.id} needs concrete Mock and UI assertions`)
    }
    if (value.requestPath !== undefined && (!nonEmpty(value.requestPath)
      || !/^\/mock\/[A-Za-z0-9/_-]+\.json$/.test(value.requestPath))) {
      throw new Error(`Case ${value.id} has an invalid browser Mock request path`)
    }
    if (value.sourceScenarioId !== undefined && !nonEmpty(value.sourceScenarioId)) {
      throw new Error(`Case ${value.id} has an invalid source Scenario ID`)
    }
    if (value.domAssertion !== undefined && (!nonEmpty(value.domAssertion?.containerSelector)
      || !Array.isArray(value.domAssertion.fields) || !value.domAssertion.fields.length
      || value.domAssertion.fields.some(field => !nonEmpty(field?.selector)
        || (nonEmpty(field?.equals) === nonEmpty(field?.includes))))) {
      throw new Error(`Case ${value.id} has invalid linked DOM assertions`)
    }
  }
  if (!TARGETS.includes(value.coverage?.target) || !BEHAVIORS.includes(value.coverage?.behavior)) {
    throw new Error(`Case ${value.id} has unsupported coverage tags`)
  }
  if (Boolean(value.expectedFailure) !== (value.coverage.behavior === 'failure-or-ambiguity')) {
    throw new Error(`Case ${value.id} has inconsistent failure expectations`)
  }
  if (!['candidate', 'approved'].includes(value.review?.status)) throw new Error(`Case ${value.id} needs a review status`)
  if (value.review.status === 'approved' && (!nonEmpty(value.review.evidenceRef)
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.review.reviewedAt || ''))) {
    throw new Error(`Case ${value.id} needs a dated human-review evidence reference before approval`)
  }
  assertBranchIsolationCase(value)
}

// Aggregate only: no intent, route, API, Mock field, case ID or run ID leaves this report.
export function summarizeBusinessExperienceCorpus(cases, runs = [], selections = []) {
  if (!Array.isArray(cases) || !Array.isArray(runs) || !Array.isArray(selections)) {
    throw new Error('Cases, runs and selections must be arrays')
  }
  const ids = new Set()
  for (const item of cases) assertCase(item, ids)
  const runById = new Map(runs.map(run => [run.id, run]))
  const selectionByCase = new Map()
  for (const selection of selections) {
    if (!ids.has(selection?.caseId) || !nonEmpty(selection?.runId)
      || selectionByCase.has(selection.caseId) || !runById.has(selection.runId)
      || runById.get(selection.runId)?.workflowId !== 'business-scenario-create'
      || (selection.mode !== undefined && !['agent', 'controlled-browser'].includes(selection.mode))
      || (selection.mode === 'controlled-browser' && !selection.previewEvidence)) {
      throw new Error('Each selection must link one known case to one existing run')
    }
    selectionByCase.set(selection.caseId, selection)
  }
  const reviewedCoverage = { target: counts(TARGETS), behavior: counts(BEHAVIORS) }
  const outcomes = { passed: 0, failed: 0, notVerified: 0 }
  const controlledOutcomes = { passed: 0, failed: 0, notVerified: 0 }
  let approved = 0
  for (const item of cases) {
    if (item.review.status !== 'approved') continue
    approved += 1
    reviewedCoverage.target[item.coverage.target] += 1
    reviewedCoverage.behavior[item.coverage.behavior] += 1
    const selection = selectionByCase.get(item.id)
    const run = runById.get(selection?.runId)
    const terminal = run?.status === 'completed' || (item.expectedFailure && run?.status === 'failed')
    const outcome = !terminal ? 'not_verified'
      : ['default-branch', 'branch-switch'].includes(item.coverage.behavior)
        ? evaluateBranchIsolation(run, item, selection?.branchTrace).outcome
        : evaluateBusinessExperience(run, item, selection?.previewEvidence).outcome
    const key = outcome === 'not_verified' ? 'notVerified' : outcome
    if (selection?.mode === 'controlled-browser') {
      controlledOutcomes[key] += 1
      outcomes.notVerified += 1
    } else {
      outcomes[key] += 1
    }
  }
  return {
    schemaVersion: 1,
    targetApprovedCases: 20,
    caseCount: cases.length,
    candidateCount: cases.length - approved,
    approvedCount: approved,
    remainingToTarget: Math.max(0, 20 - approved),
    reviewedCoverage,
    completedRunOutcomes: outcomes,
    controlledRunOutcomes: controlledOutcomes,
    limitations: [
      'A candidate is never counted as an approved accuracy case',
      'Approval requires an external human-reviewed business expectation; a workflow run alone cannot approve its own expected result',
      'Only completed runs can pass or fail the final outcome; missing or paused verification stays notVerified',
      'Controlled browser runs are reported separately and never count as natural-language Agent accuracy samples',
      'Coverage counts do not measure accuracy or speed until approved cases are linked to independently observed runs'
    ]
  }
}
