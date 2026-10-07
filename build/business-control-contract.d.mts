export const BUSINESS_CONTROL_ERROR: Readonly<{
  targetRouteAmbiguous: 'E_TARGET_ROUTE_AMBIGUOUS'
  semanticValueUnverified: 'WORKFLOW_SEMANTIC_VALUE_UNVERIFIED'
  semanticSourceChanged: 'WORKFLOW_SEMANTIC_SOURCE_CHANGED'
}>
export function validSemanticExpectations(rules: unknown, routePath: unknown, query: unknown): boolean
export function validSemanticSourceRequest(input: unknown): boolean
export function profileCreationRequestError(input: unknown): string | null
