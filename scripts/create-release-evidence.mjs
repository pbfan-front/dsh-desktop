import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const outputArg = process.argv[2]
const artifacts = process.argv.slice(3)
if (!outputArg || artifacts.length === 0) {
  console.error('Usage: node scripts/create-release-evidence.mjs <output.json> <artifact...>')
  process.exit(2)
}

async function sha256(path) {
  const hash = createHash('sha256')
  await new Promise((resolveHash, reject) => {
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).once('error', reject).once('end', resolveHash)
  })
  return hash.digest('hex')
}

const root = process.cwd()
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const business = JSON.parse(await readFile(resolve(root, 'build/business-package/manifest.json'), 'utf8'))
const files = []
for (const artifact of artifacts) {
  const path = resolve(root, artifact)
  const metadata = await stat(path)
  if (!metadata.isFile()) throw new Error(`Release artifact is not a file: ${path}`)
  files.push({ name: basename(path), bytes: metadata.size, sha256: await sha256(path) })
}

const evidence = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  desktopVersion: packageJson.version,
  businessBuildId: business.buildId,
  businessCommit: business.businessCommit ?? null,
  businessWorkingTree: business.workingTree === true,
  host: `${process.platform}/${process.arch}`,
  artifacts: files
}
await writeFile(resolve(root, outputArg), `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify(evidence, null, 2))
