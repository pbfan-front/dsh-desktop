import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const token = randomBytes(32).toString('hex')
const workflowToken = randomBytes(32).toString('hex')
const userRoot = await mkdtemp(resolve(tmpdir(), 'dsh-business-user-'))
const legacyProfileDir = resolve(userRoot, 'src/baseTypes/api')
const legacyMockDir = resolve(legacyProfileDir, 'refactor/queryMultiEnterpriseListII')
const legacyMockFile = resolve(legacyMockDir, 'mock.json')
const legacyMockConfig = { label: 'legacy', baseData: { status: '0', msg: 'ok', data: { array: [] } },
  scenarios: [{ id: 'legacy_scenario', label: 'Legacy scenario', data: { status: '0', msg: 'ok', data: { array: [] } } }] }
await mkdir(legacyMockDir, { recursive: true })
await writeFile(resolve(legacyProfileDir, 'mock-profiles.json'), JSON.stringify({ version: 1, profiles: [{
  id: 'legacy_profile', label: 'Legacy profile', page: 'productCombine', routePath: '/credit/productCombine',
  apis: { '/refactor/queryMultiEnterpriseListII.json': 'legacy_scenario' }
}] }))
await writeFile(legacyMockFile, JSON.stringify(legacyMockConfig))
const child = fork(resolve('build/business-runtime.mjs'), [resolve(process.argv[2] || 'build/business-package')], {
  execPath: resolve('node_modules/node/bin/node'), execArgv: [],
  env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_WORKFLOW_TOKEN: workflowToken, DSH_BUSINESS_USER_ROOT: userRoot }, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
})
child.stderr.on('data', data => process.stderr.write(data))
const childMessages = []
child.on('message', value => {
  childMessages.push(value)
  if (value?.type === 'workflow-request') {
    child.send({ type: 'workflow-response', id: value.id, ok: true, result: { action: value.action, payload: value.payload } })
  }
})
try {
  const ready = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 60_000)
    child.once('message', value => { clearTimeout(timer); done(value) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Exited ${code}`)) })
  })
  const get = (path, options = {}) => fetch(new URL(path, ready.origin), options)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const workflowHeaders = { ...headers, 'X-DSH-Workflow-Token': workflowToken }
  assert.equal((await get('/__desktop/workflow/start-scenario', { method: 'POST', body: '{}' })).status, 401)
  const workflowBridgeResponse = await get('/__desktop/workflow/start-scenario', {
    method: 'POST', headers: { ...headers, 'X-DSH-Session': 'workflow-test' }, body: JSON.stringify({ routePath: '/credit/productCombine', query: '核额失败' })
  })
  assert.equal(workflowBridgeResponse.status, 200)
  assert.deepEqual(await workflowBridgeResponse.json(), {
    action: 'start-scenario', payload: { routePath: '/credit/productCombine', query: '核额失败', sessionId: 'workflow-test' }
  })
  assert.equal((await get('/__desktop/profiles')).status, 401)
  assert.equal((await get('/__desktop/state', { headers: { Origin: 'https://example.com' } })).status, 403)
  assert.equal((await get('/api/agent/mock', { method: 'POST' })).status, 403)
  const context = await (await get('/__desktop/context', { headers })).json()
  assert.ok(context.sourceRoot.startsWith(resolve('build/business-package')))
  assert.equal(context.userData.schemaVersion, 2)
  assert.equal(context.userData.migrated, true)
  assert.match(context.userData.operationId, /^[0-9a-f-]{36}$/)
  assert.equal(context.codeIntell.state, 'ready', JSON.stringify(context.codeIntell))
  assert.equal(context.codeIntell.fresh, true)
  assert.ok(context.codeIntell.coverage.routes > 0)
  const codeIntellStatus = await (await get('/__desktop/code-intell/status', { headers })).json()
  assert.equal(codeIntellStatus.state, 'ready', JSON.stringify(codeIntellStatus))
  const explicitTargetResponse = await get('/__desktop/resolve-target', {
    method: 'POST', headers, body: JSON.stringify({ routePath: '/repay/receiptList', query: '创建正常借据场景' })
  })
  const explicitTarget = await explicitTargetResponse.json()
  assert.equal(explicitTargetResponse.status, 200, JSON.stringify(explicitTarget))
  assert.equal(explicitTarget.routePath, '/repay/receiptList')
  assert.equal(explicitTarget.source, 'explicit-route')
  const pageHintTargetResponse = await get('/__desktop/resolve-target', {
    method: 'POST', headers, body: JSON.stringify({ targetPage: '收款账户', query: '创建校验失败场景' })
  })
  const pageHintTarget = await pageHintTargetResponse.json()
  assert.equal(pageHintTargetResponse.status, 200, JSON.stringify(pageHintTarget))
  assert.equal(pageHintTarget.routePath, '/loan/receiveAcct')
  assert.equal(pageHintTarget.source, 'page-hint')
  const missingTargetResponse = await get('/__desktop/resolve-target', {
    method: 'POST', headers, body: JSON.stringify({ query: '创建一个普通失败场景' })
  })
  assert.equal(missingTargetResponse.status, 422)
  assert.equal((await missingTargetResponse.json()).code, 'E_TARGET_ROUTE_REQUIRED')
  const defaultAnalysisMode = await (await get('/__desktop/analysis-mode', { headers })).json()
  assert.equal(defaultAnalysisMode.mode, 'strict')
  assert.equal(defaultAnalysisMode.sessionReuse, true)
  assert.equal(defaultAnalysisMode.cacheEntries, 0)
  const assistedModeResponse = await get('/__desktop/analysis-mode/set', {
    method: 'POST', headers, body: JSON.stringify({ mode: 'assisted' })
  })
  assert.equal(assistedModeResponse.status, 200)
  assert.equal((await assistedModeResponse.json()).mode, 'assisted')
  const defaultWorkflowMode = await (await get('/__desktop/workflow-mode', { headers })).json()
  assert.equal(defaultWorkflowMode.mode, 'workflow')
  const blockedLegacy = await get('/__desktop/analyze-target', { method: 'POST', headers, body: JSON.stringify({ routePath: '/repay/receiptList', query: '借据状态正常' }) })
  assert.equal(blockedLegacy.status, 409)
  const legacyModeResponse = await get('/__desktop/workflow-mode/set', { method: 'POST', headers, body: JSON.stringify({ mode: 'legacy' }) })
  assert.equal(legacyModeResponse.status, 200)
  assert.equal((await legacyModeResponse.json()).mode, 'legacy')
  const page = await get('/?desktop=1'); assert.equal(page.status, 200)
  const frame = await get(context.state.url.split('#')[0]); assert.equal(frame.status, 200)
  const catalogResponse = await get('/api/profiles')
  const catalog = await catalogResponse.json()
  assert.equal(catalogResponse.status, 200, JSON.stringify(catalog))
  const profile = catalog.profiles.find(item => item.ok)
  const bad = await get('/__desktop/apply', { method: 'POST', headers, body: JSON.stringify({ profileId: 'nonexistent-profile' }) })
  assert.equal(bad.status, 404)
  const receiptAnalysisResponse = await get('/__desktop/analyze-target', { method: 'POST', headers, body: JSON.stringify({ routePath: '/repay/receiptList', query: '借据状态正常' }) })
  const receiptAnalysis = await receiptAnalysisResponse.json()
  assert.equal(receiptAnalysisResponse.status, 200, JSON.stringify(receiptAnalysis))
  assert.equal(receiptAnalysis.route.path, '/repay/receiptList')
  assert.ok(receiptAnalysis.apis.some(item => item.apiUrl === '/loanNbr/loanNbr.json'), JSON.stringify(receiptAnalysis).slice(0, 4000))
  assert.equal(receiptAnalysis.analysisPlan.strategy, 'existing-scenario-match', JSON.stringify(receiptAnalysis.analysisPlan))
  assert.ok(receiptAnalysis.analysisPlan.focusApiUrls.includes('/loanNbr/loanNbr.json'), JSON.stringify(receiptAnalysis.analysisPlan))
  assert.equal(receiptAnalysis.analysisPlan.candidatePreparation.mockConfigCache.strategy, 'filesystem-metadata-validated')
  assert.ok(receiptAnalysis.analysisPlan.candidatePreparation.mockConfigCache.misses > 0)
  assert.ok(receiptAnalysis.analysisPlan.existingScenarioMatches.some(item => item.apiUrl === '/loanNbr/loanNbr.json' && item.scenarioId === '正常借据可以提前结清'), JSON.stringify(receiptAnalysis.analysisPlan))
  assert.equal(receiptAnalysis.analysisPlan.confidence, 'low')
  assert.equal(receiptAnalysis.analysisPlan.qualityGate.level, 'review')
  assert.equal(receiptAnalysis.analysisPlan.qualityGate.decision, 'review-focused-evidence')
  assert.equal(receiptAnalysis.analysisPlan.qualityGate.autoDraftAllowed, false)
  assert.ok(receiptAnalysis.analysisPlan.qualityGate.gaps.includes('intent-match-not-confident'))
  assert.equal(receiptAnalysis.analysisPlan.repositorySearch, 'only-if-focus-candidates-are-insufficient')
  assert.equal(receiptAnalysis.acceleration.mode, 'assisted')
  assert.equal(receiptAnalysis.acceleration.sourceRevalidated, true)
  assert.equal(receiptAnalysis.analysisReuse.reused, false)
  assert.equal(receiptAnalysis.analysisTimings.reused, false)
  const reusedReceiptAnalysis = await (await get('/__desktop/analyze-target', {
    method: 'POST', headers, body: JSON.stringify({ routePath: '/repay/receiptList', query: '借据状态正常' })
  })).json()
  assert.equal(reusedReceiptAnalysis.analysisReuse.reused, true, JSON.stringify(reusedReceiptAnalysis.analysisReuse))
  assert.equal(reusedReceiptAnalysis.analysisTimings.reused, true)
  assert.ok(reusedReceiptAnalysis.analysisTimings.totalMs >= 0)
  assert.equal(reusedReceiptAnalysis.analysisReuse.scope, 'same-session-exact-input')
  assert.notEqual(reusedReceiptAnalysis.evidenceId, receiptAnalysis.evidenceId)
  assert.deepEqual(reusedReceiptAnalysis.analysisPlan, receiptAnalysis.analysisPlan)
  const otherSessionReceiptAnalysis = await (await get('/__desktop/analyze-target', {
    method: 'POST', headers: { ...headers, 'X-DSH-Session': 'analysis-other-session' },
    body: JSON.stringify({ routePath: '/repay/receiptList', query: '借据状态正常' })
  })).json()
  assert.equal(otherSessionReceiptAnalysis.analysisReuse.reused, false)
  assert.ok(otherSessionReceiptAnalysis.analysisPlan.candidatePreparation.mockConfigCache.hits > 0)
  assert.equal(otherSessionReceiptAnalysis.analysisPlan.candidatePreparation.mockConfigCache.misses, 0)
  const receiveAccountAnalysisResponse = await get('/__desktop/analyze-target', { method: 'POST', headers, body: JSON.stringify({
    routePath: '/loan/receiveAcct', query: '收款账户 校验失败'
  }) })
  const receiveAccountAnalysis = await receiveAccountAnalysisResponse.json()
  assert.equal(receiveAccountAnalysisResponse.status, 200, JSON.stringify(receiveAccountAnalysis))
  assert.equal(receiveAccountAnalysis.analysisTimings.reused, false)
  for (const phase of ['codeIntellRefreshMs', 'preferencesAndReuseLookupMs', 'evidenceDiscoveryMs', 'sourceReadMs',
    'accelerationHintsMs', 'candidatePreparationMs', 'scenarioFieldAnalysisMs', 'rankingAndQualityMs', 'persistenceMs', 'totalMs']) {
    assert.ok(Number.isFinite(receiveAccountAnalysis.analysisTimings[phase]))
    assert.ok(receiveAccountAnalysis.analysisTimings[phase] >= 0)
  }
  assert.ok(receiveAccountAnalysis.analysisTimings.totalMs >= receiveAccountAnalysis.analysisTimings.candidatePreparationMs)
  assert.ok(receiveAccountAnalysis.analysisTimings.counts.relevantSourceFiles > 0)
  assert.ok(receiveAccountAnalysis.analysisTimings.counts.evidenceApiCandidates >= receiveAccountAnalysis.analysisTimings.counts.rankedApis)
  assert.equal(receiveAccountAnalysis.analysisPlan.confidence, 'medium', JSON.stringify(receiveAccountAnalysis.analysisPlan))
  assert.ok(receiveAccountAnalysis.analysisPlan.existingScenarioMatches.some(item => item.scenarioId === '失败返回'), JSON.stringify(receiveAccountAnalysis.analysisPlan))
  const receiveAccountMatch = receiveAccountAnalysis.analysisPlan.existingScenarioMatches.find(item => item.scenarioId === '失败返回')
  assert.ok(receiveAccountMatch.impactScore > 0)
  assert.ok(receiveAccountMatch.consumedFieldCount > 0)
  assert.ok(receiveAccountMatch.reasons.includes('field-impact-consumed'))
  assert.equal(receiveAccountAnalysis.analysisPlan.scenarioRanking.strategy, 'intent-source-and-field-impact')
  assert.equal(receiveAccountAnalysis.analysisPlan.candidatePreparation.strategy, 'bounded-parallel-read')
  assert.equal(receiveAccountAnalysis.analysisPlan.candidatePreparation.concurrency, 8)
  assert.ok(receiveAccountAnalysis.analysisPlan.candidatePreparation.candidateCount > 0)
  assert.ok(receiveAccountAnalysis.analysisPlan.candidatePreparation.preparedCount > 0)
  assert.ok(receiveAccountAnalysis.analysisPlan.candidatePreparation.preparedCount
    <= receiveAccountAnalysis.analysisPlan.candidatePreparation.candidateCount)
  assert.equal(receiveAccountAnalysis.analysisPlan.candidatePreparation.batchCount,
    Math.ceil(receiveAccountAnalysis.analysisPlan.candidatePreparation.candidateCount / 8))
  assert.equal(receiveAccountAnalysis.analysisPlan.candidatePreparation.fieldAnalysisCandidateCount,
    receiveAccountAnalysis.analysisTimings.counts.rankedApis)
  assert.equal(receiveAccountAnalysis.analysisPlan.candidatePreparation.deferredCandidateCount,
    receiveAccountAnalysis.analysisPlan.candidatePreparation.preparedCount
      - receiveAccountAnalysis.analysisPlan.candidatePreparation.fieldAnalysisCandidateCount)
  assert.ok(receiveAccountAnalysis.analysisPlan.candidatePreparation.fieldAnalysisCandidateCount <= 20)
  assert.ok(receiveAccountAnalysis.analysisPlan.candidatePreparation.durationMs >= 0)
  assert.equal(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.strategy, 'single-pass-per-api-field-index')
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.lookupCount > 0)
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.cacheHitCount > 0)
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.sourceIndexBuildCount > 0)
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.sourceIndexReuseCount > 0)
  assert.equal(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.avoidedSourceIndexBuilds,
    receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.sourceIndexReuseCount)
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.indexedFieldCount > 0)
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.indexedOccurrenceCount > 0)
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.indexedLineCount > 0)
  assert.equal(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.avoidedSourceScans,
    receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.lookupCount
      - receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.sourceIndexBuildCount)
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.sourceIndexBuildCount
    < receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.lookupCount)
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.baselineBuildCount > 0)
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.scenarioDiffCount
    > receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.baselineBuildCount)
  assert.equal(receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.avoidedBaselineTraversals,
    receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.scenarioDiffCount
      - receiveAccountAnalysis.analysisPlan.fieldImpactAnalysis.baselineBuildCount)
  assert.equal(receiveAccountAnalysis.analysisPlan.repositorySearch, 'not-needed')
  assert.equal(receiveAccountAnalysis.analysisPlan.qualityGate.level, 'ready')
  assert.equal(receiveAccountAnalysis.analysisPlan.qualityGate.decision, 'proceed-with-confirmation')
  assert.equal(receiveAccountAnalysis.analysisPlan.qualityGate.autoDraftAllowed, true)
  assert.deepEqual(receiveAccountAnalysis.analysisPlan.qualityGate.gaps, [])
  assert.equal(receiveAccountAnalysis.analysisPlan.qualityGate.factors.strongestScenarioHasFieldImpact, true)
  assert.equal(receiveAccountAnalysis.analysisPlan.fieldImpact.apiUrl, '/withdrawal/inputReceiveAcctCheck.json')
  assert.equal(receiveAccountAnalysis.analysisPlan.fieldImpact.scenarioId, '失败返回')
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpact.changedFields.length > 0)
  assert.ok(receiveAccountAnalysis.analysisPlan.fieldImpact.consumedFields.length > 0)
  assert.equal(receiveAccountAnalysis.analysisPlan.fieldImpact.finalUiVerificationRequired, true)
  const receiveAccountApi = receiveAccountAnalysis.apis.find(item => item.apiUrl === '/withdrawal/inputReceiveAcctCheck.json')
  const receiveAccountFailureScenario = receiveAccountApi.scenarios.find(item => item.id === '失败返回')
  assert.ok(receiveAccountFailureScenario.fieldImpact.evidence.some(item => item.evidence.some(value => value.source === 'bounded-source-field-consumption')))
  assert.equal(receiveAccountAnalysis.analysisPlan.suggestedPlan?.kind, 'reuse-existing-scenario', JSON.stringify(receiveAccountAnalysis.analysisPlan))
  assert.equal(receiveAccountAnalysis.analysisPlan.suggestedPlan?.requiresConfirmation, true)
  assert.equal(receiveAccountAnalysis.analysisPlan.suggestedPlan?.scenarios?.[0]?.sourceScenarioId, '失败返回')
  const draftPlan = receiveAccountAnalysis.analysisPlan.suggestedPlan
  const missingDraftSourceResponse = await get('/__desktop/create-profile', { method: 'POST', headers, body: JSON.stringify({
    evidenceId: receiveAccountAnalysis.evidenceId,
    profile: { id: 'missing_draft_source', label: 'Missing draft source', page: draftPlan.page, routePath: '/loan/receiveAcct' },
    scenarios: [{ ...draftPlan.scenarios[0], id: 'missing_draft_source_data', sourceScenarioId: '不存在的场景' }]
  }) })
  assert.equal(missingDraftSourceResponse.status, 422)
  assert.match((await missingDraftSourceResponse.json()).error, /Source Scenario does not exist/)
  const draftCreateResponse = await get('/__desktop/create-profile', { method: 'POST', headers, body: JSON.stringify({
    evidenceId: receiveAccountAnalysis.evidenceId,
    profile: { id: draftPlan.profileId, label: draftPlan.label, page: draftPlan.page, routePath: '/loan/receiveAcct' },
    scenarios: draftPlan.scenarios
  }) })
  const draftCreated = await draftCreateResponse.json()
  assert.equal(draftCreateResponse.status, 201, JSON.stringify(draftCreated))
  assert.equal(draftCreated.validation?.requests?.[0]?.scenarioId, draftPlan.scenarios[0].id)
  assert.equal((await get('/__desktop/rollback', { method: 'POST', headers, body: JSON.stringify({ operationId: draftCreated.operationId }) })).status, 200)
  const cachedReceiptAnalysis = await (await get('/__desktop/analyze-target', {
    method: 'POST', headers, body: JSON.stringify({ routePath: '/repay/receiptList', query: '借据状态正常' })
  })).json()
  assert.equal(cachedReceiptAnalysis.acceleration.usedCache, true, JSON.stringify(cachedReceiptAnalysis.acceleration))
  assert.equal(cachedReceiptAnalysis.acceleration.sourceRevalidated, true)
  const strictModeResponse = await get('/__desktop/analysis-mode/set', {
    method: 'POST', headers, body: JSON.stringify({ mode: 'strict' })
  })
  assert.equal(strictModeResponse.status, 200)
  assert.equal((await strictModeResponse.json()).mode, 'strict')
  const clearAnalysisCacheResponse = await get('/__desktop/analysis-cache/clear', { method: 'POST', headers, body: '{}' })
  assert.equal(clearAnalysisCacheResponse.status, 200)
  assert.equal((await clearAnalysisCacheResponse.json()).cacheEntries, 0)
  const disableSessionReuseResponse = await get('/__desktop/analysis-mode/set', {
    method: 'POST', headers, body: JSON.stringify({ mode: 'strict', sessionReuse: false })
  })
  assert.equal(disableSessionReuseResponse.status, 200)
  assert.equal((await disableSessionReuseResponse.json()).sessionReuse, false)
  const unsupportedExplicit = await get('/__desktop/analyze-target', { method: 'POST', headers, body: JSON.stringify({
    routePath: '/credit/productCombine', query: '不存在的接口', apiUrls: ['/missing/notFound.json']
  }) })
  assert.equal(unsupportedExplicit.status, 422)
  assert.match((await unsupportedExplicit.json()).error, /^E_API_ROUTE_EVIDENCE_GAP:/)
  const firstMockAnalysisResponse = await get('/__desktop/analyze-target', { method: 'POST', headers, body: JSON.stringify({
    routePath: '/face/home', query: 'KYC 刷脸', apiUrls: ['/cloudiii/getKycFaceId.json']
  }) })
  const firstMockAnalysis = await firstMockAnalysisResponse.json()
  assert.equal(firstMockAnalysisResponse.status, 200, JSON.stringify(firstMockAnalysis))
  assert.equal(firstMockAnalysis.analysisPlan.strategy, 'explicit-api')
  assert.deepEqual(firstMockAnalysis.analysisPlan.focusApiUrls, ['/cloudiii/getKycFaceId.json'])
  assert.equal(firstMockAnalysis.analysisPlan.confidence, 'high')
  assert.equal(firstMockAnalysis.analysisPlan.qualityGate.level, 'ready')
  assert.equal(firstMockAnalysis.analysisPlan.qualityGate.autoDraftAllowed, false)
  assert.equal(firstMockAnalysis.analysisPlan.qualityGate.factors.explicitApiCount, 1)
  assert.equal(firstMockAnalysis.analysisReuse.enabled, false)
  assert.equal(firstMockAnalysis.analysisReuse.reused, false)
  const repeatedWithoutReuse = await (await get('/__desktop/analyze-target', { method: 'POST', headers, body: JSON.stringify({
    routePath: '/face/home', query: 'KYC 刷脸', apiUrls: ['/cloudiii/getKycFaceId.json']
  }) })).json()
  assert.equal(repeatedWithoutReuse.analysisReuse.enabled, false)
  assert.equal(repeatedWithoutReuse.analysisReuse.reused, false)
  const restoreSessionReuseResponse = await get('/__desktop/analysis-mode/set', {
    method: 'POST', headers, body: JSON.stringify({ mode: 'strict', sessionReuse: true })
  })
  assert.equal(restoreSessionReuseResponse.status, 200)
  assert.equal((await restoreSessionReuseResponse.json()).sessionReuse, true)
  const missingMockApi = firstMockAnalysis.apis.find(item => item.apiUrl === '/cloudiii/getKycFaceId.json')
  assert.equal(missingMockApi?.mockExists, false, JSON.stringify(missingMockApi))
  assert.equal(missingMockApi?.canGenerate, true, JSON.stringify(missingMockApi))
  assert.match(missingMockApi?.typeEvidence?.response || '', /Rsp\.ts$/)
  const firstMockResponse = await get('/__desktop/create-profile', { method: 'POST', headers, body: JSON.stringify({
    evidenceId: firstMockAnalysis.evidenceId,
    profile: { id: 'generated_first_mock', label: 'Generated first mock', page: 'face', routePath: '/face/home' },
    scenarios: [{ id: 'generated_success', apiUrl: '/cloudiii/getKycFaceId.json', data: { data: {} } }]
  }) })
  const firstMockCreated = await firstMockResponse.json()
  assert.equal(firstMockResponse.status, 201, JSON.stringify(firstMockCreated))
  assert.equal(firstMockCreated.validation?.requests?.[0]?.scenarioId, 'generated_success')
  assert.equal((await get('/__desktop/rollback', { method: 'POST', headers, body: JSON.stringify({ operationId: firstMockCreated.operationId }) })).status, 200)
  const legacyCacheWarmResponse = await get('/__desktop/analyze-target', { method: 'POST', headers, body: JSON.stringify({
    routePath: '/credit/productCombine', query: 'Legacy scenario'
  }) })
  assert.equal(legacyCacheWarmResponse.status, 200, await legacyCacheWarmResponse.text())
  await writeFile(legacyMockFile, `${JSON.stringify(legacyMockConfig, null, 2)}\n`)
  const unprovenImpactAnalysisResponse = await get('/__desktop/analyze-target', { method: 'POST',
    headers: { ...headers, 'X-DSH-Session': 'cache-invalidation' }, body: JSON.stringify({
    routePath: '/credit/productCombine', query: 'Legacy scenario'
  }) })
  const unprovenImpactAnalysis = await unprovenImpactAnalysisResponse.json()
  assert.equal(unprovenImpactAnalysisResponse.status, 200, JSON.stringify(unprovenImpactAnalysis))
  assert.ok(unprovenImpactAnalysis.analysisPlan.candidatePreparation.mockConfigCache.invalidations > 0)
  assert.equal(unprovenImpactAnalysis.analysisPlan.existingScenarioMatches[0]?.scenarioId, 'legacy_scenario')
  assert.equal(unprovenImpactAnalysis.analysisPlan.existingScenarioMatches[0]?.impactScore, 0)
  assert.ok(!unprovenImpactAnalysis.analysisPlan.existingScenarioMatches[0]?.reasons.includes('field-impact-consumed'))
  assert.equal(unprovenImpactAnalysis.analysisPlan.fieldImpact.status, 'unproven')
  assert.equal(unprovenImpactAnalysis.analysisPlan.qualityGate.level, 'review')
  assert.equal(unprovenImpactAnalysis.analysisPlan.qualityGate.autoDraftAllowed, false)
  assert.ok(unprovenImpactAnalysis.analysisPlan.qualityGate.gaps.includes('matched-scenario-field-impact-unproven'))
  assert.equal(unprovenImpactAnalysis.analysisPlan.suggestedPlan, undefined)
  const analysisResponse = await get('/__desktop/analyze-target', { method: 'POST', headers, body: JSON.stringify({ routePath: '/credit/productCombine', query: '企业额度', apiUrls: ['/refactor/queryMultiEnterpriseListII.json'] }) })
  const analysis = await analysisResponse.json()
  assert.equal(analysisResponse.status, 200, JSON.stringify(analysis))
  assert.equal(analysis.route.path, '/credit/productCombine')
  assert.match(analysis.route.component, /views\/credit\/productCombine\/index\.vue$/)
  const analyzedApi = analysis.apis.find(item => item.apiUrl === '/refactor/queryMultiEnterpriseListII.json')
  assert.ok(analyzedApi, JSON.stringify(analysis).slice(0, 4000))
  assert.ok(analyzedApi.envelopeFields.includes('status'))
  assert.ok(analyzedApi.fields.some(field => field.includes('array')))
  let checked = 0
  if (profile) {
    childMessages.length = 0
    const uiApplied = await get('/__desktop/apply-ui', { method: 'POST', headers: { Origin: ready.origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: profile.id }) })
    assert.equal(uiApplied.status, 200)
    const appliedResponse = await get('/__desktop/apply', { method: 'POST', headers, body: JSON.stringify({ profileId: profile.id }) })
    assert.equal(appliedResponse.status, 200)
    await new Promise(done => setTimeout(done, 20))
    assert.ok(!childMessages.some(item => item?.type === 'show-preview'), 'Profile apply must stay in the persistent sidebar preview')
  }
  const invalidEnvelope = await get('/__desktop/create-profile', { method: 'POST', headers, body: JSON.stringify({
    evidenceId: analysis.evidenceId, profile: { id: 'bad_envelope', label: 'Bad envelope', page: 'productCombine', routePath: '/credit/productCombine' },
    scenarios: [{ id: 'bad_nested', apiUrl: '/refactor/queryMultiEnterpriseListII.json', data: { data: { data: { array: [] } } } }]
  }) })
  assert.equal(invalidEnvelope.status, 422)
  assert.match((await invalidEnvelope.json()).error, /duplicated data envelope/)
  const missingApi = await get('/__desktop/create-profile', { method: 'POST', headers, body: JSON.stringify({
    evidenceId: analysis.evidenceId, profile: { id: 'missing_api', label: 'Missing API', page: 'productCombine', routePath: '/credit/productCombine' },
    scenarios: [{ id: 'missing_api_scenario', apiUrl: '/missing/notFound.json', data: { data: {} } }]
  }) })
  assert.equal(missingApi.status, 422)
  assert.match((await missingApi.json()).error, /not established by business_analyze_target/)
  const duplicateApi = await get('/__desktop/create-profile', { method: 'POST', headers, body: JSON.stringify({
    evidenceId: analysis.evidenceId, profile: { id: 'duplicate_api', label: 'Duplicate API', page: 'productCombine', routePath: '/credit/productCombine' },
    scenarios: [
      { id: 'duplicate_one', apiUrl: '/refactor/queryMultiEnterpriseListII.json', data: { data: { array: [] } } },
      { id: 'duplicate_two', apiUrl: '/refactor/queryMultiEnterpriseListII.json', data: { data: { array: [] } } }
    ]
  }) })
  assert.equal(duplicateApi.status, 422)
  assert.match((await duplicateApi.json()).error, /one scenario binding is allowed per API/)
  const createdResponse = await get('/__desktop/create-profile', { method: 'POST', headers, body: JSON.stringify({
    evidenceId: analysis.evidenceId, profile: { id: 'p1_user_test', label: 'P1 user test', page: 'productCombine', routePath: '/credit/productCombine' },
    scenarios: [{ id: 'p1_normal', apiUrl: '/refactor/queryMultiEnterpriseListII.json', data: { data: { array: [{ id: 'P1' }] } } }]
  }) })
  const created = await createdResponse.json()
  assert.equal(createdResponse.status, 201, JSON.stringify(created))
  assert.equal(created.validation?.ok, true)
  assert.match(created.operationId, /^[0-9a-f-]{36}$/)
  assert.ok((await (await get('/__desktop/profiles', { headers })).json()).profiles.some(item => item.id === 'p1_user_test'))
  const refreshedCatalog = await (await get('/api/profiles')).json()
  const userSummary = refreshedCatalog.profiles.find(item => item.id === 'p1_user_test')
  assert.equal(userSummary?.ok, true, JSON.stringify(userSummary))
  assert.equal(userSummary?.apis?.[0]?.scenarioId, 'p1_normal')
  const userDataStatus = await (await get('/__desktop/user-data/status', { headers })).json()
  assert.equal(userDataStatus.schemaVersion, 2)
  assert.match(userDataStatus.persistence, /Preserved across upgrades/)
  const exported = await (await get('/__desktop/user-data/export', { headers })).json()
  assert.equal(exported.kind, 'dsh-business-user-mocks')
  assert.equal(exported.schemaVersion, 2)
  assert.ok(exported.profiles.some(item => item.id === 'p1_user_test'))
  assert.ok(exported.mocks['/refactor/queryMultiEnterpriseListII.json'])
  const collisionImport = await get('/__desktop/user-data/import', { method: 'POST', headers, body: JSON.stringify({ package: exported }) })
  assert.equal(collisionImport.status, 409)
  assert.equal((await get('/__desktop/rollback', { method: 'POST', headers, body: JSON.stringify({ operationId: created.operationId }) })).status, 200)
  const importedResponse = await get('/__desktop/user-data/import', { method: 'POST', headers, body: JSON.stringify({ package: exported, replaceExisting: true }) })
  const imported = await importedResponse.json()
  assert.equal(importedResponse.status, 201, JSON.stringify(imported))
  assert.deepEqual(new Set(imported.importedProfiles), new Set(['legacy_profile', 'p1_user_test']))
  assert.ok((await (await get('/__desktop/profiles', { headers })).json()).profiles.some(item => item.id === 'p1_user_test'))
  assert.equal((await get('/__desktop/apply', { method: 'POST', headers, body: JSON.stringify({ profileId: 'p1_user_test' }) })).status, 200)
  const userMock = await get('/mock/refactor/queryMultiEnterpriseListII.json', { method: 'POST', body: '{}' })
  const userPayload = await userMock.json()
  assert.equal(userPayload.status, '0', 'Missing response-envelope fields must be restored from baseData')
  assert.equal(userPayload.data.array[0].id, 'P1', JSON.stringify({ profile: userMock.headers.get('x-local-mock-profile'), scenario: userMock.headers.get('x-local-mock-scenario'), userPayload }))
  const sessionAHeaders = { ...headers, 'X-DSH-Session': 'session-a' }
  const sessionBHeaders = { ...headers, 'X-DSH-Session': 'session-b' }
  assert.equal((await get('/__desktop/apply', { method: 'POST', headers: sessionAHeaders, body: JSON.stringify({ profileId: 'p1_user_test' }) })).status, 200)
  const contextA = await (await get('/__desktop/context', { headers: sessionAHeaders })).json()
  const contextB = await (await get('/__desktop/context', { headers: sessionBHeaders })).json()
  assert.equal(contextA.sessionId, 'session-a')
  assert.equal(contextA.state.profileId, 'p1_user_test')
  assert.equal(contextB.sessionId, 'session-b')
  assert.equal(contextB.state.profileId, '')
  const sessionAMock = await get('/mock/refactor/queryMultiEnterpriseListII.json', { method: 'POST', headers: { Cookie: 'dsh_business_session=session-a' }, body: '{}' })
  assert.equal(sessionAMock.headers.get('x-local-mock-profile'), 'p1_user_test')
  assert.equal(sessionAMock.headers.get('x-local-mock-scenario'), 'p1_normal')
  const sessionBMock = await get('/mock/refactor/queryMultiEnterpriseListII.json', { method: 'POST', headers: { Cookie: 'dsh_business_session=session-b' }, body: '{}' })
  assert.notEqual(sessionBMock.headers.get('x-local-mock-profile'), 'p1_user_test')
  const observed = await get('/__desktop/page-observation-ui', { method: 'POST', headers: { Origin: ready.origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ route: '/mm2606290/#/credit/productCombine', title: '额度页', text: '预估可借金额 P1 正常状态' }) })
  assert.equal(observed.status, 202)
  const queryIntentTargetResponse = await get('/__desktop/resolve-target', {
    method: 'POST', headers, body: JSON.stringify({ query: '创建收款账户校验失败场景' })
  })
  const queryIntentTarget = await queryIntentTargetResponse.json()
  assert.equal(queryIntentTargetResponse.status, 200, JSON.stringify(queryIntentTarget))
  assert.equal(queryIntentTarget.routePath, '/loan/receiveAcct')
  assert.equal(queryIntentTarget.source, 'query-intent')
  assert.equal(queryIntentTarget.currentRoute, '/credit/productCombine')
  const currentFallbackResponse = await get('/__desktop/resolve-target', {
    method: 'POST', headers, body: JSON.stringify({ query: '创建一个普通失败场景' })
  })
  const currentFallback = await currentFallbackResponse.json()
  assert.equal(currentFallbackResponse.status, 200, JSON.stringify(currentFallback))
  assert.equal(currentFallback.routePath, '/credit/productCombine')
  assert.equal(currentFallback.source, 'current-preview')
  const evidence = await (await get('/__desktop/evidence', { headers })).json()
  assert.ok(evidence.requests.some(item => item.profileId === 'p1_user_test' && item.scenarioId === 'p1_normal'))
  const rejectedVerification = await get('/__desktop/verify', { method: 'POST', headers, body: JSON.stringify({ route: '/credit/productCombine', containsText: ['不存在的页面文案'], absentText: [] }) })
  assert.equal(rejectedVerification.status, 422)
  const verifiedResponse = await get('/__desktop/verify', { method: 'POST', headers, body: JSON.stringify({ route: '/credit/productCombine', containsText: ['P1', '正常状态'], absentText: ['系统繁忙'] }) })
  const verified = await verifiedResponse.json()
  assert.equal(verifiedResponse.status, 200, JSON.stringify(verified))
  assert.equal(verified.verified, true)
  const scenarioResult = await (await get('/__desktop/result', { headers })).json()
  assert.equal(scenarioResult.status, 'verified', JSON.stringify(scenarioResult))
  assert.equal(scenarioResult.stages.created.passed, true)
  assert.equal(scenarioResult.stages.applied.passed, true)
  assert.equal(scenarioResult.stages.requestHit.passed, true)
  assert.equal(scenarioResult.stages.verified.passed, true)
  assert.ok(scenarioResult.apiBindings.some(item => item.apiUrl === '/refactor/queryMultiEnterpriseListII.json' && item.hit))
  const restoredWorkflowModeResponse = await get('/__desktop/workflow-mode/set', {
    method: 'POST', headers, body: JSON.stringify({ mode: 'workflow' })
  })
  assert.equal(restoredWorkflowModeResponse.status, 200)
  const restoredWorkflowMode = await restoredWorkflowModeResponse.json()
  assert.equal(restoredWorkflowMode.mode, 'workflow')
  const blockedAfterRestore = await get('/__desktop/analyze-target', {
    method: 'POST', headers, body: JSON.stringify({ routePath: '/repay/receiptList', query: '借据状态正常' })
  })
  assert.equal(blockedAfterRestore.status, 409)
  assert.match((await blockedAfterRestore.json()).error, /workflow mode/i)
  const internalWorkflowAnalysis = await get('/__desktop/analyze-target', {
    method: 'POST', headers: workflowHeaders, body: JSON.stringify({ routePath: '/repay/receiptList', query: '借据状态正常' })
  })
  assert.equal(internalWorkflowAnalysis.status, 200, await internalWorkflowAnalysis.text())
  const workflowModeStatus = await (await get('/__desktop/workflow-mode', { headers })).json()
  const auditEntries = (await readFile(workflowModeStatus.auditFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.ok(auditEntries.some(item => item.mode === 'workflow' && item.action === '/__desktop/analyze-target' && item.outcome === 'blocked'))
  assert.ok(auditEntries.some(item => item.mode === 'legacy' && item.action === '/__desktop/analyze-target' && item.outcome === 'allowed'))
  assert.ok(auditEntries.some(item => item.mode === 'workflow' && item.action === '/__desktop/analyze-target' && item.outcome === 'allowed'))
  const rolledBack = await get('/__desktop/rollback', { method: 'POST', headers, body: JSON.stringify({ operationId: imported.operationId }) })
  assert.equal(rolledBack.status, 200)
  const rolledBackResult = await rolledBack.json()
  assert.ok(rolledBackResult.resetSessionIds.includes('default'))
  assert.ok(rolledBackResult.resetSessionIds.includes('session-a'))
  assert.ok(!(await (await get('/__desktop/profiles', { headers })).json()).profiles.some(item => item.id === 'p1_user_test'))
  assert.equal((await (await get('/__desktop/state', { headers })).json()).profileId, '')
  assert.equal((await (await get('/__desktop/state', { headers: sessionAHeaders })).json()).profileId, '')
  console.log(JSON.stringify({ ok: true, buildId: context.buildId, profileId: created.profileId,
    apiBindingsVerified: checked + 1, browserOutcomeVerified: true,
    timingSamples: {
      receiptInitial: receiptAnalysis.analysisTimings,
      receiptReused: reusedReceiptAnalysis.analysisTimings,
      receiptOtherSession: otherSessionReceiptAnalysis.analysisTimings,
      receiveAccountInitial: receiveAccountAnalysis.analysisTimings
    } }))
} finally {
  if (child.exitCode === null) {
    await new Promise(done => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      child.once('exit', () => { clearTimeout(timer); done() }); child.kill('SIGTERM')
    })
  }
  await rm(userRoot, { recursive: true, force: true })
}
