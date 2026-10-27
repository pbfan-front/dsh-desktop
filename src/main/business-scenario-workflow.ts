import type {
  BusinessScenarioWorkflowPlan,
  BusinessScenarioWorkflowStartInput,
  BusinessScenarioWorkflowTarget,
  BusinessScenarioWorkflowVerification,
  BusinessScenarioPreviewStep,
  BusinessWorkflowDefinition,
  BusinessWorkflowRun
} from '../shared/business-workflow'
import type { BusinessControlPath } from './business-preview'
import type { BusinessWorkflowRuntime } from './business-workflow-runtime'
import type { BusinessPluginWorkflowDeclaration } from './business-plugin-contract'
import type { BusinessPluginSemanticRule } from './business-plugin-contract'
import { BUSINESS_CONTROL_ERROR, profileCreationRequestError, resolveSemanticIntent, validSemanticSourceRequest } from '../shared/business-control-contract'
import { assertCreationEvidenceRefreshable, assertCreationEvidenceUnchanged, isStaleCreationEvidence } from './business-creation-evidence'

export const BUSINESS_SCENARIO_WORKFLOW_ID = 'business-scenario-create'

const defaultDefinition: BusinessWorkflowDefinition = {
  id: BUSINESS_SCENARIO_WORKFLOW_ID,
  version: '1.3.0',
  title: '创建并验证业务体验场景',
  steps: [
    { id: 'analyze-target', type: 'deterministic', title: '分析页面与接口证据' },
    { id: 'confirm-plan', type: 'checkpoint', title: '确认 Mock 场景方案' },
    { id: 'create-profile', type: 'deterministic', title: '创建 Mock Profile' },
    { id: 'apply-profile', type: 'deterministic', title: '等待用户选择体验分支' },
    { id: 'wait-for-preview', type: 'checkpoint', title: '用户选择分支后验证预览' },
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
      const semanticContext = { ...context, target }
      const { rules: semanticExpectations, resolution: intentResolution } = selectSemanticRules(semanticContext, options.semanticRules)
      const analysis = await options.requestBusiness('/__desktop/analyze-target', {
        routePath: target.routePath,
        query: input.query,
        apiUrls: input.apiUrls ?? [],
        ...(semanticExpectations.length ? { semanticExpectations } : {})
      }, input.sessionId)
      const analyzeTargetMs = Math.max(0, nowMs() - analyzeStartedAt)
      return {
        output: analysis,
        contextPatch: { analysis, target, semanticExpectations, intentResolution, requestTimings: { resolveTargetMs, analyzeTargetMs } }
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
      const request = {
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
      }
      const requestError = profileCreationRequestError(request)
      if (requestError) throw new Error(`Profile creation request does not satisfy the shared business control contract: ${requestError}`)
      let created: unknown
      let refreshedAnalysis: Record<string, unknown> | undefined
      try { created = await options.requestBusiness('/__desktop/create-profile', request, input.sessionId) }
      catch (error) {
        // Only this explicit pre-write failure is safe to recover automatically.
        // Never replay a timed-out/unknown write or replace the confirmed plan.
        if (!isStaleCreationEvidence(error)) throw error
        const apiUrls = plan.scenarios.map(item => item.apiUrl)
        assertCreationEvidenceRefreshable(analysis, apiUrls)
        refreshedAnalysis = record(await options.requestBusiness('/__desktop/analyze-target', {
          routePath: target.routePath, query: input.query, apiUrls, forceFresh: true,
          ...(semanticRules.length ? { semanticExpectations: semanticRules } : {})
        }, input.sessionId), 'Refreshed workflow analysis result is missing.')
        assertCreationEvidenceUnchanged(analysis, refreshedAnalysis, apiUrls)
        assertAnalysisQuality(refreshedAnalysis)
        assertSemanticSourceValues(semanticRules, plan, refreshedAnalysis)
        created = await options.requestBusiness('/__desktop/create-profile', {
          ...request, evidenceId: text(refreshedAnalysis.evidenceId, 'Refreshed workflow evidenceId is missing.')
        }, input.sessionId)
      }
      return { output: created, contextPatch: { profileId: plan.profileId, plan,
        ...(refreshedAnalysis ? { analysis: refreshedAnalysis, creationEvidenceRefresh: {
          previousEvidenceId: evidenceId, evidenceId: refreshedAnalysis.evidenceId, refreshedAt: new Date().toISOString(),
          confirmedPlanUnchanged: true
        } } : {}) } }
    },
    'apply-profile': async ({ context }) => {
      const profileId = text(context.profileId, 'Workflow profileId is missing.')
      // Creation must never activate a branch. The preview keeps its current
      // profile until the user explicitly chooses this Profile in the UI.
      return { output: { profileId, status: 'available', activation: 'user-selection-required' } }
    },
    'verify-preview': async ({ context, previousOutput }) => {
      const input = parseStartInput(context)
      const plan = parsePlan(context.plan)
      if (plan.verificationSteps) {
        // parsePlan guarantees 1-5 steps; the length/order checks below bound every indexed lookup.
        const progress = previewProgress(context)
        if (progress.length !== plan.verificationSteps.length) throw workflowGateError('Complete every declared page check before final verification.')
        progress.forEach((item, index) => {
          if (item.id !== plan.verificationSteps![index]!.id) throw workflowGateError('Saved page check order does not match the confirmed plan.')
          assertPreviewIdentity(item.result, input.sessionId, plan.profileId)
          assertSamePreviewRevision(progress[0]!.result, item.result)
        })
        const last = plan.verificationSteps[plan.verificationSteps.length - 1]!
        const verified = await options.requestBusiness('/__desktop/verify', {
          route: last.route, containsText: last.containsText, absentText: last.absentText,
          expectedProfileId: plan.profileId
        }, input.sessionId)
        const final = assertPreviewIdentity(verified, input.sessionId, plan.profileId)
        assertSamePreviewRevision(progress[0]!.result, final)
        return { output: { ...final, pageSteps: progress.map((item, index) => ({
          id: item.id, expected: plan.verificationSteps![index], verification: item.result
        })) } }
      }
      const verification = parseVerification(previousOutput)
      const verified = await options.requestBusiness('/__desktop/verify', verification, input.sessionId)
      return { output: verified }
    }
  }, {
    'business.preview-verification': ({ context, result }) => {
      assertPreviewVerification(result.output)
      const steps = parsePlan(context.plan).verificationSteps
      if (steps) {
        const output = record(result.output, 'Multi-page verification result is missing.')
        if (!Array.isArray(output.pageSteps) || output.pageSteps.length !== steps.length
          || output.pageSteps.some((value, index) => record(value, 'Page verification result is invalid.').id !== steps[index]!.id)) {
          throw workflowGateError('Preview verification gate requires every declared page check.')
        }
      }
    }
  }, {
    pluginId: options.pluginId,
    compatibleRunVersions: options.definition?.compatibleRunVersions,
    proposalCheckpoints: ['confirm-plan'],
    checkpointValidators: {
      'confirm-plan': async ({ context, checkpointOutput, proposal }) => {
        const rules = matchingSemanticRules(context, options.semanticRules)
        if (!proposal && !options.semanticRules?.length && (!checkpointOutput || typeof checkpointOutput !== 'object'
          || Array.isArray(checkpointOutput) || !('verificationSteps' in checkpointOutput))) return
        if (proposal) assertAnalysisQuality(record(context.analysis, 'Workflow analysis result is missing.'))
        const plan = parsePlan(checkpointOutput)
        if (proposal) {
          const analysis = record(context.analysis, 'Workflow analysis result is missing.')
          const requestError = profileCreationRequestError({ evidenceId: text(analysis.evidenceId, 'Workflow analysis evidenceId is missing.'),
            profile: { id: plan.profileId, label: plan.label, branchLabel: plan.label, page: plan.page, routePath: parseTarget(context.target).routePath },
            scenarios: plan.scenarios })
          if (requestError) throw new Error(`Invalid proposal: ${requestError}`)
        }
        assertPreviewPlan(plan, parseTarget(context.target).routePath)
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
      },
      'wait-for-preview': async ({ context, checkpointOutput }) => {
        const plan = parsePlan(context.plan)
        if (!plan.verificationSteps) return
        const selection = record(checkpointOutput, 'Pass the next declared stepId for multi-page verification.')
        if (selection.restartVerification === true && Object.keys(selection).length === 1) {
          return { contextPatch: { previousPreviewVerifications: previewProgress(context), previewVerifications: [] }, continueWaiting: true }
        }
        if (Object.keys(selection).some(key => key !== 'stepId')) throw new Error('Page checks use the confirmed assertions; pass only stepId.')
        const progress = previewProgress(context)
        const next = plan.verificationSteps[progress.length]
        if (!next || selection.stepId !== next.id) throw new Error(`Verify the next declared page step: ${next?.id ?? '(all captured)'}.`)
        const input = parseStartInput(context)
        const result = assertPreviewIdentity(await options.requestBusiness('/__desktop/verify', {
          route: next.route, containsText: next.containsText, absentText: next.absentText,
          expectedProfileId: plan.profileId, partial: true,
          ...(next.apiUrls ? { apiUrls: next.apiUrls } : {})
        }, input.sessionId), input.sessionId, plan.profileId)
        if (progress.length) {
          assertSamePreviewRevision(progress[0]!.result, result)
          const previous = progress[progress.length - 1]!.result
          const observation = record(result.pageObservation, 'Page observation is missing.')
          if (Date.parse(String(observation.observedAt)) < Date.parse(String(previous.checkedAt))) {
            throw workflowGateError('The next page needs a fresh observation after the preceding page check.')
          }
        }
        const previewVerifications = [...progress, { id: next.id, result }]
        return { contextPatch: { previewVerifications }, continueWaiting: previewVerifications.length < plan.verificationSteps.length }
      }
    },
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
    context: { ...parseStartInput(input), semanticIntentContract: 1, experienceFlowVersion: 1 }
  })
}

function matchingSemanticRules(context: Record<string, unknown>, rules: BusinessPluginSemanticRule[] = []): BusinessPluginSemanticRule[] {
  return selectSemanticRules(context, rules).rules
}

function selectSemanticRules(context: Record<string, unknown>, rules: BusinessPluginSemanticRule[] = []) {
  const target = context.target && typeof context.target === 'object' && !Array.isArray(context.target)
    ? context.target as Record<string, unknown> : undefined
  const routePath = target?.routePath ?? context.routePath
  // Persisted pre-contract runs retain exact-query behavior; do not activate new
  // rules retroactively on a plan a user already reviewed.
  const candidates = context.semanticIntentContract === 1 ? rules : rules.map(rule => ({ ...rule, intentMatch: 'exact' as const }))
  const resolution = resolveSemanticIntent(candidates, routePath, context.query)
  if (resolution.status === 'ambiguous') throw Object.assign(new Error(
    'Multiple plugin-declared intent clauses occur in this request. Clarify the business requirement in a new run before analysis or creation.'
  ), { code: BUSINESS_CONTROL_ERROR.intentAmbiguous, retryable: false })
  const selectedRules = rules.filter(rule => resolution.ruleIds.includes(rule.id))
  if (context.semanticIntentContract === 1 && context.intentResolution
    && (JSON.stringify(resolution) !== JSON.stringify(context.intentResolution)
      || JSON.stringify(selectedRules) !== JSON.stringify(context.semanticExpectations))) throw Object.assign(new Error(
    'Declared intent matching or semantic rules changed after analysis. Start a new reviewed run; do not reuse the old plan with different semantic rules.'
  ), { code: BUSINESS_CONTROL_ERROR.intentChanged, retryable: false })
  return { resolution, rules: selectedRules }
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
  const humanPromptAt = Number.isSafeInteger(input.humanPromptAt) && (input.humanPromptAt as number) >= 0
    ? input.humanPromptAt as number : undefined
  const humanPromptAdmittedAt = Number.isSafeInteger(input.humanPromptAdmittedAt)
    && (input.humanPromptAdmittedAt as number) >= 0
    && humanPromptAt !== undefined && (input.humanPromptAdmittedAt as number) <= humanPromptAt
    ? input.humanPromptAdmittedAt as number : undefined
  const agentTurnStartAt = Number.isSafeInteger(input.agentTurnStartAt)
    && humanPromptAt !== undefined && (input.agentTurnStartAt as number) >= 0
    && (input.agentTurnStartAt as number) <= humanPromptAt
    && (humanPromptAdmittedAt === undefined || (input.agentTurnStartAt as number) >= humanPromptAdmittedAt)
    ? input.agentTurnStartAt as number : undefined
  const agentFirstStepAt = Number.isSafeInteger(input.agentFirstStepAt)
    && agentTurnStartAt !== undefined && (input.agentFirstStepAt as number) >= agentTurnStartAt
    && humanPromptAt !== undefined && (input.agentFirstStepAt as number) <= humanPromptAt
    ? input.agentFirstStepAt as number : undefined
  const observedAfterPrompt = (value: unknown): number | undefined => Number.isSafeInteger(value)
    && (value as number) >= (humanPromptAt ?? Number.POSITIVE_INFINITY)
    ? value as number : undefined
  const agentFirstAssistantMessageAt = observedAfterPrompt(input.agentFirstAssistantMessageAt)
  const agentFirstToolCallAt = observedAfterPrompt(input.agentFirstToolCallAt)
  const workflowToolCallAt = observedAfterPrompt(input.workflowToolCallAt)
  if (sessionId && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(sessionId)) throw new Error('sessionId is unsafe.')
  return {
    ...(routePath ? { routePath } : {}),
    ...(targetPage ? { targetPage } : {}),
    query,
    apiUrls,
    ...(sessionId ? { sessionId } : {}),
    ...(humanPromptAt !== undefined ? { humanPromptAt } : {}),
    ...(humanPromptAdmittedAt !== undefined ? { humanPromptAdmittedAt } : {}),
    ...(agentTurnStartAt !== undefined ? { agentTurnStartAt } : {}),
    ...(agentFirstStepAt !== undefined ? { agentFirstStepAt } : {}),
    ...(agentFirstAssistantMessageAt !== undefined ? { agentFirstAssistantMessageAt } : {}),
    ...(agentFirstToolCallAt !== undefined ? { agentFirstToolCallAt } : {}),
    ...(workflowToolCallAt !== undefined && (agentFirstToolCallAt === undefined
      || workflowToolCallAt >= agentFirstToolCallAt) ? { workflowToolCallAt } : {})
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
    scenarios,
    ...(plan.verificationSteps === undefined ? {} : { verificationSteps: parsePreviewSteps(plan.verificationSteps) })
  }
}

function parsePreviewSteps(value: unknown): BusinessScenarioPreviewStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) throw new Error('verificationSteps must contain 1-5 ordered page checks.')
  const ids = new Set<string>()
  return value.map(value => {
    const step = record(value, 'Each page check must be an object.')
    const id = text(step.id, 'Page check id is required.', 64)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id) || ids.has(id)) throw new Error('Page check ids must be safe and unique.')
    ids.add(id)
    const verification = parseVerification(step)
    if (!verification.containsText.length || verification.containsText.some(text => !text.trim())) {
      throw new Error('Each page check needs at least one nonempty required text assertion.')
    }
    const apiUrls = step.apiUrls === undefined ? undefined : stringArray(step.apiUrls, 'apiUrls', 12, 500)
    if (apiUrls && (!apiUrls.length || apiUrls.some(api => !api.trim()))) throw new Error('Page check apiUrls must not be empty.')
    return { ...verification, id, label: text(step.label, 'Page check label is required.', 200),
      ...(apiUrls ? { apiUrls } : {}) }
  })
}

function assertPreviewPlan(plan: BusinessScenarioWorkflowPlan, targetRoute: string): void {
  if (!plan.verificationSteps) return
  const routePath = (route: string): string => route.split('?')[0]!.replace(/\/+$/, '') || '/'
  if (routePath(plan.verificationSteps[0]!.route) !== routePath(targetRoute)) {
    throw new Error('The first page check must verify the analyzed target route.')
  }
  for (const step of plan.verificationSteps) {
    if (step.apiUrls?.some(api => !plan.scenarios.some(scenario => scenario.apiUrl === api))) {
      throw new Error('Page check APIs must be declared in the confirmed Profile plan.')
    }
  }
}

function previewProgress(context: Readonly<Record<string, unknown>>): Array<{ id: string; result: Record<string, unknown> }> {
  const progress = context.previewVerifications ?? []
  if (!Array.isArray(progress) || progress.length > 5) throw workflowGateError('Saved page verification progress is invalid.')
  return progress.map(value => {
    const item = record(value, 'Saved page verification is invalid.')
    return { id: text(item.id, 'Saved page verification id is missing.', 64), result: record(item.result, 'Saved page evidence is missing.') }
  })
}

function assertPreviewIdentity(value: unknown, sessionId: string | undefined, profileId: string): Record<string, unknown> {
  assertPreviewVerification(value)
  const output = record(value, 'Page verification result is missing.')
  const observation = record(output.pageObservation, 'Page observation is missing.')
  if (output.sessionId !== (sessionId || 'default') || output.profileId !== profileId
    || !Number.isInteger(output.revision) || (output.revision as number) < 0
    || typeof output.revisionId !== 'string' || !output.revisionId
    || observation.revision !== output.revision || observation.revisionId !== output.revisionId
    || observation.profileId !== output.profileId
    || !Number.isFinite(Date.parse(String(output.checkedAt)))
    || !Number.isFinite(Date.parse(String(observation.observedAt)))
    || Date.parse(String(observation.observedAt)) > Date.parse(String(output.checkedAt))) {
    throw workflowGateError('Page evidence must identify the same session, Profile and Runtime revision; upgrade the Runtime if identity fields are missing.')
  }
  return output
}

function assertSamePreviewRevision(first: Record<string, unknown>, current: Record<string, unknown>): void {
  if (['sessionId', 'profileId', 'revision', 'revisionId'].some(key => first[key] !== current[key])) {
    throw workflowGateError('Preview revision changed between page checks. While waiting, restart with {"restartVerification":true} and recapture all pages in one activation; do not combine old evidence. A failed final step needs a new reviewed run if its saved evidence has expired.')
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
