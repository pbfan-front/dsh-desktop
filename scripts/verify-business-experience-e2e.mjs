import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { evaluateBusinessExperience } from './business-experience-evaluation.mjs'

const descriptor = JSON.parse(await readFile(resolve('build/connection.json'), 'utf8'))
const [scenario] = JSON.parse(await readFile(new URL('./fixtures/business-experience-cases.json', import.meta.url), 'utf8'))
const businessRoot = resolve(process.env.DSH_BUSINESS_PROJECT || '../demo-test')
const mock = JSON.parse(await readFile(join(businessRoot, 'src/baseTypes/api/loanNbr/loanNbr/mock.json'), 'utf8'))
const source = mock.scenarios.find(item => item.id === '正常借据可以提前结清')
assert.ok(source?.data, 'The verified normal-loan source Scenario is missing')
assert.equal(source.data.data.list[0].duestatus, '0')

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sessionId = `bea043-${randomUUID()}`
const profileId = `bea043_${randomUUID().replaceAll('-', '')}`
const headers = { Authorization: `Bearer ${descriptor.token}`, 'Content-Type': 'application/json', 'X-DSH-Session': sessionId }
const post = async (path, body) => {
  const response = await fetch(`${descriptor.origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
const get = async path => {
  const response = await fetch(`${descriptor.origin}${path}`, { headers })
  assert.equal(response.status, 200, `${path} returned HTTP ${response.status}`)
  return response.json()
}

let intentRunId
let qualifiedIntentRunId
let runId
let operationId
let chrome
let chromeRoot
let summary
try {
  // This measures the deterministic intent resolver, not an Agent's own phrasing or tool choice.
  const intent = await post('/__desktop/workflow/start-scenario', { query: scenario.intent })
  assert.equal(intent.status, 200, JSON.stringify(intent.body))
  intentRunId = intent.body.id
  const intentError = intent.body.steps.find(step => step.id === 'analyze-target')?.error?.message || ''
  assert.equal(intent.body.status, 'failed')
  assert.match(intentError, /E_TARGET_ROUTE_AMBIGUOUS/)
  assert.equal((await post('/__desktop/workflow/cancel', { runId: intentRunId })).status, 200)
  intentRunId = undefined

  const qualifiedIntent = await post('/__desktop/workflow/start-scenario', {
    query: '在还款查询页展示正常借据'
  })
  assert.equal(qualifiedIntent.status, 200, JSON.stringify(qualifiedIntent.body))
  qualifiedIntentRunId = qualifiedIntent.body.id
  assert.equal(qualifiedIntent.body.status, 'failed')
  assert.match(qualifiedIntent.body.steps.find(step => step.id === 'analyze-target')?.error?.message || '', /E_TARGET_ROUTE_AMBIGUOUS/)
  assert.equal((await post('/__desktop/workflow/cancel', { runId: qualifiedIntentRunId })).status, 200)
  qualifiedIntentRunId = undefined

  const started = await post('/__desktop/workflow/start-scenario', {
    routePath: scenario.routePath, query: scenario.intent, apiUrls: [scenario.apiUrl]
  })
  assert.equal(started.status, 200, JSON.stringify(started.body))
  runId = started.body.id
  assert.equal(started.body.currentStepId, 'confirm-plan')
  assert.equal(started.body.context.target.source, 'explicit-route')

  const accepted = await post('/__desktop/workflow/resume', {
    runId,
    checkpointOutput: {
      profileId, label: 'BEA-043 隔离端到端样本', page: 'repay',
      scenarios: [{ id: 'bea043_normal', apiUrl: scenario.apiUrl, sourceScenarioId: source.id }]
    }
  })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
  assert.equal(accepted.body.currentStepId, 'wait-for-preview')
  operationId = accepted.body.steps.find(step => step.id === 'create-profile')?.output?.operationId
  assert.match(operationId, /^[0-9a-f-]{36}$/)

  chromeRoot = await mkdtemp(join(tmpdir(), 'dsh-bea043-chrome-'))
  const url = new URL(descriptor.origin)
  url.searchParams.set('desktop', '1')
  url.searchParams.set('__dshSession', sessionId)
  chrome = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--disable-gpu', '--disable-background-networking',
    `--user-data-dir=${chromeRoot}`, '--virtual-time-budget=60000', '--dump-dom', url.href
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let browserOutput = ''
  let browserError = ''
  chrome.stdout.on('data', chunk => { browserOutput = `${browserOutput}${chunk}`.slice(-1000) })
  chrome.stderr.on('data', chunk => { browserError = `${browserError}${chunk}`.slice(-1000) })

  let evidence
  let requestHits = []
  const deadline = Date.now() + 90000
  do {
    evidence = await get('/__desktop/evidence')
    const external = await readFile(join(resolve('build/business-dev-user-data'), '.runtime-evidence.jsonl'), 'utf8')
      .then(raw => raw.trim().split('\n').slice(-200).flatMap(line => {
        try { return [JSON.parse(line)] } catch { return [] }
      })).catch(() => [])
    requestHits = external.filter(item => item.sessionId === sessionId && item.profileId === profileId
      && item.scenarioId === 'bea043_normal' && item.status === 200)
    if (evidence.pageObservation?.route?.includes(scenario.routePath) && requestHits.length > 0) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  } while (Date.now() < deadline)
  const diagnostic = JSON.stringify({ chromeExitCode: chrome.exitCode,
    browserOutput, browserError, observation: evidence.pageObservation && {
      route: evidence.pageObservation.route, text: evidence.pageObservation.text?.slice(0, 400)
    }, requests: evidence.requests.slice(-10).map(item => ({ path: item.path, status: item.status,
      profileId: item.profileId, scenarioId: item.scenarioId })) })
  assert.ok(evidence.pageObservation?.route?.includes(scenario.routePath), `Real browser did not report the target page: ${diagnostic}`)
  assert.ok(requestHits.length > 0, `Real browser did not hit the expected Mock Scenario: ${diagnostic}`)

  const verified = await post('/__desktop/workflow/resume', {
    runId, checkpointOutput: { route: scenario.routePath, containsText: scenario.visibleText, absentText: scenario.absentText }
  })
  assert.equal(verified.status, 200, JSON.stringify(verified.body))
  // Source-clone plans carry an ID, not inline data. Evaluate the actual installed Overlay payload.
  const installedMock = JSON.parse(await readFile(join(resolve('build/business-dev-user-data'),
    'src/baseTypes/api/loanNbr/loanNbr/mock.json'), 'utf8'))
  const installedScenario = installedMock.scenarios.find(item => item.id === 'bea043_normal')
  assert.ok(installedScenario?.data, 'The cloned Scenario is missing from the installed Overlay')
  const evaluationRun = structuredClone(verified.body)
  evaluationRun.context.plan.scenarios.find(item => item.apiUrl === scenario.apiUrl).data = installedScenario.data
  const evaluation = evaluateBusinessExperience(evaluationRun, scenario)
  assert.equal(evaluation.outcome, 'passed', JSON.stringify(evaluation))
  summary = { ok: true, shortIntent: 'ambiguous', qualifiedIntent: 'ambiguous', runId, profileId,
    requestHits: requestHits.length,
    observedRoute: evidence.pageObservation.route, evaluation }
} finally {
  if (intentRunId) await post('/__desktop/workflow/cancel', { runId: intentRunId })
  if (qualifiedIntentRunId) await post('/__desktop/workflow/cancel', { runId: qualifiedIntentRunId })
  if (runId) await post('/__desktop/workflow/cancel', { runId })
  if (operationId) {
    const rollback = await post('/__desktop/rollback', { operationId })
    assert.equal(rollback.status, 200, JSON.stringify(rollback.body))
    const catalog = await get('/__desktop/profiles')
    assert.equal(catalog.profiles.some(item => item.id === profileId), false)
  }
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill('SIGTERM')
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))])
  }
  if (chromeRoot) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await rm(chromeRoot, { recursive: true, force: true }); break }
      catch (error) {
        if (error.code !== 'ENOTEMPTY' || attempt === 4) throw error
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }
  }
}
console.log(JSON.stringify({ ...summary, rolledBack: true }))
