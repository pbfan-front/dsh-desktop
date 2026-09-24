import { spawnSync } from 'node:child_process'
import { access, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const businessRoot = resolve(process.env.DSH_BUSINESS_PROJECT || join(desktopRoot, '..', 'demo-test'))
const webRoot = resolve(process.env.DSH_BUSINESS_WEB_ROOT || join(businessRoot, '.desktop-build', 'web'))
const destination = join(desktopRoot, 'build', 'business-package')
const stage = `${destination}.next-${process.pid}`
const previous = `${destination}.previous-${process.pid}`

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
}

await access(join(businessRoot, 'mock-platform', 'package.json'))
await access(join(webRoot, 'mm2606290', 'index.html'))
await rm(stage, { recursive: true, force: true })
run('npm', ['run', 'build'], join(businessRoot, 'mock-platform'))
run(process.execPath, [join(desktopRoot, 'scripts', 'export-business-package.mjs'), businessRoot, stage, webRoot], desktopRoot)

let movedPrevious = false
try {
  try {
    await rename(destination, previous)
    movedPrevious = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await rename(stage, destination)
  if (movedPrevious) await rm(previous, { recursive: true, force: true })
} catch (error) {
  if (movedPrevious) {
    await rm(destination, { recursive: true, force: true })
    await rename(previous, destination)
  }
  throw error
}

run(process.execPath, [join(desktopRoot, 'scripts', 'verify-business-package.mjs')], desktopRoot)
