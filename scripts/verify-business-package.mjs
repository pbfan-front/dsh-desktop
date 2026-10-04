import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(desktopRoot, 'build', 'business-package')
const businessRoot = resolve(process.env.DSH_BUSINESS_PROJECT || join(desktopRoot, '..', 'demo-test'))
const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'))
const failures = []
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex')
const check = (condition, message) => { if (!condition) failures.push(message) }

check(manifest.schemaVersion === 2, 'manifest schemaVersion must be 2')
check(manifest.type === 'dsh-business-plugin', 'manifest type must be dsh-business-plugin')
check(Boolean(manifest.pluginId), 'manifest pluginId is missing')
check(Boolean(manifest.displayName), 'manifest displayName is missing')
check(Array.isArray(manifest.capabilities) && manifest.capabilities.includes('business-preview'), 'manifest business-preview capability is missing')
check(Array.isArray(manifest.workflows), 'manifest workflows declaration is missing')
check(manifest.workflows.some(workflow => workflow?.id === 'business-scenario-create'), 'manifest business-scenario-create workflow is missing')
const scenarioWorkflow = manifest.workflows.find(workflow => workflow?.id === 'business-scenario-create')
check(scenarioWorkflow?.steps?.some(step => step?.id === 'verify-preview' && step?.gate === 'business.preview-verification'), 'manifest preview verification gate is missing')
check(Boolean(manifest.buildId), 'manifest buildId is missing')
check(Boolean(manifest.packageVersion), 'manifest packageVersion is missing')
check(Boolean(manifest.compatibility?.desktop?.min), 'manifest Desktop minimum version is missing')
check(Boolean(manifest.compatibility?.desktop?.maxExclusive), 'manifest Desktop maximum version is missing')
check(Boolean(manifest.provenance?.createdAt), 'manifest provenance.createdAt is missing; run npm run business:sync')
const packagedBuildId = (await readFile(join(packageRoot, 'platform', '.next', 'BUILD_ID'), 'utf8')).trim()
check(packagedBuildId === manifest.provenance?.platformBuildId, 'packaged Next.js BUILD_ID does not match the manifest')
check(await sha256(join(packageRoot, 'web', manifest.businessPath, 'index.html')) === manifest.provenance?.businessWebEntrySha256, 'packaged business web entry does not match the manifest')
check(await sha256(join(packageRoot, 'source', '.codeIntell', 'index.json')) === manifest.provenance?.codeIntellIndexSha256, 'packaged CodeIntell index does not match the manifest')
const codeIntellRoot = join(packageRoot, 'source', '.codeIntell')
const lifecycleFile = join(codeIntellRoot, 'lifecycle.json')
const packagedRoutes = JSON.parse(await readFile(join(codeIntellRoot, 'routes.json'), 'utf8'))
const routePaths = new Set(Array.isArray(packagedRoutes) ? packagedRoutes.map(route => route?.path) : [])
check(Array.isArray(manifest.targetAliases), 'manifest targetAliases declaration is missing')
for (const declaration of manifest.targetAliases || []) {
  check(typeof declaration?.routePath === 'string' && routePaths.has(declaration.routePath), `target alias route is missing from CodeIntell: ${String(declaration?.routePath)}`)
  check(Array.isArray(declaration?.aliases) && declaration.aliases.length > 0, `target alias list is empty: ${String(declaration?.routePath)}`)
}
let lifecycle
try {
  lifecycle = JSON.parse(await readFile(lifecycleFile, 'utf8'))
  check(lifecycle.schemaVersion === 1, 'unsupported CodeIntell lifecycle schema')
  check(lifecycle.buildId === manifest.buildId, 'CodeIntell build ID does not match the business package')
  check(lifecycle.businessWebEntrySha256 === manifest.provenance?.businessWebEntrySha256, 'CodeIntell is not bound to this business Web build')
  check(await sha256(lifecycleFile) === manifest.provenance?.codeIntellLifecycleSha256, 'CodeIntell lifecycle metadata changed after export')
  for (const [name, hash] of Object.entries(lifecycle.artifacts || {})) {
    check(await sha256(join(codeIntellRoot, name)) === hash, `CodeIntell artifact is corrupt: ${name}`)
  }
} catch (error) {
  failures.push(`cannot verify CodeIntell lifecycle: ${error.message}`)
}

const sourceEntries = Object.entries(manifest.sourceHashes || {}).sort(([a], [b]) => a.localeCompare(b))
check(sourceEntries.length > 0, 'manifest sourceHashes is empty')
for (const [relativeFile, expectedHash] of sourceEntries) {
  const packagedFile = join(packageRoot, relativeFile)
  try {
    check(await sha256(packagedFile) === expectedHash, `packaged source changed after export: ${relativeFile}`)
    const projectFile = join(businessRoot, relativeFile.replace(/^source\//, ''))
    check(await sha256(projectFile) === expectedHash, `business source changed after export: ${relativeFile}; run npm run business:sync`)
  } catch (error) {
    failures.push(`cannot verify ${relativeFile}: ${error.message}`)
  }
}
const sourceDigest = createHash('sha256')
  .update(sourceEntries.map(([file, hash]) => `${file}\0${hash}\n`).join(''))
  .digest('hex')
check(sourceDigest === manifest.provenance?.sourceDigestSha256, 'source digest does not match the manifest')
check(sourceDigest === lifecycle?.sourceDigestSha256, 'CodeIntell source digest does not match packaged source')

try {
  check(await sha256(join(businessRoot, 'mock-platform', 'app', 'page.tsx')) === manifest.provenance?.platformPageSourceSha256, 'mock-platform source changed after export; run npm run business:sync')
  check((await readFile(join(businessRoot, 'mock-platform', '.next', 'BUILD_ID'), 'utf8')).trim() === packagedBuildId, 'mock-platform was rebuilt after export; run npm run business:sync')
} catch (error) {
  failures.push(`cannot verify business project at ${businessRoot}: ${error.message}`)
}

const sourceClient = join(desktopRoot, 'packages', 'dsh-desktop-client-ui', 'client.js')
const installedClient = join(desktopRoot, 'node_modules', 'dsh-desktop-client-ui', 'client.js')
check(await sha256(sourceClient) === await sha256(installedClient), 'local desktop client package is stale; run npm install')
const clientText = await readFile(installedClient, 'utf8')
check(clientText.includes('business-sidebar-preview') && clientText.includes('侧栏体验'), 'desktop client does not contain the sidebar experience entry')
await stat(join(packageRoot, 'platform', 'server.js'))
const integrityEntries = Object.entries(manifest.integrity?.files || {})
check(integrityEntries.length > 0, 'manifest integrity.files is empty')
for (const [relativeFile, expectedHash] of integrityEntries) {
  try {
    check(await sha256(join(packageRoot, relativeFile)) === expectedHash, `business package integrity failed: ${relativeFile}`)
  } catch (error) {
    failures.push(`cannot verify package integrity for ${relativeFile}: ${error.message}`)
  }
}

if (failures.length) {
  console.error(`Business package verification failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, buildId: manifest.buildId, platformBuildId: packagedBuildId, createdAt: manifest.provenance.createdAt }))
