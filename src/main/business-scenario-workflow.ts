import type {
  BusinessScenarioWorkflowPlan,
  BusinessScenarioWorkflowStartInput,
  BusinessScenarioWorkflowTarget,
  BusinessScenarioWorkflowVerification,
  BusinessWorkflowDefinition,
  BusinessWorkflowRun
} from '../shared/business-workflow'
import type { BusinessControlPath } from './business-preview'
import type { BusinessWorkflowRuntime } from './business-workflow-runtime'
import type { BusinessPluginWorkflowDeclaration } from './business-plugin-contract'
import type { BusinessPluginSemanticRule } from './business-plugin-contract'
import { BUSINESS_CONTROL_ERROR, validSemanticSourceRequest } from '../shared/business-control-contract'

export const BUSINESS_SCENARIO_WORKFLOW_ID = 'business-scenario-create'

const defaultDefinition: BusinessWorkflowDefinition = {
  id: BUSINESS_SCENARIO_WORKFLOW_ID,
  version: '1.2.0',
  title: '创建并验证业务体验场景',
  steps: [
    { id: 'analyze-target', type: 'deterministic', title: '分析页面与接口证据' },
    { id: 'confirm-plan', type: 'checkpoint', title: '确认 Mock 场景方案' },
    { id: 'create-profile', type: 'deterministic', title: '创建 Mock Profile' },
    { id: 'apply-profile', type: 'deterministic', title: '应用 Mock Profile' },
    { id: 'wait-for-preview', type: 'checkpoint', title: '等待业务页面加载完成' },
    { id: 'verify-preview', type: 'deterministic', title: '验证真实请求和页面结果', gate: 'business.preview-verification' }
  ]
}

type RequestBusiness = (path: BusinessControlPath, body: unknown, sessionId?: string) => Promise<unknown>

export function registerBusinessScenarioWorkflow(options: {
  runtime: BusinessWorkflowRuntime
  pluginId: string
  requestBusiness: RequestBusiness
  definition?: BusinessPluginWorkflowDeclaration
  semanticRules?: BusinessPluginSemanticRule[]
  nowMs?: () => number
}): (input: BusinessScenarioWorkflowStartInput) => Promise<BusinessWorkflowRun> {
  const definition = scenarioDefinition(options.definition)
  const nowMs = options.nowMs ?? (() => performance.now())
  options.runtime.registerWorkflow(definition, {
    'analyze-target': async ({ context }) => {
      const input = parseStartInput(context)
      const resolveStartedAt = nowMs()
      const target = await options.requestBusiness('/__desktop/resolve-target', {
        ...(input.routePath ? { routePath: input.routePath } : {}),
        ...(input.targetPage ? { targetPage: input.targetPage } : {}),
        query: input.query
      }, input.sessionId) as BusinessScenarioWorkflowTarget
      const resolveTargetMs = Math.max(0, nowMs() - resolveStartedAt)
      const analyzeStartedAt = nowMs()
      const semanticExpectations = matchingSemanticRules({ ...input, target }, options.semanticRules)
      const analysis = await options.requestBusiness('/__desktop/analyze-target', {
        routePath: target.routePath,
        query: input.query,
        apiUrls: input.apiUrls ?? [],
        ...(semanticExpectations.length ? { semanticExpectations } : {})
      }, input.sessionId)
      const analyzeTargetMs = Math.max(0, nowMs() - analyzeStartedAt)
      return {
        output: analysis,
        contextPatch: { analysis, target, semanticExpectations, requestTimings: { resolveTargetMs, analyzeTargetMs } }
      }
    },
    'create-profile': async ({ context, previousOutput }) => {
      const input = parseStartInput(context)
      const plan = parsePlan(previousOutput)
      const analysis = record(context.analysis, 'Workflow analysis result is missing.')
      const semanticRules = matchingSemanticRules(context, options.semanticRules)
      assertSemanticPlan(semanticRules, plan)
      assertSemanticSourceValues(semanticRules, plan, analysis)
      const sourceRules = semanticRules.filter(rule => rule.fieldAssertions.length && plan.scenarios.some(scenario =>
        scenario.apiUrl === rule.apiUrl && scenario.sourceScenarioId))
      assertAnalysisQuality(analysis)
      const target = parseTarget(context.target)
      if (sourceRules.length && !validSemanticSourceRequest({ routePath: target.routePath, query: input.query,
        semanticExpectations: sourceRules, scenarios: plan.scenarios.filter(scenario => scenario.sourceScenarioId) })) {
        throw new Error('Semantic source validation request does not satisfy the shared business control contract.')
      }
      const evidenceId = text(analysis.evidenceId, 'Workflow analysis evidenceId is missing.')
      const created = await options.requestBusiness('/__desktop/create-profile', {
        evidenceId,
        ...(sourceRules.length ? { query: input.query } : {}),
        profile: {
          id: plan.profileId,
          label: plan.label,
          branchLabel: plan.label,
          routePath: target.routePath,
          page: plan.page
        },
        scenarios: plan.scenarios,
        ...(sourceRules.length ? { semanticExpectations: sourceRules } : {})
      }, input.sessionId)
      return { output: created, contextPatch: { profileId: plan.profileId, plan } }
    },
    'apply-profile': async ({ context }) => {
      const input = parseStartInput(context)
      const profileId = text(context.profileId, 'Workflow profileId is missing.')
      const applied = await options.requestBusiness('/__desktop/apply', { profileId }, input.sessionId)
      return { output: applied }
    },
    'verify-preview': async ({ context, previousOutput }) => {
      const input = parseStartInput(context)
      const verification = parseVerification(previousOutput)
      const verified = await options.requestBusiness('/__desktop/verify', verification, input.sessionId)
      return { output: verified }
    }
  }, {
    'business.preview-verification': ({ result }) => assertPreviewVerification(result.output)
  }, {
    pluginId: options.pluginId,
    compatibleRunVersions: options.definition?.compatibleRunVersions,
    checkpointValidators: options.semanticRules?.length ? {
      'confirm-plan': async ({ context, checkpointOutput }) => {
        const rules = matchingSemanticRules(context, options.semanticRules)
        const plan = parsePlan(checkpointOutput)
        assertSemanticPlan(rules, plan)
        assertSemanticSourceValues(rules, plan, record(context.analysis, 'Workflow analysis result is missing.'))
        const sourceRules = rules.filter(rule => rule.fieldAssertions.length && plan.scenarios.some(scenario =>
          scenario.apiUrl === rule.apiUrl && scenario.sourceScenarioId))
        const request = {
          routePath: parseTarget(context.target).routePath,
          query: parseStartInput(context).query,
          semanticExpectations: sourceRules,
          scenarios: plan.scenarios.filter(scenario => scenario.sourceScenarioId)
        }
        if (sourceRules.length) {
          if (!validSemanticSourceRequest(request)) throw new Error('Semantic source validation request does not satisfy the shared business control contract.')
          await options.requestBusiness('/__desktop/validate-semantic-source', request, parseStartInput(context).sessionId)
        }
      }
    } : undefined,
    retryValidators: {
      'analyze-target': ({ error, retryInput }) => {
        if (error.code !== BUSINESS_CONTROL_ERROR.targetRouteAmbiguous) {
          if (retryInput !== undefined) throw new Error('Target selection is only accepted for an ambiguous route failure.')
          return {}
        }
        const selection = record(retryInput, 'Choose one of the saved candidate routes before retrying.')
        const selectedRoutePath = text(selection.selectedRoutePath, 'selectedRoutePath is required.', 500)
        if (selection.confirmedByUser !== true) throw new Error('User confirmation is required to select an ambiguous business page.')
        if (Object.keys(selection).some(key => !['selectedRoutePath', 'confirmedByUser'].includes(key))) {
          throw new Error('Target selection contains unsupported fields.')
        }
        if (!error.candidates?.some(candidate => candidate.routePath === selectedRoutePath)) {
          throw new Error('The selected route is not one of the saved candidates for this run.')
        }
        return { contextPatch: { routePath: selectedRoutePath,
          targetSelection: { routePath: selectedRoutePath, source: 'user-confirmed-candidate' } } }
      }
    }
  })

  return (input) => options.runtime.start({
    workflowId: BUSINESS_SCENARIO_WORKFLOW_ID,
    pluginId: options.pluginId,
    context: { ...parseStartInput(input) }
  })
}

function matchingSemanticRules(context: Record<string, unknown>, rules: BusinessPluginSemanticRule[] = []): BusinessPluginSemanticRule[] {
  const target = context.target && typeof context.target === 'object' && !Array.isArray(context.target)
    ? context.target as Record<string, unknown> : undefined
  const routePath = target?.routePath ?? context.routePath
  return rules.filter(rule => rule.routePath === routePath && rule.intentEquals === context.query)
}

function assertSemanticPlan(rules: BusinessPluginSemanticRule[], plan: BusinessScenarioWorkflowPlan): void {
  for (const rule of rules) {
    const candidates = plan.scenarios.filter(scenario => scenario.apiUrl === rule.apiUrl)
    const matched = candidates.some(scenario => scenario.sourceScenarioId
      ? rule.sourceScenarioIds.includes(scenario.sourceScenarioId)
      : rule.fieldAssertions.length > 0 && rule.fieldAssertions.every(assertion => {
        const actual = assertion.path.reduce<unknown>((current, part) =>
          current && typeof current === 'object' ? (current as Record<string | number, unknown>)[part] : undefined,
        scenario.data)
        return actual === assertion.equals
      }))
    if (!matched) {
      throw Object.assign(new Error(
        `Confirmed plan does not satisfy business semantic rule ${rule.id}; review the Mock fields or source Scenario before creating a Profile.`
      ), { code: 'WORKFLOW_SEMANTIC_MISMATCH', retryable: false })
    }
  }
}

function assertSemanticSourceValues(rules: BusinessPluginSemanticRule[], plan: BusinessScenarioWorkflowPlan, analysis: Record<string, unknown>): void {
  if (!rules.some(rule => rule.fieldAssertions.length)) return
  const analysisPlan = analysis.analysisPlan && typeof analysis.analysisPlan === 'object' && !Array.isArray(analysis.analysisPlan)
    ? analysis.analysisPlan as Record<string, unknown> : undefined
  const checks = analysisPlan?.semanticValueChecks && typeof analysisPlan.semanticValueChecks === 'object'
    ? analysisPlan.semanticValueChecks as Record<string, unknown> : undefined
  const approvedSources = Array.isArray(checks?.approvedSources) ? checks.approvedSources : undefined
  // Older persisted workflow runs have no value-check snapshot; retain their previous contract.
  if (!approvedSources) return
  for (const rule of rules) {
    if (!rule.fieldAssertions.length) continue
    for (const scenario of plan.scenarios) {
      if (scenario.apiUrl !== rule.apiUrl || !scenario.sourceScenarioId) continue
      const verified = approvedSources.some(value => value && typeof value === 'object' &&
        (value as Record<string, unknown>).apiUrl === rule.apiUrl &&
        (value as Record<string, unknown>).scenarioId === scenario.sourceScenarioId &&
        (value as Record<string, unknown>).status === 'matched')
      if (!verified) throw Object.assign(new Error(
        `Source Scenario ${scenario.sourceScenarioId} has not passed the declared value checks for semantic rule ${rule.id}; use a verified source or review a direct Mock payload.`
      ), { code: BUSINESS_CONTROL_ERROR.semanticValueUnverified, retryable: false })
    }
  }
}

function scenarioDefinition(declaration?: BusinessPluginWorkflowDeclaration): BusinessWorkflowDefinition {
  if (!declaration) return defaultDefinition
  if (declaration.id !== BUSINESS_SCENARIO_WORKFLOW_ID) throw new Error(`Unsupported business scenario workflow: ${declaration.id}`)
  const expected: Array<readonly [string, 'deterministic' | 'checkpoint', string | undefined]> = [
    ['analyze-target', 'deterministic', 'business.analyze-target'],
    ['confirm-plan', 'checkpoint', undefined],
    ['create-profile', 'deterministic', 'business.create-profile'],
    ['apply-profile', 'deterministic', 'business.apply-profile'],
    ['wait-for-preview', 'checkpoint', undefined],
    ['verify-preview', 'deterministic', 'business.verify-preview']
  ]
  if (declaration.steps.length !== expected.length || declaration.steps.some((step, index) => {
    const [id, type, handler] = expected[index]!
    return step.id !== id || step.type !== type || step.handler !== handler
      || step.gate !== (step.id === 'verify-preview' ? 'business.preview-verification' : undefined)
  })) throw new Error('Business scenario workflow declaration does not match the supported deterministic topology.')
  return declaration
}

function assertPreviewVerification(value: unknown): void {
  const output = record(value, 'Preview verification gate requires a structured result.')
  const checks = record(output.checks, 'Preview verification checks are missing.')
  const arrayPassed = (candidate: unknown, label: string, requireEvidence = false): void => {
    if (!Array.isArray(candidate) || (requireEvidence && candidate.length === 0)
      || candidate.some(item => !item || typeof item !== 'object' || (item as Record<string, unknown>).passed !== true)) {
      throw workflowGateError(`Preview verification gate rejected ${label}.`)
    }
  }
  if (output.verified !== true || checks.currentProfile !== true || checks.observationCurrent !== true || checks.route !== true) {
    throw workflowGateError('Preview verification gate rejected stale or mismatched page evidence.')
  }
  arrayPassed(checks.containsText, 'required text assertions')
  arrayPassed(checks.absentText, 'absence assertions')
  arrayPassed(checks.scenarios, 'real Scenario request evidence', true)
}

function workflowGateError(message: string): { code: string; message: string; retryable: boolean } {
  return { code: 'WORKFLOW_GATE_REJECTED', message, retryable: true }
}

function assertAnalysisQuality(analysis: Record<string, unknown>): void {
  if (!analysis.analysisPlan || typeof analysis.analysisPlan !== 'object' || Array.isArray(analysis.analysisPlan)) return
  const qualityGate = (analysis.analysisPlan as Record<string, unknown>).qualityGate
  if (!qualityGate || typeof qualityGate !== 'object' || Array.isArray(qualityGate)) return
  if ((qualityGate as Record<string, unknown>).level === 'insufficient') {
    throw {
      code: 'WORKFLOW_ANALYSIS_INSUFFICIENT',
      message: 'Scenario creation requires a refined target because the analysis evidence is insufficient.',
      retryable: false
    }
  }
}

function parseStartInput(value: unknown): BusinessScenarioWorkflowStartInput {
  const input = record(value, 'Scenario workflow input must be an object.')
  const routePath = input.routePath === undefined ? undefined : text(input.routePath, 'routePath is invalid.', 500)
  if (routePath && (!routePath.startsWith('/') || routePath.startsWith('//'))) throw new Error('routePath must be a safe absolute business route.')
  const targetPage = input.targetPage === undefined ? undefined : text(input.targetPage, 'targetPage is invalid.', 200)
  const query = text(input.query, 'query is required.', 1000)
  const apiUrls = input.apiUrls === undefined ? [] : stringArray(input.apiUrls, 'apiUrls', 12, 500)
  const sessionId = input.sessionId === undefined ? undefined : text(input.sessionId, 'sessionId is invalid.', 128)
  if (sessionId && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(sessionId)) throw new Error('sessionId is unsafe.')
  return {
    ...(routePath ? { routePath } : {}),
    ...(targetPage ? { targetPage } : {}),
    query,
    apiUrls,
    ...(sessionId ? { sessionId } : {})
  }
}

function parseTarget(value: unknown): BusinessScenarioWorkflowTarget {
  const target = record(value, 'Workflow target resolution is missing.')
  const routePath = text(target.routePath, 'Resolved target routePath is missing.', 500)
  if (!routePath.startsWith('/') || routePath.startsWith('//')) throw new Error('Resolved target routePath is unsafe.')
  const sources = ['explicit-route', 'page-hint', 'query-intent', 'current-preview'] as const
  const confidences = ['high', 'medium'] as const
  if (!sources.includes(target.source as typeof sources[number])) throw new Error('Resolved target source is invalid.')
  if (!confidences.includes(target.confidence as typeof confidences[number])) throw new Error('Resolved target confidence is invalid.')
  if (!Array.isArray(target.candidates)) throw new Error('Resolved target candidates are invalid.')
  return target as unknown as BusinessScenarioWorkflowTarget
}

function parsePlan(value: unknown): BusinessScenarioWorkflowPlan {
  const plan = record(value, 'A confirmed Mock plan is required.')
  const profileId = text(plan.profileId, 'profileId is required.', 128)
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(profileId)) throw new Error('profileId is unsafe.')
  if (!Array.isArray(plan.scenarios) || plan.scenarios.length < 1 || plan.scenarios.length > 12) {
    throw new Error('scenarios must contain 1-12 items.')
  }
  const scenarios = plan.scenarios.map((value) => {
    const scenario = record(value, 'Each scenario must be an object.')
    const id = text(scenario.id, 'Scenario id is required.', 128)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error('Scenario id is unsafe.')
    const data = scenario.data === undefined ? undefined : record(scenario.data, 'Scenario data must be an object.')
    const sourceScenarioId = scenario.sourceScenarioId === undefined
      ? undefined
      : text(scenario.sourceScenarioId, 'Scenario sourceScenarioId is invalid.', 128)
    if ((data === undefined) === (sourceScenarioId === undefined)) {
      throw new Error('Each scenario must provide exactly one of data or sourceScenarioId.')
    }
    return {
      id,
      apiUrl: text(scenario.apiUrl, 'Scenario apiUrl is required.', 500),
      ...(scenario.label === undefined ? {} : { label: text(scenario.label, 'Scenario label is invalid.', 200) }),
      ...(data === undefined ? {} : { data }),
      ...(sourceScenarioId === undefined ? {} : { sourceScenarioId })
    }
  })
  return {
    profileId,
    label: text(plan.label, 'Profile label is required.', 200),
    page: text(plan.page, 'Profile page is required.', 64),
    scenarios
  }
}

function parseVerification(value: unknown): BusinessScenarioWorkflowVerification {
  const verification = record(value, 'Preview verification input is required.')
  const route = text(verification.route, 'Verification route is required.', 500)
  if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Verification route is unsafe.')
  return {
    route,
    containsText: stringArray(verification.containsText, 'containsText', 20, 200),
    absentText: stringArray(verification.absentText, 'absentText', 20, 200)
  }
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function text(value: unknown, message: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) throw new Error(message)
  return value
}

function stringArray(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string' || item.length > maxLength)) {
    throw new Error(`${label} must be an array of at most ${maxItems} strings.`)
  }
  return [...value]
}
