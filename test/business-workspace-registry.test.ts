import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { reconcileBusinessWorkspaceRecords } from '../src/main/business-workspace-registry'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; storagePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-business-workspace-registry-'))
  roots.push(root)
  const storagePath = join(root, 'workspace.json')
  await writeFile(storagePath, JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['current', 'empty-old', 'history', 'unrelated'], archivedSessionIds: [] },
    tables: {
      workspaces: {
        current: { path: join(root, 'current'), title: 'demo-test · build-3', sessionIds: [], createdAt: 'a', updatedAt: 'a' },
        'empty-old': { path: join(root, 'old'), title: 'demo-test · build-2', sessionIds: [], createdAt: 'a', updatedAt: 'a' },
        history: { path: join(root, 'history'), title: 'demo-test · build-1', sessionIds: ['session-1'], createdAt: 'a', updatedAt: 'a' },
        unrelated: { path: join(root, 'other'), title: 'other-project', sessionIds: [], createdAt: 'a', updatedAt: 'a' }
      }
    }
  }))
  return { root, storagePath }
}

describe('business Workspace registry reconciliation', () => {
  it('keeps one stable current record and removes only empty legacy records', async () => {
    const { root, storagePath } = await fixture()
    const result = await reconcileBusinessWorkspaceRecords(storagePath, {
      canonicalPath: join(root, 'current'),
      projectId: 'demo-test',
      displayName: '微业贷业务体验',
      knownLegacyPaths: [join(root, 'old'), join(root, 'history')]
    })

    expect(result).toMatchObject({
      changed: true,
      renamed: true,
      removedWorkspaceIds: ['empty-old'],
      preservedWorkspaceIds: ['history']
    })
    const storage = JSON.parse(await readFile(storagePath, 'utf8'))
    expect(storage.global.workspaceIds).toEqual(['current', 'history', 'unrelated'])
    expect(storage.tables.workspaces.current.title).toBe('微业贷业务体验')
    expect(storage.tables.workspaces.history.sessionIds).toEqual(['session-1'])
    expect(storage.tables.workspaces.unrelated.title).toBe('other-project')
    expect(JSON.parse(await readFile(`${storagePath}.business-workspace-backup`, 'utf8')).global.workspaceIds)
      .toEqual(['current', 'empty-old', 'history', 'unrelated'])
  })

  it('does not rewrite unknown storage formats', async () => {
    const { root, storagePath } = await fixture()
    await writeFile(storagePath, JSON.stringify({ unit: { name: 'workspace', version: 99 } }))
    const before = await readFile(storagePath, 'utf8')
    const result = await reconcileBusinessWorkspaceRecords(storagePath, {
      canonicalPath: join(root, 'current'), projectId: 'demo-test', displayName: '业务体验', knownLegacyPaths: []
    })
    expect(result.changed).toBe(false)
    expect(await readFile(storagePath, 'utf8')).toBe(before)
  })
})
