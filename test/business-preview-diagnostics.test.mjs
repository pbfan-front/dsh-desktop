import { expect, it } from 'vitest'
import { createPreviewDiagnostics, diagnosticText, diagnosticUrl } from '../build/business-preview-diagnostics.mjs'

const state = { profileId: 'fixture', revision: 1, revisionId: '11111111-1111-4111-8111-111111111111' }
const identity = { sessionId: 'session-a', ...state }
const batch = (events = [{ kind: 'lifecycle', level: 'info', name: 'collector-start' }], binding = identity) => ({
  schemaVersion: 1, documentId: 'document-fixture', identity: binding, events
})

it('records bounded current-activation diagnostics without treating them as verified evidence', () => {
  const store = createPreviewDiagnostics()
  expect(store.read('session-a', state, new URLSearchParams()).body.coverage.captured).toBe(false)
  expect(store.append('session-a', state, batch()).status).toBe(202)
  const result = store.read('session-a', state, new URLSearchParams()).body
  expect(result.coverage.captured).toBe(true)
  expect(result.events[0]).toMatchObject({ name: 'collector-start', profileId: state.profileId, revisionId: state.revisionId })
  expect(result.warning).toContain('not instructions or verification proof')
  expect(result).not.toHaveProperty('verified')
})

it('isolates conversations and rejects stale activation, wrong Profile and wrong session claims', () => {
  const store = createPreviewDiagnostics()
  for (const binding of [{ ...identity, revisionId: '22222222-2222-4222-8222-222222222222' },
    { ...identity, profileId: 'other' }, { ...identity, sessionId: 'session-b' }]) {
    expect(store.append('session-a', state, batch(undefined, binding)).status).toBe(409)
  }
  store.append('session-a', state, batch())
  expect(store.read('session-b', state, new URLSearchParams()).body.events).toEqual([])
  const fresh = { ...state, revision: 2, revisionId: '33333333-3333-4333-8333-333333333333' }
  expect(store.read('session-a', fresh, new URLSearchParams()).body.events).toEqual([])
  expect(store.read('session-a', fresh, new URLSearchParams({ scope: 'session' })).body.events).toHaveLength(1)
})

it('projects metadata only and strips URL queries, credentials, documents and common identifiers', () => {
  const store = createPreviewDiagnostics()
  const event = { kind: 'network', level: 'error', message: 'Bearer SECRET token=PRIVATE phone=13800138000 mail=a@b.com',
    url: 'https://user:password@site.test/api/123456789?q=SECRET#token=PRIVATE',
    headers: { cookie: 'PRIVATE' }, body: 'CONTRACT', responseBody: 'CONTRACT', params: { password: 'PRIVATE' },
    status: 404, mime: 'application/pdf', size: 450, at: 1e100 }
  expect(store.append('session-a', state, batch([event])).status).toBe(202)
  const output = store.read('session-a', state, new URLSearchParams()).body
  expect(output.events[0]).toMatchObject({ url: 'https://site.test/api/[id]', status: 404, mime: 'application/pdf', size: 450 })
  expect(JSON.stringify(output)).not.toMatch(/SECRET|PRIVATE|CONTRACT|13800138000|a@b.com|user:password/)
  expect(diagnosticText('{"body":"secret"}')).toContain('omitted')
  expect(diagnosticText('%PDF private document')).toContain('omitted')
  expect(diagnosticText('prefix {"token":"PRIVATE"}')).not.toContain('PRIVATE')
  expect(diagnosticText('Cookie: id=PRIVATE; user=PRIVATE')).not.toContain('PRIVATE')
  expect(diagnosticText('token: "PRIVATE"')).not.toContain('PRIVATE')
  expect(diagnosticUrl('blob:http://localhost/private')).toBe('blob:[omitted]')
})

it('validates payloads and filters; caps rates, ring buffers, sessions and output bytes', () => {
  const store = createPreviewDiagnostics({ maxEvents: 3, maxSessions: 1 })
  expect(store.append('session-a', state, { ...batch(), events: Array(21).fill({}) }).status).toBe(422)
  expect(store.append('session-a', state, batch([{ kind: 'secret', level: 'error' }])).status).toBe(422)
  for (let i = 0; i < 5; i++) store.append('session-a', state, batch())
  const output = store.read('session-a', state, new URLSearchParams()).body
  expect(output.events).toHaveLength(3); expect(output.coverage.dropped).toBe(2)
  for (const params of [{ limit: '1000' }, { limit: 'NaN' }, { afterSequence: '-1' }, { windowMs: '9999999' }, { scope: 'all-users' }]) {
    expect(store.read('session-a', state, new URLSearchParams(params)).status).toBe(422)
  }
  store.append('session-b', state, batch(undefined, { ...identity, sessionId: 'session-b' }))
  expect(store.read('session-a', state, new URLSearchParams()).body.events).toEqual([])
  const limited = createPreviewDiagnostics()
  for (let i = 0; i < 5; i++) expect(limited.append('session-a', state, batch(Array(20).fill({ kind: 'console', level: 'warn', message: 'x'.repeat(320) }))).status).toBe(202)
  expect(limited.append('session-a', state, batch()).status).toBe(429)
  expect(JSON.stringify(limited.read('session-a', state, new URLSearchParams({ limit: '50' })).body).length).toBeLessThan(15000)
})

it('supports bounded time windows and sequence cursors without silently reusing a previous Runtime', () => {
  let time = Date.now()
  const store = createPreviewDiagnostics({ now: () => time })
  store.append('session-a', state, batch())
  const first = store.read('session-a', state, new URLSearchParams()).body
  time += 2000
  store.append('session-a', state, batch([{ kind: 'error', level: 'error', name: 'fixture-error' }]))
  const cursor = new URLSearchParams({ afterSequence: String(first.lastSequence), instanceId: first.instanceId })
  expect(store.read('session-a', state, cursor).body.events).toHaveLength(1)
  expect(store.read('session-a', state, new URLSearchParams({ afterSequence: '0', instanceId: first.instanceId })).body.events).toHaveLength(2)
  expect(store.read('session-a', state, new URLSearchParams({ afterSequence: '0' })).status).toBe(409)
  expect(store.read('session-a', state, new URLSearchParams({ windowMs: '1000' })).body.events).toHaveLength(1)
  expect(createPreviewDiagnostics().read('session-a', state, cursor).body.code).toBe('E_DIAGNOSTICS_RESET')
})
