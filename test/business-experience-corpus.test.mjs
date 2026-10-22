import assert from 'node:assert/strict'
import { test } from 'vitest'
import { summarizeBusinessExperienceCorpus } from '../scripts/business-experience-corpus.mjs'
import { planBusinessBranchTrace } from '../scripts/business-branch-isolation-evaluation.mjs'

const candidate = {
  id: 'receipt-normal', review: { status: 'candidate' },
  coverage: { target: 'explicit-route', behavior: 'existing-reuse' },
  intent: 'private intent', routePath: '/repay/receiptList', apiUrl: '/loanNbr/loanNbr.json',
  mockFields: [{ path: ['data', 'list', 0, 'duestatus'], equals: '0' }],
  visibleText: ['借据列表'], absentText: ['逾期']
}

function completedRun() {
  return {
    id: 'private-run-id', workflowId: 'business-scenario-create', status: 'completed', context: {
      profileId: 'profile-created',
      query: candidate.intent, target: { routePath: candidate.routePath, source: 'explicit-route' },
      plan: { scenarios: [{ id: 'normal', apiUrl: candidate.apiUrl,
        data: { data: { list: [{ duestatus: '0' }] } } }] }
    },
    steps: [{ id: 'verify-preview', output: { verified: true,
      checks: { observationCurrent: true, route: true, scenarios: [{ scenarioId: 'normal', passed: true }] },
      pageObservation: { route: candidate.routePath, text: '借据列表' } } }]
  }
}

const review = { status: 'approved', evidenceRef: 'review-record-1', reviewedAt: '2026-10-14' }
const contrast = { scenarioId: 'base-default', mockFields: [{ path: ['data', 'list', 0, 'duestatus'], equals: '1' }],
  visibleText: ['借据列表', '未结清'], absentText: ['正常'] }
const defaultCase = { ...candidate, review, coverage: { target: 'explicit-route', behavior: 'default-branch' },
  branchIsolation: { requestPath: '/mock/loanNbr/loanNbr.json', default: contrast } }

function snapshot(revision, profileId, scenarioId, duestatus, text) {
  const sessionId = 'private-session-id'
  const transitionAt = new Date(Date.UTC(2026, 9, 14, 0, revision * 3)).toISOString()
  const requestAt = new Date(Date.parse(transitionAt) + 1000).toISOString()
  const observedAt = new Date(Date.parse(transitionAt) + 2000).toISOString()
  return { sessionId, transitionAt,
    state: { revision, profileId, url: `http://127.0.0.1:8094/mm?${profileId ? `__mockProfile=${profileId}` : ''}#/repay/receiptList` },
    result: { sessionId, revision, profileId,
      requests: [{ sessionId, revision, profileId, scenarioId, path: '/mock/loanNbr/loanNbr.json', status: 200,
        timestamp: requestAt }] },
    evidence: { sessionId, revision, profileId,
      pageObservation: { revision, profileId, route: '/mm#/repay/receiptList', text, observedAt } },
    mockResponse: { timestamp: requestAt, sessionId, path: '/mock/loanNbr/loanNbr.json', statusCode: 200, profileId, scenarioId,
      body: { data: { list: [{ duestatus }] } } } }
}

function defaultTrace() {
  return { snapshots: [
    snapshot(1, '', 'base-default', '1', '借据列表 未结清'),
    snapshot(2, 'profile-created', 'normal', '0', '借据列表 正常'),
    snapshot(3, '', 'base-default', '1', '借据列表 未结清')
  ] }
}

test('unreviewed cases never count as an accuracy baseline even with a passing run', () => {
  const report = summarizeBusinessExperienceCorpus([candidate], [completedRun()],
    [{ caseId: candidate.id, runId: 'private-run-id' }])
  assert.equal(report.candidateCount, 1)
  assert.equal(report.approvedCount, 0)
  assert.deepEqual(report.completedRunOutcomes, { passed: 0, failed: 0, notVerified: 0 })
  assert.doesNotMatch(JSON.stringify(report), /private intent|private-run-id|receipt-normal|loanNbr/)
})

test('approved cases require human evidence and a completed observed run', () => {
  assert.throws(() => summarizeBusinessExperienceCorpus([{ ...candidate, review: { status: 'approved' } }]), /human-review/)
  const approved = { ...candidate, review }
  const unlinked = summarizeBusinessExperienceCorpus([approved])
  assert.equal(unlinked.completedRunOutcomes.notVerified, 1)
  const linked = summarizeBusinessExperienceCorpus([approved], [completedRun()],
    [{ caseId: approved.id, runId: 'private-run-id' }])
  assert.equal(linked.completedRunOutcomes.passed, 1)
  assert.equal(linked.reviewedCoverage.behavior['existing-reuse'], 1)
  const paused = { ...completedRun(), status: 'waiting_for_user' }
  assert.equal(summarizeBusinessExperienceCorpus([approved], [paused],
    [{ caseId: approved.id, runId: paused.id }]).completedRunOutcomes.notVerified, 1)
  const controlledRun = completedRun()
  controlledRun.steps.unshift({ id: 'create-profile', completedAt: '2026-10-16T04:00:01.000Z' })
  controlledRun.steps.find(step => step.id === 'verify-preview').completedAt = '2026-10-16T04:00:05.000Z'
  const url = 'http://127.0.0.1:8094/mm?__mockProfile=profile-created&__dshRevision=2&__dshRevisionId=new#/repay/receiptList'
  const previewEvidence = { selectionAt: '2026-10-16T04:00:02.000Z',
    state: { profileId: 'profile-created', revision: 2, revisionId: 'new', url },
    mockResponse: { timestamp: '2026-10-16T04:00:03.000Z', statusCode: 200,
      profileId: 'profile-created', scenarioId: 'normal', path: '/mock/loanNbr/loanNbr.json',
      body: { data: { list: [{ duestatus: '0' }] } } },
    page: { capturedAt: '2026-10-16T04:00:04.000Z', url, text: '借据列表' } }
  assert.throws(() => summarizeBusinessExperienceCorpus([approved], [controlledRun],
    [{ caseId: approved.id, runId: 'private-run-id', mode: 'controlled-browser' }]), /known case/)
  const controlled = summarizeBusinessExperienceCorpus([approved], [controlledRun],
    [{ caseId: approved.id, runId: 'private-run-id', mode: 'controlled-browser', previewEvidence }])
  assert.equal(controlled.controlledRunOutcomes.passed, 1)
  assert.equal(controlled.completedRunOutcomes.notVerified, 1)
})

test('negative cases need the exact failure gate', () => {
  const negative = { id: 'ambiguous', intent: 'private negative intent',
    coverage: { target: 'intent-page', behavior: 'failure-or-ambiguity' },
    review: { status: 'approved', evidenceRef: 'review-record-2', reviewedAt: '2026-10-14' },
    expectedFailure: { stepId: 'analyze-target', code: 'E_TARGET_ROUTE_AMBIGUOUS' } }
  const run = { id: 'negative-run', workflowId: 'business-scenario-create', status: 'failed', context: { query: negative.intent },
    steps: [{ id: 'analyze-target', status: 'failed', error: { code: 'E_TARGET_ROUTE_AMBIGUOUS' } }] }
  assert.equal(summarizeBusinessExperienceCorpus([negative], [run],
    [{ caseId: negative.id, runId: run.id }]).completedRunOutcomes.passed, 1)
})

test('default branch requires a paired trace across one session and increasing revisions', () => {
  const selection = { caseId: candidate.id, runId: 'private-run-id', branchTrace: defaultTrace() }
  const report = summarizeBusinessExperienceCorpus([defaultCase], [completedRun()], [selection])
  assert.equal(report.completedRunOutcomes.passed, 1)
  assert.doesNotMatch(JSON.stringify(report), /private-session-id|profile-created|loanNbr|base-default/)
  assert.equal(summarizeBusinessExperienceCorpus([defaultCase], [completedRun()],
    [{ caseId: candidate.id, runId: 'private-run-id' }]).completedRunOutcomes.notVerified, 1)

  const leaked = defaultTrace()
  leaked.snapshots[2].state.profileId = 'profile-created'
  assert.equal(summarizeBusinessExperienceCorpus([defaultCase], [completedRun()],
    [{ ...selection, branchTrace: leaked }]).completedRunOutcomes.failed, 1)
  const stale = defaultTrace()
  stale.snapshots[2].state.revision = 2
  assert.equal(summarizeBusinessExperienceCorpus([defaultCase], [completedRun()],
    [{ ...selection, branchTrace: stale }]).completedRunOutcomes.failed, 1)
  const wrongRequest = defaultTrace()
  wrongRequest.snapshots[1].result.requests[0].scenarioId = 'base-default'
  assert.equal(summarizeBusinessExperienceCorpus([defaultCase], [completedRun()],
    [{ ...selection, branchTrace: wrongRequest }]).completedRunOutcomes.failed, 1)
  const staleRequest = defaultTrace()
  delete staleRequest.snapshots[1].result.requests[0].revision
  staleRequest.snapshots[1].result.requests[0].timestamp = staleRequest.snapshots[0].result.requests[0].timestamp
  assert.equal(summarizeBusinessExperienceCorpus([defaultCase], [completedRun()],
    [{ ...selection, branchTrace: staleRequest }]).completedRunOutcomes.failed, 1)
  const staleBrowserResponse = defaultTrace()
  staleBrowserResponse.snapshots[2].mockResponse.timestamp = staleBrowserResponse.snapshots[0].mockResponse.timestamp
  assert.equal(summarizeBusinessExperienceCorpus([defaultCase], [completedRun()],
    [{ ...selection, branchTrace: staleBrowserResponse }]).completedRunOutcomes.failed, 1)
  const externalRequest = defaultTrace()
  delete externalRequest.snapshots[1].result.requests[0].revision
  externalRequest.snapshots[1].result.requests[0].path = '/loanNbr/loanNbr.json'
  assert.equal(summarizeBusinessExperienceCorpus([defaultCase], [completedRun()],
    [{ ...selection, branchTrace: externalRequest }]).completedRunOutcomes.passed, 1)
  const noDefaultRuntimeLog = defaultTrace()
  noDefaultRuntimeLog.snapshots[0].result.requests = []
  noDefaultRuntimeLog.snapshots[2].result.requests = []
  assert.equal(summarizeBusinessExperienceCorpus([defaultCase], [completedRun()],
    [{ ...selection, branchTrace: noDefaultRuntimeLog }]).completedRunOutcomes.passed, 1)
})

test('branch switch must prove A to B to A without stale Mock or page evidence', () => {
  const branchCase = { ...candidate, review, coverage: { target: 'explicit-route', behavior: 'branch-switch' },
    branchIsolation: { requestPath: '/mock/loanNbr/loanNbr.json', alternateProfileId: 'profile-alternate',
      alternate: { ...contrast, scenarioId: 'alternate-scenario' } } }
  const selection = { caseId: candidate.id, runId: 'private-run-id', branchTrace: { snapshots: [
    snapshot(4, 'profile-created', 'normal', '0', '借据列表 正常'),
    snapshot(5, 'profile-alternate', 'alternate-scenario', '1', '借据列表 未结清'),
    snapshot(6, 'profile-created', 'normal', '0', '借据列表 正常')
  ] } }
  assert.equal(summarizeBusinessExperienceCorpus([branchCase], [completedRun()], [selection]).completedRunOutcomes.passed, 1)
  const stale = structuredClone(selection)
  stale.branchTrace.snapshots[2].mockResponse.body.data.list[0].duestatus = '1'
  assert.equal(summarizeBusinessExperienceCorpus([branchCase], [completedRun()], [stale]).completedRunOutcomes.failed, 1)
  const wrongSession = structuredClone(selection)
  wrongSession.branchTrace.snapshots[1].sessionId = 'unrelated-session'
  assert.equal(summarizeBusinessExperienceCorpus([branchCase], [completedRun()], [wrongSession]).completedRunOutcomes.failed, 1)
  const sameProfile = { ...branchCase, branchIsolation: { ...branchCase.branchIsolation,
    alternateProfileId: 'profile-created' } }
  assert.equal(summarizeBusinessExperienceCorpus([sameProfile], [completedRun()], [selection]).completedRunOutcomes.failed, 1)
  const noContrast = { ...branchCase, branchIsolation: { ...branchCase.branchIsolation,
    alternate: { ...branchCase.branchIsolation.alternate, mockFields: candidate.mockFields,
      visibleText: candidate.visibleText, absentText: candidate.absentText } } }
  assert.throws(() => summarizeBusinessExperienceCorpus([noContrast]), /paired branch-isolation/)
  assert.throws(() => summarizeBusinessExperienceCorpus([{ ...branchCase, branchIsolation: {} }]), /paired branch-isolation/)
})

test('browser trace plan only switches between installed Profiles for the same page and API', () => {
  const branchCase = { ...defaultCase, coverage: { target: 'explicit-route', behavior: 'branch-switch' },
    branchIsolation: { requestPath: defaultCase.branchIsolation.requestPath,
      alternateProfileId: 'profile-alternate', alternate: { ...contrast, scenarioId: 'alternate-scenario' } } }
  const profiles = ['profile-created', 'profile-alternate'].map(id => ({ id, routePath: candidate.routePath,
    apis: { [candidate.apiUrl]: {} } }))
  const selected = planBusinessBranchTrace(completedRun(), defaultCase, profiles)
  assert.deepEqual(selected.phases, [
    { phase: 'default-before', profileId: '' },
    { phase: 'selected', profileId: 'profile-created' },
    { phase: 'default-after', profileId: '' }
  ])
  const switched = planBusinessBranchTrace(completedRun(), branchCase, profiles)
  assert.deepEqual(switched.phases, [
    { phase: 'selected-before', profileId: 'profile-created' },
    { phase: 'alternate', profileId: 'profile-alternate' },
    { phase: 'selected-after', profileId: 'profile-created' }
  ])
  assert.throws(() => planBusinessBranchTrace(completedRun(), branchCase, profiles.slice(0, 1)), /not installed/)
  assert.throws(() => planBusinessBranchTrace(completedRun(), branchCase,
    [{ ...profiles[0], routePath: '/unrelated' }, profiles[1]]), /page and API/)
  assert.throws(() => planBusinessBranchTrace(completedRun(), branchCase,
    [profiles[0], { ...profiles[1], apis: {} }]), /page and API/)
  assert.throws(() => planBusinessBranchTrace(completedRun(), branchCase,
    [profiles[0], { ...profiles[1], id: 'profile-created' }]), /not installed/)
  const unverified = completedRun()
  unverified.steps[0].output.verified = false
  assert.throws(() => planBusinessBranchTrace(unverified, branchCase, profiles), /verified preview/)
})

test('rejects duplicate cases and invalid run links', () => {
  assert.throws(() => summarizeBusinessExperienceCorpus([candidate, candidate]), /unique/)
  assert.throws(() => summarizeBusinessExperienceCorpus([candidate], [],
    [{ caseId: candidate.id, runId: 'unknown' }]), /known case/)
})
