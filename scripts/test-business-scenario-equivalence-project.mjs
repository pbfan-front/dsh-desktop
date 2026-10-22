import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

// Read-only project sampling. Every write and analysis preference is isolated
// from the Desktop user's Profile, active preview and persisted workflow run.
const runId = process.argv[2]
if (!runId) throw new Error('Usage: node scripts/test-business-scenario-equivalence-project.mjs <runId> [connectionFile]')
const connectionFile = resolve(process.argv[3] || 'build/connection.json')
const connection = JSON.parse(await readFile(connectionFile, 'utf8'))
const { runs } = JSON.parse(await readFile(resolve(dirname(connectionFile), 'workflow-runs.json'), 'utf8'))
const run = runs.find(item => item.id === runId)
assert.ok(run?.context?.analysis?.route?.path, 'The run needs an analyzed target')
const userRoot = await mkdtemp(resolve(tmpdir(), 'dsh-equivalence-project-'))
let child
try {
  const paths = new Set(run.context.analysis.apis.map(api => api.mockPath))
  for (const path of paths) {
    assert.ok(typeof path === 'string' && /^src\/baseTypes\/api\/[\w/-]+\/mock\.json$/.test(path), 'Unsafe Mock path')
    const target = resolve(userRoot, path)
    await mkdir(dirname(target), { recursive: true })
    try { await copyFile(resolve(connection.userRoot, path), target) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const token = randomBytes(32).toString('hex')
  const workflowToken = randomBytes(32).toString('hex')
  child = fork(resolve('build/business-runtime.mjs'), [resolve('build/business-package')], {
    execPath: process.execPath, execArgv: [],
    env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_WORKFLOW_TOKEN: workflowToken,
      DSH_BUSINESS_SOURCE_ROOT: connection.sourceRoot, DSH_BUSINESS_USER_ROOT: userRoot },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  const ready = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated Runtime startup timed out')), 60_000)
    child.once('message', value => { clearTimeout(timer); done(value) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Runtime exited: ${code}`)) })
  })
  assert.equal(ready.type, 'ready')
  const request = async (path, body) => {
    const response = await fetch(new URL(path, ready.origin), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-DSH-Workflow-Token': workflowToken, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(String(result.error || `HTTP ${response.status}`).slice(0, 500))
    return result
  }
  const analyze = async enabled => {
    await request('/__desktop/analysis-mode/set', { mode: 'strict', sessionReuse: false, exactScenarioEquivalence: enabled })
    return request('/__desktop/analyze-target', { routePath: run.context.analysis.route.path, query: run.context.query })
  }
  const original = await analyze(false)
  const grouped = await analyze(true)
  const ambiguity = result => result.analysisPlan.qualityGate.gaps.includes('existing-scenario-match-ambiguous')
  assert.equal(ambiguity(original), true, 'The selected project snapshot does not reproduce duplicate ambiguity')
  assert.ok(grouped.analysisPlan.scenarioEquivalence.equivalentCandidateCount > 0)
  assert.equal(ambiguity(grouped), false, 'A distinct state or insufficient evidence still requires review')
  assert.equal((await request('/__desktop/state')).profileId, '', 'Read-only analysis must not activate a Profile')
  console.log(JSON.stringify({ ok: true, scope: 'isolated-current-project-analysis',
    original: { quality: original.analysisPlan.qualityGate.level, ambiguity: ambiguity(original) },
    grouped: { quality: grouped.analysisPlan.qualityGate.level, ambiguity: ambiguity(grouped),
      equivalentCandidateCount: grouped.analysisPlan.scenarioEquivalence.equivalentCandidateCount,
      groups: grouped.analysisPlan.scenarioEquivalence.groups },
    originalCandidatesRetained: grouped.analysisPlan.existingScenarioMatches.length,
    requiresConfirmation: grouped.analysisPlan.suggestedPlan?.requiresConfirmation === true,
    livePreviewChanged: false }))
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(done => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); done() }, 5000)
      child.once('exit', () => { clearTimeout(timer); done() })
      child.kill('SIGTERM')
    })
  }
  await rm(userRoot, { recursive: true, force: true })
}
