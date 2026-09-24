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

check(manifest.schemaVersion === 1, 'manifest schemaVersion must be 1')
check(Boolean(manifest.buildId), 'manifest buildId is missing')
check(Boolean(manifest.provenance?.createdAt), 'manifest provenance.createdAt is missing; run npm run business:sync')
const packagedBuildId = (await readFile(join(packageRoot, 'platform', '.next', 'BUILD_ID'), 'utf8')).trim()
check(packagedBuildId === manifest.provenance?.platformBuildId, 'packaged Next.js BUILD_ID does not match the manifest')
check(await sha256(join(packageRoot, 'web', manifest.businessPath, 'index.html')) === manifest.provenance?.businessWebEntrySha256, 'packaged business web entry does not match the manifest')
check(await sha256(join(packageRoot, 'source', '.codeIntell', 'index.json')) === manifest.provenance?.codeIntellIndexSha256, 'packaged CodeIntell index does not match the manifest')

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

if (failures.length) {
  console.error(`Business package verification failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, buildId: manifest.buildId, platformBuildId: packagedBuildId, createdAt: manifest.provenance.createdAt }))
