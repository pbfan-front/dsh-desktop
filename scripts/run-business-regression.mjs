import { spawn } from 'node:child_process'
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(desktopRoot, 'build', 'business-package')
const reportRoot = join(desktopRoot, 'build', 'reports', 'business-regression')
const startedAt = new Date()
const steps = [
  {
    id: 'package-verification',
    label: '业务插件完整性',
    script: 'scripts/verify-business-package.mjs',
    args: []
  },
  {
    id: 'runtime-regression',
    label: '业务运行时',
    script: 'scripts/test-business-runtime.mjs',
    args: [packageRoot]
  },
  {
    id: 'golden-scenarios',
    label: '黄金业务场景',
    script: 'scripts/accept-business-scenarios.mjs',
    args: [packageRoot]
  }
]

const runStep = step => new Promise((done, reject) => {
  const stepStartedAt = Date.now()
  const child = spawn(process.execPath, [resolve(desktopRoot, step.script), ...step.args], {
    cwd: desktopRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    const result = {
      id: step.id,
      label: step.label,
      status: code === 0 ? 'passed' : 'failed',
      durationMs: Date.now() - stepStartedAt
    }
    if (code !== 0) {
      reject(Object.assign(new Error(`${step.label}失败（exit=${code ?? 'null'}, signal=${signal || 'none'}）`), {
        stepResult: { ...result, exitCode: code, signal, stdout: stdout.trim(), stderr: stderr.trim() }
      }))
      return
    }
    try {
      result.details = JSON.parse(stdout.trim())
    } catch (error) {
      reject(Object.assign(new Error(`${step.label}输出不是有效 JSON：${error.message}`), {
        stepResult: { ...result, status: 'failed', stdout: stdout.trim(), stderr: stderr.trim() }
      }))
      return
    }
    done(result)
  })
})

const writeReport = async report => {
  await mkdir(reportRoot, { recursive: true })
  const latest = join(reportRoot, 'latest.json')
  const temporary = `${latest}.tmp-${process.pid}`
  const content = `${JSON.stringify(report, null, 2)}\n`
  await writeFile(temporary, content)
  await rename(temporary, latest)

  const timestamp = report.startedAt.replaceAll(':', '-').replaceAll('.', '-')
  const historical = join(reportRoot, `${timestamp}-${report.buildId || 'unknown'}.json`)
  await writeFile(historical, content)
  return { latest, historical }
}

let manifest = {}
try {
  manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'))
} catch {
  // Package verification below reports the actionable manifest failure.
}

const report = {
  schemaVersion: 1,
  status: 'running',
  startedAt: startedAt.toISOString(),
  finishedAt: null,
  durationMs: null,
  pluginId: manifest.pluginId || null,
  packageVersion: manifest.packageVersion || null,
  buildId: manifest.buildId || null,
  steps: []
}

try {
  for (const step of steps) {
    process.stdout.write(`[business:regression] ${step.label}... `)
    const result = await runStep(step)
    report.steps.push(result)
    const suffix = step.id === 'golden-scenarios'
      ? `通过（${result.details.cases?.length || 0} 个场景）`
      : '通过'
    process.stdout.write(`${suffix}\n`)
  }
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = { message: error.message }
  if (error.stepResult) {
    report.steps.push(error.stepResult)
    if (error.stepResult.stderr) process.stderr.write(`${error.stepResult.stderr}\n`)
    if (error.stepResult.stdout) process.stderr.write(`${error.stepResult.stdout}\n`)
  }
  process.stdout.write('失败\n')
  process.exitCode = 1
} finally {
  const finishedAt = new Date()
  report.finishedAt = finishedAt.toISOString()
  report.durationMs = finishedAt.getTime() - startedAt.getTime()
  const paths = await writeReport(report)
  console.log(JSON.stringify({
    ok: report.status === 'passed',
    buildId: report.buildId,
    packageVersion: report.packageVersion,
    goldenScenarioCount: report.steps.find(step => step.id === 'golden-scenarios')?.details?.cases?.length || 0,
    report: paths.latest,
    history: paths.historical
  }, null, 2))
}
