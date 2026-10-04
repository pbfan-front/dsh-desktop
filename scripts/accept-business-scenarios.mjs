import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const packageRoot = resolve(process.argv[2] || 'build/business-package')
const sourceRoot = join(packageRoot, 'source')
const token = randomBytes(32).toString('hex')
const workflowToken = randomBytes(32).toString('hex')
const userRoot = await mkdtemp(join(tmpdir(), 'dsh-business-acceptance-'))
const child = fork(resolve('build/business-runtime.mjs'), [packageRoot], {
  execPath: resolve('node_modules/node/bin/node'), execArgv: [],
  env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_WORKFLOW_TOKEN: workflowToken, DSH_BUSINESS_USER_ROOT: userRoot },
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
  const workflowHeaders = { ...headers, 'X-DSH-Workflow-Token': workflowToken }
  const request = async (path, options = {}) => {
    const response = await fetch(`${ready.origin}${path}`, options)
    const body = await response.json()
    return { response, body }
  }
  const post = (path, body) => request(path, { method: 'POST', headers: workflowHeaders, body: JSON.stringify(body) })

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
      name: 'credit-normal', routePath: '/credit/productCombine', query: '额度页 正常额度',
      apiUrl: '/credits/supportCreditAgain.json', profileId: 'accept_credit_normal', scenarioId: 'accept_credit_normal_data',
      relativePath: 'src/baseTypes/api/credits/supportCreditAgain/mock.json', baselineId: '正常', page: 'productCombine',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.ok(payload.data?.productList?.length > 0)
        assert.ok(payload.data.productList.every(item => item.registerStatus === '6'))
        return { registerStatuses: payload.data.productList.map(item => item.registerStatus), creditAgain: payload.data.productList.map(item => item.creditAgain) }
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
    },
    {
      name: 'enterprise-list', routePath: '/credit/productCombine', query: '额度页 多企业切换',
      apiUrl: '/refactor/queryMultiEnterpriseListII.json', profileId: 'accept_enterprise_list', scenarioId: 'accept_enterprise_list_data',
      relativePath: 'src/baseTypes/api/refactor/queryMultiEnterpriseListII/mock.json', baselineId: '正常返回(3企业2法人)', page: 'productCombine',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.equal(payload.data?.array?.length, 3)
        assert.ok(payload.data.array.every(item => item.type === '0'))
        return { status: payload.status, enterpriseCount: payload.data.array.length, types: payload.data.array.map(item => item.type) }
      }
    },
    {
      name: 'enterprise-personal-switch', routePath: '/credit/productCombine', query: '额度页 企业个人共同展示',
      apiUrl: '/refactor/queryMultiEnterpriseListII.json', profileId: 'accept_enterprise_personal_switch', scenarioId: 'accept_enterprise_personal_switch_data',
      relativePath: 'src/baseTypes/api/refactor/queryMultiEnterpriseListII/mock.json', baselineId: '500+客户-企个一体', page: 'productCombine',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.ok(payload.data?.array?.some(item => item.type === '00'))
        assert.ok(payload.data?.array?.some(item => item.type === '01' && item.personalFlag === 'Y'))
        return { status: payload.status, identities: payload.data.array.map(item => ({ type: item.type, personalFlag: item.personalFlag || 'N' })) }
      }
    },
    {
      name: 'loan-package-normal', routePath: '/loan/loanPkgType', query: '借款套餐页 分段计息套餐',
      apiUrl: '/loan/queryPkgListV3.json', profileId: 'accept_loan_package_normal', scenarioId: 'accept_loan_package_normal_data',
      relativePath: 'src/baseTypes/api/loan/queryPkgListV3/mock.json', baselineId: '分段计息套餐', page: 'loanPkgType',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.ok(payload.data?.pkg_list?.length > 0)
        return { status: payload.status, packageCount: payload.data.pkg_list.length }
      }
    },
    {
      name: 'loan-package-error', routePath: '/loan/loanPkgType', query: '借款套餐页 接口报错',
      apiUrl: '/loan/queryPkgListV3.json', profileId: 'accept_loan_package_error', scenarioId: 'accept_loan_package_error_data',
      relativePath: 'src/baseTypes/api/loan/queryPkgListV3/mock.json', baselineId: '接口报错', page: 'loanPkgType',
      assertPayload: payload => {
        assert.equal(payload.status, '42300218')
        assert.equal(payload.msg, '错误提示')
        return { status: payload.status, message: payload.msg }
      }
    },
    {
      name: 'receive-account-normal', routePath: '/loan/receiveAcct', query: '收款账户 校验成功',
      apiUrl: '/withdrawal/inputReceiveAcctCheck.json', profileId: 'accept_receive_account_normal', scenarioId: 'accept_receive_account_normal_data',
      relativePath: 'src/baseTypes/api/withdrawal/inputReceiveAcctCheck/mock.json', baselineId: '成功返回', page: 'receiveAcct',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.equal(payload.data?.checkResult, 'S')
        return { status: payload.status, checkResult: payload.data.checkResult }
      }
    },
    {
      name: 'receive-account-fail', routePath: '/loan/receiveAcct', query: '收款账户 校验失败',
      apiUrl: '/withdrawal/inputReceiveAcctCheck.json', profileId: 'accept_receive_account_fail', scenarioId: 'accept_receive_account_fail_data',
      relativePath: 'src/baseTypes/api/withdrawal/inputReceiveAcctCheck/mock.json', baselineId: '失败返回', page: 'receiveAcct',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.equal(payload.data?.checkResult, 'F')
        assert.match(payload.data?.checkMsg || '', /不支持|更换收款账户/)
        return { status: payload.status, checkResult: payload.data.checkResult, checkMsg: payload.data.checkMsg }
      }
    },
    {
      name: 'loan-application-list', routePath: '/loan/loanApply', query: '借款申请单列表',
      apiUrl: '/withdrawal/queryLoanInfo.json', profileId: 'accept_loan_application_list', scenarioId: 'accept_loan_application_list_data',
      relativePath: 'src/baseTypes/api/withdrawal/queryLoanInfo/mock.json', baselineId: '借款申请单', page: 'loanApply',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.ok(payload.data?.list?.length > 0)
        assert.ok(payload.data.list.every(item => item.apply_id && item.loan_status))
        return { status: payload.status, applicationCount: payload.data.list.length, firstStatus: payload.data.list[0].loan_status }
      }
    },
    {
      name: 'kyc-face-strategy', routePath: '/face/home', query: 'KYC 刷脸 S1策略',
      apiUrl: '/face/getFaceModel.json', profileId: 'accept_kyc_face_strategy', scenarioId: 'accept_kyc_face_strategy_data',
      relativePath: 'src/baseTypes/api/face/getFaceModel/mock.json', baselineId: 'S1策略', page: 'faceHome',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.equal(payload.data?.loan_face_strategy, 'S1')
        return { status: payload.status, strategy: payload.data.loan_face_strategy }
      }
    },
    {
      name: 'kyc-face-rejected', routePath: '/face/home', query: 'KYC 刷脸拒绝',
      apiUrl: '/face/getFaceModel.json', profileId: 'accept_kyc_face_rejected', scenarioId: 'accept_kyc_face_rejected_data',
      relativePath: 'src/baseTypes/api/face/getFaceModel/mock.json', baselineId: '刷脸拒绝', page: 'faceHome',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.equal(payload.data?.loan_face_strategy, '-1')
        return { status: payload.status, strategy: payload.data.loan_face_strategy }
      }
    },
    {
      name: 'kyc-video-strategy', routePath: '/face/home', query: 'KYC 视频录制策略',
      apiUrl: '/face/getFaceModel.json', profileId: 'accept_kyc_video_strategy', scenarioId: 'accept_kyc_video_strategy_data',
      relativePath: 'src/baseTypes/api/face/getFaceModel/mock.json', baselineId: '录视频', page: 'faceHome',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.equal(payload.data?.loan_face_strategy, 'S4')
        return { status: payload.status, strategy: payload.data.loan_face_strategy }
      }
    },
    {
      name: 'repayment-calc-normal', routePath: '/repay/doRepay', query: '还款试算 正常账户',
      apiUrl: '/loanNbr/repaymentCalc.json', profileId: 'accept_repayment_calc_normal', scenarioId: 'accept_repayment_calc_normal_data',
      relativePath: 'src/baseTypes/api/loanNbr/repaymentCalc/mock.json', baselineId: '正常返回（3个还款户）', page: 'doRepay',
      assertPayload: payload => {
        assert.equal(payload.status, '0')
        assert.equal(payload.data?.array?.length, 3)
        return { status: payload.status, accountCount: payload.data.array.length }
      }
    },
    {
      name: 'repayment-calc-error', routePath: '/repay/doRepay', query: '还款试算 系统清算日',
      apiUrl: '/loanNbr/repaymentCalc.json', profileId: 'accept_repayment_calc_error', scenarioId: 'accept_repayment_calc_error_data',
      relativePath: 'src/baseTypes/api/loanNbr/repaymentCalc/mock.json', baselineId: '系统清算日', page: 'doRepay',
      assertPayload: payload => {
        assert.equal(payload.status, '21901604')
        assert.match(payload.msg || '', /系统清算日/)
        return { status: payload.status, message: payload.msg }
      }
    }
  ]

  const results = []
  for (const item of cases) {
    let stage = 'ROUTE_EVIDENCE'
    try {
      const analyzed = await post('/__desktop/analyze-target', { routePath: item.routePath, query: item.query, apiUrls: [item.apiUrl] })
      assert.equal(analyzed.response.status, 200, JSON.stringify(analyzed.body))
      const apiEvidence = analyzed.body.apis.find(api => api.apiUrl === item.apiUrl)
      assert.ok(apiEvidence, `CodeIntell did not identify ${item.apiUrl}\n${JSON.stringify(analyzed.body).slice(0, 8000)}`)
      assert.ok(apiEvidence.evidence?.length > 0, 'API has no source evidence')

      stage = 'INTERFACE_HIT'
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

      stage = 'FIELD_ASSERTION'
      const businessFields = item.assertPayload(payload)

      stage = 'ROLLBACK'
      const rolledBack = await post('/__desktop/rollback', { operationId: created.body.operationId })
      assert.equal(rolledBack.response.status, 200, JSON.stringify(rolledBack.body))
      results.push({ name: item.name, routePath: item.routePath, apiUrl: item.apiUrl,
        evidence: apiEvidence.evidence, profileId: item.profileId, scenarioId: item.scenarioId, businessFields })
    } catch (error) {
      error.message = `[${stage}] ${item.name}: ${error.message}`
      throw error
    }
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
