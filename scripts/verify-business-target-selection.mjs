import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const descriptor = JSON.parse(await readFile(resolve('build/connection.json'), 'utf8'))
const sessionId = `bea044-${randomUUID()}`
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
let summary
try {
  const started = await post('/__desktop/workflow/start-scenario', { query: '借据列表正常展示' })
  assert.equal(started.status, 200, JSON.stringify(started.body))
  runId = started.body.id
  assert.equal(started.body.status, 'failed')
  assert.equal(started.body.currentStepId, 'analyze-target')
  const failure = started.body.steps.find(step => step.id === 'analyze-target')?.error
  assert.equal(failure?.code, 'E_TARGET_ROUTE_AMBIGUOUS')
  assert.ok(failure.candidates.some(item => item.routePath === '/repay/receiptList'))

  for (const retryInput of [
    undefined,
    { selectedRoutePath: '/repay/receiptList', confirmedByUser: false },
    { selectedRoutePath: '/credit/productCombine', confirmedByUser: true }
  ]) {
    const rejected = await post('/__desktop/workflow/retry', { runId, ...(retryInput ? { retryInput } : {}) })
    assert.equal(rejected.status, 422, JSON.stringify(rejected.body))
    const unchanged = await post('/__desktop/workflow/get', { runId })
    assert.equal(unchanged.body.run.status, 'failed')
    assert.equal(unchanged.body.run.currentStepId, 'analyze-target')
  }

  const selected = await post('/__desktop/workflow/retry', {
    runId, retryInput: { selectedRoutePath: '/repay/receiptList', confirmedByUser: true }
  })
  assert.equal(selected.status, 200, JSON.stringify(selected.body))
  assert.equal(selected.body.id, runId)
  assert.equal(selected.body.status, 'waiting_for_user')
  assert.equal(selected.body.currentStepId, 'confirm-plan')
  assert.equal(selected.body.context.target.routePath, '/repay/receiptList')
  assert.equal(selected.body.context.targetSelection.source, 'user-confirmed-candidate')
  assert.ok(selected.body.context.analysis.evidenceId)
  assert.equal(selected.body.steps.find(step => step.id === 'create-profile')?.status, 'pending')
  summary = { ok: true, runId,
    candidates: failure.candidates.map(item => item.routePath),
    rejectedSelections: 3, selectedRoutePath: selected.body.context.target.routePath,
    resumedAt: selected.body.currentStepId, profileCreated: false }
} finally {
  if (runId) {
    const cancelled = await post('/__desktop/workflow/cancel', { runId })
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
  }
}
console.log(JSON.stringify({ ...summary, cancelled: true }))
