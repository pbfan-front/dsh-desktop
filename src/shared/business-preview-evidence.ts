/** Read-only wake-up metadata; it is never page proof or permission to create/apply. */
export interface BusinessPreviewEvidence {
  sessionId: string
  profileId: string | null
  revision: number
  revisionId: string
  route: string
  observedAt: string
  fingerprint: string
}

export function parseBusinessPreviewEvidence(value: unknown): BusinessPreviewEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const bounded = (input: unknown, max: number): input is string => typeof input === 'string'
    && input.length > 0 && input.length <= max && !/[\u0000-\u001f]/u.test(input)
  if (!bounded(item.sessionId, 200) || !(item.profileId === null || bounded(item.profileId, 128))
    || !Number.isSafeInteger(item.revision) || Number(item.revision) < 0 || !bounded(item.revisionId, 200)
    || !bounded(item.route, 500) || !bounded(item.observedAt, 80) || !Number.isFinite(Date.parse(item.observedAt))
    || typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint)) return null
  return { sessionId: item.sessionId, profileId: item.profileId, revision: Number(item.revision),
    revisionId: item.revisionId, route: item.route, observedAt: item.observedAt, fingerprint: item.fingerprint }
}
