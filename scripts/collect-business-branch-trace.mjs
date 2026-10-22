import { randomUUID } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { evaluateBranchIsolation, planBusinessBranchTrace } from './business-branch-isolation-evaluation.mjs'
import { openBusinessPreviewNetwork } from './business-preview-network.mjs'

const [caseFile, runId, outputFile] = process.argv.slice(2)
if (!caseFile || !runId) throw new Error('Usage: node scripts/collect-business-branch-trace.mjs <case.json> <run-id> [output-outside-repo.json]')
let traceOutput
if (outputFile) {
  traceOutput = join(await realpath(dirname(resolve(outputFile))), basename(outputFile))
  const repository = await realpath(process.cwd())
  if (traceOutput === repository || traceOutput.startsWith(`${repository}${sep}`)) {
    throw new Error('Raw branch traces must be written outside the repository')
  }
}
const scenario = JSON.parse(await readFile(resolve(caseFile), 'utf8'))
const runs = JSON.parse(await readFile(resolve('build/workflow-runs.json'), 'utf8')).runs
const run = runs.find(item => item.id === runId)
if (!run) throw new Error('A local workflow run is required')
const connection = JSON.parse(await readFile(resolve('build/connection.json'), 'utf8'))
const sessionId = `branch-audit-${randomUUID()}`
const headers = { Authorization: `Bearer ${connection.token}`, 'X-DSH-Session': sessionId }
const get = async path => {
  const response = await fetch(`${connection.origin}${path}`, { headers })
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return response.json()
}
const profiles = await get('/__desktop/profiles')
const plan = planBusinessBranchTrace(run, scenario, profiles.profiles)

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let browser
let sessionStarted = false
let trace
let cleanupError
try {
  browser = await openBusinessPreviewNetwork({ chromePath, requestPath: scenario.branchIsolation.requestPath })
  await browser.navigate(`${connection.origin}/?desktop=1&__dshSession=${encodeURIComponent(sessionId)}`)
  const originDeadline = Date.now() + 15_000
  while (true) {
    let pageOrigin
    try { pageOrigin = await browser.evaluate('location.origin') } catch { /* Navigation replaces the execution context. */ }
    if (pageOrigin === connection.origin) break
    if (Date.now() > originDeadline) throw new Error('Preview page did not navigate to the isolated business session')
    await pause(100)
  }
  const postUi = async (path, body) => {
    const expression = `fetch(${JSON.stringify(`/__desktop/${path}`)}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body || {}))} }).then(async response => ({ status: response.status, body: await response.json() }))`
    const response = await browser.evaluate(expression)
    if (response?.status !== 200) throw new Error(`${path} returned HTTP ${response?.status}`)
    return response.body
  }
  const selectedProfileId = plan.selectedProfileId
  const setProfile = profileId => postUi(profileId ? 'apply-ui' : 'default-ui', profileId ? { profileId } : {})
  sessionStarted = true
  await setProfile(selectedProfileId)
  const snapshots = []
  const capturePhase = async (phase, expectedProfileId) => {
    const transitionAt = new Date().toISOString()
    await setProfile(expectedProfileId)
    await browser.reload()
    const deadline = Date.now() + 60_000
    let firstReadyAt
    while (Date.now() < deadline) {
      const [state, result, evidence] = await Promise.all([
        get('/__desktop/state'), get('/__desktop/result'), get('/__desktop/evidence')
      ])
      const observedAt = Date.parse(evidence.pageObservation?.observedAt || '')
      const response = browser.responses.filter(item => Date.parse(item.timestamp) >= Date.parse(transitionAt)
        && Date.parse(item.timestamp) <= observedAt).at(-1)
      if (state.profileId === expectedProfileId && evidence.pageObservation?.revision === state.revision
        && evidence.pageObservation?.profileId === expectedProfileId && response) {
        firstReadyAt ??= Date.now()
      }
      if (firstReadyAt && Date.now() - firstReadyAt >= 2000) {
        const latest = browser.responses.filter(item => Date.parse(item.timestamp) >= Date.parse(transitionAt)
          && Date.parse(item.timestamp) <= Date.parse(evidence.pageObservation?.observedAt || '')).at(-1)
        if (!latest) { await pause(250); continue }
        const snapshot = { sessionId, transitionAt, state, result, evidence,
          mockResponse: { ...latest, sessionId, revision: state.revision } }
        snapshots.push(snapshot)
        return
      }
      await pause(250)
    }
    throw new Error(`Timed out collecting phase ${phase}; observed Mock paths: ${[...browser.observedMockPaths].slice(-12).join(', ') || 'none'}`)
  }
  for (const { phase, profileId } of plan.phases) await capturePhase(phase, profileId)
  trace = { snapshots }
  const evaluation = evaluateBranchIsolation(run, scenario, trace)
  if (traceOutput) await writeFile(traceOutput, JSON.stringify({ caseId: scenario.id, runId, branchTrace: trace }, null, 2),
    { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ caseReview: scenario.review?.status, outcome: evaluation.outcome,
    checks: evaluation.checks, rawTraceSaved: Boolean(outputFile) }))
} finally {
  if (sessionStarted) {
    try {
      const state = await get('/__desktop/state')
      if (state.profileId) {
        // Cleanup is limited to this newly generated session; Bearer is the documented alternative to GUI origin.
        const response = await fetch(`${connection.origin}/__desktop/default-ui`, { method: 'POST', headers })
        if (!response.ok) throw new Error(`Isolated session cleanup returned HTTP ${response.status}`)
      }
      const cleaned = await get('/__desktop/state')
      if (cleaned.profileId || cleaned.url?.includes('__mockProfile=')) {
        throw new Error('Isolated session did not return to the default Profile')
      }
    } catch (error) { cleanupError = error }
  }
  await browser?.close()
  if (cleanupError) throw cleanupError
}
