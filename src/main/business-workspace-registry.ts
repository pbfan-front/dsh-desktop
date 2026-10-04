import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

interface WorkspaceRecord {
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

interface WorkspaceStorage {
  unit?: { name?: unknown; version?: unknown }
  global?: { workspaceIds?: unknown; archivedSessionIds?: unknown; [key: string]: unknown }
  tables?: { workspaces?: Record<string, WorkspaceRecord>; [key: string]: unknown }
  [key: string]: unknown
}

export interface BusinessWorkspaceReconcileOptions {
  canonicalPath: string
  projectId: string
  displayName: string
  knownLegacyPaths: string[]
}

export interface BusinessWorkspaceReconcileResult {
  changed: boolean
  renamed: boolean
  removedWorkspaceIds: string[]
  preservedWorkspaceIds: string[]
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false)
}

async function canonicalWhenPresent(path: string): Promise<string> {
  return await realpath(path).catch(() => path)
}

function isWorkspaceRecord(value: unknown): value is WorkspaceRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<WorkspaceRecord>
  return typeof record.path === 'string'
    && typeof record.title === 'string'
    && Array.isArray(record.sessionIds)
    && record.sessionIds.every((id) => typeof id === 'string')
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string'
}

/**
 * Collapse obsolete, empty business Workspace registrations before Harness
 * opens its storage. Sessions are never moved or deleted: a legacy record that
 * owns at least one Session stays available as history.
 */
export async function reconcileBusinessWorkspaceRecords(
  storagePath: string,
  options: BusinessWorkspaceReconcileOptions
): Promise<BusinessWorkspaceReconcileResult> {
  const unchanged: BusinessWorkspaceReconcileResult = {
    changed: false,
    renamed: false,
    removedWorkspaceIds: [],
    preservedWorkspaceIds: []
  }
  if (!(await exists(storagePath))) return unchanged

  const storage = JSON.parse(await readFile(storagePath, 'utf8')) as WorkspaceStorage
  if (storage.unit?.name !== 'workspace' || storage.unit.version !== 2) return unchanged
  if (!Array.isArray(storage.global?.workspaceIds) || !storage.tables?.workspaces) return unchanged
  if (!storage.global.workspaceIds.every((id) => typeof id === 'string')) return unchanged

  const records = storage.tables.workspaces
  if (Object.values(records).some((record) => !isWorkspaceRecord(record))) return unchanged

  const canonicalPath = await canonicalWhenPresent(options.canonicalPath)
  const relatedPaths = new Set(await Promise.all(
    [options.canonicalPath, ...options.knownLegacyPaths].map(canonicalWhenPresent)
  ))
  const projectTitlePrefix = `${options.projectId} · `
  const entries = Object.entries(records)
  const canonicalEntry = entries.find(([, record]) => record.path === canonicalPath)
  let renamed = false

  if (canonicalEntry && canonicalEntry[1].title !== options.displayName) {
    canonicalEntry[1].title = options.displayName
    canonicalEntry[1].updatedAt = new Date().toISOString()
    renamed = true
  }

  const removedWorkspaceIds: string[] = []
  const preservedWorkspaceIds: string[] = []
  for (const [workspaceId, record] of entries) {
    if (canonicalEntry?.[0] === workspaceId) continue
    const belongsToBusiness = relatedPaths.has(record.path) || record.title.startsWith(projectTitlePrefix)
    if (!belongsToBusiness) continue
    if (record.sessionIds.length > 0) {
      preservedWorkspaceIds.push(workspaceId)
      continue
    }
    removedWorkspaceIds.push(workspaceId)
    delete records[workspaceId]
  }

  if (!renamed && removedWorkspaceIds.length === 0) {
    return { ...unchanged, preservedWorkspaceIds }
  }
  const removed = new Set(removedWorkspaceIds)
  storage.global.workspaceIds = storage.global.workspaceIds.filter((id) => !removed.has(id as string))

  const nonce = `${process.pid}-${randomUUID()}`
  const temporary = `${storagePath}.${nonce}.tmp`
  const backup = `${storagePath}.business-workspace-backup`
  await mkdir(dirname(storagePath), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(storage, null, 2)}\n`, { mode: 0o600 })
  await writeFile(backup, await readFile(storagePath), { mode: 0o600 })
  await rename(temporary, storagePath)
  return { changed: true, renamed, removedWorkspaceIds, preservedWorkspaceIds }
}
