import { createHash } from 'node:crypto'
import { businessReviewReads } from './review-reads.js'

// Stay below Harness's 50,000-character tool clipping boundary, including
// multibyte text and wrapper metadata. Never cut serialized JSON.
export const MAX_WORKFLOW_REPLY_BYTES = 24000
const FULL_DOCUMENT_BYTES = 21000
const PAGE_CHARS = 12000
const SECTIONS = ['run', 'analysis', 'review', 'semantic', 'api', 'plan', 'reads']
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const pick = (value, keys) => Object.fromEntries(keys.filter(key => object(value) && Object.hasOwn(value, key)).map(key => [key, value[key]]))
const limited = (values, limit) => Array.isArray(values) ? values.slice(0, limit) : values
const bytes = value => Buffer.byteLength(JSON.stringify(value))
const reference = section => ({ summaryOmitted: true, read: { detail: 'full', section } })

function compactApi(analysis, api) {
  if (!object(api)) return api
  const matches = new Set([
    ...(analysis.analysisPlan?.existingScenarioMatches || []).filter(item => item.apiUrl === api.apiUrl).map(item => item.scenarioId),
    ...(analysis.analysisPlan?.suggestedPlan?.scenarios || []).filter(item => item.apiUrl === api.apiUrl).map(item => item.sourceScenarioId),
    ...(analysis.analysisPlan?.semanticValueChecks?.approvedSources || []).filter(item => item.apiUrl === api.apiUrl).map(item => item.scenarioId)
  ].filter(Boolean))
  const scenarios = Array.isArray(api.scenarios) ? [
    ...api.scenarios.filter(item => matches.has(item.id)), ...api.scenarios.filter(item => !matches.has(item.id))
  ].slice(0, 4).map(item => ({
    ...pick(item, ['id', 'label', 'score', 'matchScore', 'impactScore', 'valuePreview', 'responseType']),
    changedFields: limited(item.changedFields, 12),
    ...(item.fieldImpact ? { fieldImpact: {
      ...pick(item.fieldImpact, ['level', 'coverage']),
      consumedFields: limited(item.fieldImpact.consumedFields, 12), unprovenFields: limited(item.fieldImpact.unprovenFields, 12),
      evidence: Array.isArray(item.fieldImpact.evidence) ? item.fieldImpact.evidence.slice(0, 4).map(evidence => ({
        ...evidence, evidence: limited(evidence.evidence, 2)
      })) : item.fieldImpact.evidence
    } } : {})
  })) : api.scenarios
  return {
    ...pick(api, ['apiUrl', 'score', 'mockPath', 'mockExists', 'canGenerate', 'label']),
    evidence: limited(api.evidence, 4), envelopeFields: limited(api.envelopeFields, 24), fields: limited(api.fields, 24), scenarios,
    scenarioSummary: { total: api.scenarios?.length || 0, returned: scenarios?.length || 0 }
  }
}

/**
 * Focus evidence once; complete source data stays in the persisted run.
 * @param {unknown} analysis
 */
export function compactBusinessAnalysis(analysis) {
  if (!object(analysis)) return analysis
  const apis = Array.isArray(analysis.apis) ? analysis.apis : []
  const priority = [...new Set([
    ...(analysis.analysisPlan?.suggestedPlan?.scenarios || []).map(item => item.apiUrl),
    ...(analysis.analysisPlan?.existingScenarioMatches || []).map(item => item.apiUrl),
    ...(analysis.analysisPlan?.focusApiUrls || [])
  ].filter(Boolean))]
  const focused = priority.map(apiUrl => apis.find(api => api?.apiUrl === apiUrl)).filter(Boolean)
  const selected = (focused.length ? focused : apis).slice(0, 6)
  return {
    ...pick(analysis, ['evidenceId', 'expiresAt', 'query', 'route', 'routeCandidates', 'acceleration', 'analysisReuse', 'analysisTimings']),
    apis: selected.map(api => compactApi(analysis, api)),
    ...(object(analysis.analysisPlan) ? { analysisPlan: { ...analysis.analysisPlan } } : {}),
    compaction: { mode: 'summary', totalApiCount: apis.length, returnedApiCount: selected.length,
      omittedApiCount: Math.max(0, apis.length - selected.length), fullEvidenceAvailable: true,
      note: 'Collections are focused, not exhaustive. Missing summary entries are not missing evidence. Values are not normalized.',
      fullEvidenceHint: 'Use business_scenario_workflow_status detail=full with section=analysis, review, semantic or api when needed.' }
  }
}

function proposalSummary(proposal) {
  if (!object(proposal)) return undefined
  return { ...pick(proposal, ['id', 'checkpointId', 'proposedAt']), approval: 'explicit-user-action-required',
    planSummary: { ...pick(proposal.output, ['profileId', 'label']), scenarioCount: proposal.output?.scenarios?.length,
      pageCheckCount: proposal.output?.verificationSteps?.length || 0 } }
}

function planSummary(plan) {
  if (!object(plan)) return plan
  return { ...pick(plan, ['profileId', 'label', 'page', 'verificationSteps']),
    scenarios: Array.isArray(plan.scenarios) ? plan.scenarios.map(item => ({
      ...pick(item, ['id', 'apiUrl', 'label', 'sourceScenarioId']),
      ...(Object.hasOwn(item, 'data') ? { data: reference('plan') } : {})
    })) : plan.scenarios }
}

function errorSummary(error) {
  if (!object(error)) return error
  return { ...pick(error, ['code', 'retryable', 'candidates']),
    ...(typeof error.message === 'string' ? { message: error.message.slice(0, 1200),
      ...(error.message.length > 1200 ? { messageOmitted: true } : {}) } : {}) }
}

function stepSummary(step, analysis) {
  const result = pick(step, ['id', 'type', 'title', 'status', 'startedAt', 'completedAt', 'evidenceIds'])
  if (step.error) result.error = errorSummary(step.error)
  if (step.id === 'analyze-target' && step.output) {
    result.outputRef = JSON.stringify(step.output) === JSON.stringify(analysis)
      ? { path: 'context.analysis', evidenceId: analysis?.evidenceId }
      : { ...reference('run'), path: `steps.${step.id}.output` }
  } else if (step.output) {
    result.output = pick(step.output, ['operationId', 'profileId', 'sessionId', 'revision', 'revisionId',
      'verified', 'status', 'failureCategory', 'requiresUserSelection', 'url', 'checks', 'pageSteps'])
    result.outputRef = { ...reference('run'), path: `steps.${step.id}.output` }
  }
  return result
}

/**
 * Model-facing projection only. Whole evidence sections may become explicit
 * references when oversized; never mutate the run, its guards or scalar values.
 * @param {unknown} run
 * @param {{proposalOnly?: boolean}} [options]
 */
export function compactBusinessWorkflowRun(run, options = {}) {
  if (object(run) && Object.hasOwn(run, 'run') && !Object.hasOwn(run, 'id')) {
    return { run: compactBusinessWorkflowRun(run.run, options) }
  }
  if (run === null) return null
  if (!object(run) || typeof run.id !== 'string' || !run.id) throw new Error('Invalid business workflow response; no raw response was returned.')
  const context = pick(run.context, options.proposalOnly ? ['sessionId', 'routePath', 'target', 'profileId', 'experienceFlowVersion']
    : ['query', 'targetPage', 'routePath', 'apiUrls', 'sessionId', 'target', 'targetSelection',
      'semanticIntentContract', 'intentResolution', 'semanticExpectations', 'profileId', 'experienceFlowVersion'])
  const result = { ...pick(run, ['id', 'workflowId', 'workflowVersion', 'pluginId', 'status', 'currentStepId', 'createdAt', 'updatedAt', 'compatibility']),
    context, ...(run.checkpointProposal ? { checkpointProposal: proposalSummary(run.checkpointProposal) } : {}) }
  if (!options.proposalOnly) {
    const reads = businessReviewReads(run)
    if (reads) result.reviewReads = reads
  }
  const omitted = []
  result.compaction = { mode: options.proposalOnly ? 'proposal-summary' : 'summary', maxReplyBytes: MAX_WORKFLOW_REPLY_BYTES,
    fullEvidenceAvailable: true, omittedSections: omitted,
    note: 'This is a projection, not approval or complete evidence. Omitted sections require explicit full review before relying on them.',
    fullEvidenceHint: 'Use business_scenario_workflow_status detail=full; select section=analysis, review, semantic, api or plan. Follow pinned pages when returned.' }
  if (!options.proposalOnly) {
    result.steps = Array.isArray(run.steps) ? run.steps.map(step => stepSummary(step, run.context?.analysis)) : []
    if (run.context?.plan) context.plan = planSummary(run.context.plan)
    if (Array.isArray(run.context?.previewVerifications)) context.previewVerifications = run.context.previewVerifications.map(item => ({
      id: item.id, result: pick(item.result, ['verified', 'sessionId', 'profileId', 'revision', 'revisionId', 'checkedAt'])
    }))
    if (run.context?.analysis) context.analysis = compactBusinessAnalysis(run.context.analysis)
  }
  const fits = () => bytes(result) <= MAX_WORKFLOW_REPLY_BYTES - 1000
  const omit = (container, key, section, path) => {
    if (!fits() && object(container) && Object.hasOwn(container, key)) {
      container[key] = reference(section)
      omitted.push(path)
    }
  }
  const analysis = context.analysis, plan = analysis?.analysisPlan
  for (const key of ['fieldImpactAnalysis', 'candidatePreparation', 'evidenceDiscoveryIndex', 'sourceReadPlan', 'scenarioRanking', 'scenarioEquivalence']) {
    omit(plan, key, 'analysis', `analysis.analysisPlan.${key}`)
  }
  if (!fits() && Array.isArray(analysis?.apis)) {
    analysis.apis = analysis.apis.map(api => ({ ...pick(api, ['apiUrl', 'score', 'mockPath', 'mockExists', 'canGenerate']), ...reference('api') }))
    omitted.push('analysis.apis.details')
  }
  for (const [key, section] of [['reviewPacket', 'review'], ['fieldImpact', 'analysis'], ['suggestedPlan', 'analysis'],
    ['leadingScenarioValuePreview', 'analysis'], ['semanticValueChecks', 'semantic']]) omit(plan, key, section, `analysis.analysisPlan.${key}`)
  omit(result, 'reviewReads', 'reads', 'reviewReads')
  for (const [key, section] of [['plan', 'plan'], ['semanticExpectations', 'semantic'], ['analysis', 'analysis']]) omit(context, key, section, `context.${key}`)
  if (omitted.length) result.compaction.requiresFullReview = true
  if (!fits()) {
    // Even invalid/exceptionally large metadata cannot leak an unbounded body.
    const minimal = { ...pick(run, ['id', 'status', 'currentStepId']),
      ...(run.checkpointProposal ? { checkpointProposal: proposalSummary(run.checkpointProposal) } : {}),
      compaction: { mode: options.proposalOnly ? 'proposal-summary' : 'summary', requiresFullReview: true,
        fullEvidenceAvailable: true, omittedSections: ['run-details'],
        fullEvidenceHint: 'Read business_scenario_workflow_status detail=full section=run. Do not infer success, route choices or approval from omitted data.' } }
    if (bytes(minimal) > MAX_WORKFLOW_REPLY_BYTES - 1000) throw new Error('Business workflow metadata exceeds the safe summary budget.')
    return minimal
  }
  return result
}

function fullReply(response, options) {
  const run = object(response) && Object.hasOwn(response, 'run') && !Object.hasOwn(response, 'id') ? response.run : response
  const section = options.section === undefined ? 'run' : options.section
  if (!SECTIONS.includes(section)) throw new Error('Unknown workflow evidence section.')
  if (options.apiUrl !== undefined && section !== 'api') throw new Error('apiUrl is only valid for section=api.')
  if (section === 'api' && (typeof options.apiUrl !== 'string' || !options.apiUrl || options.apiUrl.length > 512)) throw new Error('section=api requires an exact apiUrl.')
  if (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0)) throw new Error('Evidence offset must be a non-negative integer.')
  if (options.documentId !== undefined && (typeof options.documentId !== 'string' || !/^[a-f0-9]{64}$/.test(options.documentId))) throw new Error('Invalid evidence documentId.')
  if (options.offset > 0 && !options.documentId) throw new Error('Continuation pages require the previous documentId; do not mix snapshots.')
  if (run === null) {
    if (options.documentId) throw new Error('WORKFLOW_EVIDENCE_CHANGED: run no longer exists; discard partial pages.')
    return { run: null }
  }
  if (!object(run) || typeof run.id !== 'string' || !run.id) throw new Error('Invalid workflow evidence response.')
  if (section === 'run' && !options.offset && !options.documentId && bytes(response) <= FULL_DOCUMENT_BYTES) return response
  const analysis = run.context?.analysis
  let value = section === 'reads' ? businessReviewReads(run) : section === 'run' ? run : section === 'analysis' ? analysis : section === 'review' ? analysis?.analysisPlan?.reviewPacket
    : section === 'plan' ? run.checkpointProposal?.output || run.context?.plan
      : section === 'semantic' ? { intentResolution: run.context?.intentResolution, semanticExpectations: run.context?.semanticExpectations,
        semanticValueChecks: analysis?.analysisPlan?.semanticValueChecks } : undefined
  if (section === 'api') {
    value = analysis?.apis?.find(api => api.apiUrl === options.apiUrl)
  }
  if (value === undefined) {
    if (options.documentId) throw new Error('WORKFLOW_EVIDENCE_CHANGED: section no longer exists; discard partial pages.')
    return { id: run.id, evidence: { section, available: false } }
  }
  const text = JSON.stringify(value)
  const documentId = createHash('sha256').update([run.id || '', section, options.apiUrl || '', text].join('\0')).digest('hex')
  if (options.documentId && options.documentId !== documentId) throw new Error('WORKFLOW_EVIDENCE_CHANGED: restart this section at offset 0 without documentId; never combine different snapshots.')
  if (section !== 'run' && !options.offset && !options.documentId && Buffer.byteLength(text) <= FULL_DOCUMENT_BYTES) {
    return { id: run.id, evidence: { section, available: true, complete: true, documentId, value } }
  }
  const offset = options.offset || 0
  if (offset >= text.length) throw new Error('Evidence offset is outside the current document.')
  const page = length => {
    const content = text.slice(offset, offset + length)
    const end = offset + content.length
    return { id: run.id,
      ...(section === 'api' ? { focusedReadHint: { tool: 'business_scenario_workflow_status',
        args: { runId: run.id, detail: 'full', section: 'reads' },
        note: 'This is only a partial API document. For exact candidate values use its evidence-backed focused reads; do not infer field absence from this page.' } } : {}),
      evidencePage: { section, ...(section === 'api' ? { apiUrl: options.apiUrl } : {}), format: 'json-text',
      documentId, offset, nextOffset: end < text.length ? end : null, totalChars: text.length,
      complete: offset === 0 && end === text.length, content,
      note: 'Partial document text is not evidence of missing fields. Collect all pages with the same documentId before parsing; restart if the document changes.' } }
  }
  // Use larger pages when safe, but budget the serialized outer JSON too:
  // multibyte text and escaped control characters can exceed the byte cap.
  let length = PAGE_CHARS, result = page(length)
  while (bytes(result) > MAX_WORKFLOW_REPLY_BYTES && length > 1) {
    length = Math.floor(length / 2)
    result = page(length)
  }
  return result
}

/**
 * Serialize model replies as complete JSON under a fixed byte budget. Full
 * documents remain lossless; large ones are read in version-pinned text pages.
 * @param {unknown} response
 * @param {{detail?: string, section?: string, apiUrl?: string, offset?: number, documentId?: string, proposalOnly?: boolean}} [options]
 * @returns {string}
 */
export function serializeBusinessWorkflowReply(response, options = {}) {
  if (options.detail !== undefined && !['summary', 'full'].includes(options.detail)) throw new Error('detail must be summary or full.')
  if (options.detail !== 'full' && ['section', 'apiUrl', 'offset', 'documentId'].some(key => options[key] !== undefined)) {
    throw new Error('Evidence selectors require detail=full.')
  }
  const value = options.detail === 'full' ? fullReply(response, options) : compactBusinessWorkflowRun(response, options)
  const text = JSON.stringify(value)
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_WORKFLOW_REPLY_BYTES) throw new Error('Workflow reply exceeds the safe JSON budget; request a focused evidence section.')
  return text
}
