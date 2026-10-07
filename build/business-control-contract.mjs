// Shared by Electron Main and the packaged business Runtime. Keep this module free of process state.
export const BUSINESS_CONTROL_ERROR = Object.freeze({
  targetRouteAmbiguous: 'E_TARGET_ROUTE_AMBIGUOUS',
  semanticValueUnverified: 'WORKFLOW_SEMANTIC_VALUE_UNVERIFIED',
  semanticSourceChanged: 'WORKFLOW_SEMANTIC_SOURCE_CHANGED'
})

const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const safeText = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const safeRoute = value => typeof value === 'string' && /^\/[a-zA-Z0-9_./-]*$/.test(value) && !value.includes('..') && !value.startsWith('//')

export const validSemanticExpectations = (rules, routePath, query) => Array.isArray(rules) && rules.length <= 16 && rules.every(rule =>
  plainObject(rule) && safeText(rule.id, 128) && rule.routePath === routePath && rule.intentEquals === query
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

export const validSemanticSourceRequest = input => plainObject(input)
  && safeRoute(input.routePath)
  && validSemanticExpectations(input.semanticExpectations, input.routePath, input.query)
  && input.semanticExpectations.length > 0
  && Array.isArray(input.scenarios) && input.scenarios.length >= 1 && input.scenarios.length <= 12
  && input.scenarios.every(item => plainObject(item) && safeRoute(item.apiUrl)
    && safeText(item.sourceScenarioId, 128))
