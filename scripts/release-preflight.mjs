import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

function option(name, fallback = '') {
  const direct = process.argv.find((item) => item.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}

function pass(message) {
  console.log(`PASS: ${message}`)
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function exists(path) {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
    return false
  }
  pass(`${command} ${args.join(' ')}`)
  return true
}

const root = resolve(option('--root', process.cwd()))
const channel = option('--channel', 'production')
const artifact = option('--artifact')
const reportPath = option('--report')
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const checks = []

if (!['production', 'development'].includes(channel)) {
  fail('--channel must be production or development')
}

try {
  const packageJson = await json(resolve(root, 'package.json'))
  const manifest = await json(resolve(root, 'build/business-package/manifest.json'))
  const builder = packageJson.build ?? {}

  if (!semver.test(packageJson.version ?? '')) fail(`invalid Desktop version: ${packageJson.version}`)
  else pass(`Desktop version ${packageJson.version}`)
  if (builder.asar !== false) fail('release contract currently requires asar=false for packaged runtime access')
  else pass('packaging layout matches runtime contract')
  if (builder.appId !== 'io.dsh.desktop') fail(`unexpected production appId: ${builder.appId}`)
  else pass(`production appId ${builder.appId}`)
  if (!manifest.buildId || typeof manifest.buildId !== 'string') fail('business manifest has no buildId')
  else pass(`business Build ID ${manifest.buildId}`)
  const businessPath = typeof manifest.businessPath === 'string'
    ? manifest.businessPath.replace(/^\/+|\/+$/g, '')
    : ''
  const webRoot = typeof manifest.webRoot === 'string' ? manifest.webRoot : 'web'
  const webEntry = `build/business-package/${webRoot}/${businessPath}/index.html`
  for (const relative of ['build/business-runtime.mjs', 'build/business-mock-store.mjs', 'build/business-control-contract.mjs', webEntry]) {
    if (!(await exists(resolve(root, relative)))) fail(`required packaged resource is missing: ${relative}`)
    else pass(`required resource ${relative}`)
  }
  if (channel === 'production' && /-dev\./.test(packageJson.version)) {
    fail('development version cannot be released on the production channel')
  }
  checks.push({ desktopVersion: packageJson.version, businessBuildId: manifest.buildId, channel })
} catch (error) {
  fail(`source preflight failed: ${error instanceof Error ? error.message : String(error)}`)
}

if (artifact) {
  const target = resolve(root, artifact)
  if (!(await exists(target))) {
    fail(`artifact does not exist: ${target}`)
  } else if (process.platform === 'darwin') {
    if (channel === 'development' && (target.endsWith('.app') || target.endsWith('.dmg'))) {
      pass(`development artifact exists: ${target}`)
    } else if (target.endsWith('.app')) {
      run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', target])
      run('spctl', ['--assess', '--type', 'execute', '--verbose=4', target])
    } else if (target.endsWith('.dmg')) {
      run('codesign', ['--verify', '--verbose=2', target])
      run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', target])
      run('xcrun', ['stapler', 'validate', target])
    } else {
      fail('macOS artifact must be an .app or .dmg')
    }
  } else if (process.platform === 'win32') {
    if (!target.toLowerCase().endsWith('.exe')) fail('Windows artifact must be an .exe')
    else if (channel === 'production') {
      const script = `$s=Get-AuthenticodeSignature -LiteralPath '${target.replaceAll("'", "''")}'; if($s.Status -ne 'Valid'){throw \"Invalid signature: $($s.Status)\"}; if(-not $s.TimeStamperCertificate){throw 'Missing timestamp certificate'}; Write-Output $s.SignerCertificate.Subject`
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    } else pass(`development artifact exists: ${target}`)
  } else {
    fail('artifact signature verification must run on its native macOS or Windows platform')
  }
}

if (reportPath) {
  await writeFile(resolve(root, reportPath), `${JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2)}\n`)
}

if (process.exitCode) process.exit(process.exitCode)
console.log('Release preflight completed successfully.')
