import { randomUUID } from 'node:crypto'
import type {
  BusinessWorkflowDefinition,
  BusinessWorkflowError,
  BusinessWorkflowRun,
  BusinessWorkflowStepDefinition
} from '../shared/business-workflow'

const safeId = /^[a-z0-9][a-z0-9._-]{1,127}$/

export interface BusinessWorkflowStepResult {
  output?: unknown
  contextPatch?: Record<string, unknown>
  evidenceIds?: string[]
}

export interface BusinessWorkflowStepContext {
  runId: string
  workflowId: string
  pluginId: string
  step: BusinessWorkflowStepDefinition
  context: Readonly<Record<string, unknown>>
  previousOutput?: unknown
}

export type BusinessWorkflowStepHandler = (
  context: BusinessWorkflowStepContext
) => Promise<BusinessWorkflowStepResult> | BusinessWorkflowStepResult

export type BusinessWorkflowHandlers = Record<string, BusinessWorkflowStepHandler>

export interface BusinessWorkflowGateContext extends BusinessWorkflowStepContext {
  result: Readonly<BusinessWorkflowStepResult>
}

export type BusinessWorkflowGate = (context: BusinessWorkflowGateContext) => Promise<void> | void
export type BusinessWorkflowGates = Record<string, BusinessWorkflowGate>

interface RegisteredWorkflow {
  definition: BusinessWorkflowDefinition
  handlers: BusinessWorkflowHandlers
  gates: BusinessWorkflowGates
  pluginId?: string
  compatibleRunVersions: Set<string>
}

export interface BusinessWorkflowRegistrationOptions {
  pluginId?: string
  compatibleRunVersions?: string[]
}

export interface BusinessWorkflowRuntimeOptions {
  now?: () => Date
  idFactory?: () => string
  onRunChanged?: (run: BusinessWorkflowRun) => Promise<void> | void
}

export class BusinessWorkflowRuntime {
  private readonly workflows = new Map<string, RegisteredWorkflow>()
  private readonly runs = new Map<string, BusinessWorkflowRun>()
  private readonly executing = new Set<string>()
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly onRunChanged?: (run: BusinessWorkflowRun) => Promise<void> | void

  constructor(options: BusinessWorkflowRuntimeOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? randomUUID
    this.onRunChanged = options.onRunChanged
  }

  registerWorkflow(
    definition: BusinessWorkflowDefinition,
    handlers: BusinessWorkflowHandlers,
    gates: BusinessWorkflowGates = {},
    options: BusinessWorkflowRegistrationOptions = {}
  ): void {
    validateDefinition(definition)
    if (this.workflows.has(definition.id)) throw new Error(`Workflow is already registered: ${definition.id}`)
    const requiredHandlers = definition.steps
      .filter((step) => step.type !== 'checkpoint')
      .map((step) => step.id)
    for (const stepId of requiredHandlers) {
      if (typeof handlers[stepId] !== 'function') throw new Error(`Workflow step handler is missing: ${definition.id}/${stepId}`)
    }
    const knownSteps = new Set(definition.steps.map((step) => step.id))
    for (const stepId of Object.keys(handlers)) {
      if (!knownSteps.has(stepId)) throw new Error(`Workflow handler has no matching step: ${definition.id}/${stepId}`)
    }
    const requiredGates = new Set(definition.steps.flatMap((step) => step.gate ? [step.gate] : []))
    for (const gateId of requiredGates) {
      if (typeof gates[gateId] !== 'function') throw new Error(`Workflow gate is missing: ${definition.id}/${gateId}`)
    }
    for (const gateId of Object.keys(gates)) {
      if (!requiredGates.has(gateId)) throw new Error(`Workflow gate is not declared: ${definition.id}/${gateId}`)
    }
    if (options.pluginId !== undefined && !safeId.test(options.pluginId)) throw new Error('Workflow registration pluginId is unsafe.')
    const compatibleRunVersions = new Set(options.compatibleRunVersions ?? [])
    compatibleRunVersions.delete(definition.version)
    this.workflows.set(definition.id, {
      definition: clone(definition), handlers: { ...handlers }, gates: { ...gates },
      pluginId: options.pluginId, compatibleRunVersions
    })
  }

  async start(params: {
    workflowId: string
    pluginId: string
    context?: Record<string, unknown>
  }): Promise<BusinessWorkflowRun> {
    const workflow = this.requireWorkflow(params.workflowId)
    if (!safeId.test(params.pluginId)) throw new Error('Workflow pluginId is missing or unsafe.')
    assertSerializable(params.context ?? {}, 'workflow context')
    const timestamp = this.timestamp()
    const run: BusinessWorkflowRun = {
      id: this.idFactory(),
      workflowId: workflow.definition.id,
      workflowVersion: workflow.definition.version,
      pluginId: params.pluginId,
      status: 'pending',
      context: clone(params.context ?? {}),
      steps: workflow.definition.steps.map((step) => ({
        id: step.id,
        type: step.type,
        title: step.title,
        status: 'pending',
        evidenceIds: []
      })),
      createdAt: timestamp,
      updatedAt: timestamp
    }
    this.runs.set(run.id, run)
    await this.emit(run)
    return this.execute(run.id)
  }

  getRun(runId: string): BusinessWorkflowRun | undefined {
    const run = this.runs.get(runId)
    return run ? this.present(run) : undefined
  }

  listRuns(): BusinessWorkflowRun[] {
    return [...this.runs.values()].map((run) => this.present(run))
  }

  restoreRuns(runs: BusinessWorkflowRun[]): void {
    for (const run of runs) {
      if (this.runs.has(run.id)) throw new Error(`Workflow run is already restored: ${run.id}`)
      if (!safeId.test(run.pluginId)) throw new Error(`Restored workflow pluginId is unsafe: ${run.id}`)
      assertSerializable(run, `restored workflow run ${run.id}`)
      this.runs.set(run.id, clone(run))
    }
  }

  async resume(runId: string, checkpointOutput?: unknown): Promise<BusinessWorkflowRun> {
    const run = this.requireRun(runId)
    await this.ensureRunnableCompatibility(run)
    if (run.status !== 'waiting_for_user' || !run.currentStepId) {
      throw new Error(`Workflow is not waiting at a checkpoint: ${runId}`)
    }
    assertSerializable(checkpointOutput, 'checkpoint output')
    const step = run.steps.find((candidate) => candidate.id === run.currentStepId)
    if (!step || step.type !== 'checkpoint' || step.status !== 'running') {
      throw new Error(`Workflow checkpoint state is inconsistent: ${runId}`)
    }
    step.output = clone(checkpointOutput)
    step.status = 'completed'
    step.completedAt = this.timestamp()
    run.status = 'running'
    run.currentStepId = undefined
    await this.touch(run)
    return this.execute(runId)
  }

  async retry(runId: string): Promise<BusinessWorkflowRun> {
    const run = this.requireRun(runId)
    await this.ensureRunnableCompatibility(run)
    if (run.status !== 'failed' || !run.currentStepId) throw new Error(`Workflow has no failed step to retry: ${runId}`)
    const step = run.steps.find((candidate) => candidate.id === run.currentStepId)
    if (!step || step.status !== 'failed' || step.error?.retryable !== true) {
      throw new Error(`Workflow failed step is not retryable: ${runId}`)
    }
    step.status = 'pending'
    step.error = undefined
    step.startedAt = undefined
    step.completedAt = undefined
    run.status = 'running'
    run.currentStepId = undefined
    await this.touch(run)
    return this.execute(runId)
  }

  async cancel(runId: string): Promise<BusinessWorkflowRun> {
    const run = this.requireRun(runId)
    if (run.status === 'completed' || run.status === 'cancelled') return clone(run)
    if (this.executing.has(runId)) throw new Error(`Workflow is currently executing and cannot be cancelled synchronously: ${runId}`)
    for (const step of run.steps) {
      if (step.status === 'pending' || step.status === 'running') step.status = 'skipped'
    }
    run.status = 'cancelled'
    run.currentStepId = undefined
    await this.touch(run)
    return clone(run)
  }

  private async execute(runId: string): Promise<BusinessWorkflowRun> {
    if (this.executing.has(runId)) throw new Error(`Workflow run is already executing: ${runId}`)
    const run = this.requireRun(runId)
    const workflow = this.requireWorkflow(run.workflowId)
    this.executing.add(runId)
    try {
      run.status = 'running'
      await this.touch(run)
      for (const stepRun of run.steps) {
        if (stepRun.status === 'completed' || stepRun.status === 'skipped') continue
        const definition = workflow.definition.steps.find((step) => step.id === stepRun.id)
        if (!definition) throw new Error(`Workflow definition changed while running: ${run.workflowId}/${stepRun.id}`)
        run.currentStepId = stepRun.id
        stepRun.status = 'running'
        stepRun.startedAt = this.timestamp()
        stepRun.error = undefined
        await this.touch(run)
        if (definition.type === 'checkpoint') {
          run.status = 'waiting_for_user'
          await this.touch(run)
          return clone(run)
        }
        try {
          const handler = workflow.handlers[stepRun.id]
          if (!handler) throw new Error(`Workflow step handler disappeared: ${run.workflowId}/${stepRun.id}`)
          const previousStep = run.steps[run.steps.indexOf(stepRun) - 1]
          stepRun.input = clone(run.context)
          const result = await handler({
            runId: run.id,
            workflowId: run.workflowId,
            pluginId: run.pluginId,
            step: clone(definition),
            context: clone(run.context),
            previousOutput: clone(previousStep?.output)
          })
          assertSerializable(result, `workflow step result ${stepRun.id}`)
          if (definition.gate) {
            const gate = workflow.gates[definition.gate]
            if (!gate) throw new Error(`Workflow gate disappeared: ${run.workflowId}/${definition.gate}`)
            await gate({
              runId: run.id,
              workflowId: run.workflowId,
              pluginId: run.pluginId,
              step: clone(definition),
              context: clone(run.context),
              previousOutput: clone(previousStep?.output),
              result: clone(result)
            })
          }
          stepRun.output = clone(result.output)
          stepRun.evidenceIds = [...new Set(result.evidenceIds ?? [])]
          if (result.contextPatch) Object.assign(run.context, clone(result.contextPatch))
          stepRun.status = 'completed'
          stepRun.completedAt = this.timestamp()
          run.currentStepId = undefined
          await this.touch(run)
        } catch (error) {
          stepRun.status = 'failed'
          stepRun.completedAt = this.timestamp()
          stepRun.error = normalizeError(error)
          run.status = 'failed'
          await this.touch(run)
          return clone(run)
        }
      }
      run.status = 'completed'
      run.currentStepId = undefined
      await this.touch(run)
      return clone(run)
    } finally {
      this.executing.delete(runId)
    }
  }

  private present(run: BusinessWorkflowRun): BusinessWorkflowRun {
    const presented = clone(run)
    presented.compatibility = this.compatibility(run)
    return presented
  }

  private compatibility(run: BusinessWorkflowRun): NonNullable<BusinessWorkflowRun['compatibility']> {
    const workflow = this.workflows.get(run.workflowId)
    if (!workflow) return { status: 'incompatible', reason: 'Workflow definition is not available.' }
    if (workflow.pluginId && workflow.pluginId !== run.pluginId) {
      return { status: 'incompatible', currentVersion: workflow.definition.version, reason: 'Workflow belongs to a different business plugin.' }
    }
    if (run.workflowVersion === workflow.definition.version) {
      if (run.compatibility?.status === 'migrated' && run.compatibility.currentVersion === workflow.definition.version) return clone(run.compatibility)
      return { status: 'current', currentVersion: workflow.definition.version }
    }
    if (run.status === 'completed' || run.status === 'cancelled') {
      return { status: 'historical', sourceVersion: run.workflowVersion, currentVersion: workflow.definition.version }
    }
    if (workflow.compatibleRunVersions.has(run.workflowVersion) && topologyMatches(run, workflow.definition)) {
      return { status: 'migratable', sourceVersion: run.workflowVersion, currentVersion: workflow.definition.version }
    }
    return {
      status: 'incompatible', sourceVersion: run.workflowVersion, currentVersion: workflow.definition.version,
      reason: topologyMatches(run, workflow.definition)
        ? 'The plugin does not declare this run version as compatible.'
        : 'Workflow steps changed and cannot be resumed safely.'
    }
  }

  private async ensureRunnableCompatibility(run: BusinessWorkflowRun): Promise<void> {
    const compatibility = this.compatibility(run)
    if (compatibility.status === 'current' || compatibility.status === 'migrated') return
    if (compatibility.status === 'migratable') {
      const sourceVersion = run.workflowVersion
      run.workflowVersion = compatibility.currentVersion!
      run.compatibility = {
        status: 'migrated', sourceVersion, currentVersion: compatibility.currentVersion,
        migratedAt: this.timestamp()
      }
      await this.touch(run)
      return
    }
    throw new Error(`Workflow run cannot continue: ${compatibility.reason ?? compatibility.status}`)
  }

  private requireWorkflow(workflowId: string): RegisteredWorkflow {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`)
    return workflow
  }

  private requireRun(runId: string): BusinessWorkflowRun {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Unknown workflow run: ${runId}`)
    return run
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private async touch(run: BusinessWorkflowRun): Promise<void> {
    run.updatedAt = this.timestamp()
    await this.emit(run)
  }

  private async emit(run: BusinessWorkflowRun): Promise<void> {
    await this.onRunChanged?.(clone(run))
  }
}

function topologyMatches(run: BusinessWorkflowRun, definition: BusinessWorkflowDefinition): boolean {
  return run.steps.length === definition.steps.length && run.steps.every((step, index) => {
    const current = definition.steps[index]
    return current?.id === step.id && current.type === step.type
  })
}

function validateDefinition(definition: BusinessWorkflowDefinition): void {
  if (!safeId.test(definition.id)) throw new Error('Workflow id is missing or unsafe.')
  if (!definition.version.trim()) throw new Error(`Workflow version is missing: ${definition.id}`)
  if (!definition.title.trim()) throw new Error(`Workflow title is missing: ${definition.id}`)
  if (definition.steps.length === 0) throw new Error(`Workflow has no steps: ${definition.id}`)
  const stepIds = new Set<string>()
  for (const step of definition.steps) {
    if (!safeId.test(step.id)) throw new Error(`Workflow step id is missing or unsafe: ${definition.id}`)
    if (stepIds.has(step.id)) throw new Error(`Workflow contains duplicate step: ${definition.id}/${step.id}`)
    if (!step.title.trim()) throw new Error(`Workflow step title is missing: ${definition.id}/${step.id}`)
    stepIds.add(step.id)
  }
}

function normalizeError(error: unknown): BusinessWorkflowError {
  if (isWorkflowError(error)) return error
  return {
    code: 'WORKFLOW_STEP_FAILED',
    message: error instanceof Error ? error.message : String(error),
    retryable: true
  }
}

function isWorkflowError(value: unknown): value is BusinessWorkflowError {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.code === 'string'
    && typeof candidate.message === 'string'
    && typeof candidate.retryable === 'boolean'
}

function assertSerializable(value: unknown, label: string): void {
  if (value === undefined) return
  try {
    JSON.stringify(value, (_key, item: unknown) => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
        throw new TypeError(`unsupported ${typeof item} value`)
      }
      return item
    })
  } catch (error) {
    throw new Error(`${label} must be serializable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value
  return structuredClone(value)
}
