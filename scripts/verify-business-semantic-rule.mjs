import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const descriptor = JSON.parse(await readFile(resolve('build/connection.json'), 'utf8'))
const sessionId = `bea042-${randomUUID()}`
const profileId = `bea042_${randomUUID().replaceAll('-', '')}`
const headers = {
  Authorization: `Bearer ${descriptor.token}`,
  'Content-Type': 'application/json',
  'X-DSH-Session': sessionId
}
const post = async (path, body) => {
  const response = await fetch(`${descriptor.origin}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

let runId
let operationId
try {
  const started = await post('/__desktop/workflow/start-scenario', {
    routePath: '/repay/receiptList', query: '借据列表正常展示',
    apiUrls: ['/loanNbr/loanNbr.json']
  })
  assert.equal(started.status, 200, JSON.stringify(started.body))
  runId = started.body.id
  assert.equal(started.body.currentStepId, 'confirm-plan')
  assert.deepEqual(started.body.context.semanticExpectations?.map(rule => rule.id), ['receipt-normal-status'])

  const basePlan = {
    profileId, label: 'BEA-042 语义校验临时样本', page: 'repay',
    scenarios: [{ id: 'bea042_normal', apiUrl: '/loanNbr/loanNbr.json' }]
  }
  const rejected = await post('/__desktop/workflow/resume', {
    runId, checkpointOutput: {
      ...basePlan,
      scenarios: [{ ...basePlan.scenarios[0], data: { data: { list: [{ duestatus: '1' }] } } }]
    }
  })
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body))
  assert.match(rejected.body.error, /receipt-normal-status/)
  const afterRejection = await post('/__desktop/workflow/get', { runId })
  assert.equal(afterRejection.status, 200)
  assert.equal(afterRejection.body.run.status, 'waiting_for_user')
  assert.equal(afterRejection.body.run.currentStepId, 'confirm-plan')

  const accepted = await post('/__desktop/workflow/resume', {
    runId, checkpointOutput: {
      ...basePlan,
      scenarios: [{ ...basePlan.scenarios[0], sourceScenarioId: '正常借据可以提前结清' }]
    }
  })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
  assert.equal(accepted.body.currentStepId, 'wait-for-preview')
  operationId = accepted.body.steps.find(step => step.id === 'create-profile')?.output?.operationId
  assert.match(operationId, /^[0-9a-f-]{36}$/)
  console.log(JSON.stringify({ ok: true, runId, rejectedStatus: rejected.status,
    remainedAt: afterRejection.body.run.currentStepId,
    correctedStatus: accepted.body.status, correctedStep: accepted.body.currentStepId }))
} finally {
  if (runId) {
    const cancelled = await post('/__desktop/workflow/cancel', { runId })
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
  }
  if (operationId) {
    const rolledBack = await post('/__desktop/rollback', { operationId })
    assert.equal(rolledBack.status, 200, JSON.stringify(rolledBack.body))
    const profiles = await fetch(`${descriptor.origin}/__desktop/profiles`, { headers }).then(response => response.json())
    assert.equal(profiles.profiles.some(profile => profile.id === profileId), false)
  }
}
