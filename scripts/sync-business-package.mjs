import { spawnSync } from 'node:child_process'
import { access, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBusinessBuildPlan } from './business-sync-plan.mjs'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const businessRoot = resolve(process.env.DSH_BUSINESS_PROJECT || join(desktopRoot, '..', 'demo-test'))
const webRoot = resolve(process.env.DSH_BUSINESS_WEB_ROOT || join(businessRoot, '.desktop-build', 'web'))
const destination = join(desktopRoot, 'build', 'business-package')
const stage = `${destination}.next-${process.pid}`
const previous = `${destination}.previous-${process.pid}`
const exportOnly = process.argv.includes('--export-only')

const run = (command, args, cwd, extraEnv = {}) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...extraEnv } })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
}

await access(join(businessRoot, 'mock-platform', 'package.json'))
if (!exportOnly) {
  for (const step of createBusinessBuildPlan({ businessRoot, webRoot, desktopRoot })) {
    console.log(`\n[business:sync] ${step.label}`)
    run(step.command, step.args, step.cwd, step.env)
  }
} else {
  console.log('[business:sync] export-only mode: reusing prebuilt web, index and mock platform outputs')
}
await rm(stage, { recursive: true, force: true })
run(process.execPath, [join(businessRoot, 'scripts', 'dsh-business-plugin.mjs'), 'export', stage], businessRoot, {
  DSH_BUSINESS_WEB_ROOT: webRoot
})

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
