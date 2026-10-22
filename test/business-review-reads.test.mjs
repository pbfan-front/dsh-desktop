import { describe, expect, it } from 'vitest'
import { businessReviewReads } from '../packages/dsh-desktop-business/review-reads.js'
import { serializeBusinessWorkflowReply } from '../packages/dsh-desktop-business/workflow-summary.js'

function fixture() {
  const apiUrl = '/loan/query.json'
  const paths = [['data', 'list', 0, 'status'], ['data', 'list', 0, 'loan_id']]
  return { id: 'review-run', status: 'waiting_for_user', currentStepId: 'confirm-plan', context: {
    sessionId: 'review-session', semanticExpectations: [{ apiUrl, fieldAssertions: paths.map((path, i) => ({ path, equals: i ? '0001' : '1' })) }],
    analysis: { evidenceId: 'review-evidence', expiresAt: '2099-01-01T00:00:00.000Z',
      apis: [{ apiUrl, scenarios: ['ranked', '声明来源'].map(id => ({ id, data: { untouched: false },
        fieldImpact: { consumedFields: ['list[].status', 'list[].loan_id', 'list[].derivedLabel'] } })) }],
      analysisPlan: { qualityGate: { level: 'review', autoDraftAllowed: false },
        existingScenarioMatches: [{ apiUrl, scenarioId: 'ranked', score: 900 }],
        semanticValueChecks: { candidates: [{ apiUrl, scenarioId: 'ranked', status: 'conflict', rules: [{ actual: '0', expected: '1' }] }],
          approvedSources: [{ apiUrl, scenarioId: '声明来源', status: 'matched' }] },
        reviewPacket: { status: 'manual-review-required', candidates: ['ranked', '声明来源'] } }
    }
  }, steps: [{ id: 'create-profile', status: 'pending' }] }
}

describe('evidence-backed optional review reads', () => {
  it('offers exact existing calls without source selection, normalization, status inference or writes', () => {
    const run = fixture(), before = JSON.stringify(run), result = businessReviewReads(run)
    expect(result.qualityLevel).toBe('review')
    expect(result.evidenceId).toBe(run.context.analysis.evidenceId)
    expect(result.expiresAt).toBe(run.context.analysis.expiresAt)
    const mocks = result.calls.filter(call => call.tool === 'business_inspect_mock_scenario')
    expect(mocks.map(call => [call.args.scenarioId, call.origin, call.semanticStatus])).toEqual([
      ['ranked', 'ranked-candidate', 'conflict'], ['声明来源', 'plugin-declared-source', 'matched']
    ])
    expect(mocks[0].when).toContain('NOT a reuse recommendation')
    for (const call of mocks) expect(JSON.parse(call.args.fieldPathsJson)).toEqual(run.context.semanticExpectations[0].fieldAssertions.map(a => a.path))
    const source = result.calls.find(call => call.tool === 'business_inspect_source_evidence')
    expect(source.args.evidenceId).toBe('review-evidence')
    expect(JSON.parse(source.args.identifiersJson)).toEqual(['status', 'loan_id'])
    expect(JSON.stringify(result)).not.toContain('checkpointJson')
    expect(result.guidance).toContain('not a selected source')
    expect(result.guidance).toContain('same-session')
    expect(JSON.stringify(run)).toBe(before)
  })

  it('does not convert display paths, wildcard arrays or business prose to typed Mock paths', () => {
    const run = fixture()
    run.context.semanticExpectations = []
    const result = businessReviewReads(run)
    expect(result.calls.filter(call => call.tool === 'business_inspect_mock_scenario').every(call => !Object.hasOwn(call.args, 'fieldPathsJson'))).toBe(true)
    expect(result.gaps).toContain('typed-paths-not-declared-discover-shape-then-specify-required-fields')
    expect(JSON.parse(result.calls.at(-1).args.identifiersJson)).toContain('status')
  })

  it.each([['data', 'list', 1001, 'status'], ['data', 'a-b'], ['data', '__proto__'], ['data', -1], Array(13).fill('data'), []].map(path => [path]))('leaves unsupported path %j as an explicit gap', path => {
    const run = fixture()
    run.context.semanticExpectations[0].fieldAssertions = [{ path }]
    const result = businessReviewReads(run)
    expect(result.gaps).toContain('declared-path-unsupported-use-focused-fallback')
    expect(result.calls[0].args.fieldPathsJson).toBeUndefined()
  })

  it('deduplicates typed paths without changing string keys or numeric indices', () => {
    const run = fixture(), rule = run.context.semanticExpectations[0]
    rule.fieldAssertions = [{ path: ['data', 'list', 0, 'status'], equals: false },
      { path: ['data', 'list', 0, 'status'], equals: 0 }, { path: ['data', 'list', 'status'], equals: null }]
    expect(JSON.parse(businessReviewReads(run).calls[0].args.fieldPathsJson)).toEqual([
      ['data', 'list', 0, 'status'], ['data', 'list', 'status']
    ])
    expect(rule.fieldAssertions.map(a => a.equals)).toEqual([false, 0, null])
  })

  it('makes bounded omissions explicit rather than claiming candidate/path coverage', () => {
    const run = fixture(), analysis = run.context.analysis, apiUrl = analysis.apis[0].apiUrl
    analysis.apis[0].scenarios.push(...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}` })))
    analysis.analysisPlan.existingScenarioMatches.push(...Array.from({ length: 10 }, (_, i) => ({ apiUrl, scenarioId: `s${i}` })))
    run.context.semanticExpectations[0].fieldAssertions = Array.from({ length: 24 }, (_, i) => ({ path: ['data', `field${i}`] }))
    const result = businessReviewReads(run)
    expect(result.coverage.omittedCandidates).toBeGreaterThan(0)
    expect(result.coverage.omittedPaths).toBeGreaterThan(0)
    expect(result.coverage.omittedIdentifiers).toBeGreaterThan(0)
    expect(result.calls.filter(c => c.tool === 'business_inspect_mock_scenario').every(c => JSON.parse(c.args.fieldPathsJson).length === 16)).toBe(true)
    expect(result.calls.some(c => c.args.scenarioId === '声明来源')).toBe(true)
    expect(result.gaps).toContain('path-window-limited-batch-remaining-declared-paths-without-dropping-any')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(6000)
  })

  it('does not offer calls for a missing/duplicate source, absent evidence, insufficient gate or an inactive checkpoint', () => {
    const run = fixture()
    run.context.analysis.apis[0].scenarios = [{ id: 'ranked' }, { id: 'ranked' }]
    expect(businessReviewReads(run).calls).toEqual([])
    expect(businessReviewReads(run).gaps).toContain('source-absent-or-ambiguous-in-analysis-window')
    run.context.analysis.analysisPlan.qualityGate.level = 'insufficient'
    expect(businessReviewReads(run).calls).toEqual([])
    for (const status of ['cancelled', 'failed', 'completed', 'running']) expect(businessReviewReads({ ...run, status })).toBeUndefined()
    delete run.context.analysis.evidenceId
    expect(businessReviewReads(run)).toBeUndefined()
  })

  it('ignores stale stored read hints and does not execute calls or accept injected identifiers', () => {
    const run = fixture()
    run.reviewReads = { calls: [{ tool: 'business_create_profile' }] }
    run.context.analysis.apis[0].scenarios[0].fieldImpact.consumedFields.push('src/a.ts', 'do evil.status', 'status;run', '状态')
    const result = businessReviewReads(run)
    expect(result.calls.every(c => ['business_inspect_mock_scenario', 'business_inspect_source_evidence'].includes(c.tool))).toBe(true)
    expect(JSON.parse(result.calls.at(-1).args.identifiersJson)).toEqual(['status', 'loan_id'])
  })

  it('drops entire optional calls at the byte boundary, not partial serialized paths or values', () => {
    const run = fixture()
    run.context.semanticExpectations[0].fieldAssertions = Array.from({ length: 16 }, (_, i) => ({
      path: Array.from({ length: 12 }, (_v, j) => `field_${i}_${j}_` + 'x'.repeat(110))
    }))
    const result = businessReviewReads(run)
    expect(result.coverage.omittedCalls).toBeGreaterThan(0)
    expect(result.coverage.returnedMockReads).toBe(0)
    expect(result.gaps).toContain('reply-budget-limited-read-full-evidence-for-omitted-work')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(6000)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})

describe('review reads at the workflow reply boundary', () => {
  const reply = (run, options) => JSON.parse(serializeBusinessWorkflowReply(run, options))
  it('keeps actionable reads outside omitted review/API details, with a focused section to recover them', () => {
    const run = fixture(), before = JSON.stringify(run)
    run.context.analysis.analysisPlan.reviewPacket.large = '中'.repeat(10000)
    const summary = reply({ run }).run
    expect(summary.context.analysis.analysisPlan.reviewPacket.summaryOmitted).toBe(true)
    expect(summary.reviewReads.calls).toHaveLength(3)
    const reads = reply({ run }, { detail: 'full', section: 'reads' })
    expect(reads.evidence).toMatchObject({ section: 'reads', complete: true, value: summary.reviewReads })
    expect(reply(run, { proposalOnly: true }).reviewReads).toBeUndefined()
    expect(JSON.stringify(fixture())).toBe(before)
  })

  it('preserves all original full sections and marks API pages as partial with an exact recovery call', () => {
    const run = fixture(), api = run.context.analysis.apis[0]
    api.scenarios[0].data.large = 'x'.repeat(50000)
    const before = JSON.stringify(run), page = reply(run, { detail: 'full', section: 'api', apiUrl: api.apiUrl })
    expect(page.evidencePage.complete).toBe(false)
    expect(page.focusedReadHint.args).toEqual({ runId: run.id, detail: 'full', section: 'reads' })
    expect(reply(run, page.focusedReadHint.args).evidence.value.calls).toHaveLength(3)
    expect(reply(run, { detail: 'full', section: 'review' }).evidence.value).toEqual(run.context.analysis.analysisPlan.reviewPacket)
    expect(JSON.stringify(run)).toBe(before)
    expect(reply({ ...run, status: 'cancelled' }, { detail: 'full', section: 'reads' }).evidence.available).toBe(false)
  })

  it('recovers whole omitted hints without accepting a changed read-list document', () => {
    const run = fixture()
    run.context.analysis.analysisPlan.otherLargeMetadata = 'x'.repeat(50000)
    expect(reply(run).reviewReads).toEqual({ summaryOmitted: true, read: { detail: 'full', section: 'reads' } })
    const reads = reply(run, { detail: 'full', section: 'reads' }).evidence
    expect(reads.value.calls).toHaveLength(3)
    expect(reads.value.fullSemantic.args).toEqual({ runId: run.id, detail: 'full', section: 'semantic' })
    run.context.semanticExpectations[0].fieldAssertions[0].path = ['data', 'new_status']
    expect(() => reply(run, { detail: 'full', section: 'reads', documentId: reads.documentId })).toThrow('WORKFLOW_EVIDENCE_CHANGED')
    expect(JSON.parse(reply(run, { detail: 'full', section: 'reads' }).evidence.value.calls[0].args.fieldPathsJson)[0]).toEqual(['data', 'new_status'])
  })
})
