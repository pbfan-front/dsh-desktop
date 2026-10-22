import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'

const control = vi.hoisted(() => ({ changeAfterRead: null }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, open: async (...args) => {
    const handle = await actual.open(...args)
    return { stat: () => handle.stat(), close: () => handle.close(), read: async (...readArgs) => {
      const result = await handle.read(...readArgs)
      if (control.changeAfterRead && String(args[0]).endsWith('/src/page.vue')) {
        const change = control.changeAfterRead
        control.changeAfterRead = null
        await change()
      }
      return result
    } }
  } }
})

it('detects a source rewrite during an open read instead of publishing mixed-version snippets', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-source-read-race-')))
  try {
    await mkdir(join(root, 'src')); await mkdir(join(root, '.codeIntell'))
    const sourceFile = join(root, 'src/page.vue')
    await writeFile(sourceFile, 'const status = "before"\n')
    const graph = JSON.stringify({ nodes: [], edges: [] })
    await writeFile(join(root, '.codeIntell/graph.json'), graph)
    const { createBusinessSourceEvidence } = await import('../build/business-source-evidence.mjs')
    const tool = await createBusinessSourceEvidence({ source: root })
    control.changeAfterRead = () => writeFile(sourceFile, 'const status = "changed after read"\n')
    const result = await tool.inspect({ componentFile: 'src/page.vue', identifiers: ['status'],
      graphHash: createHash('sha256').update(graph).digest('hex') })
    expect(result.items).toEqual([])
    expect(result.gaps).toEqual([{ file: 'src/page.vue', code: 'E_SOURCE_REVIEW_CHANGED' }])
    expect(result.unlocatedIdentifiers).toEqual(['status'])
  } finally { control.changeAfterRead = null; await rm(root, { recursive: true, force: true }) }
})
