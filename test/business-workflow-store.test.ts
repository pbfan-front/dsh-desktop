import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BusinessWorkflowStore, createPersistentBusinessWorkflowRuntime } from '../src/main/business-workflow-store'
import type { BusinessWorkflowRun } from '../src/shared/business-workflow'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; storagePath: string; store: BusinessWorkflowStore }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-business-workflow-store-'))
  roots.push(root)
  const storagePath = join(root, 'workflows', 'runs.json')
  return {
    root,
    storagePath,
    store: new BusinessWorkflowStore(storagePath, {
      now: () => new Date('2026-10-03T08:00:00.000Z'),
      nonce: () => 'fixed'
    })
  }
}

function run(status: BusinessWorkflowRun['status'] = 'waiting_for_user'): BusinessWorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'business-scenario-create',
    workflowVersion: '1.0.0',
    pluginId: 'com.dataelement.demo-test',
    status,
    currentStepId: 'confirm-plan',
    context: { route: '/loan/loanApply' },
    steps: [{
      id: 'confirm-plan',
      type: 'checkpoint',
      title: '确认 Mock 方案',
      status: 'running',
      evidenceIds: ['evidence-1'],
      startedAt: '2026-10-03T07:59:00.000Z'
    }],
    createdAt: '2026-10-03T07:58:00.000Z',
    updatedAt: '2026-10-03T07:59:00.000Z'
  }
}

describe('business workflow store', () => {
  it('writes a versioned snapshot atomically and restores checkpoints unchanged', async () => {
    const { root, storagePath, store } = await fixture()
    await store.save([run()])
    const document = JSON.parse(await readFile(storagePath, 'utf8'))
    expect(document.version).toBe(1)
    expect((await readdir(join(root, 'workflows'))).filter((name) => name.endsWith('.tmp'))).toEqual([])
    const loaded = await store.load()
    expect(loaded.runs[0]).toMatchObject({ status: 'waiting_for_user', currentStepId: 'confirm-plan' })
    expect(loaded.runs[0]?.steps[0]).toMatchObject({ status: 'running', evidenceIds: ['evidence-1'] })
  })

  it('marks an interrupted running step as retryable instead of replaying it', async () => {
    const { store } = await fixture()
    await store.save([run('running')])
    const loaded = await store.load()
    expect(loaded.runs[0]).toMatchObject({ status: 'failed', currentStepId: 'confirm-plan' })
    expect(loaded.runs[0]?.steps[0]).toMatchObject({
      status: 'failed',
      error: { code: 'WORKFLOW_INTERRUPTED', retryable: true }
    })
  })

  it('restores bounded route candidates for a retryable ambiguity and rejects unsafe persisted candidates', async () => {
    const { store } = await fixture()
    const ambiguous = run('failed')
    ambiguous.currentStepId = 'confirm-plan'
    ambiguous.steps[0]!.status = 'failed'
    ambiguous.steps[0]!.error = { code: 'E_TARGET_ROUTE_AMBIGUOUS', message: 'Choose a page.', retryable: true,
      candidates: [{ routePath: '/repay/receiptList', pageTitle: '还款查询' }] }
    await store.save([ambiguous])
    expect((await store.load()).runs[0]?.steps[0]?.error?.candidates).toEqual([
      { routePath: '/repay/receiptList', pageTitle: '还款查询' }
    ])
    ambiguous.steps[0]!.error!.candidates = [{ routePath: '//untrusted' }]
    await store.save([ambiguous])
    const rejected = await store.load()
    expect(rejected.runs).toEqual([])
    expect(rejected.quarantinedPath).toBeTruthy()
  })

  it('quarantines malformed state and starts with an empty collection', async () => {
    const { root, storagePath, store } = await fixture()
    await mkdir(join(root, 'workflows'), { recursive: true })
    await writeFile(storagePath, '{not-json', 'utf8')
    const loaded = await store.load()
    expect(loaded.runs).toEqual([])
    expect(loaded.quarantinedPath).toContain('.corrupt-2026-10-03T08-00-00-000Z-fixed')
    expect(await readFile(loaded.quarantinedPath!, 'utf8')).toBe('{not-json')
  })

  it('hydrates the runtime and persists interruption recovery before returning', async () => {
    const { storagePath, store } = await fixture()
    await store.save([run('running')])
    const restored = await createPersistentBusinessWorkflowRuntime({
      storagePath,
      runtime: { now: () => new Date('2026-10-03T08:00:00.000Z') },
      store: {
        now: () => new Date('2026-10-03T08:00:00.000Z'),
        nonce: () => 'restore'
      }
    })
    expect(restored.recovery.recoveredInterruptedRuns).toBe(1)
    expect(restored.runtime.getRun('run-1')).toMatchObject({ status: 'failed', currentStepId: 'confirm-plan' })
    const persisted = JSON.parse(await readFile(storagePath, 'utf8'))
    expect(persisted.runs[0].steps[0].error.code).toBe('WORKFLOW_INTERRUPTED')
  })
})
