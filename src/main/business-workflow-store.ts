import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BusinessWorkflowRun, BusinessWorkflowStepRun } from '../shared/business-workflow'
import { BusinessWorkflowRuntime, type BusinessWorkflowRuntimeOptions } from './business-workflow-runtime'

const STORE_VERSION = 1

interface BusinessWorkflowStoreDocument {
  version: number
  runs: BusinessWorkflowRun[]
}

export interface BusinessWorkflowLoadResult {
  runs: BusinessWorkflowRun[]
  recoveredInterruptedRuns: number
  quarantinedPath?: string
}

export interface BusinessWorkflowStoreOptions {
  now?: () => Date
  nonce?: () => string
}

export class BusinessWorkflowStore {
  private readonly now: () => Date
  private readonly nonce: () => string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly storagePath: string,
    options: BusinessWorkflowStoreOptions = {}
  ) {
    this.now = options.now ?? (() => new Date())
    this.nonce = options.nonce ?? randomUUID
  }

  async load(): Promise<BusinessWorkflowLoadResult> {
    let raw: string
    try {
      raw = await readFile(this.storagePath, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return { runs: [], recoveredInterruptedRuns: 0 }
      throw error
    }
    try {
      const document = JSON.parse(raw) as unknown
      if (!isStoreDocument(document)) throw new Error('Workflow store schema is invalid.')
      const recoveredAt = this.now().toISOString()
      const recoveredInterruptedRuns = document.runs.filter((run) => run.status === 'pending' || run.status === 'running').length
      return {
        runs: document.runs.map((run) => recoverInterruptedRun(run, recoveredAt)),
        recoveredInterruptedRuns
      }
    } catch {
      const quarantinedPath = `${this.storagePath}.corrupt-${this.now().toISOString().replaceAll(/[:.]/g, '-')}-${this.nonce()}`
      await rename(this.storagePath, quarantinedPath)
      return { runs: [], recoveredInterruptedRuns: 0, quarantinedPath }
    }
  }

  async save(runs: BusinessWorkflowRun[]): Promise<void> {
    const snapshot: BusinessWorkflowStoreDocument = {
      version: STORE_VERSION,
      runs: structuredClone(runs)
    }
    const operation = async () => this.writeAtomically(snapshot)
    this.writeQueue = this.writeQueue.then(operation, operation)
    return this.writeQueue
  }

  private async writeAtomically(document: BusinessWorkflowStoreDocument): Promise<void> {
    const temporary = `${this.storagePath}.${process.pid}.${this.nonce()}.tmp`
    await mkdir(dirname(this.storagePath), { recursive: true })
    try {
      await writeFile(temporary, JSON.stringify(document, null, 2), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.storagePath)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
}

export async function createPersistentBusinessWorkflowRuntime(options: {
  storagePath: string
  runtime?: BusinessWorkflowRuntimeOptions
  store?: BusinessWorkflowStoreOptions
}): Promise<{
  runtime: BusinessWorkflowRuntime
  store: BusinessWorkflowStore
  recovery: BusinessWorkflowLoadResult
}> {
  const store = new BusinessWorkflowStore(options.storagePath, options.store)
  const notifyRunChanged = options.runtime?.onRunChanged
  let runtime: BusinessWorkflowRuntime
  runtime = new BusinessWorkflowRuntime({
    ...options.runtime,
    onRunChanged: async (run) => {
      await store.save(runtime.listRuns())
      await notifyRunChanged?.(run)
    }
  })
  const recovery = await store.load()
  runtime.restoreRuns(recovery.runs)
  if (recovery.recoveredInterruptedRuns > 0) await store.save(runtime.listRuns())
  return { runtime, store, recovery }
}

function recoverInterruptedRun(run: BusinessWorkflowRun, recoveredAt: string): BusinessWorkflowRun {
  const recovered = structuredClone(run)
  if (recovered.status !== 'pending' && recovered.status !== 'running') return recovered
  const interruptedStep = recovered.steps.find((step) => step.id === recovered.currentStepId)
    ?? recovered.steps.find((step) => step.status === 'running')
    ?? recovered.steps.find((step) => step.status === 'pending')
  if (interruptedStep) {
    interruptedStep.status = 'failed'
    interruptedStep.completedAt = recoveredAt
    interruptedStep.error = {
      code: 'WORKFLOW_INTERRUPTED',
      message: 'Desktop exited before this workflow step completed.',
      retryable: true
    }
    recovered.currentStepId = interruptedStep.id
  }
  recovered.status = 'failed'
  recovered.updatedAt = recoveredAt
  return recovered
}

function isStoreDocument(value: unknown): value is BusinessWorkflowStoreDocument {
  if (!isRecord(value) || value.version !== STORE_VERSION || !Array.isArray(value.runs)) return false
  return value.runs.every(isWorkflowRun)
}

function isWorkflowRun(value: unknown): value is BusinessWorkflowRun {
  if (!isRecord(value)) return false
  if (!isString(value.id) || !isString(value.workflowId) || !isString(value.workflowVersion) || !isString(value.pluginId)) return false
  if (!['pending', 'running', 'waiting_for_user', 'completed', 'failed', 'cancelled'].includes(String(value.status))) return false
  if (!isRecord(value.context) || !Array.isArray(value.steps)) return false
  if (!isString(value.createdAt) || !isString(value.updatedAt)) return false
  if (value.currentStepId !== undefined && !isString(value.currentStepId)) return false
  return value.steps.every(isWorkflowStepRun)
}

function isWorkflowStepRun(value: unknown): value is BusinessWorkflowStepRun {
  if (!isRecord(value) || !isString(value.id) || !isString(value.title)) return false
  if (!['deterministic', 'agent', 'checkpoint'].includes(String(value.type))) return false
  if (!['pending', 'running', 'completed', 'failed', 'skipped'].includes(String(value.status))) return false
  if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every(isString)) return false
  if (value.startedAt !== undefined && !isString(value.startedAt)) return false
  if (value.completedAt !== undefined && !isString(value.completedAt)) return false
  if (value.error !== undefined) {
    if (!isRecord(value.error) || !isString(value.error.code) || !isString(value.error.message) || typeof value.error.retryable !== 'boolean') return false
    if (value.error.candidates !== undefined && (!Array.isArray(value.error.candidates) || value.error.candidates.length > 8
      || value.error.candidates.some(candidate => !isRecord(candidate)
        || !isString(candidate.routePath) || candidate.routePath.length > 500
        || !candidate.routePath.startsWith('/') || candidate.routePath.startsWith('//')
        || (candidate.pageTitle !== undefined && (typeof candidate.pageTitle !== 'string' || candidate.pageTitle.length > 200))))) return false
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}
