import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerBusinessScenarioWorkflow } from '../src/main/business-scenario-workflow'
import { BusinessWorkflowRuntime } from '../src/main/business-workflow-runtime'

describe('business target selection over the process bridge', () => {
  it('resumes the same run only after a confirmed saved candidate is selected', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-target-selection-bridge-'))
    const token = randomBytes(32).toString('hex')
    const workflowToken = randomBytes(32).toString('hex')
    const child = fork(resolve('build/business-runtime.mjs'), [resolve('build/business-package')], {
      execPath: resolve('node_modules/node/bin/node'), execArgv: [],
      env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_WORKFLOW_TOKEN: workflowToken,
        DSH_BUSINESS_USER_ROOT: userRoot },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    let origin = ''
    let output = ''
    child.stderr?.on('data', chunk => { output = `${output}${chunk}`.slice(-2000) })
    const runtime = new BusinessWorkflowRuntime()
    const requestBusiness = async (path: string, body: unknown, sessionId?: string) => {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          'X-DSH-Workflow-Token': workflowToken, ...(sessionId ? { 'X-DSH-Session': sessionId } : {}) },
        body: JSON.stringify(body)
      })
      const payload = await response.json() as Record<string, unknown>
      if (!response.ok) throw Object.assign(new Error(String(payload.error || `HTTP ${response.status}`)), {
        code: payload.code, retryable: true, candidates: payload.candidates
      })
      return payload
    }
    const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'com.dataelement.demo-test', requestBusiness })
    const ready = new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error(`Business runtime did not start: ${output}`)), 30000)
      child.on('message', (message: unknown) => {
        if (!message || typeof message !== 'object') return
        const event = message as Record<string, unknown>
        if (event.type === 'ready' && typeof event.origin === 'string') {
          origin = event.origin
          clearTimeout(timeout)
          resolveReady()
        }
        if (event.type === 'workflow-request' && typeof event.id === 'string') {
          void (async () => {
            try {
              const payload = event.payload as Record<string, unknown>
              const result = event.action === 'start-scenario'
                ? await start(payload as unknown as Parameters<typeof start>[0])
                : event.action === 'retry'
                  ? await runtime.retry(String(payload.runId), payload.retryInput)
                  : event.action === 'get'
                    ? { run: runtime.getRun(String(payload.runId)) }
                    : await runtime.cancel(String(payload.runId))
              child.send({ type: 'workflow-response', id: event.id, ok: true, result })
            } catch (error) {
              child.send({ type: 'workflow-response', id: event.id, ok: false,
                error: error instanceof Error ? error.message : String(error) })
            }
          })()
        }
      })
      child.once('exit', code => rejectReady(new Error(`Business runtime exited (${code}): ${output}`)))
    })
    try {
      await ready
      const sessionId = `bridge-${randomBytes(8).toString('hex')}`
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`${origin}${path}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-DSH-Session': sessionId },
          body: JSON.stringify(body)
        })
        return { status: response.status, body: await response.json() as Record<string, any> }
      }
      const started = await post('/__desktop/workflow/start-scenario', { query: '借据列表正常展示' })
      expect(started.status).toBe(200)
      expect(started.body.status).toBe('failed')
      expect(started.body.steps[0].error).toMatchObject({ code: 'E_TARGET_ROUTE_AMBIGUOUS' })
      expect(started.body.steps[0].error.candidates).toContainEqual(expect.objectContaining({ routePath: '/repay/receiptList' }))
      const runId = started.body.id
      for (const retryInput of [undefined,
        { selectedRoutePath: '/repay/receiptList', confirmedByUser: false },
        { selectedRoutePath: '/credit/productCombine', confirmedByUser: true }]) {
        const rejected = await post('/__desktop/workflow/retry', { runId, ...(retryInput ? { retryInput } : {}) })
        expect(rejected.status).toBe(422)
        expect(runtime.getRun(runId)?.status).toBe('failed')
      }
      const selected = await post('/__desktop/workflow/retry', {
        runId, retryInput: { selectedRoutePath: '/repay/receiptList', confirmedByUser: true }
      })
      expect(selected.status).toBe(200)
      expect(selected.body).toMatchObject({ id: runId, status: 'waiting_for_user', currentStepId: 'confirm-plan' })
      expect(selected.body.context).toMatchObject({ target: { routePath: '/repay/receiptList' },
        targetSelection: { source: 'user-confirmed-candidate' }, analysis: { evidenceId: expect.any(String) } })
      expect(selected.body.steps.find((step: Record<string, unknown>) => step.id === 'create-profile')?.status).toBe('pending')
      expect((await post('/__desktop/workflow/cancel', { runId })).status).toBe(200)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolveExit => child.once('exit', resolveExit))
        child.kill('SIGTERM')
        await exited
      }
      await rm(userRoot, { recursive: true, force: true })
    }
  }, 45000)
})
