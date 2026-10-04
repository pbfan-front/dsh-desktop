import { describe, expect, it } from 'vitest'
import { BusinessWorkflowRuntime } from '../src/main/business-workflow-runtime'
import type { BusinessWorkflowDefinition } from '../src/shared/business-workflow'

const definition: BusinessWorkflowDefinition = {
  id: 'business-scenario-create',
  version: '1.0.0',
  title: '创建业务体验场景',
  steps: [
    { id: 'capture-page', type: 'deterministic', title: '读取当前页面' },
    { id: 'infer-chain', type: 'agent', title: '推理业务调用链' },
    { id: 'confirm-plan', type: 'checkpoint', title: '确认 Mock 方案' },
    { id: 'apply-mock', type: 'deterministic', title: '应用 Mock' }
  ]
}

function runtime() {
  let sequence = 0
  return new BusinessWorkflowRuntime({
    idFactory: () => `run-${++sequence}`,
    now: () => new Date('2026-10-03T00:00:00.000Z')
  })
}

function persisted<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('business workflow runtime', () => {
  it('runs deterministic and agent steps in order, then pauses at a checkpoint', async () => {
    const events: string[] = []
    const subject = runtime()
    subject.registerWorkflow(definition, {
      'capture-page': () => {
        events.push('capture-page')
        return { contextPatch: { route: '/loan/loanApply' }, output: { title: '企业借款' } }
      },
      'infer-chain': ({ context, previousOutput }) => {
        events.push('infer-chain')
        expect(context.route).toBe('/loan/loanApply')
        expect(previousOutput).toEqual({ title: '企业借款' })
        return { contextPatch: { api: '/queryPkgListV3' }, evidenceIds: ['evidence-1'] }
      },
      'apply-mock': () => {
        events.push('apply-mock')
        return { output: { applied: true } }
      }
    })

    const paused = await subject.start({
      workflowId: definition.id,
      pluginId: 'com.dataelement.demo-test'
    })

    expect(events).toEqual(['capture-page', 'infer-chain'])
    expect(paused.status).toBe('waiting_for_user')
    expect(paused.currentStepId).toBe('confirm-plan')
    expect(paused.context).toMatchObject({ route: '/loan/loanApply', api: '/queryPkgListV3' })
    expect(paused.steps[1]?.evidenceIds).toEqual(['evidence-1'])

    const completed = await subject.resume(paused.id, { approved: true })
    expect(events).toEqual(['capture-page', 'infer-chain', 'apply-mock'])
    expect(completed.status).toBe('completed')
    expect(completed.steps[2]?.output).toEqual({ approved: true })
    expect(completed.steps[3]?.output).toEqual({ applied: true })
  })

  it('records a retryable failure and retries only the failed step', async () => {
    let attempts = 0
    const subject = runtime()
    subject.registerWorkflow({
      ...definition,
      steps: definition.steps.slice(0, 2)
    }, {
      'capture-page': () => ({ contextPatch: { route: '/loan/loanApply' } }),
      'infer-chain': () => {
        attempts++
        if (attempts === 1) throw new Error('temporary analysis failure')
        return { output: { api: '/queryPkgListV3' } }
      }
    })

    const failed = await subject.start({ workflowId: definition.id, pluginId: 'com.dataelement.demo-test' })
    expect(failed.status).toBe('failed')
    expect(failed.currentStepId).toBe('infer-chain')
    expect(failed.steps[1]?.error).toMatchObject({ code: 'WORKFLOW_STEP_FAILED', retryable: true })

    const completed = await subject.retry(failed.id)
    expect(completed.status).toBe('completed')
    expect(attempts).toBe(2)
    expect(completed.steps[0]?.status).toBe('completed')
  })

  it('cancels a run waiting at a checkpoint without running later steps', async () => {
    let applied = false
    const subject = runtime()
    subject.registerWorkflow(definition, {
      'capture-page': () => ({}),
      'infer-chain': () => ({}),
      'apply-mock': () => {
        applied = true
        return {}
      }
    })
    const paused = await subject.start({ workflowId: definition.id, pluginId: 'com.dataelement.demo-test' })
    const cancelled = await subject.cancel(paused.id)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.steps.slice(2).every((step) => step.status === 'skipped')).toBe(true)
    expect(applied).toBe(false)
  })

  it('rejects incomplete or ambiguous workflow registrations', () => {
    const subject = runtime()
    expect(() => subject.registerWorkflow(definition, {})).toThrow('handler is missing')
    expect(() => subject.registerWorkflow({
      ...definition,
      steps: [definition.steps[0]!, definition.steps[0]!]
    }, { 'capture-page': () => ({}) })).toThrow('duplicate step')
  })

  it('rejects non-serializable run context before execution', async () => {
    const subject = runtime()
    subject.registerWorkflow({
      ...definition,
      steps: definition.steps.slice(0, 1)
    }, { 'capture-page': () => ({}) })
    await expect(subject.start({
      workflowId: definition.id,
      pluginId: 'com.dataelement.demo-test',
      context: { callback: () => undefined }
    })).rejects.toThrow('workflow context must be serializable')
  })

  it('runs declared deterministic gates before completing a step', async () => {
    const subject = runtime()
    subject.registerWorkflow({
      ...definition,
      steps: [{ ...definition.steps[0]!, gate: 'test.require-applied' }]
    }, {
      'capture-page': () => ({ output: { applied: false } })
    }, {
      'test.require-applied': ({ result }) => {
        if ((result.output as { applied?: boolean })?.applied !== true) {
          throw { code: 'WORKFLOW_GATE_REJECTED', message: 'not applied', retryable: true }
        }
      }
    })

    const rejected = await subject.start({ workflowId: definition.id, pluginId: 'com.dataelement.demo-test' })
    expect(rejected.status).toBe('failed')
    expect(rejected.steps[0]?.error?.code).toBe('WORKFLOW_GATE_REJECTED')
  })

  it('rejects a workflow when a declared gate has no host implementation', () => {
    const subject = runtime()
    expect(() => subject.registerWorkflow({
      ...definition,
      steps: [{ ...definition.steps[0]!, gate: 'test.missing' }]
    }, { 'capture-page': () => ({}) })).toThrow('Workflow gate is missing')
  })

  it('keeps completed runs readable as historical after a workflow upgrade', async () => {
    const oldRuntime = runtime()
    oldRuntime.registerWorkflow(definition, {
      'capture-page': () => ({}), 'infer-chain': () => ({}), 'apply-mock': () => ({ output: { applied: true } })
    }, {}, { pluginId: 'com.dataelement.demo-test' })
    const waiting = await oldRuntime.start({ workflowId: definition.id, pluginId: 'com.dataelement.demo-test' })
    const completed = await oldRuntime.resume(waiting.id, { approved: true })

    const upgraded = runtime()
    upgraded.restoreRuns([persisted(completed)])
    upgraded.registerWorkflow({ ...definition, version: '2.0.0' }, {
      'capture-page': () => ({}), 'infer-chain': () => ({}), 'apply-mock': () => ({})
    }, {}, { pluginId: 'com.dataelement.demo-test' })

    expect(upgraded.getRun(completed.id)?.compatibility).toMatchObject({
      status: 'historical', sourceVersion: '1.0.0', currentVersion: '2.0.0'
    })
  })

  it('blocks an incompatible paused run instead of applying a new workflow definition', async () => {
    const oldRuntime = runtime()
    oldRuntime.registerWorkflow(definition, {
      'capture-page': () => ({}), 'infer-chain': () => ({}), 'apply-mock': () => ({})
    }, {}, { pluginId: 'com.dataelement.demo-test' })
    const waiting = await oldRuntime.start({ workflowId: definition.id, pluginId: 'com.dataelement.demo-test' })

    const upgraded = runtime()
    upgraded.restoreRuns([persisted(waiting)])
    upgraded.registerWorkflow({ ...definition, version: '2.0.0' }, {
      'capture-page': () => ({}), 'infer-chain': () => ({}), 'apply-mock': () => ({})
    }, {}, { pluginId: 'com.dataelement.demo-test' })

    expect(upgraded.getRun(waiting.id)?.compatibility?.status).toBe('incompatible')
    await expect(upgraded.resume(waiting.id, { approved: true })).rejects.toThrow('cannot continue')
    expect(upgraded.getRun(waiting.id)?.workflowVersion).toBe('1.0.0')
  })

  it('migrates an explicitly compatible run only when its topology still matches', async () => {
    const oldRuntime = runtime()
    oldRuntime.registerWorkflow(definition, {
      'capture-page': () => ({}), 'infer-chain': () => ({}), 'apply-mock': () => ({})
    }, {}, { pluginId: 'com.dataelement.demo-test' })
    const waiting = await oldRuntime.start({ workflowId: definition.id, pluginId: 'com.dataelement.demo-test' })

    const upgraded = runtime()
    upgraded.restoreRuns([persisted(waiting)])
    upgraded.registerWorkflow({ ...definition, version: '2.0.0' }, {
      'capture-page': () => ({}), 'infer-chain': () => ({}), 'apply-mock': () => ({ output: { applied: true } })
    }, {}, { pluginId: 'com.dataelement.demo-test', compatibleRunVersions: ['1.0.0'] })

    expect(upgraded.getRun(waiting.id)?.compatibility?.status).toBe('migratable')
    const completed = await upgraded.resume(waiting.id, { approved: true })
    expect(completed.workflowVersion).toBe('2.0.0')
    expect(completed.compatibility).toMatchObject({ status: 'migrated', sourceVersion: '1.0.0', currentVersion: '2.0.0' })
    expect(completed.status).toBe('completed')
  })

  it('blocks runs restored under a different plugin identity', async () => {
    const oldRuntime = runtime()
    oldRuntime.registerWorkflow(definition, {
      'capture-page': () => ({}), 'infer-chain': () => ({}), 'apply-mock': () => ({})
    })
    const waiting = await oldRuntime.start({ workflowId: definition.id, pluginId: 'com.other.business' })
    const current = runtime()
    current.restoreRuns([persisted(waiting)])
    current.registerWorkflow(definition, {
      'capture-page': () => ({}), 'infer-chain': () => ({}), 'apply-mock': () => ({})
    }, {}, { pluginId: 'com.dataelement.demo-test' })
    expect(current.getRun(waiting.id)?.compatibility?.reason).toContain('different business plugin')
    await expect(current.resume(waiting.id, {})).rejects.toThrow('cannot continue')
  })
})
