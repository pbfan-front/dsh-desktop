import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const token = randomBytes(32).toString('hex')
const userRoot = await mkdtemp(resolve(tmpdir(), 'dsh-business-user-'))
const child = fork(resolve('build/business-runtime.mjs'), [resolve(process.argv[2] || 'build/business-package')], {
  execPath: resolve('node_modules/node/bin/node'), execArgv: [],
  env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_USER_ROOT: userRoot }, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
})
child.stderr.on('data', data => process.stderr.write(data))
const childMessages = []
child.on('message', value => childMessages.push(value))
try {
  const ready = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 60_000)
    child.once('message', value => { clearTimeout(timer); done(value) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Exited ${code}`)) })
  })
  const get = (path, options = {}) => fetch(`${ready.origin}${path}`, options)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  assert.equal((await get('/__desktop/profiles')).status, 401)
  assert.equal((await get('/__desktop/state', { headers: { Origin: 'https://example.com' } })).status, 403)
  assert.equal((await get('/api/agent/mock', { method: 'POST' })).status, 403)
  const context = await (await get('/__desktop/context', { headers })).json()
  assert.ok(context.sourceRoot.startsWith(resolve('build/business-package')))
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
  const evidence = await (await get('/__desktop/evidence', { headers })).json()
  assert.ok(evidence.requests.some(item => item.profileId === 'p1_user_test' && item.scenarioId === 'p1_normal'))
  const rejectedVerification = await get('/__desktop/verify', { method: 'POST', headers, body: JSON.stringify({ route: '/credit/productCombine', containsText: ['不存在的页面文案'], absentText: [] }) })
  assert.equal(rejectedVerification.status, 422)
  const verifiedResponse = await get('/__desktop/verify', { method: 'POST', headers, body: JSON.stringify({ route: '/credit/productCombine', containsText: ['P1', '正常状态'], absentText: ['系统繁忙'] }) })
  const verified = await verifiedResponse.json()
  assert.equal(verifiedResponse.status, 200, JSON.stringify(verified))
  assert.equal(verified.verified, true)
  const rolledBack = await get('/__desktop/rollback', { method: 'POST', headers, body: JSON.stringify({ operationId: created.operationId }) })
  assert.equal(rolledBack.status, 200)
  assert.ok(!(await (await get('/__desktop/profiles', { headers })).json()).profiles.some(item => item.id === 'p1_user_test'))
  console.log(JSON.stringify({ ok: true, buildId: context.buildId, profileId: created.profileId, apiBindingsVerified: checked + 1, browserOutcomeVerified: true }))
} finally {
  if (child.exitCode === null) {
    await new Promise(done => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      child.once('exit', () => { clearTimeout(timer); done() }); child.kill('SIGTERM')
    })
  }
  await rm(userRoot, { recursive: true, force: true })
}
