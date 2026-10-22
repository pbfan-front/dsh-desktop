export interface BusinessExperienceCorpusReport {
  completedRunOutcomes: { passed: number; failed: number; notVerified: number }
  controlledRunOutcomes: { passed: number; failed: number; notVerified: number }
}

export function summarizeBusinessExperienceCorpus(
  cases: unknown[], runs?: unknown[], selections?: unknown[]
): BusinessExperienceCorpusReport
