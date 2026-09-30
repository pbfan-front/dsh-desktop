import { spawn } from 'node:child_process'
import { access, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const businessRoot = resolve(process.env.DSH_BUSINESS_PROJECT || join(desktopRoot, '..', 'demo-test'))
const packageRoot = join(desktopRoot, 'build', 'business-package')
const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'))
const userRoot = resolve(process.env.DSH_BUSINESS_DEV_USER_ROOT || join(desktopRoot, 'build', 'business-dev-user-data'))
const appUrl = new URL(manifest.businessPath, process.env.DSH_BUSINESS_DEV_ORIGIN || 'http://127.0.0.1:8094').href
await access(join(businessRoot, 'package.json'))
await mkdir(userRoot, { recursive: true })

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = new Set()
const launch = (command, args, cwd, env) => {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
  children.add(child)
  child.once('exit', code => {
    children.delete(child)
    if (!stopping && code !== 0) stop(code || 1)
  })
  return child
}

let stopping = false
const stop = code => {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 250).unref()
}
process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))

console.log(`[business:dev] app=${appUrl}`)
console.log(`[business:dev] user-data=${userRoot}`)
launch(npm, ['run', 'dev:local-mock'], businessRoot, { LOCAL_MOCK_OVERLAY_ROOT: userRoot })
launch(process.execPath, [join(desktopRoot, 'scripts', 'watch-business-code-intell.mjs'), businessRoot], desktopRoot, {})
launch(npm, ['run', 'dev'], desktopRoot, {
  DSH_BUSINESS_PACKAGE: packageRoot,
  DSH_BUSINESS_APP_URL: appUrl,
  DSH_BUSINESS_SOURCE_ROOT: businessRoot,
  DSH_BUSINESS_USER_ROOT: userRoot
})
