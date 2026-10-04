import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { parseBusinessPluginIdentity, parseBusinessPluginWorkflows, type BusinessPluginIdentity } from './business-plugin-contract'

interface BusinessPackageManifest {
  type?: unknown
  pluginId?: unknown
  projectId?: unknown
  displayName?: unknown
  capabilities?: unknown
  schemaVersion?: unknown
  buildId?: unknown
  packageVersion?: unknown
  compatibility?: { desktop?: { min?: unknown; maxExclusive?: unknown } }
  integrity?: { files?: Record<string, unknown> }
}

interface ActiveBusinessPackage {
  schemaVersion: 1
  pluginId: string
  projectId: string
  activeBuildId: string
  previousBuildId?: string
  updatedAt: string
}

interface BusinessPluginRegistry {
  schemaVersion: 1
  plugins: Array<BusinessPluginIdentity & { packageVersion: string; activeBuildId: string; updatedAt: string }>
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false)
}

function parseVersion(value: string): number[] {
  return (value.split('-', 1)[0] ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0)
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < Math.max(a.length, b.length, 3); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference) return difference
  }
  return 0
}

function safeBuildId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/.test(value)) {
    throw new Error('Business package buildId is missing or unsafe.')
  }
  return value
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function verifyInstallableBusinessPackage(
  packageRoot: string,
  desktopVersion: string
): Promise<{ buildId: string; packageVersion: string } & BusinessPluginIdentity> {
  const canonical = await realpath(packageRoot)
  const manifest = JSON.parse(await readFile(join(canonical, 'manifest.json'), 'utf8')) as BusinessPackageManifest
  if (manifest.schemaVersion !== 2) throw new Error('Only business package schemaVersion 2 can be installed independently.')
  const identity = parseBusinessPluginIdentity(manifest as Record<string, unknown>)
  parseBusinessPluginWorkflows(manifest as Record<string, unknown>)
  const buildId = safeBuildId(manifest.buildId)
  if (typeof manifest.packageVersion !== 'string' || manifest.packageVersion.length === 0) {
    throw new Error('Business package has no packageVersion.')
  }
  const min = manifest.compatibility?.desktop?.min
  const maxExclusive = manifest.compatibility?.desktop?.maxExclusive
  if (typeof min !== 'string' || typeof maxExclusive !== 'string') {
    throw new Error('Business package has no Desktop compatibility range.')
  }
  if (compareVersions(desktopVersion, min) < 0 || compareVersions(desktopVersion, maxExclusive) >= 0) {
    throw new Error(`Business package ${manifest.packageVersion} is incompatible with Desktop ${desktopVersion}.`)
  }
  const files = manifest.integrity?.files
  if (!files || Object.keys(files).length === 0) throw new Error('Business package integrity manifest is empty.')
  for (const [file, expected] of Object.entries(files)) {
    if (typeof expected !== 'string') throw new Error(`Invalid integrity hash for ${file}.`)
    const target = resolve(canonical, file)
    const targetRelative = relative(canonical, target)
    if (!targetRelative || targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
      throw new Error(`Unsafe integrity path: ${file}`)
    }
    if (await sha256(target) !== expected) throw new Error(`Business package integrity check failed: ${file}`)
  }
  return { buildId, packageVersion: manifest.packageVersion, ...identity }
}

export async function installBusinessPackage(
  sourceRoot: string,
  businessDataRoot: string,
  desktopVersion: string
): Promise<{ packageRoot: string; buildId: string; packageVersion: string; pluginId: string; projectId: string }> {
  const verified = await verifyInstallableBusinessPackage(sourceRoot, desktopVersion)
  const pluginsRoot = join(businessDataRoot, 'plugins')
  const packagesRoot = join(pluginsRoot, verified.pluginId, 'packages')
  const destination = join(packagesRoot, verified.buildId)
  const nonce = `${process.pid}-${randomUUID()}`
  const staging = join(packagesRoot, `.staging-${nonce}`)
  await mkdir(packagesRoot, { recursive: true })
  try {
    await cp(sourceRoot, staging, { recursive: true, force: true })
    await verifyInstallableBusinessPackage(staging, desktopVersion)
    if (!(await exists(destination))) await rename(staging, destination)
    else await rm(staging, { recursive: true, force: true })
    const pointerPath = join(pluginsRoot, 'active.json')
    let current: ActiveBusinessPackage | undefined
    try { current = JSON.parse(await readFile(pointerPath, 'utf8')) as ActiveBusinessPackage } catch { /* first install */ }
    const pointer: ActiveBusinessPackage = {
      schemaVersion: 1,
      pluginId: verified.pluginId,
      projectId: verified.projectId,
      activeBuildId: verified.buildId,
      previousBuildId: current?.pluginId === verified.pluginId && current.activeBuildId !== verified.buildId
        ? current.activeBuildId
        : current?.pluginId === verified.pluginId ? current.previousBuildId : undefined,
      updatedAt: new Date().toISOString()
    }
    const temporaryPointer = `${pointerPath}.${nonce}.tmp`
    await writeFile(temporaryPointer, `${JSON.stringify(pointer, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPointer, pointerPath)
    const registryPath = join(pluginsRoot, 'registry.json')
    let registry: BusinessPluginRegistry = { schemaVersion: 1, plugins: [] }
    try { registry = JSON.parse(await readFile(registryPath, 'utf8')) as BusinessPluginRegistry } catch { /* first plugin */ }
    registry.plugins = [
      ...registry.plugins.filter((plugin) => plugin.pluginId !== verified.pluginId),
      {
        pluginId: verified.pluginId,
        projectId: verified.projectId,
        displayName: verified.displayName,
        capabilities: verified.capabilities,
        packageVersion: verified.packageVersion,
        activeBuildId: verified.buildId,
        updatedAt: pointer.updatedAt
      }
    ]
    const temporaryRegistry = `${registryPath}.${nonce}.tmp`
    await writeFile(temporaryRegistry, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryRegistry, registryPath)
    return { packageRoot: destination, ...verified }
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function resolveActiveBusinessPackage(
  bundledPackageRoot: string,
  businessDataRoot: string,
  desktopVersion: string
): Promise<string> {
  try {
    const pointer = JSON.parse(
      await readFile(join(businessDataRoot, 'plugins', 'active.json'), 'utf8')
    ) as ActiveBusinessPackage
    const activeBuildId = safeBuildId(pointer.activeBuildId)
    const activeRoot = join(businessDataRoot, 'plugins', pointer.pluginId, 'packages', activeBuildId)
    await verifyInstallableBusinessPackage(activeRoot, desktopVersion)
    return activeRoot
  } catch {
    return bundledPackageRoot
  }
}

export async function rollbackBusinessPackage(
  businessDataRoot: string,
  desktopVersion: string
): Promise<string> {
  const pluginsRoot = join(businessDataRoot, 'plugins')
  const pointerPath = join(pluginsRoot, 'active.json')
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as ActiveBusinessPackage
  const previousBuildId = safeBuildId(pointer.previousBuildId)
  const previousRoot = join(pluginsRoot, pointer.pluginId, 'packages', previousBuildId)
  await verifyInstallableBusinessPackage(previousRoot, desktopVersion)
  const next: ActiveBusinessPackage = {
    schemaVersion: 1,
    pluginId: pointer.pluginId,
    projectId: pointer.projectId,
    activeBuildId: previousBuildId,
    previousBuildId: safeBuildId(pointer.activeBuildId),
    updatedAt: new Date().toISOString()
  }
  const temporary = `${pointerPath}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, pointerPath)
  return previousRoot
}
