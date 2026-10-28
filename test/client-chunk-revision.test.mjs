import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, unlink } from 'node:fs/promises'
import { statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { expect, it } from 'vitest'

it('includes lazy sibling chunks in the immutable owner revision without invalidating for unrelated files', async () => {
  const source = await readFile('node_modules/@deepseek-ai/dsh-client-modules/lib/index.js', 'utf8')
  const hash = source.slice(source.indexOf('function framedHash('), source.indexOf('/** Absolute route prefix'))
  const start = source.indexOf('\tcaptureArtifactBaseline(clientPath) {')
  const end = source.indexOf('\n\t/**', start)
  const { capture, revision } = new Function('createHash', 'statSync', 'readdirSync', 'dirname', 'join', `
    const HASH_REVISION_LENGTH=12;
    const CLIENT_CHUNK=/^client\\.[A-Za-z0-9][A-Za-z0-9._-]*\\.js$/;
    ${hash}
    const holder={${source.slice(start, end)}};
    return {capture:holder.captureArtifactBaseline.bind(holder),revision:artifactRevision};
  `)(createHash, statSync, readdirSync, dirname, join)
  const root = await mkdtemp(join(tmpdir(), 'dsh-chunk-revision-'))
  try {
    const entry = join(root, 'client.js'), chunk = join(root, 'client.experience-flow.js')
    await writeFile(entry, 'entry')
    const plain = revision(capture(entry))
    await writeFile(chunk, 'old completed card')
    const before = capture(entry), oldRevision = revision(before)
    expect(oldRevision).not.toBe(plain)
    await writeFile(join(root, 'README.md'), 'unrelated')
    expect(revision(capture(entry))).toBe(oldRevision)
    await writeFile(chunk, 'completed cards now return null')
    const after = capture(entry)
    expect([after.mtimeMs, after.ctimeMs, after.size]).toEqual([before.mtimeMs, before.ctimeMs, before.size])
    expect(revision(after)).not.toBe(oldRevision)
    await unlink(chunk)
    expect(revision(capture(entry))).toBe(plain)
  } finally { await rm(root, { recursive: true, force: true }) }
})
