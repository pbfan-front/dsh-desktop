import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { writeCodeIntellLifecycle } from './code-intell-lifecycle.mjs'

const projectRoot = resolve(process.argv[2] || process.env.DSH_BUSINESS_PROJECT || process.cwd())
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
await access(join(projectRoot, 'package.json'))

let running = false
let pending = false
let timer
const rebuild = async () => {
  if (running) { pending = true; return }
  running = true
  console.log('[CodeIntell] source changed; refreshing incremental index...')
  const child = spawn(npm, ['run', 'code-intell:index'], { cwd: projectRoot, stdio: 'inherit' })
  const code = await new Promise(resolve => child.once('exit', resolve))
  if (code === 0) {
    const lifecycle = await writeCodeIntellLifecycle(projectRoot, { mode: 'development' })
    console.log(`[CodeIntell] ready: ${lifecycle.coverage.routes} routes, ${lifecycle.coverage.filesWithApis} files with APIs`)
  } else {
    console.error(`[CodeIntell] refresh failed with exit code ${code}; the previous index remains active`)
  }
  running = false
  if (pending) { pending = false; void rebuild() }
}
const schedule = (_event, filename = '') => {
  const value = String(filename).replaceAll('\\', '/')
  if (!value || value.startsWith('.codeIntell/') || value.includes('/node_modules/') || value.includes('/.desktop-build/')) return
  clearTimeout(timer)
  timer = setTimeout(() => void rebuild(), 800)
}

await writeCodeIntellLifecycle(projectRoot, { mode: 'development' }).catch(() => rebuild())
const watcher = watch(join(projectRoot, 'src'), { recursive: true }, schedule)
console.log(`[CodeIntell] watching ${join(projectRoot, 'src')}`)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { watcher.close(); process.exit(0) })
