import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn, fork } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBusinessPreviewNetwork } from './business-preview-network.mjs'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const businessRoot = resolve(process.env.DSH_BUSINESS_PROJECT || join(desktopRoot, '..', 'demo-test'))
const packageRoot = join(desktopRoot, 'build/business-package')
const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'))
const sourceRoot = resolve(packageRoot, manifest.sourceRoot)
const mockRelative = 'src/baseTypes/api/loanNbr/loanNbr/mock.json'
const apiUrl = '/loanNbr/loanNbr.json'
const requestPath = '/mock/mesp-wpm/loanNbr/loanNbr.json'
const evidencePath = '/mesp-wpm/loanNbr/loanNbr.json'
const scenarios = [
  { profileId: 'revision_a', scenarioId: '正常借据可以提前结清', dueStatus: '0', statusText: '正常' },
  { profileId: 'revision_b', scenarioId: '多个优惠券提示', dueStatus: '1', statusText: '逾期' },
  { profileId: 'revision_a', scenarioId: '正常借据可以提前结清', dueStatus: '0', statusText: '正常' }
]
const pause = ms => new Promise(done => setTimeout(done, ms))
const freePort = () => new Promise((done, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => done(port))
  })
})
const stop = async child => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(done => child.once('exit', done))
  child.kill('SIGTERM')
  await Promise.race([exited, pause(5000)])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}
const root = await mkdtemp(join(tmpdir(), 'dsh-revision-browser-'))
let devServer
let runtime
let browser
try {
  const mockFile = join(root, mockRelative)
  const profileFile = join(root, 'src/baseTypes/api/mock-profiles.json')
  await mkdir(dirname(mockFile), { recursive: true })
  const mockText = await readFile(join(sourceRoot, mockRelative), 'utf8')
  const mockConfig = JSON.parse(mockText)
  await writeFile(mockFile, mockText)
  await writeFile(profileFile, JSON.stringify({ schemaVersion: 2, projectId: manifest.projectId,
    profiles: scenarios.slice(0, 2).map(({ profileId, scenarioId }) => ({
      id: profileId, label: profileId, page: 'receiptList', routePath: '/repay/receiptList',
      apis: { [apiUrl]: scenarioId }
    })) }))
  const port = await freePort()
  const appUrl = `http://127.0.0.1:${port}${manifest.businessPath}`
  let devLog = ''
  devServer = spawn(process.execPath, [join(businessRoot, 'node_modules/@vue/cli-service/bin/vue-cli-service.js'),
    'serve-env', '--mode', 'dev', '--scene', 'local-mock', '--port', String(port)], {
    cwd: businessRoot, env: { ...process.env, VUE_APP_SCENE: 'local-mock', LOCAL_MOCK_OVERLAY_ROOT: root },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  for (const stream of [devServer.stdout, devServer.stderr]) stream.on('data', chunk => {
    devLog = (devLog + chunk.toString()).slice(-10000)
  })
  const devDeadline = Date.now() + 180_000
  while (Date.now() < devDeadline) {
    if (devServer.exitCode !== null) throw new Error(`Business dev server exited ${devServer.exitCode}: ${devLog}`)
    try {
      const response = await fetch(appUrl, { signal: AbortSignal.timeout(2500) })
      if (response.ok && (await response.text()).includes('<html')) break
    } catch { /* Wait for the dev compiler to finish. */ }
    await pause(1000)
  }
  if (Date.now() >= devDeadline) throw new Error(`Business dev server did not become ready: ${devLog}`)
  console.log(JSON.stringify({ stage: 'business-dev-ready', appUrl }))
  const token = randomBytes(32).toString('hex')
  const workflowToken = randomBytes(32).toString('hex')
  runtime = fork(join(desktopRoot, 'build/business-runtime.mjs'), [packageRoot], {
    cwd: desktopRoot, execPath: process.execPath, execArgv: [],
    env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_WORKFLOW_TOKEN: workflowToken,
      DSH_BUSINESS_USER_ROOT: root, DSH_BUSINESS_APP_URL: appUrl },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  })
  let runtimeLog = ''
  for (const stream of [runtime.stdout, runtime.stderr]) stream.on('data', chunk => {
    runtimeLog = (runtimeLog + chunk.toString()).slice(-10000)
  })
  const ready = await Promise.race([
    new Promise((done, reject) => {
      runtime.once('message', done)
      runtime.once('exit', code => reject(new Error(`Runtime exited ${code}: ${runtimeLog}`)))
    }),
    pause(60_000).then(() => { throw new Error(`Runtime startup timed out: ${runtimeLog}`) })
  ])
  if (ready.type !== 'ready') throw new Error(`Unexpected runtime startup message: ${JSON.stringify(ready)}`)
  const request = async (path, body) => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      ...(path === '/__desktop/verify' ? { 'X-DSH-Workflow-Token': workflowToken } : {}) }
    const response = await fetch(`${ready.origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    return { status: response.status, body: await response.json() }
  }
  browser = await openBusinessPreviewNetwork({
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', requestPath,
    mobileViewport: { width: 402, height: 874, deviceScaleFactor: 3 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  })
  const samples = []
  for (const [index, { profileId, scenarioId, dueStatus, statusText }] of scenarios.entries()) {
    const expectedItem = mockConfig.scenarios.find(item => item.id === scenarioId)?.data?.data?.list?.[0]
    assert.equal(expectedItem?.duestatus, dueStatus)
    const accountNo = expectedItem?.loan_acct_no
    assert.ok(accountNo)
    const applied = await request('/__desktop/apply-ui', { profileId })
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    const state = applied.body
    if (index > 0) {
      const staleObservation = await request('/__desktop/page-observation-ui', {
        route: `${appUrl}#/repay/receiptList`, title: '借据列表', text: '借据列表'
      })
      assert.equal(staleObservation.status, 202)
      const staleVerification = await request('/__desktop/verify', {
        route: '/repay/receiptList', containsText: ['借据列表'], absentText: []
      })
      assert.equal(staleVerification.status, 422, 'Previous revision requests must not verify the new branch')
      assert.equal(staleVerification.body.checks.scenarios[0].passed, false)
    }
    const transitionAt = Date.now()
    await browser.navigate(state.url)
    const deadline = Date.now() + 90_000
    let match
    let pageText = ''
    let cardRendered = false
    while (Date.now() < deadline) {
      const lines = await readFile(join(root, '.runtime-evidence.jsonl'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return ''
        throw error
      })
      const evidence = lines.trim().split('\n').flatMap(line => {
        try { return [JSON.parse(line)] } catch { return [] }
      })
      match = evidence.find(item => item.sessionId === 'default' && item.revision === state.revision
        && item.revisionId === state.revisionId && item.profileId === profileId
        && item.scenarioId === scenarioId && item.path === evidencePath)
      try { pageText = await browser.evaluate('document.body.innerText') || '' } catch { /* Navigation in progress. */ }
      try {
        cardRendered = await browser.evaluate(`Array.from(document.querySelectorAll('.receipt-item-wrapper')).some(item => item.querySelector('.top-receipt')?.textContent?.includes(${JSON.stringify(accountNo)}) && item.querySelector('.status span')?.textContent?.trim() === ${JSON.stringify(statusText)})`)
      } catch { /* Navigation in progress. */ }
      if (match && pageText.includes('借据列表') && cardRendered) break
      await pause(500)
    }
    assert.ok(match, `No revision-tagged ${scenarioId} request; observed paths: ${[...browser.observedMockPaths].join(', ')}`)
    const pageUrl = await browser.evaluate('location.href')
    assert.ok(pageText.includes('借据列表'),
      `The real business page did not render the target text: ${JSON.stringify({ pageUrl, textSnippet: pageText.slice(0, 300) })}`)
    assert.ok(cardRendered, `The loan card did not render ${statusText} for the selected Scenario`)
    const observed = await request('/__desktop/page-observation-ui', {
      route: pageUrl, title: await browser.evaluate('document.title'), text: pageText
    })
    assert.equal(observed.status, 202)
    const verified = await request('/__desktop/verify', {
      route: '/repay/receiptList', containsText: ['借据列表', accountNo, statusText], absentText: ['系统繁忙']
    })
    assert.equal(verified.status, 200, JSON.stringify(verified.body).slice(0, 1200))
    const browserHit = browser.responses.find(item => Date.parse(item.timestamp) >= transitionAt
      && item.profileId === profileId && item.scenarioId === scenarioId)
    assert.ok(browserHit, `No browser-captured response for ${scenarioId}`)
    assert.equal(browserHit.body?.data?.list?.[0]?.duestatus, dueStatus)
    assert.equal(browserHit.body?.data?.list?.[0]?.loan_acct_no, accountNo)
    samples.push({ revision: state.revision, revisionId: state.revisionId,
      profileId, scenarioId, browserHit: true, externalEvidenceHit: true, fieldRendered: true, verified: true })
    console.log(JSON.stringify({ stage: 'branch-verified', index: index + 1, revision: state.revision, profileId }))
  }
  assert.equal(new Set(samples.map(item => item.revisionId)).size, 3)
  console.log(JSON.stringify({ ok: true, phases: samples }))
} finally {
  await browser?.close()
  await stop(runtime)
  await stop(devServer)
  await rm(root, { recursive: true, force: true })
}
