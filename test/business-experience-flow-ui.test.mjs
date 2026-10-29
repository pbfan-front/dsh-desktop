// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { BusinessWorkflowRuntime } from '../src/main/business-workflow-runtime'
import { registerBusinessScenarioWorkflow } from '../src/main/business-scenario-workflow'
import { registerBusinessWorkflowHandlers } from '../src/main/business-workflow-ipc'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.useRealTimers()
  document.getElementById('dsh-business-experience-flow-styles')?.remove()
  document.getElementById('dsh-desktop-workflow-styles')?.remove()
  delete window.__ModuleLoader__; delete window.dshDesktop
  delete document.documentElement.dataset.dshBusinessSessionId
})

const plan = { profileId: 'flow_receipt', label: '正常借据', page: 'repay', scenarios: [
  { id: 'flow_normal', apiUrl: '/loanNbr/loanNbr.json', data: { duestatus: '0' } }
], verificationSteps: [
  { id: 'list', label: '借据列表正常', route: '/repay/receiptList', containsText: ['正常', 'LOAN-1'], absentText: ['系统繁忙'] },
  { id: 'detail', label: '详情可提前结清', route: '/repay/receiptDetail', containsText: ['提前结清', 'LOAN-1'], absentText: ['系统繁忙'] }
] }

async function setup({ proposed = true, locale = 'zh', legacy = false, single = false, creationFailure = false } = {}) {
  const activePlan = { ...plan, verificationSteps: single ? plan.verificationSteps.slice(0, 1) : plan.verificationSteps }
  const runListeners = new Set(), evidenceListeners = new Set()
  const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'experience-run', onRunChanged: run => runListeners.forEach(listener => listener(run)) })
  const page = { selected: false, route: '/credit/productCombine', missing: false, hold: null, revisionId: 'activation-1' }
  const requestBusiness = vi.fn(async (path, input, sessionId) => {
    if (path === '/__desktop/resolve-target') return { routePath: '/repay/receiptList', pageTitle: '借据列表', source: 'explicit-route', confidence: 'high', candidates: [] }
    if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-flow', analysisPlan: { qualityGate: { level: 'review' } } }
    if (path === '/__desktop/create-profile' && creationFailure) throw new Error('fetch failed')
    if (path !== '/__desktop/verify') return { ok: true }
    if (page.hold) await page.hold
    if (!page.selected || input.route !== page.route || page.missing) throw new Error('E_PREVIEW_VERIFICATION_FAILED: private technical diagnostic')
    const at = Date.now()
    return { verified: true, sessionId, profileId: plan.profileId, revision: 1, revisionId: page.revisionId,
      checkedAt: new Date(at + 1).toISOString(), pageObservation: { profileId: plan.profileId, sessionId, revision: 1,
        revisionId: page.revisionId, observedAt: new Date(at).toISOString(), route: page.route },
      checks: { currentProfile: true, observationCurrent: true, route: true, containsText: [], absentText: [],
        scenarios: [{ apiUrl: plan.scenarios[0].apiUrl, scenarioId: plan.scenarios[0].id, passed: true }] } }
  })
  const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'fixture.business', requestBusiness })
  const run = await start({ query: '正常借据', routePath: '/repay/receiptList', sessionId: 'session-1' })
  if (proposed) await runtime.proposeCheckpoint(run.id, activePlan)
  else await runtime.resume(run.id, activePlan)
  const handlers = new Map()
  const trusted = vi.fn()
  registerBusinessWorkflowHandlers({ ipcMain: { removeHandler: channel => handlers.delete(channel), handle: (channel, fn) => handlers.set(channel, fn) },
    runtime: () => runtime, assertTrustedEvent: trusted })
  const invoke = (channel, ...args) => handlers.get(channel)({ trusted: true }, ...args)
  const bridge = {
    businessWorkflowRuns: vi.fn(async () => ({ runs: runtime.listRuns().map(value => {
      if (!legacy) return value
      const copy = JSON.parse(JSON.stringify(value)); delete copy.context.experienceFlowVersion; return copy
    }) })),
    onBusinessWorkflowChanged: fn => { runListeners.add(fn); return () => runListeners.delete(fn) },
    onBusinessPreviewEvidence: fn => { evidenceListeners.add(fn); return () => evidenceListeners.delete(fn) },
    approveBusinessWorkflowProposal: vi.fn((...args) => invoke('business-workflow:approve-proposal', ...args)),
    resumeBusinessWorkflow: vi.fn((...args) => invoke('business-workflow:resume', ...args)),
    retryBusinessWorkflow: vi.fn((...args) => invoke('business-workflow:retry', ...args))
  }
  Object.defineProperty(window, 'dshDesktop', { value: bridge, configurable: true })
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  const registrations = new Map()
  window.__ModuleLoader__ = { load: registration => registrations.set(registration.chunk || 'entry', registration) }
  for (const file of ['client.js', 'client.experience-flow.js']) new Function('window', 'document', await readFile(`packages/dsh-desktop-business-ui/${file}`, 'utf8'))(window, document)
  const require = name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw Error(name)
  }
  require.async = vi.fn(async name => registrations.get(name.slice(2)).factory(require))
  const plugin = registrations.get('entry').factory(require)
  let Dock, dictionaries
  const openTab = vi.fn(), disposers = []
  plugin.apply({ locale: { register: (_ns, values) => { dictionaries = values; return () => {} }, bind: () => key => dictionaries[locale][key] },
    effect: fn => { const dispose = fn(); if (dispose) disposers.push(dispose) }, sidebarRight: { openTab }, sidebarRightTabs: { register: () => () => {} },
    slots: { inject: (_slot, fn) => fn(), register: (config, component) => { if (config.id === 'business-experience-flow') Dock = component; return () => {} } } })
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  let mounted = true
  const render = async (sessionId = 'session-1') => { await act(async () => root.render(React.createElement(Dock, { sessionId, t: key => dictionaries[locale][key] }))) }
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()) } }
  cleanups.push(async () => { await unmount(); disposers.reverse().forEach(fn => fn()); container.remove() })
  vi.useFakeTimers()
  await render()
  const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(750) }) }
  const emit = async (overrides = {}) => {
    const value = { sessionId: 'session-1', profileId: page.selected ? plan.profileId : null, revision: 1, revisionId: page.revisionId,
      route: page.route, observedAt: new Date(Date.now()).toISOString(), fingerprint: 'a'.repeat(64), ...overrides }
    await act(async () => evidenceListeners.forEach(fn => fn(value)))
    return value
  }
  const button = key => [...container.querySelectorAll('button')].find(el => el.textContent === dictionaries[locale][key])
  return { container, runtime, page, bridge, requestBusiness, trusted, openTab, render, unmount, emit, tick, button, runListeners, evidenceListeners, dictionaries, registrations, require }
}

it('confirms the exact proposal in the conversation without checkboxes or opening diagnostics, and never auto-selects', async () => {
  const f = await setup()
  expect(f.require.async).toHaveBeenCalledWith('./client.experience-flow.js')
  expect(f.container.querySelector('input[type=checkbox]')).toBeNull()
  expect(f.container.querySelector('details')?.open).toBe(false)
  expect(f.container.textContent).toContain('确认后仅新增分支')
  expect(f.container.querySelector('details').textContent).toContain('系统繁忙')
  expect(f.bridge.approveBusinessWorkflowProposal).not.toHaveBeenCalled()
  await f.emit(); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).not.toHaveBeenCalled()
  const proposalId = f.runtime.getRun('experience-run').checkpointProposal.id
  await act(async () => { f.button('planConfirm').click(); f.button('planConfirm')?.click() })
  expect(f.bridge.approveBusinessWorkflowProposal).toHaveBeenCalledExactlyOnceWith('experience-run', { proposalId, sessionId: 'session-1' })
  expect(f.trusted).toHaveBeenCalled()
  expect(f.runtime.getRun('experience-run').currentStepId).toBe('wait-for-preview')
  expect(f.page.selected).toBe(false)
  expect(f.requestBusiness.mock.calls.some(([path]) => path === '/__desktop/apply')).toBe(false)
  expect(f.openTab).not.toHaveBeenCalled()
  expect(f.container.textContent).toBe('')
})

it('waits quietly for the right branch/page, then checks ordered pages through the original checkpoint without clicks', async () => {
  const f = await setup({ proposed: false })
  await f.emit(); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).not.toHaveBeenCalled()
  expect(f.container.textContent).toBe('')
  f.page.selected = true
  await f.emit({ fingerprint: 'b'.repeat(64) }); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).not.toHaveBeenCalled()
  expect(f.container.textContent).toBe('')
  f.page.route = plan.verificationSteps[0].route
  await f.emit({ fingerprint: 'c'.repeat(64) }); await f.tick()
  expect(f.runtime.getRun('experience-run').context.previewVerifications).toHaveLength(1)
  expect(f.bridge.resumeBusinessWorkflow).toHaveBeenCalledExactlyOnceWith('experience-run', { stepId: 'list' })
  f.page.route = plan.verificationSteps[1].route
  await f.emit({ fingerprint: 'd'.repeat(64) }); await f.tick()
  expect(f.runtime.getRun('experience-run').status).toBe('completed')
  expect(f.container.querySelector('.dshExperienceFlow')).toBeNull()
  expect(f.container.textContent).toBe('')
  expect(f.requestBusiness.mock.calls.filter(([path]) => path === '/__desktop/verify').map(([, input]) => input)).toEqual([
    { ...plan.verificationSteps[0], id: undefined, label: undefined, partial: true, expectedProfileId: plan.profileId },
    { ...plan.verificationSteps[1], id: undefined, label: undefined, partial: true, expectedProfileId: plan.profileId },
    { ...plan.verificationSteps[1], id: undefined, label: undefined, expectedProfileId: plan.profileId }
  ].map(({ id, label, ...input }) => input))
  expect(f.openTab).not.toHaveBeenCalled()
})

it('does not spin on the same failing page; raw diagnostics stay folded and new evidence can trigger one new attempt', async () => {
  const f = await setup({ proposed: false })
  f.page.selected = true; f.page.route = plan.verificationSteps[0].route; f.page.missing = true
  const evidence = await f.emit(); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).toHaveBeenCalledTimes(1)
  expect(f.runtime.getRun('experience-run').context.previewVerifications).toBeUndefined()
  expect(f.container.querySelector('[role=alert]')).toBeNull()
  expect(f.container.querySelector('.dshExperienceFlow')).toBeNull()
  expect(f.container.textContent).toBe('')
  await f.emit(evidence); await f.tick(); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).toHaveBeenCalledTimes(1)
  f.page.missing = false
  await f.emit({ fingerprint: 'b'.repeat(64) }); await f.tick()
  expect(f.runtime.getRun('experience-run').context.previewVerifications).toHaveLength(1)
})

it('ignores other sessions and hidden windows, and cleans subscriptions/timers on session changes or unmount', async () => {
  const f = await setup({ proposed: false })
  f.page.selected = true; f.page.route = plan.verificationSteps[0].route
  await f.emit({ sessionId: 'another-session' }); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).not.toHaveBeenCalled()
  Object.defineProperty(document, 'hidden', { value: true, configurable: true })
  await f.emit(); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).not.toHaveBeenCalled()
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  await f.render('another-session'); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).not.toHaveBeenCalled()
  expect(f.container.textContent).not.toContain('正常借据')
  await f.unmount()
  expect(f.runListeners.size).toBe(0)
  expect(f.evidenceListeners.size).toBe(0)
})

it('requires an explicit reset after branch reactivation and retains old page evidence', async () => {
  const f = await setup({ proposed: false })
  f.page.selected = true; f.page.route = plan.verificationSteps[0].route
  await f.emit(); await f.tick()
  f.page.revisionId = 'activation-2'; f.page.route = plan.verificationSteps[1].route
  await f.emit({ fingerprint: 'b'.repeat(64) }); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).toHaveBeenCalledTimes(1)
  expect(f.container.textContent).toBe('')
  // Recovery remains available through the diagnostics bridge, not a conversation card.
  await act(async () => { await f.bridge.resumeBusinessWorkflow('experience-run', { restartVerification: true }) })
  expect(f.bridge.resumeBusinessWorkflow).toHaveBeenLastCalledWith('experience-run', { restartVerification: true })
  expect(f.runtime.getRun('experience-run').context.previousPreviewVerifications).toHaveLength(1)
  expect(f.runtime.getRun('experience-run').context.previewVerifications).toEqual([])
})

it('does not automatically advance legacy records and has matching English copy', async () => {
  const f = await setup({ proposed: false, legacy: true, locale: 'en' })
  f.page.selected = true; f.page.route = plan.verificationSteps[0].route
  await f.emit(); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).not.toHaveBeenCalled()
  expect(f.container.textContent).toBe('')
  expect(Object.keys(f.dictionaries.zh).sort()).toEqual(Object.keys(f.dictionaries.en).sort())
  expect(f.container.textContent).not.toContain('undefined')
})

it('finishes a single-page branch without a Verify click and keeps only one check in flight', async () => {
  const f = await setup({ proposed: false, single: true })
  f.page.selected = true; f.page.route = plan.verificationSteps[0].route
  let release
  f.page.hold = new Promise(resolve => { release = resolve })
  await f.emit(); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).toHaveBeenCalledTimes(1)
  await f.emit({ fingerprint: 'b'.repeat(64) }); await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).toHaveBeenCalledTimes(1)
  await act(async () => { release(); await f.page.hold })
  expect(f.runtime.getRun('experience-run').status).toBe('completed')
  expect(f.bridge.resumeBusinessWorkflow).toHaveBeenCalledTimes(1)
  expect(f.container.querySelector('.dshExperienceFlow')).toBeNull()
  expect(f.container.textContent).toBe('')
  expect(f.container.textContent).not.toContain('验证当前步骤')
})

it('rejects a replaced proposal even if an old rendered confirmation handler is retained', async () => {
  const f = await setup()
  const oldProposal = f.runtime.getRun('experience-run').checkpointProposal.id
  await act(async () => f.runtime.proposeCheckpoint('experience-run', { ...plan, label: '更新后的方案' }))
  expect(f.container.textContent).toContain('更新后的方案')
  // Exercise the exported controller's version check independently of React's
  // fresh button closure; the original Main version gate also remains active.
  const module = f.registrations.get('client.experience-flow.js').factory(f.require)
  let snapshot
  const controller = module.createExperienceController({ bridge: f.bridge, sessionId: 'session-1', currentSession: () => 'session-1', visible: () => true,
    proposalFor: run => run?.checkpointProposal, progressFor: () => null, choicesFor: () => [], onChange: value => { snapshot = value } })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  await controller.confirm('experience-run', oldProposal)
  expect(snapshot.errorKind).toBe('changed')
  expect(f.bridge.approveBusinessWorkflowProposal).not.toHaveBeenCalled()
  controller.dispose()
})


it('hides cancelled tasks both on live cancellation and when reopening their session, retaining diagnostics', async () => {
  const f = await setup()
  expect(f.container.querySelector('.dshExperienceFlow')).not.toBeNull()
  await act(async () => { await f.runtime.cancel('experience-run') })
  expect(f.container.textContent).toBe('')
  expect(f.runtime.getRun('experience-run').status).toBe('cancelled')
  await f.render('another-session')
  await f.render('session-1')
  expect(f.container.querySelector('.dshExperienceFlow')).toBeNull()
  expect(f.container.textContent).toBe('')
  expect(f.bridge.approveBusinessWorkflowProposal).not.toHaveBeenCalled()
  expect(f.bridge.resumeBusinessWorkflow).not.toHaveBeenCalled()
  expect(f.runListeners.size).toBe(1)
})


for (const created of [false, true]) {
  it(`hides failed ${created ? 'preview checks' : 'creation'} results, including reopened sessions`, async () => {
    const f = await setup({ proposed: false })
    const failed = JSON.parse(JSON.stringify(f.runtime.getRun('experience-run')))
    failed.status = 'failed'
    delete failed.checkpointProposal
    if (!created) failed.steps = failed.steps.filter(step => step.id !== 'create-profile')
    f.bridge.businessWorkflowRuns.mockResolvedValue({ runs: [failed] })
    await act(async () => { f.runListeners.forEach(fn => fn(failed)) })
    expect(f.container.textContent).toBe('')
    await f.render('another-session')
    await f.render('session-1')
    expect(f.container.querySelector('.dshExperienceFlow')).toBeNull()
    expect(f.bridge.resumeBusinessWorkflow).not.toHaveBeenCalled()
    expect(f.bridge.approveBusinessWorkflowProposal).not.toHaveBeenCalled()
    expect(f.runListeners.size).toBe(1)
  })
}


it('hides creation failure feedback while retaining the failed workflow without automatic replay', async () => {
  const f = await setup({ creationFailure: true })
  await act(async () => f.button('planConfirm').click())
  expect(f.bridge.approveBusinessWorkflowProposal).toHaveBeenCalledTimes(1)
  expect(f.runtime.getRun('experience-run')).toMatchObject({ status: 'failed', currentStepId: 'create-profile' })
  expect(f.container.querySelector('[role=alert]')).toBeNull()
  expect(f.container.textContent).toBe('')
  expect(f.container.querySelector('.dshExperienceFlow')).toBeNull()
  expect(f.requestBusiness.mock.calls.filter(([path]) => path === '/__desktop/create-profile')).toHaveLength(1)
  await f.tick()
  expect(f.bridge.resumeBusinessWorkflow).not.toHaveBeenCalled()
  await f.render('another-session'); await f.render('session-1')
  expect(f.container.textContent).toBe('')
})
