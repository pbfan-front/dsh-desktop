export interface BusinessExperienceEvaluation {
  outcome: 'passed' | 'failed' | 'not_verified'
  checks: Record<string, { status: 'passed' | 'failed' | 'not_measured' }>
}

export function evaluateBusinessExperience(
  run: unknown, scenario: unknown, previewEvidence?: unknown
): BusinessExperienceEvaluation
