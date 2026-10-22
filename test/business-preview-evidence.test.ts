import { describe, expect, it } from 'vitest'
import { parseBusinessPreviewEvidence } from '../src/shared/business-preview-evidence'

const evidence = { sessionId: 'session-1', profileId: null, revision: 0, revisionId: 'activation-1',
  route: '/repay/receiptList', observedAt: '2026-10-22T08:00:00.000Z', fingerprint: 'a'.repeat(64) }

describe('read-only preview wake-up boundary', () => {
  it('accepts bounded metadata but never forwards text, tokens or extra command fields', () => {
    expect(parseBusinessPreviewEvidence({ ...evidence, text: 'private page', token: 'secret', action: 'approve' })).toEqual(evidence)
    expect(parseBusinessPreviewEvidence({ ...evidence, profileId: 'selected' })?.profileId).toBe('selected')
  })
  it.each([null, [], {}, { ...evidence, revision: -1 }, { ...evidence, revision: 0.1 },
    { ...evidence, fingerprint: 'short' }, { ...evidence, observedAt: 'invalid' },
    { ...evidence, sessionId: 's'.repeat(201) }, { ...evidence, profileId: {} },
    { ...evidence, route: 'r'.repeat(501) }, { ...evidence, revisionId: '' }].map(value => [value]))('rejects malformed metadata %#', value => {
    expect(parseBusinessPreviewEvidence(value)).toBeNull()
  })
})
