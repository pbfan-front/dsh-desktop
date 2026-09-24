import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const packageRoot = resolve(process.argv[2] || 'build/business-package')
const sourceRoot = join(packageRoot, 'source')
const token = randomBytes(32).toString('hex')
const userRoot = await mkdtemp(join(tmpdir(), 'dsh-business-acceptance-'))
const child = fork(resolve('build/business-runtime.mjs'), [packageRoot], {
  execPath: resolve('node_modules/node/bin/node'), execArgv: [],
  env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_USER_ROOT: userRoot },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc']
})
child.stderr.on('data', data => process.stderr.write(data))

const loadScenario = async (relativePath, id) => {
  const config = JSON.parse(await readFile(join(sourceRoot, relativePath), 'utf8'))
  const scenario = config.scenarios.find(item => item.id === id)
  assert.ok(scenario, `Missing packaged baseline scenario ${id}`)
  return scenario.data
}

try {
  const ready = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Business runtime startup timeout')), 60_000)
    child.once('message', value => { clearTimeout(timer); done(value) })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`Business runtime exited ${code}`)))
  })
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const request = async (path, options = {}) => {
    const response = await fetch(`${ready.origin}${path}`, options)
    const body = await response.json()
    return { response, body }
  }
  const post = (path, body) => request(path, { method: 'POST', headers, body: JSON.stringify(body) })

  const cases = [
    {
      name: 'receipt-normal', routePath: '/repay/receiptList', query: '借据列表页 借据状态正常',
      apiUrl: '/loanNbr/loanNbr.json', profileId: 'accept_receipt_normal', scenarioId: 'accept_receipt_normal_data',
      relativePath: 'src/baseTypes/api/loanNbr/loanNbr/mock.json', baselineId: '正常借据可以提前结清', page: 'receiptList',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.equal(payload.data?.list?.[0]?.duestatus, '0')
        return { duestatus: payload.data.list[0].duestatus, loanAcctNo: payload.data.list[0].loan_acct_no }
      }
    },
    {
      name: 'credit-fail', routePath: '/credit/productCombine', query: '额度页 核额失败',
      apiUrl: '/credits/supportCreditAgain.json', profileId: 'accept_credit_fail', scenarioId: 'accept_credit_fail_data',
      relativePath: 'src/baseTypes/api/credits/supportCreditAgain/mock.json', baselineId: '核额失败', page: 'productCombine',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.ok(payload.data?.productList?.length > 0)
        assert.ok(payload.data.productList.every(item => item.registerStatus === '4'))
        return { registerStatuses: payload.data.productList.map(item => item.registerStatus), creditAgain: payload.data.productList.map(item => item.creditAgain) }
      }
    }
  ]

  const results = []
  for (const item of cases) {
    const analyzed = await post('/__desktop/analyze-target', { routePath: item.routePath, query: item.query })
    assert.equal(analyzed.response.status, 200, JSON.stringify(analyzed.body))
    const apiEvidence = analyzed.body.apis.find(api => api.apiUrl === item.apiUrl)
    assert.ok(apiEvidence, `${item.name}: CodeIntell did not identify ${item.apiUrl}\n${JSON.stringify(analyzed.body).slice(0, 8000)}`)
    assert.ok(apiEvidence.evidence?.length > 0, `${item.name}: API has no source evidence`)

    const data = await loadScenario(item.relativePath, item.baselineId)
    const created = await post('/__desktop/create-profile', {
      evidenceId: analyzed.body.evidenceId,
      profile: { id: item.profileId, label: item.query, branchLabel: item.query, routePath: item.routePath, page: item.page },
      scenarios: [{ id: item.scenarioId, apiUrl: item.apiUrl, label: item.query, data }]
    })
    assert.equal(created.response.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.validation?.ok, true)

    const applied = await post('/__desktop/apply', { profileId: item.profileId })
    assert.equal(applied.response.status, 200, JSON.stringify(applied.body))
    const mockResponse = await fetch(`${ready.origin}/mock${item.apiUrl}`, { method: 'POST', body: '{}' })
    const payload = await mockResponse.json()
    assert.equal(mockResponse.headers.get('x-local-mock-profile'), item.profileId)
    assert.equal(mockResponse.headers.get('x-local-mock-scenario'), item.scenarioId)
    const businessFields = item.assertPayload(payload)

    const rolledBack = await post('/__desktop/rollback', { operationId: created.body.operationId })
    assert.equal(rolledBack.response.status, 200, JSON.stringify(rolledBack.body))
    results.push({ name: item.name, routePath: item.routePath, apiUrl: item.apiUrl,
      evidence: apiEvidence.evidence, profileId: item.profileId, scenarioId: item.scenarioId, businessFields })
  }
  console.log(JSON.stringify({ ok: true, buildId: ready.buildId, cases: results }, null, 2))
} finally {
  if (child.exitCode === null) {
    await new Promise(done => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      child.once('exit', () => { clearTimeout(timer); done() })
      child.kill('SIGTERM')
    })
  }
  await rm(userRoot, { recursive: true, force: true })
}
