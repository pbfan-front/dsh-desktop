export interface ScenarioMatch {
  apiUrl: string
  scenarioId: string
}
export interface ScenarioEquivalenceSummary {
  enabled: boolean
  strategy: string
  ignoredMetadata: string[]
  candidateCount: number
  groupCount: number
  equivalentCandidateCount: number
  ungroupableCount: number
  comparedBytes: number
  maxConfigBytes: number
  maxTotalBytes: number
  groupDetailsTruncated: boolean
  groups: Array<{ apiUrl: string; representativeScenarioId: string; memberCount: number; scenarioIds: string[] }>
  note: string
}
export function groupEquivalentScenarioMatches<T extends ScenarioMatch>(matches: T[], lookup: (match: T) => unknown,
  options?: { enabled?: boolean; maxConfigBytes?: number; maxTotalBytes?: number }): {
    representatives: T[]
    summary: ScenarioEquivalenceSummary
  }
