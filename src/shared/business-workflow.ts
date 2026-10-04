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
  context: Record<string, unknown>
  steps: BusinessWorkflowStepRun[]
  createdAt: string
  updatedAt: string
}

export interface BusinessScenarioWorkflowStartInput {
  routePath?: string
  targetPage?: string
  query: string
  apiUrls?: string[]
  sessionId?: string
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
}

export interface BusinessScenarioWorkflowVerification {
  route: string
  containsText: string[]
  absentText: string[]
}
