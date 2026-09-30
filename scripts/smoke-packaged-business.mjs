import { fork } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const resources = resolve(process.argv[2] ?? '')
if (!process.argv[2]) {
  console.error('Usage: node scripts/smoke-packaged-business.mjs <app-resources-directory>')
  process.exit(2)
}

const executable = process.platform === 'win32' ? 'node.exe' : 'node'
const runtime = join(resources, 'business-runtime.mjs')
const packageRoot = join(resources, 'business-package')
const node = join(resources, 'app', 'node_modules', 'node', 'bin', executable)
const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'))
const userRoot = await mkdtemp(join(tmpdir(), 'dsh-packaged-business-'))
const token = 'packaged-business-smoke-token-00000000000000000000'
let stderr = ''

const child = fork(runtime, [packageRoot], {
  execPath: node,
  execArgv: [],
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_USER_ROOT: userRoot }
})
child.stderr?.on('data', (data) => { stderr += String(data) })

const outcome = await new Promise((resolveOutcome, reject) => {
  const timer = setTimeout(() => reject(new Error(`Packaged business runtime timed out. ${stderr}`)), 60_000)
  child.once('error', reject)
  child.once('exit', (code) => {
    if (code && code !== 0) reject(new Error(`Packaged business runtime exited (${code}). ${stderr}`))
  })
  child.on('message', (message) => {
    if (message?.type !== 'ready') return
    get(`${message.origin}${manifest.businessPath}`, (response) => {
      let bytes = 0
      response.on('data', (data) => { bytes += data.length })
      response.on('end', () => {
        clearTimeout(timer)
        if (response.statusCode !== 200 || bytes === 0) {
          reject(new Error(`Packaged business entry returned ${response.statusCode} (${bytes} bytes).`))
          return
        }
        resolveOutcome({
          buildId: message.buildId,
          path: manifest.businessPath,
          status: response.statusCode,
          contentType: response.headers['content-type'],
          bytes
        })
      })
    }).on('error', reject)
  })
})

child.kill('SIGTERM')
await new Promise((resolveExit) => child.once('exit', resolveExit))
await rm(userRoot, { recursive: true, force: true })
console.log(JSON.stringify({ ok: true, ...outcome }, null, 2))
