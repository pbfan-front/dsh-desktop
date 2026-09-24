import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

interface BusinessManifest {
  buildId?: unknown
  sourceRoot?: unknown
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false)
}

/**
 * Materialize packaged business source at a stable user-data path.
 *
 * Sessions keep their workspace cwd for their whole lifetime. Pointing that cwd
 * into an installation directory makes it disappear when Windows replaces or
 * repairs the app. A stable copy also gives the Agent sandbox an ordinary
 * user-owned workspace instead of a Program Files/resources directory.
 */
export async function ensureBusinessWorkspace(
  packageRoot: string,
  businessDataRoot: string
): Promise<string> {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8')) as BusinessManifest
  if (typeof manifest.buildId !== 'string' || manifest.buildId.length === 0) {
    throw new Error('Business package has no buildId.')
  }
  if (typeof manifest.sourceRoot !== 'string' || manifest.sourceRoot.length === 0) {
    throw new Error('Business package has no sourceRoot.')
  }

  const packageCanonical = await realpath(packageRoot)
  const source = await realpath(resolve(packageCanonical, manifest.sourceRoot))
  const sourceRelative = relative(packageCanonical, source)
  if (!sourceRelative || sourceRelative.startsWith('..') || isAbsolute(sourceRelative)) {
    throw new Error('Business sourceRoot must stay inside the package.')
  }

  const workspace = join(businessDataRoot, 'workspace')
  const marker = join(workspace, '.dsh-business-build.json')
  try {
    const current = JSON.parse(await readFile(marker, 'utf8')) as { buildId?: unknown }
    if (current.buildId === manifest.buildId && (await exists(join(workspace, 'package.json')))) {
      return workspace
    }
  } catch {
    // Missing or invalid markers are replaced atomically below.
  }

  await mkdir(businessDataRoot, { recursive: true })
  const nonce = `${process.pid}-${randomUUID()}`
  const staging = join(businessDataRoot, `.workspace-staging-${nonce}`)
  const previous = join(businessDataRoot, `.workspace-previous-${nonce}`)
  let movedPrevious = false
  try {
    await cp(source, staging, { recursive: true, force: true })
    await writeFile(
      join(staging, '.dsh-business-build.json'),
      `${JSON.stringify({ buildId: manifest.buildId })}\n`,
      'utf8'
    )
    if (await exists(workspace)) {
      await rename(workspace, previous)
      movedPrevious = true
    }
    await rename(staging, workspace)
    if (movedPrevious) await rm(previous, { recursive: true, force: true })
    return workspace
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    if (movedPrevious && !(await exists(workspace))) {
      await mkdir(dirname(workspace), { recursive: true })
      await rename(previous, workspace).catch(() => undefined)
    }
    throw error
  }
}
