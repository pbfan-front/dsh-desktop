import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureBusinessWorkspace } from '../src/main/business-workspace'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(buildId: string, content: string): Promise<{ packageRoot: string; dataRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-business-workspace-'))
  roots.push(root)
  const packageRoot = join(root, 'package')
  const source = join(packageRoot, 'source')
  const dataRoot = join(root, 'data')
  await mkdir(source, { recursive: true })
  await writeFile(join(packageRoot, 'manifest.json'), JSON.stringify({ buildId, sourceRoot: 'source' }))
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'demo-test' }))
  await writeFile(join(source, 'value.txt'), content)
  return { packageRoot, dataRoot }
}

describe('business workspace materialization', () => {
  it('copies packaged source to a stable user-data path', async () => {
    const { packageRoot, dataRoot } = await fixture('build-1', 'first')
    const workspace = await ensureBusinessWorkspace(packageRoot, dataRoot)

    expect(workspace).toBe(join(dataRoot, 'workspace'))
    expect(await readFile(join(workspace, 'value.txt'), 'utf8')).toBe('first')
  })

  it('refreshes the same path when the packaged build changes', async () => {
    const first = await fixture('build-1', 'first')
    const workspace = await ensureBusinessWorkspace(first.packageRoot, first.dataRoot)
    await writeFile(join(first.packageRoot, 'manifest.json'), JSON.stringify({ buildId: 'build-2', sourceRoot: 'source' }))
    await writeFile(join(first.packageRoot, 'source', 'value.txt'), 'second')

    expect(await ensureBusinessWorkspace(first.packageRoot, first.dataRoot)).toBe(workspace)
    expect(await readFile(join(workspace, 'value.txt'), 'utf8')).toBe('second')
  })
})
