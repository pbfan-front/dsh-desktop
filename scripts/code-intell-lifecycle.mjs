import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CODE_INTELL_LIFECYCLE_SCHEMA = 1
export const CODE_INTELL_ARTIFACTS = ['index.json', 'routes.json', 'graph.json', 'file-cache.json']

const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex')

export async function sourceSnapshot(projectRoot) {
  projectRoot = resolve(projectRoot)
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: projectRoot, encoding: 'utf8' }).split('\0').filter(Boolean)
  const hashes = {}
  for (const file of files) {
    if (!(file.startsWith('src/') || file === 'package.json' || /^tsconfig[^/]*\.json$/.test(file))) continue
    try { hashes[file] = await sha256(join(projectRoot, file)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const digest = createHash('sha256')
    .update(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)).map(([file, hash]) => `source/${file}\0${hash}\n`).join(''))
    .digest('hex')
  return { digest, files: Object.keys(hashes).length }
}

export async function createCodeIntellLifecycle(projectRoot, extra = {}) {
  projectRoot = resolve(projectRoot)
  const codeIntellRoot = join(projectRoot, '.codeIntell')
  const artifacts = {}
  for (const name of CODE_INTELL_ARTIFACTS) {
    const file = join(codeIntellRoot, name)
    await stat(file)
    artifacts[name] = await sha256(file)
  }
  const [source, graph, routes, index] = await Promise.all([
    sourceSnapshot(projectRoot),
    readFile(join(codeIntellRoot, 'graph.json'), 'utf8').then(JSON.parse),
    readFile(join(codeIntellRoot, 'routes.json'), 'utf8').then(JSON.parse),
    readFile(join(codeIntellRoot, 'index.json'), 'utf8').then(JSON.parse)
  ])
  return {
    schemaVersion: CODE_INTELL_LIFECYCLE_SCHEMA,
    generatedAt: new Date().toISOString(),
    sourceDigestSha256: source.digest,
    sourceFiles: source.files,
    artifacts,
    coverage: {
      routes: Array.isArray(routes) ? routes.length : 0,
      nodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
      edges: Array.isArray(graph.edges) ? graph.edges.length : 0,
      apiCallers: Object.keys(index.apiCallers || {}).length,
      filesWithApis: Object.keys(index.fileToApis || {}).length
    },
    ...extra
  }
}

export async function writeCodeIntellLifecycle(projectRoot, extra = {}) {
  const lifecycle = await createCodeIntellLifecycle(projectRoot, extra)
  await writeFile(join(resolve(projectRoot), '.codeIntell', 'lifecycle.json'), `${JSON.stringify(lifecycle, null, 2)}\n`)
  return lifecycle
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const projectRoot = resolve(process.argv[2] || process.cwd())
  console.log(JSON.stringify(await writeCodeIntellLifecycle(projectRoot)))
}
