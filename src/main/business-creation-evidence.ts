const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

interface CreationSnapshot { sourceDigestSha256: string; indexStampSha256: string; sourceFilesSha256: string; apis: Record<string, string> }

function snapshot(analysis: Record<string, unknown>, apiUrls: string[]): CreationSnapshot | undefined {
  const value = record(analysis.creationSnapshot)
  const apis = record(value?.apis)
  if (value?.version !== 1 || !hash(value.sourceDigestSha256) || !hash(value.indexStampSha256) || !hash(value.sourceFilesSha256) || !apis) return undefined
  const selected: Record<string, string> = {}
  for (const api of apiUrls) {
    const digest = apis[api]
    if (!Object.hasOwn(apis, api) || !hash(digest)) return undefined
    selected[api] = digest
  }
  return { sourceDigestSha256: value.sourceDigestSha256, indexStampSha256: value.indexStampSha256,
    sourceFilesSha256: value.sourceFilesSha256, apis: selected }
}

export function assertCreationEvidenceRefreshable(analysis: Record<string, unknown>, apiUrls: string[]): CreationSnapshot {
  const value = snapshot(analysis, apiUrls)
  if (!value) throw Object.assign(new Error(
    'Analysis evidence expired or was lost. This run has no complete source fingerprints for safe recovery. Re-analyze the saved route and resubmit the saved plan for confirmation; do not retry creation with the old evidence ID.'
  ), { code: 'WORKFLOW_ANALYSIS_REFRESH_REQUIRED', retryable: false })
  return value
}

export function assertCreationEvidenceUnchanged(previous: Record<string, unknown>, current: Record<string, unknown>, apiUrls: string[]): void {
  const before = assertCreationEvidenceRefreshable(previous, apiUrls)
  const after = snapshot(current, apiUrls)
  if (!after || before.sourceDigestSha256 !== after.sourceDigestSha256 || before.indexStampSha256 !== after.indexStampSha256
    || before.sourceFilesSha256 !== after.sourceFilesSha256
    || apiUrls.some(api => before.apis[api] !== after.apis[api])) {
    throw Object.assign(new Error('The source/index or Mock configuration changed since this plan was reviewed. Re-review and confirm the saved plan against the current source before creating a Profile.'),
      { code: 'WORKFLOW_ANALYSIS_CHANGED', retryable: false })
  }
}

export function isStaleCreationEvidence(error: unknown): boolean {
  const value = record(error)
  return value?.code === 'E_ANALYSIS_EVIDENCE_STALE'
    || value?.code === undefined && value?.message === 'A current business_analyze_target evidenceId is required before creating a Profile'
}
