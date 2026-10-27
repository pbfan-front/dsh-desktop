export const BUSINESS_CONTROL_ERROR: Readonly<{
  targetRouteAmbiguous: 'E_TARGET_ROUTE_AMBIGUOUS'
  analysisEvidenceStale: 'E_ANALYSIS_EVIDENCE_STALE'
  analysisSourceChanged: 'E_ANALYSIS_SOURCE_CHANGED'
  previewVerificationFailed: 'E_PREVIEW_VERIFICATION_FAILED'
  semanticValueUnverified: 'WORKFLOW_SEMANTIC_VALUE_UNVERIFIED'
  semanticSourceChanged: 'WORKFLOW_SEMANTIC_SOURCE_CHANGED'
  intentAmbiguous: 'WORKFLOW_INTENT_AMBIGUOUS'
  intentChanged: 'WORKFLOW_INTENT_CHANGED'
}>
export interface SemanticIntentRule {
  id: string
  routePath: string
  intentEquals: string
  intentMatch?: 'exact' | 'leading-clause'
}
export type SemanticIntentResolution =
  | { status: 'unmatched'; ruleIds: string[] }
  | { status: 'ambiguous'; ruleIds: string[]; candidates: string[] }
  | { status: 'matched'; canonicalIntent: string; source: 'exact-query' | 'declared-leading-clause'; ruleIds: string[] }
export function resolveSemanticIntent(rules: readonly SemanticIntentRule[], routePath: unknown, query: unknown): SemanticIntentResolution
export function validSemanticExpectations(rules: unknown, routePath: unknown, query: unknown): boolean
export function validSemanticSourceRequest(input: unknown): boolean
export function profileCreationRequestError(input: unknown): string | null
