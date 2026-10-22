import { describe, expect, it } from 'vitest'
import { MAX_WORKFLOW_REPLY_BYTES, serializeBusinessWorkflowReply } from '../packages/dsh-desktop-business/workflow-summary.js'

function fixture() {
  const analysis = { evidenceId: 'evidence-1', apis: [{ apiUrl: '/loan/query.json', scenarios: [
    { id: 'normal', data: { status: '0', amount: 0, enabled: false, optional: null } }
  ] }], analysisPlan: {
    qualityGate: { status: 'review', reason: 'source review required' },
    semanticValueChecks: { status: 'conflict', actual: '0', expected: 0, unknownFields: ['other'] },
    reviewPacket: { candidate: 'normal', valuePreview: { status: '0', amount: 0, enabled: false, optional: null } }
  } }
  return { id: 'run-1', status: 'waiting_for_user', currentStepId: 'confirm-plan', context: {
    sessionId: 'session-1', routePath: '/loan/apply', query: 'review source', analysis,
    semanticExpectations: [{ path: ['data', 'status'], equals: '0' }]
  }, steps: [{ id: 'analyze-target', status: 'completed', input: { rawCopy: analysis }, output: analysis },
    { id: 'create-profile', status: 'pending' }, { id: 'verify-preview', status: 'pending' }] }
}

function reply(run, options) {
  const text = serializeBusinessWorkflowReply(run, options)
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_WORKFLOW_REPLY_BYTES)
  return JSON.parse(text)
}

function collect(run, options = {}) {
  let payload = reply(run, { detail: 'full', ...options })
  if (!payload.evidencePage) return payload.evidence?.value ?? payload
  const contents = []
  const documentId = payload.evidencePage.documentId
  let expectedOffset = 0
  for (;;) {
    const page = payload.evidencePage
    expect(page.documentId).toBe(documentId)
    expect(page.offset).toBe(expectedOffset)
    contents.push(page.content)
    expectedOffset += page.content.length
    if (page.nextOffset === null) {
      expect(expectedOffset).toBe(page.totalChars)
      break
    }
    expect(page.complete).toBe(false)
    payload = reply(run, { detail: 'full', ...options, offset: page.nextOffset, documentId })
  }
  return JSON.parse(contents.join(''))
}

describe('bounded workflow evidence projection', () => {
  it('covers the actual get wrapper, deduplicates only equal analysis and preserves gates and scalar types', () => {
    const run = fixture(), before = JSON.stringify(run)
    const result = reply({ run }).run
    expect(result).toMatchObject({ id: run.id, status: run.status, currentStepId: run.currentStepId })
    expect(result.context.analysis.analysisPlan).toEqual(run.context.analysis.analysisPlan)
    expect(result.context.semanticExpectations).toEqual(run.context.semanticExpectations)
    expect(result.steps[0].output).toBeUndefined()
    expect(result.steps[0].input).toBeUndefined()
    expect(result.steps[0].outputRef).toEqual({ path: 'context.analysis', evidenceId: 'evidence-1' })
    expect(result.steps[1].status).toBe('pending')
    expect(result.context.profileId).toBeUndefined()
    expect(JSON.stringify(run)).toBe(before)
    expect(reply({ run: null })).toEqual({ run: null })
    expect(reply({ run: null }, { detail: 'full' })).toEqual({ run: null })
    run.steps[0].output = { ...run.context.analysis, evidenceId: 'different' }
    expect(reply(run).steps[0].outputRef).toMatchObject({ summaryOmitted: true, read: { section: 'run' } })
  })

  it('keeps candidate collections explicitly non-exhaustive and prioritizes reviewed sources without changing the saved order', () => {
    const run = fixture(), api = run.context.analysis.apis[0]
    api.scenarios = Array.from({ length: 20 }, (_, index) => ({ id: `source-${index}` }))
    run.context.analysis.analysisPlan.semanticValueChecks.approvedSources = [{ apiUrl: api.apiUrl, scenarioId: 'source-19' }]
    const result = reply(run).context.analysis
    expect(result.apis[0].scenarios.map(item => item.id)).toEqual(['source-19', 'source-0', 'source-1', 'source-2'])
    expect(result.apis[0].scenarioSummary).toEqual({ total: 20, returned: 4 })
    expect(result.compaction.note).toContain('not exhaustive')
    expect(api.scenarios[0].id).toBe('source-0')
  })

  it('returns a proposal receipt, not repeated analysis or a partial Mock plan, and does not imply approval', () => {
    const run = fixture()
    run.checkpointProposal = { id: 'proposal-1', checkpointId: 'confirm-plan', proposedAt: 1,
      output: { profileId: 'new_profile', label: 'review', scenarios: [{ id: 'new', data: { huge: 'x'.repeat(100000) } }] } }
    const before = JSON.stringify(run)
    const result = reply(run, { proposalOnly: true })
    expect(result.checkpointProposal).toEqual({ id: 'proposal-1', checkpointId: 'confirm-plan', proposedAt: 1,
      approval: 'explicit-user-action-required', planSummary: { profileId: 'new_profile', label: 'review', scenarioCount: 1, pageCheckCount: 0 } })
    expect(result.context.analysis).toBeUndefined()
    expect(result.steps).toBeUndefined()
    expect(result.context.profileId).toBeUndefined()
    expect(collect(run, { section: 'plan' })).toEqual(run.checkpointProposal.output)
    expect(JSON.stringify(run)).toBe(before)
  })

  it('replaces oversized sections as a whole, never converts conflict/unknown to ready or changes business values', () => {
    const run = fixture()
    run.context.analysis.analysisPlan.fieldImpactAnalysis = { large: '中'.repeat(100000) }
    const result = reply(run)
    expect(result.compaction.requiresFullReview).toBe(true)
    expect(result.context.analysis.analysisPlan.fieldImpactAnalysis).toEqual({ summaryOmitted: true, read: { detail: 'full', section: 'analysis' } })
    expect(result.context.analysis.analysisPlan.qualityGate).toEqual(run.context.analysis.analysisPlan.qualityGate)
    expect(result.context.analysis.analysisPlan.semanticValueChecks).toEqual(run.context.analysis.analysisPlan.semanticValueChecks)
    run.context.analysis.analysisPlan.qualityGate = { status: 'insufficient', reason: 'large'.repeat(20000) }
    const minimal = reply(run)
    expect(minimal.context.analysis).toEqual({ summaryOmitted: true, read: { detail: 'full', section: 'analysis' } })
    expect(minimal.compaction.requiresFullReview).toBe(true)
    expect(minimal.status).toBe('waiting_for_user')
  })

  it('does not truncate scalar Mock values or echo raw plan data in a summary', () => {
    const run = fixture()
    run.context.plan = { profileId: 'pending_profile', scenarios: [{ id: 'new', apiUrl: '/loan/query.json', data: { exact: '0001' } }] }
    expect(reply(run).context.plan.scenarios[0].data).toEqual({ summaryOmitted: true, read: { detail: 'full', section: 'plan' } })
    expect(collect(run, { section: 'plan' }).scenarios[0].data.exact).toBe('0001')
    run.context.query = 'x'.repeat(100000)
    const result = reply(run)
    expect(result.compaction.omittedSections).toEqual(['run-details'])
    expect(result.context).toBeUndefined()
    run.id = 'x'.repeat(100000)
    expect(() => reply(run)).toThrow('safe summary budget')
  })

  it('retains ambiguity candidates and failure/rollback identities without manufacturing success', () => {
    const run = fixture()
    run.status = 'failed'
    run.steps = [{ id: 'analyze-target', status: 'failed', error: { code: 'E_TARGET_ROUTE_AMBIGUOUS', retryable: true,
      candidates: [{ routePath: '/one' }, { routePath: '/two' }], message: 'Choose explicitly' } },
    { id: 'create-profile', status: 'completed', output: { operationId: 'rollback-id', profileId: 'p' } },
    { id: 'verify-preview', status: 'failed', output: { verified: false, revisionId: 'r', checks: { apiHits: false } } }]
    const result = reply(run)
    expect(result.steps[0].error).toEqual(run.steps[0].error)
    expect(result.steps[1].output).toEqual(run.steps[1].output)
    expect(result.steps[2].output).toEqual(run.steps[2].output)
    expect(result.status).toBe('failed')
  })
})

describe('lossless, version-pinned full evidence', () => {
  it('preserves small full-run compatibility and selects exact sections, including explicit missing evidence', () => {
    const run = fixture()
    expect(reply({ run }, { detail: 'full' })).toEqual({ run })
    expect(collect(run, { section: 'analysis' })).toEqual(run.context.analysis)
    expect(collect(run, { section: 'review' })).toEqual(run.context.analysis.analysisPlan.reviewPacket)
    expect(collect(run, { section: 'semantic' })).toEqual({ semanticExpectations: run.context.semanticExpectations,
      semanticValueChecks: run.context.analysis.analysisPlan.semanticValueChecks })
    expect(collect(run, { section: 'api', apiUrl: '/loan/query.json' })).toEqual(run.context.analysis.apis[0])
    expect(reply(run, { detail: 'full', section: 'api', apiUrl: '/missing.json' }).evidence).toMatchObject({ available: false })
    expect(reply(run, { detail: 'full', section: 'plan' }).evidence).toMatchObject({ available: false })
  })

  it.each(['normal', 'escaped', 'unicode'])('reconstructs every byte of large %s evidence without partial outer JSON', kind => {
    const run = fixture()
    const value = kind === 'normal' ? 'business-field ' : kind === 'escaped' ? '\u0000\n\\"' : '中文🚀𠮷'
    run.context.analysis.apis[0].scenarios[0].data.payload = value.repeat(12000)
    const before = JSON.stringify(run)
    expect(collect({ run })).toEqual(run)
    expect(collect(run, { section: 'analysis' })).toEqual(run.context.analysis)
    expect(JSON.stringify(run)).toBe(before)
  })

  it('rejects changed documents, run IDs and section choices instead of mixing snapshots', () => {
    const run = fixture()
    run.context.analysis.apis[0].scenarios[0].data.payload = 'x'.repeat(30000)
    const first = reply(run, { detail: 'full', section: 'analysis' }).evidencePage
    const options = { detail: 'full', section: 'analysis', offset: first.nextOffset, documentId: first.documentId }
    run.context.analysis.apis[0].scenarios[0].data.status = '1'
    expect(() => reply(run, options)).toThrow('WORKFLOW_EVIDENCE_CHANGED')
    run.context.analysis.apis[0].scenarios[0].data.status = '0'
    expect(() => reply({ ...run, id: 'run-2' }, options)).toThrow('WORKFLOW_EVIDENCE_CHANGED')
    expect(() => reply(run, { ...options, section: 'run' })).toThrow('WORKFLOW_EVIDENCE_CHANGED')
    expect(collect(run, { section: 'analysis' })).toEqual(run.context.analysis)
    delete run.context.analysis
    expect(() => reply(run, options)).toThrow('WORKFLOW_EVIDENCE_CHANGED')
    expect(() => reply({ run: null }, options)).toThrow('WORKFLOW_EVIDENCE_CHANGED')
  })

  it('fails closed for invalid selectors, offsets and malformed envelopes', () => {
    const run = fixture()
    for (const options of [ { detail: 'invalid' }, { section: 'analysis' }, { detail: 'full', section: 'unknown' }, { detail: 'full', section: '' },
      { detail: 'full', section: 'api' }, { detail: 'full', apiUrl: '/ignored.json' }, { detail: 'full', offset: -1 },
      { detail: 'full', offset: 1.5 }, { detail: 'full', offset: 1 }, { detail: 'full', documentId: 'bad' },
      { detail: 'full', offset: 999999, documentId: '0'.repeat(64) } ]) expect(() => reply(run, options)).toThrow()
    const first = reply(run, { detail: 'full', section: 'analysis' }).evidence
    expect(() => reply(run, { detail: 'full', section: 'analysis', offset: 999999, documentId: first.documentId })).toThrow('outside')
    for (const value of [false, [], 'raw', {}, { run: 'raw' }]) {
      expect(() => reply(value)).toThrow('Invalid')
      expect(() => reply(value, { detail: 'full' })).toThrow('Invalid')
    }
  })
})
