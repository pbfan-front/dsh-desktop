import assert from 'node:assert/strict'
import { spawn, fork, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'
import { BusinessWorkflowRuntime } from '../src/main/business-workflow-runtime'
import { registerBusinessScenarioWorkflow, BUSINESS_SCENARIO_WORKFLOW_ID } from '../src/main/business-scenario-workflow'
import { summarizeBusinessScenarioTiming } from '../src/main/business-scenario-timing'
import { parseBusinessPluginSemanticRules, parseBusinessPluginWorkflows } from '../src/main/business-plugin-contract'
import type { BusinessControlPath } from '../src/main/business-preview'
import type { BusinessWorkflowRun } from '../src/shared/business-workflow'
import { openBusinessPreviewNetwork } from '../scripts/business-preview-network.mjs'
import { summarizeBusinessExperienceCorpus } from '../scripts/business-experience-corpus.mjs'
import { evaluateBusinessExperience } from '../scripts/business-experience-evaluation.mjs'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const businessRoot = resolve(process.env.DSH_BUSINESS_PROJECT || join(desktopRoot, '..', 'demo-test'))
const packageRoot = join(desktopRoot, 'build/business-package')
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms))
const getPath = (input: unknown, path: Array<string | number>): unknown => path.reduce<unknown>((value, part) =>
  value !== null && typeof value === 'object' ? (value as Record<string | number, unknown>)[part] : undefined, input)
const freePort = () => new Promise<number>((done, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port
    server.close(() => done(port))
  })
})
const stop = async (child?: ChildProcess) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>(done => child.once('exit', () => done()))
  child.kill('SIGTERM')
  await Promise.race([exited, pause(5000)])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

const browserTest = process.env.DSH_RUN_BUSINESS_BROWSER_E2E === '1' ? test : test.skip
browserTest('creates an isolated branch, waits for user selection, and verifies a real business page', async () => {
  await access(chromePath)
  const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8')) as Record<string, unknown>
  const sourceRoot = resolve(packageRoot, String(manifest.sourceRoot))
  const mock = JSON.parse(await readFile(join(sourceRoot, 'src/baseTypes/api/loanNbr/loanNbr/mock.json'), 'utf8')) as {
    scenarios: Array<{ id: string; data: { data: { list: Array<{ duestatus: string; loan_acct_no: string }> } } }>
  }
  const fixture = JSON.parse(await readFile(join(desktopRoot, 'scripts/fixtures/business-experience-cases.json'), 'utf8')) as Array<{
    id: string; review: { status: string }; intent: string; routePath: string; apiUrl: string;
    requestPath: string; sourceScenarioId: string;
    mockFields: Array<{ path: Array<string | number>; equals: string }>;
    visibleText: string[]; absentText: string[];
    domAssertion: { containerSelector: string; fields: Array<{ selector: string; equals?: string; includes?: string }> }
  }>
  const approved = [
    { caseId: 'receipt-normal', sourceScenarioId: '正常借据可以提前结清', statusText: '正常' },
    { caseId: 'receipt-overdue', sourceScenarioId: '多个优惠券提示', statusText: '逾期' }
  ].map(spec => {
    const businessCase = fixture.find(item => item.id === spec.caseId)
    assert.equal(businessCase?.review.status, 'approved', `Case ${spec.caseId} needs human approval`)
    assert.equal(businessCase.routePath, '/repay/receiptList')
    assert.equal(businessCase.apiUrl, '/loanNbr/loanNbr.json')
    assert.equal(businessCase.sourceScenarioId, spec.sourceScenarioId)
    assert.equal(businessCase.requestPath, '/mock/mesp-wpm/loanNbr/loanNbr.json')
    const sourceScenario = mock.scenarios.find(item => item.id === spec.sourceScenarioId)
    assert.ok(sourceScenario, `Missing source Scenario ${spec.sourceScenarioId}`)
    for (const field of businessCase.mockFields) {
      const actual = getPath(sourceScenario.data, field.path)
      assert.equal(actual, field.equals, `Source Scenario ${spec.sourceScenarioId} no longer matches ${field.path.join('.')}`)
    }
    const accountNo = sourceScenario.data.data.list[0]?.loan_acct_no
    assert.ok(accountNo)
    return { ...spec, businessCase, accountNo }
  })
  const userRoot = await mkdtemp(join(tmpdir(), 'dsh-create-browser-'))
  let devServer: ChildProcess | undefined
  let runtime: ChildProcess | undefined
  let browser: Awaited<ReturnType<typeof openBusinessPreviewNetwork>> | undefined
  const completedRuns: BusinessWorkflowRun[] = []
  const selections: Array<Record<string, unknown>> = []
  try {
    const port = await freePort()
    const appUrl = `http://127.0.0.1:${port}${manifest.businessPath}`
    let devLog = ''
    const devStartedAt = Date.now()
    devServer = spawn(process.execPath, [join(businessRoot, 'node_modules/@vue/cli-service/bin/vue-cli-service.js'),
      'serve-env', '--mode', 'dev', '--scene', 'local-mock', '--port', String(port)], {
      cwd: businessRoot, env: { ...process.env, NODE_ENV: 'development', VUE_APP_SCENE: 'local-mock',
        LOCAL_MOCK_OVERLAY_ROOT: userRoot },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    for (const stream of [devServer.stdout, devServer.stderr]) stream?.on('data', chunk => {
      devLog = (devLog + chunk.toString()).slice(-10000)
    })
    const devDeadline = Date.now() + 180_000
    while (Date.now() < devDeadline) {
      if (devServer.exitCode !== null) throw new Error(`Business dev server exited: ${devLog}`)
      try {
        const response = await fetch(appUrl, { signal: AbortSignal.timeout(2500) })
        if (response.ok && (await response.text()).includes('<html')) break
      } catch { /* Wait for the dev compiler. */ }
      await pause(1000)
    }
    if (Date.now() >= devDeadline) throw new Error(`Business dev server did not become ready: ${devLog}`)
    const devReadyMs = Date.now() - devStartedAt

    const token = randomBytes(32).toString('hex')
    const workflowToken = randomBytes(32).toString('hex')
    runtime = fork(join(desktopRoot, 'build/business-runtime.mjs'), [packageRoot], {
      cwd: desktopRoot, execPath: process.execPath, execArgv: [],
      env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_WORKFLOW_TOKEN: workflowToken,
        DSH_BUSINESS_USER_ROOT: userRoot, DSH_BUSINESS_APP_URL: appUrl },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    let runtimeLog = ''
    for (const stream of [runtime.stdout, runtime.stderr]) stream?.on('data', chunk => {
      runtimeLog = (runtimeLog + chunk.toString()).slice(-10000)
    })
    const ready = await Promise.race([
      new Promise<{ type: string; origin: string }>((done, reject) => {
        runtime!.once('message', done)
        runtime!.once('exit', code => reject(new Error(`Runtime exited ${code}: ${runtimeLog}`)))
      }),
      pause(60_000).then(() => { throw new Error(`Runtime startup timed out: ${runtimeLog}`) })
    ])
    assert.equal(ready.type, 'ready')
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(`${ready.origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          'X-DSH-Workflow-Token': workflowToken },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
      const result = await response.json() as Record<string, unknown>
      if (!response.ok) throw Object.assign(new Error(String(result.error || `HTTP ${response.status}`)), {
        code: result.code, candidates: result.candidates
      })
      return result
    }
    const workflow = new BusinessWorkflowRuntime()
    const start = registerBusinessScenarioWorkflow({ runtime: workflow, pluginId: String(manifest.pluginId),
      definition: parseBusinessPluginWorkflows(manifest).find(item => item.id === BUSINESS_SCENARIO_WORKFLOW_ID),
      semanticRules: parseBusinessPluginSemanticRules(manifest),
      requestBusiness: (path: BusinessControlPath, body: unknown) => request(path, body) })

    browser = await openBusinessPreviewNetwork({ chromePath, requestPath: approved[0]!.businessCase.requestPath,
      mobileViewport: { width: 402, height: 874, deviceScaleFactor: 3 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })
    await browser.navigate(`${ready.origin}/?desktop=1`)
    const hostDeadline = Date.now() + 15_000
    while (await browser.evaluate<string>('location.origin').catch(() => '') !== ready.origin) {
      if (Date.now() >= hostDeadline) throw new Error('Browser did not reach the isolated Desktop preview origin')
      await pause(100)
    }
    for (const [index, { caseId, sourceScenarioId, statusText, businessCase, accountNo }] of approved.entries()) {
      if (index > 0) {
        await browser.navigate(`${ready.origin}/?desktop=1`)
        const reset: { status: number; body: { profileId: string } } = await browser.evaluate(
          "fetch('/__desktop/default-ui', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(async response => ({ status: response.status, body: await response.json() }))"
        )
        assert.equal(reset.status, 200)
        assert.ok(!reset.body.profileId)
      }
      assert.ok(!(await request('/__desktop/state')).profileId, 'Each creation must begin on the default branch')
      const triggerAt = Date.now()
      const analyzed = await start({ routePath: businessCase.routePath, query: businessCase.intent,
        apiUrls: [businessCase.apiUrl] })
      assert.equal(analyzed.status, 'waiting_for_user')
      assert.equal(analyzed.currentStepId, 'confirm-plan')
      const analysis = analyzed.context.analysis as {
        analysisPlan?: { qualityGate?: { level?: string }; semanticValueChecks?: {
          approvedSources?: Array<{ apiUrl: string; scenarioId: string; status: string }>
        } }
      }
      assert.notEqual(analysis.analysisPlan?.qualityGate?.level, 'insufficient')
      assert.ok(analysis.analysisPlan?.semanticValueChecks?.approvedSources?.some(item =>
        item.apiUrl === businessCase.apiUrl && item.scenarioId === sourceScenarioId && item.status === 'matched'))
      const analyzedAt = Date.now()
      const profileId = `${caseId.replace(/-/g, '_')}_browser_e2e`
      const createdScenarioId = `${profileId}_data`
      const created = await workflow.resume(analyzed.id, { profileId, label: `${statusText}借据浏览器验证`, page: 'receiptList',
        scenarios: [{ id: createdScenarioId, apiUrl: businessCase.apiUrl,
          label: sourceScenarioId, sourceScenarioId }] })
      assert.equal(created.status, 'waiting_for_user')
      assert.equal(created.currentStepId, 'wait-for-preview')
      assert.ok(!(await request('/__desktop/state')).profileId, 'Creating a branch must not activate it')
      const profiles = await request('/__desktop/profiles')
      assert.ok((profiles.profiles as Array<{ id: string }>).some(item => item.id === profileId))
      const createdAt = Date.now()

      const selectedAt = Date.now()
      const selectedResponse: { status: number; body: { profileId: string; url: string } } = await browser.evaluate(
        `fetch('/__desktop/apply-ui', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ profileId }))} }).then(async response => ({ status: response.status, body: await response.json() }))`
      )
      assert.equal(selectedResponse.status, 200)
      const selected = selectedResponse.body
      assert.equal(selected.profileId, profileId)
      const selectedState = await request('/__desktop/state')
      assert.equal(selectedState.profileId, profileId)
      await browser.navigate(String(selected.url))
      const previewDeadline = Date.now() + 45_000
      let pageText = ''
      let domContainers: Array<{ selector: string; fields: Array<{ selector: string; text: string }> }> = []
      let browserHit: (typeof browser.responses)[number] | undefined
      while (Date.now() < previewDeadline) {
        browserHit = browser.responses.find(item => Date.parse(item.timestamp) >= selectedAt
          && item.profileId === profileId && item.scenarioId === createdScenarioId)
        try { pageText = await browser.evaluate<string>('document.body.innerText') || '' } catch { /* Navigation in progress. */ }
        try {
          const containerSelector = businessCase.domAssertion.containerSelector
          const fieldSelectors = businessCase.domAssertion.fields.map(field => field.selector)
          domContainers = await browser.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(containerSelector)})).map(container => ({ selector: ${JSON.stringify(containerSelector)}, fields: ${JSON.stringify(fieldSelectors)}.map(selector => ({ selector, text: container.querySelector(selector)?.textContent?.trim() || '' })) }))`)
        } catch { /* Navigation in progress. */ }
        const cardRendered = domContainers.some(container => businessCase.domAssertion.fields.every(field => {
          const actual = container.fields.find(item => item.selector === field.selector)?.text || ''
          return field.equals === undefined ? actual.includes(field.includes || '') : actual === field.equals
        }))
        if (browserHit && cardRendered && businessCase.visibleText.every(text => pageText.includes(text))) break
        await pause(500)
      }
      assert.ok(browserHit, `No matching browser response for ${caseId}: ${JSON.stringify({
        selectedProfile: selected.profileId,
        capturedResponses: browser.responses.map(item => ({ statusCode: item.statusCode,
          profileId: item.profileId, scenarioId: item.scenarioId })),
        observedPaths: [...browser.observedMockPaths]
      })}`)
      assert.equal(browserHit.statusCode, 200)
      for (const field of businessCase.mockFields) {
        const actual = getPath(browserHit.body, field.path)
        assert.equal(actual, field.equals, `Browser Mock response mismatched ${field.path.join('.')}`)
      }
      assert.ok(domContainers.some(container => businessCase.domAssertion.fields.every(field => {
        const actual = container.fields.find(item => item.selector === field.selector)?.text || ''
        return field.equals === undefined ? actual.includes(field.includes || '') : actual === field.equals
      })), `The ${statusText} status did not render on the card for ${accountNo}`)
      assert.ok(businessCase.visibleText.every(text => pageText.includes(text)))
      assert.ok(businessCase.absentText.every(text => !pageText.includes(text)))
      const observedAt = Date.now()
      const pageUrl = await browser.evaluate<string>('location.href')
      const observation = await request('/__desktop/page-observation-ui', { route: pageUrl,
        title: await browser.evaluate<string>('document.title'), text: pageText })
      assert.equal(observation.status, 'recorded')
      const completed = await workflow.resume(created.id, { route: businessCase.routePath,
        containsText: businessCase.visibleText, absentText: businessCase.absentText })
      assert.equal(completed.status, 'completed')
      assert.equal((await request('/__desktop/state')).verified, true)
      completedRuns.push(completed)
      selections.push({ caseId, runId: completed.id, mode: 'controlled-browser',
        previewEvidence: { selectionAt: new Date(selectedAt).toISOString(), state: selectedState,
          mockResponse: browserHit, page: { capturedAt: new Date(observedAt).toISOString(),
            url: pageUrl, text: pageText, domContainers } } })
      const timing = summarizeBusinessScenarioTiming(completed)
      assert.ok(timing)
      console.log(JSON.stringify({ stage: 'business-create-browser', caseId, ok: true,
        checks: { semanticSourceMatched: true, createdWithoutActivation: true,
          actualMockResponse: true, sameCardStatusRendered: true, workflowVerified: true },
        timingMs: { devReady: index === 0 ? devReadyMs : 0, triggerToPlan: analyzedAt - triggerAt,
          planToCreation: createdAt - analyzedAt, creationToObservedPreview: observedAt - createdAt,
          observedPreviewToVerified: Date.now() - observedAt, triggerToVerified: Date.now() - triggerAt,
          deterministicPhases: timing.phases } }))
    }
    const report = summarizeBusinessExperienceCorpus(fixture, completedRuns, selections)
    const checkStatuses = approved.map(({ caseId, businessCase }, index) => ({ caseId,
      outcome: evaluateBusinessExperience(completedRuns[index], businessCase, selections[index]?.previewEvidence).outcome,
      checks: Object.fromEntries(Object.entries(evaluateBusinessExperience(completedRuns[index], businessCase,
        selections[index]?.previewEvidence).checks).map(([key, value]) => [key, value.status])) }))
    assert.equal(report.controlledRunOutcomes.passed, approved.length, JSON.stringify(checkStatuses))
    assert.equal(report.completedRunOutcomes.passed, 0)
    assert.equal(report.completedRunOutcomes.notVerified,
      fixture.filter(item => item.review.status === 'approved').length)
    // This is a deterministic cross-page regression, not another natural-language corpus pass.
    const normal = approved[0]!
    await browser.navigate(`${ready.origin}/?desktop=1`)
    const defaultPreview = await browser.evaluate<{ url: string }>("fetch('/__desktop/default-ui', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(response => response.json())")
    // Unlike the list's read-only cards, the detail action also needs normal application bootstrap/role state.
    // Enter through the real landing page rather than injecting Vuex permissions into a deep link.
    const landing = new URL(defaultPreview.url)
    landing.hash = String(manifest.entryRoute)
    await browser.navigate(landing.href)
    const landingDeadline = Date.now() + 45_000
    let landingText = ''
    while (Date.now() < landingDeadline) {
      landingText = await browser.evaluate<string>('document.body.innerText').catch(() => '')
      if (['去借钱', '还款查询'].every(text => landingText.includes(text))) break
      await pause(300)
    }
    assert.ok(['去借钱', '还款查询'].every(text => landingText.includes(text)), 'Real landing-page bootstrap did not finish')
    await browser.navigate(`${ready.origin}/?desktop=1`)
    const crossAnalyzed = await start({ routePath: normal.businessCase.routePath,
      query: normal.businessCase.intent, apiUrls: [normal.businessCase.apiUrl] })
    const crossProfileId = 'receipt_cross_page_browser_e2e'
    const crossCreated = await workflow.resume(crossAnalyzed.id, {
      profileId: crossProfileId, label: '正常借据跨页验证', page: 'receiptList',
      scenarios: [{ id: 'receipt_cross_page_data', apiUrl: normal.businessCase.apiUrl, sourceScenarioId: normal.sourceScenarioId }],
      verificationSteps: [
        { id: 'list', label: '列表正常状态', route: normal.businessCase.routePath,
          containsText: normal.businessCase.visibleText, absentText: normal.businessCase.absentText },
        { id: 'detail', label: '详情提前结清入口', route: '/repay/receiptDetail',
          containsText: [normal.accountNo, '正常', '提前结清'], absentText: ['系统繁忙'] }
      ]
    })
    assert.equal(crossCreated.currentStepId, 'wait-for-preview')
    assert.ok(!(await request('/__desktop/state')).profileId, 'The cross-page plan must not activate its new branch')
    const crossSelected = await browser.evaluate<{ url: string }>(
      `fetch('/__desktop/apply-ui', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ profileId: crossProfileId }))} }).then(response => response.json())`
    )
    await browser.navigate(crossSelected.url)
    const capturePage = async (route: string, texts: string[]) => {
      const deadline = Date.now() + 45_000
      let latest: { route: string; title: string; text: string } | undefined
      while (Date.now() < deadline) {
        const observed = await browser!.evaluate<{ route: string; title: string; text: string }>(
          '({route:location.href,title:document.title,text:document.body.innerText})').catch(() => undefined)
        latest = observed || latest
        if (observed && new URL(observed.route).hash.split('?')[0] === `#${route}` && texts.every(text => observed.text.includes(text))) {
          await request('/__desktop/page-observation-ui', observed)
          return observed
        }
        await pause(300)
      }
      throw new Error(`Cross-page preview did not settle on ${route}: ${JSON.stringify({ ...latest,
        text: latest?.text.slice(0, 4000), observedMockPaths: [...browser!.observedMockPaths] })}`)
    }
    await capturePage(normal.businessCase.routePath, normal.businessCase.visibleText)
    const crossList = await workflow.resume(crossCreated.id, { stepId: 'list' })
    assert.equal(crossList.status, 'waiting_for_user')
    assert.equal((await request('/__desktop/state')).verified, false, 'List success alone is not the entire requirement')
    const cardPoint = await browser.evaluate<{ x: number; y: number }>(`(() => {
      const card = Array.from(document.querySelectorAll('.receipt-item-wrapper')).find(card => card.textContent.includes(${JSON.stringify(normal.accountNo)}))
      card.scrollIntoView({block:'center'})
      const rect = card.querySelector('.top-receipt').getBoundingClientRect()
      return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}
    })()`)
    await browser.tap(cardPoint.x, cardPoint.y)
    await capturePage('/repay/receiptDetail', [normal.accountNo, '正常', '提前结清'])
    const crossCompleted = await workflow.resume(crossCreated.id, { stepId: 'detail' })
    assert.equal(crossCompleted.status, 'completed')
    assert.equal((await request('/__desktop/state')).verified, true)
    const crossOutput = crossCompleted.steps.find(step => step.id === 'verify-preview')?.output as { pageSteps: Array<{ id: string }> }
    assert.deepEqual(crossOutput.pageSteps.map(step => step.id), ['list', 'detail'])
    console.log(JSON.stringify({ stage: 'business-cross-page-browser', ok: true,
      checks: { createdWithoutActivation: true, listOnlyNotCompleted: true, detailEntryRendered: true,
        sameRevisionEvidence: true, finalAllBindingsVerified: true }, runId: crossCompleted.id }))
    const reportParent = resolve(process.env.DSH_BUSINESS_E2E_EVIDENCE_ROOT || join(desktopRoot, 'build/reports'))
    await mkdir(reportParent, { recursive: true, mode: 0o700 })
    const reportDirectory = await mkdtemp(join(reportParent, 'business-create-evidence-'))
    await writeFile(join(reportDirectory, 'runs.json'), JSON.stringify({ runs: completedRuns }, null, 2),
      { flag: 'wx', mode: 0o600 })
    await writeFile(join(reportDirectory, 'links.json'), JSON.stringify(selections, null, 2),
      { flag: 'wx', mode: 0o600 })
    await writeFile(join(reportDirectory, 'multi-page-run.json'), JSON.stringify(crossCompleted, null, 2),
      { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ stage: 'controlled-evidence-saved', reportDirectory,
      controlledPassed: report.controlledRunOutcomes.passed, agentPassed: report.completedRunOutcomes.passed }))
  } finally {
    await browser?.close()
    await stop(runtime)
    await stop(devServer)
    await rm(userRoot, { recursive: true, force: true })
  }
}, 240_000)
