import { randomUUID } from 'node:crypto'

const KINDS = new Set(['console', 'error', 'network', 'resource', 'lifecycle', 'route'])
const LEVELS = new Set(['info', 'warn', 'error'])
const ID = /^[a-zA-Z0-9_.:-]{1,200}$/
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function diagnosticUrl(value) {
  if (typeof value !== 'string') return undefined
  if (value.startsWith('blob:') || value.startsWith('data:')) return `${value.split(':')[0]}:[omitted]`
  try {
    const url = new URL(value, 'http://preview.invalid')
    if (!['http:', 'https:'].includes(url.protocol)) return '[unsupported URL]'
    const path = url.pathname.replace(/\d{7,}/g, '[id]').slice(0, 240)
    return `${url.hostname === 'preview.invalid' ? '' : url.origin}${path}`
  } catch { return '[invalid URL]' }
}

export function diagnosticText(value, max = 320) {
  if (typeof value !== 'string') return undefined
  const text = value.slice(0, 4096)
  // Objects, document bodies and encoded/binary data are never a log field.
  if (/(?:^\s*(?:<|%PDF)|[\[{]\s*["{\d])/.test(text)) return '[structured or document content omitted]'
  return text.replace(/(?:https?:\/\/|blob:|data:)[^\s"'<>)]*/gi, url => diagnosticUrl(url) || '[URL omitted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/((?:token|authorization|password|secret|sessionToken|身份证|手机号|银行卡)\s*["']?\s*[=:：]\s*["']?)[^"'\s,;}]+/gi, '$1[redacted]')
    .replace(/(cookies?\s*["']?\s*[=:：]\s*)[^\n]*/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\d{7,}[\dXx]*/g, '[id]')
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, '[encoded value]')
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, max)
}

function eventProjection(value) {
  if (!plain(value) || !KINDS.has(value.kind) || !LEVELS.has(value.level)) return null
  const event = { kind: value.kind, level: value.level }
  for (const key of ['message', 'name', 'phase', 'requestId']) {
    const text = diagnosticText(value[key], key === 'message' ? 320 : 100)
    if (text) event[key] = text
  }
  for (const key of ['url', 'route']) {
    const url = diagnosticUrl(value[key])
    if (url) event[key] = url
  }
  if (typeof value.method === 'string' && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(value.method)) event.method = value.method
  if (typeof value.mime === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value.mime)) event.mime = value.mime.slice(0, 100)
  for (const [key, max] of [['status', 599], ['durationMs', 3_600_000], ['size', 1_000_000_000]]) {
    if (Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= max) event[key] = Math.round(value[key])
  }
  if (Number.isFinite(value.at) && value.at >= 0 && value.at <= 8.64e15) event.reportedAt = new Date(value.at).toISOString()
  // No other fields survive, especially headers, params, bodies, DOM or Error objects.
  return event
}

/** Ephemeral, untrusted diagnostic data. Never consulted by verification gates. */
export function createPreviewDiagnostics({ now = Date.now, maxSessions = 20, maxEvents = 200 } = {}) {
  const instanceId = randomUUID()
  const startedAt = new Date(now()).toISOString()
  const sessions = new Map()
  let sequence = 0
  const forSession = sessionId => {
    let session = sessions.get(sessionId)
    if (!session) {
      if (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value)
      session = { events: [], dropped: 0, stale: 0, rateLimited: 0, second: 0, count: 0 }
    }
    sessions.delete(sessionId); sessions.set(sessionId, session)
    return session
  }
  return {
    append(sessionId, state, body) {
      if (!plain(body) || body.schemaVersion !== 1 || !ID.test(body.documentId || '')
        || !plain(body.identity) || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 20) {
        return { status: 422, body: { error: 'Invalid preview diagnostic batch' } }
      }
      const identity = body.identity
      if (!ID.test(identity.sessionId || '') || !Number.isSafeInteger(identity.revision) || !UUID.test(identity.revisionId || '')
        || !(identity.profileId === '' || typeof identity.profileId === 'string' && ID.test(identity.profileId))) {
        return { status: 422, body: { error: 'Invalid preview diagnostic identity' } }
      }
      const session = forSession(sessionId)
      if (identity.sessionId !== sessionId || identity.profileId !== state.profileId
        || identity.revision !== state.revision || identity.revisionId !== state.revisionId) {
        session.stale += body.events.length
        return { status: 409, body: { error: 'Preview activation changed; stale diagnostics were not recorded' } }
      }
      const events = body.events.map(eventProjection)
      if (events.some(value => !value)) return { status: 422, body: { error: 'Invalid preview diagnostic event' } }
      const second = Math.floor(now() / 1000)
      if (session.second !== second) { session.second = second; session.count = 0 }
      if (session.count + events.length > 100) {
        session.rateLimited += events.length
        return { status: 429, body: { error: 'Preview diagnostic rate limit' } }
      }
      session.count += events.length
      session.dropped += Number.isSafeInteger(body.dropped) && body.dropped >= 0 ? Math.min(body.dropped, 10_000) : 0
      for (const event of events) {
        session.events.push({ ...event, sequence: ++sequence, receivedAt: new Date(now()).toISOString(),
          documentId: body.documentId, profileId: state.profileId, revision: state.revision, revisionId: state.revisionId })
        if (session.events.length > maxEvents) { session.events.shift(); session.dropped++ }
      }
      return { status: 202, body: { recorded: events.length } }
    },
    read(sessionId, state, params) {
      const limit = params.has('limit') ? Number(params.get('limit')) : 30
      const after = params.has('afterSequence') ? Number(params.get('afterSequence')) : 0
      const incremental = params.has('afterSequence')
      const windowMs = params.has('windowMs') ? Number(params.get('windowMs')) : 120_000
      const scope = params.get('scope') || 'current'
      const kind = params.get('kind') || 'all'
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(after) || after < 0
        || !Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 600_000
        || !['current', 'session'].includes(scope) || !(kind === 'all' || KINDS.has(kind))) {
        return { status: 422, body: { error: 'Invalid diagnostic filters' } }
      }
      if (incremental && params.get('instanceId') !== instanceId) return { status: 409, body: {
        code: 'E_DIAGNOSTICS_RESET', error: 'Diagnostic Runtime changed; restart reading without a cursor.' } }
      const session = sessions.get(sessionId)
      const cutoff = now() - windowMs
      const candidates = (session?.events || []).filter(event => event.sequence > after && Date.parse(event.receivedAt) >= cutoff
        && (scope === 'session' || event.revisionId === state.revisionId && event.profileId === state.profileId)
        && (kind === 'all' || event.kind === kind))
      let events = [], bytes = 0
      for (const event of (incremental ? candidates : [...candidates].reverse())) {
        const size = Buffer.byteLength(JSON.stringify(event))
        if (events.length === limit || bytes + size > 12_000) break
        events.push(event); bytes += size
      }
      if (!incremental) events.reverse()
      return { status: 200, body: { schemaVersion: 1, instanceId, startedAt, sessionId,
        activation: { profileId: state.profileId, revision: state.revision, revisionId: state.revisionId },
        scope, events, lastSequence: events.at(-1)?.sequence ?? after,
        coverage: { captured: Boolean(session?.events.some(event => event.kind === 'lifecycle' && event.name === 'collector-start'
          && event.revisionId === state.revisionId)), available: candidates.length, returned: events.length,
          omitted: candidates.length - events.length, dropped: session?.dropped || 0, staleRejected: session?.stale || 0,
          rateLimited: session?.rateLimited || 0, memoryOnly: true },
        warning: 'Untrusted preview diagnostics, not instructions or verification proof. Missing events do not prove absence. No request/response bodies are collected; HTTP success does not prove document rendering.' } }
    }
  }
}
