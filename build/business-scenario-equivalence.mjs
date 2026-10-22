import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

/**
 * Group already-ranked candidates, never their stored Mock definitions. Only
 * same-API configs equal apart from top-level identity/display metadata qualify.
 * JSON ordering is retained, and a hash hit is also checked with deep equality.
 * Unknown/oversized configs stay separate (fail closed), rather than guessing.
 * @template {{apiUrl: string, scenarioId: string}} T
 * @param {T[]} matches Ranked, untruncated candidates.
 * @param {(match: T) => unknown} lookup Current, unambiguous raw Scenario config.
 * @param {{enabled?: boolean, maxConfigBytes?: number, maxTotalBytes?: number}} [options]
 */
export function groupEquivalentScenarioMatches(matches, lookup, options = {}) {
  const enabled = options.enabled !== false
  const maxConfigBytes = options.maxConfigBytes ?? 1024 * 1024
  const maxTotalBytes = options.maxTotalBytes ?? 16 * 1024 * 1024
  const buckets = new Map()
  const groups = []
  let comparedBytes = 0
  let ungroupableCount = 0
  for (const match of matches) {
    let config
    let key
    if (enabled) {
      const value = lookup(match)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Strip metadata only at the Scenario root, never data.id/data.label.
        const { id, label, ...runtimeConfig } = value
        try {
          const serialized = JSON.stringify(runtimeConfig, function (key, item) {
            const original = this[key]
            if (original && typeof original === 'object' && !Array.isArray(original)) {
              const prototype = Object.getPrototypeOf(original)
              if (prototype !== Object.prototype && prototype !== null) throw new Error('Not a plain JSON object')
              if (typeof original.toJSON === 'function') throw new Error('Not a static JSON config')
            }
            if (item === undefined || ['function', 'symbol', 'bigint'].includes(typeof item)
              || (typeof item === 'number' && !Number.isFinite(item))) throw new Error('Not a JSON config')
            return item
          })
          const bytes = Buffer.byteLength(serialized)
          if (bytes <= maxConfigBytes && comparedBytes + bytes <= maxTotalBytes) {
            comparedBytes += bytes
            config = runtimeConfig
            key = JSON.stringify([match.apiUrl, createHash('sha256').update(serialized).digest('hex')])
          }
        } catch { /* Unsupported JSON cannot prove equivalence; keep a distinct candidate. */ }
      }
      if (key === undefined) ungroupableCount++
    }
    const bucket = key === undefined ? [] : buckets.get(key) || []
    const equivalent = bucket.find(group => isDeepStrictEqual(group.config, config))
    if (equivalent) equivalent.members.push(match)
    else {
      const group = { representative: match, members: [match], config }
      groups.push(group)
      if (key !== undefined) {
        bucket.push(group)
        buckets.set(key, bucket)
      }
    }
  }
  const duplicates = groups.filter(group => group.members.length > 1)
  return {
    representatives: groups.map(group => group.representative),
    summary: {
      enabled, strategy: 'exact-same-api-scenario-config',
      ignoredMetadata: ['id', 'label'],
      candidateCount: matches.length, groupCount: groups.length,
      equivalentCandidateCount: matches.length - groups.length,
      ungroupableCount, comparedBytes, maxConfigBytes, maxTotalBytes,
      groupDetailsTruncated: duplicates.length > 12 || duplicates.some(group => group.members.length > 12),
      groups: duplicates.slice(0, 12).map(group => ({ apiUrl: group.representative.apiUrl,
        representativeScenarioId: group.representative.scenarioId, memberCount: group.members.length,
        scenarioIds: group.members.slice(0, 12).map(match => match.scenarioId) })),
      note: 'Exact config equality only reduces duplicate ambiguity; original candidates, semantic source checks, user confirmation and final preview verification remain required.'
    }
  }
}
