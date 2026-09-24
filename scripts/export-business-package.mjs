import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

// Build outputs are inputs, never generated from an arbitrary npm script here.
// A fresh destination prevents accidental replacement of a previously signed pack.
const [projectArg, destinationArg, webArg, profilesArg] = process.argv.slice(2)
if (!projectArg || !destinationArg || !webArg) throw new Error('Usage: node scripts/export-business-package.mjs PROJECT NEW_DEST WEB_ROOT')
const project = resolve(projectArg)
const destination = resolve(destinationArg)
const web = resolve(webArg)
const runtime = join(project, 'mock-platform/.next/standalone')
await stat(join(runtime, 'server.js'))
const platformSourceFile = join(project, 'mock-platform/app/page.tsx')
const platformBuildIdFile = join(project, 'mock-platform/.next/BUILD_ID')
const businessConfig = await import('node:module').then(({ createRequire }) => createRequire(import.meta.url)(join(project, '__build/config/fe.config.js')))
const businessPath = `/${businessConfig.versionPrefix}${businessConfig.inVersion.replaceAll('.', '')}/`
await stat(join(web, businessPath, 'index.html'))
await mkdir(destination, { recursive: false })
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim()
const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: project, encoding: 'utf8' }).trim())
const files = execFileSync('git', ['ls-files', '-z'], { cwd: project, encoding: 'utf8' }).split('\0').filter(Boolean)
const hashes = {}
for (const file of files) {
  if (!(file.startsWith('src/') || file === 'package.json' || /^tsconfig[^/]*\.json$/.test(file))) continue
  const source = join(project, file)
  const info = await import('node:fs/promises').then(({ lstat }) => lstat(source))
  if (info.isSymbolicLink()) continue // source packages must not reference developer-machine paths
  const bytes = await readFile(source)
  const target = join(destination, 'source', file)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, bytes)
  hashes[`source/${file}`] = createHash('sha256').update(bytes).digest('hex')
}
if (profilesArg) {
  const bytes = await readFile(resolve(profilesArg))
  JSON.parse(bytes.toString('utf8'))
  await writeFile(join(destination, 'source/src/baseTypes/api/mock-profiles.json'), bytes)
  hashes['source/src/baseTypes/api/mock-profiles.json'] = createHash('sha256').update(bytes).digest('hex')
}
const copyFilter = (file) => !/(^|[/\\])\.env(?:\.|$)/.test(file)
await cp(runtime, join(destination, 'platform'), { recursive: true, filter: copyFilter })
await cp(join(project, 'mock-platform/.next/static'), join(destination, 'platform/.next/static'), { recursive: true })
await cp(web, join(destination, 'web'), { recursive: true })
await cp(join(project, '__build/config/localMockMiddleware.js'), join(destination, 'localMockMiddleware.cjs'))
await cp(join(project, '.codeIntell'), join(destination, 'source/.codeIntell'), { recursive: true })
const buildId = `${commit.slice(0, 12)}${dirty ? '-working' : ''}-${Date.now()}`
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex')
const platformBuildId = (await readFile(platformBuildIdFile, 'utf8')).trim()
const provenance = {
  createdAt: new Date().toISOString(),
  platformBuildId,
  platformPageSourceSha256: await sha256(platformSourceFile),
  businessWebEntrySha256: await sha256(join(web, businessPath, 'index.html')),
  codeIntellIndexSha256: await sha256(join(project, '.codeIntell/index.json')),
  sourceDigestSha256: createHash('sha256')
    .update(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)).map(([file, hash]) => `${file}\0${hash}\n`).join(''))
    .digest('hex')
}
await writeFile(join(destination, 'manifest.json'), JSON.stringify({
  schemaVersion: 1, projectId: 'demo-test', buildId, businessCommit: commit, workingTree: dirty, testProfiles: Boolean(profilesArg),
  validation: 'P0 development snapshot; index and web provenance require release-pipeline verification',
  businessPath, entryRoute: '/credit/productCombine', sourceRoot: 'source', webRoot: 'web', platformRoot: 'platform',
  provenance, sourceHashes: hashes
}, null, 2))
console.log(JSON.stringify({ destination, buildId, businessPath, platformBuildId, sourceFiles: Object.keys(hashes).length }))
