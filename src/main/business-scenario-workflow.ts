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
}): (input: BusinessScenarioWorkflowStartInput) => Promise<BusinessWorkflowRun> {
  const definition = scenarioDefinition(options.definition)
  options.runtime.registerWorkflow(definition, {
    'analyze-target': async ({ context }) => {
      const input = parseStartInput(context)
      const target = await options.requestBusiness('/__desktop/resolve-target', {
        ...(input.routePath ? { routePath: input.routePath } : {}),
        ...(input.targetPage ? { targetPage: input.targetPage } : {}),
        query: input.query
      }, input.sessionId) as BusinessScenarioWorkflowTarget
      const analysis = await options.requestBusiness('/__desktop/analyze-target', {
        routePath: target.routePath,
        query: input.query,
        apiUrls: input.apiUrls ?? []
      }, input.sessionId)
      return {
        output: analysis,
        contextPatch: { analysis, target }
      }
    },
    'create-profile': async ({ context, previousOutput }) => {
      const input = parseStartInput(context)
      const plan = parsePlan(previousOutput)
      const analysis = record(context.analysis, 'Workflow analysis result is missing.')
      const target = parseTarget(context.target)
      const evidenceId = text(analysis.evidenceId, 'Workflow analysis evidenceId is missing.')
      const created = await options.requestBusiness('/__desktop/create-profile', {
        evidenceId,
        profile: {
          id: plan.profileId,
          label: plan.label,
          branchLabel: plan.label,
          routePath: target.routePath,
          page: plan.page
        },
        scenarios: plan.scenarios
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
    compatibleRunVersions: options.definition?.compatibleRunVersions
  })

  return (input) => options.runtime.start({
    workflowId: BUSINESS_SCENARIO_WORKFLOW_ID,
    pluginId: options.pluginId,
    context: { ...parseStartInput(input) }
  })
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
