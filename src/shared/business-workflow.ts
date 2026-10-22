export type BusinessWorkflowStepType = 'deterministic' | 'agent' | 'checkpoint'

export type BusinessWorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_user'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type BusinessWorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export interface BusinessWorkflowError {
  code: string
  message: string
  retryable: boolean
  candidates?: Array<{ routePath: string; pageTitle?: string }>
}

/** An explicit route choice for retrying a persisted ambiguous target step. */
export interface BusinessWorkflowRouteSelection {
  selectedRoutePath: string
  confirmedByUser: true
}

export interface BusinessWorkflowStepDefinition {
  id: string
  type: BusinessWorkflowStepType
  title: string
  handler?: string
  gate?: string
}

export interface BusinessWorkflowDefinition {
  id: string
  version: string
  title: string
  inputSchema?: Record<string, unknown>
  steps: BusinessWorkflowStepDefinition[]
}

export interface BusinessWorkflowCompatibility {
  status: 'current' | 'migratable' | 'migrated' | 'historical' | 'incompatible'
  currentVersion?: string
  sourceVersion?: string
  reason?: string
  migratedAt?: string
}

export interface BusinessWorkflowStepRun {
  id: string
  type: BusinessWorkflowStepType
  title: string
  status: BusinessWorkflowStepStatus
  input?: unknown
  output?: unknown
  /** Exact version accepted by a proposal confirmation, absent for legacy conversation resumes. */
  confirmedProposalId?: string
  evidenceIds: string[]
  error?: BusinessWorkflowError
  startedAt?: string
  completedAt?: string
}

export interface BusinessWorkflowRun {
  id: string
  workflowId: string
  workflowVersion: string
  compatibility?: BusinessWorkflowCompatibility
  pluginId: string
  status: BusinessWorkflowRunStatus
  currentStepId?: string
  /** A validated proposal is not approval. Its identity binds a deliberate UI confirmation. */
  checkpointProposal?: { id: string; checkpointId: string; output: unknown; proposedAt: string }
  context: Record<string, unknown>
  steps: BusinessWorkflowStepRun[]
  createdAt: string
  updatedAt: string
}

export interface BusinessWorkflowProposalApproval {
  proposalId: string
  sessionId: string
}

export interface BusinessScenarioWorkflowStartInput {
  routePath?: string
  targetPage?: string
  query: string
  apiUrls?: string[]
  sessionId?: string
  /** Direct human message committed to the model-visible session log; optional telemetry, never a workflow gate. */
  humanPromptAt?: number
  /** Earlier durable host-inbox admission time for the same message, when observed. */
  humanPromptAdmittedAt?: number
  /** Start of the Agent turn that admitted this direct user message. */
  agentTurnStartAt?: number
  /** First Agent step of that turn, before the model-visible user message commit. */
  agentFirstStepAt?: number
  /** First durable assistant message after this direct user message, not first streamed token. */
  agentFirstAssistantMessageAt?: number
  /** First Agent tool call after this direct user message. */
  agentFirstToolCallAt?: number
  /** Durable call event for this workflow tool, before Desktop dispatch. */
  workflowToolCallAt?: number
}

export interface BusinessScenarioWorkflowTarget {
  routePath: string
  pageTitle?: string
  source: 'explicit-route' | 'page-hint' | 'query-intent' | 'current-preview'
  confidence: 'high' | 'medium'
  currentRoute?: string
  candidates: Array<{ routePath: string; pageTitle?: string }>
}

export interface BusinessScenarioWorkflowPlan {
  profileId: string
  label: string
  page: string
  scenarios: Array<{
    id: string
    apiUrl: string
    label?: string
    data?: Record<string, unknown>
    sourceScenarioId?: string
  }>
  /** Ordered, reviewed page checks. Omit to retain the existing single-page checkpoint. */
  verificationSteps?: BusinessScenarioPreviewStep[]
}

export interface BusinessScenarioWorkflowVerification {
  route: string
  containsText: string[]
  absentText: string[]
}

export interface BusinessScenarioPreviewStep extends BusinessScenarioWorkflowVerification {
  id: string
  label: string
  /** Optional subset of this Profile's APIs needed on this page; final verification checks all bindings. */
  apiUrls?: string[]
}
