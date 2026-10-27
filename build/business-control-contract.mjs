// Shared by Electron Main and the packaged business Runtime. Keep this module free of process state.
export const BUSINESS_CONTROL_ERROR = Object.freeze({
  targetRouteAmbiguous: 'E_TARGET_ROUTE_AMBIGUOUS',
  analysisEvidenceStale: 'E_ANALYSIS_EVIDENCE_STALE',
  analysisSourceChanged: 'E_ANALYSIS_SOURCE_CHANGED',
  previewVerificationFailed: 'E_PREVIEW_VERIFICATION_FAILED',
  semanticValueUnverified: 'WORKFLOW_SEMANTIC_VALUE_UNVERIFIED',
  semanticSourceChanged: 'WORKFLOW_SEMANTIC_SOURCE_CHANGED',
  intentAmbiguous: 'WORKFLOW_INTENT_AMBIGUOUS',
  intentChanged: 'WORKFLOW_INTENT_CHANGED'
})

const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const safeText = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const safeRoute = value => typeof value === 'string' && /^\/[a-zA-Z0-9_./-]*$/.test(value) && !value.includes('..') && !value.startsWith('//')
const safeProfileId = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/.test(value)
const intentSeparators = /[：:，,。；;\r\n]/u
const validIntentMatch = rule => rule.intentMatch === undefined || rule.intentMatch === 'exact'
  || (rule.intentMatch === 'leading-clause' && !intentSeparators.test(rule.intentEquals))

// This recognizes an explicitly declared leading clause, not general language,
// aliases, negation or a substring anywhere in the request. Keep the full query.
export function resolveSemanticIntent(rules, routePath, query) {
  const unmatched = { status: 'unmatched', ruleIds: [] }
  if (!Array.isArray(rules) || !safeText(query, 1000)) return unmatched
  const scoped = rules.filter(rule => plainObject(rule) && rule.routePath === routePath
    && safeText(rule.id, 128) && safeText(rule.intentEquals, 1000) && validIntentMatch(rule))
  const clauses = query.split(intentSeparators).map(clause => clause.trim()).filter(Boolean)
  // Do not shift past an empty leading clause or an introductory label.
  const leading = query.split(intentSeparators, 1)[0].trim()
  const matched = scoped.filter(rule => rule.intentEquals === query
    || (rule.intentMatch === 'leading-clause' && leading === rule.intentEquals))
  if (!matched.length) return unmatched
  const intents = new Set(matched.map(rule => rule.intentEquals))
  if (matched.some(rule => rule.intentMatch === 'leading-clause')) {
    for (const rule of scoped) if (clauses.includes(rule.intentEquals)) intents.add(rule.intentEquals)
  }
  if (intents.size !== 1) return { status: 'ambiguous', ruleIds: [], candidates: [...intents] }
  return { status: 'matched', canonicalIntent: matched[0].intentEquals,
    source: matched.every(rule => rule.intentEquals === query) ? 'exact-query' : 'declared-leading-clause',
    ruleIds: matched.map(rule => rule.id) }
}

export const validSemanticExpectations = (rules, routePath, query) => Array.isArray(rules) && rules.length <= 16 && rules.every(rule =>
  plainObject(rule) && safeText(rule.id, 128) && rule.routePath === routePath && safeText(rule.intentEquals, 1000) && validIntentMatch(rule)
  && safeRoute(rule.apiUrl) && Array.isArray(rule.fieldAssertions) && rule.fieldAssertions.length <= 16
  && rule.fieldAssertions.every(assertion => plainObject(assertion) && Array.isArray(assertion.path)
    && assertion.path.length >= 1 && assertion.path.length <= 12
    && assertion.path.every(part => typeof part === 'number'
      ? Number.isSafeInteger(part) && part >= 0 && part <= 1000
      : typeof part === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(part)
        && !['__proto__', 'constructor', 'prototype'].includes(part))
    && (assertion.equals === null || ['string', 'number', 'boolean'].includes(typeof assertion.equals)))
  && Array.isArray(rule.sourceScenarioIds) && rule.sourceScenarioIds.length <= 32
  && rule.sourceScenarioIds.every(id => safeText(id, 128)))
  && (rules.length === 0 || resolveSemanticIntent(rules, routePath, query).ruleIds.length === rules.length)

export const validSemanticSourceRequest = input => plainObject(input)
  && safeRoute(input.routePath)
  && validSemanticExpectations(input.semanticExpectations, input.routePath, input.query)
  && input.semanticExpectations.length > 0
  && Array.isArray(input.scenarios) && input.scenarios.length >= 1 && input.scenarios.length <= 12
  && input.scenarios.every(item => plainObject(item) && safeRoute(item.apiUrl)
    && safeText(item.sourceScenarioId, 128))

export const profileCreationRequestError = input => {
  if (!plainObject(input) || !plainObject(input.profile) || !safeProfileId(input.profile.id)) return 'Invalid profile id'
  if (!safeText(input.profile.label) || !safeText(input.profile.page, 64) || !safeRoute(input.profile.routePath)) {
    return 'profile requires a non-empty label, page and safe absolute routePath'
  }
  if (!Array.isArray(input.scenarios) || input.scenarios.length < 1 || input.scenarios.length > 12) {
    return 'scenarios must contain 1-12 items'
  }
  if (!validSemanticExpectations(input.semanticExpectations ?? [], input.profile.routePath, input.query)) {
    return 'Invalid semantic expectations for Profile creation'
  }
  return null
}
