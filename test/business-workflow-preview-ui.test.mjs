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
  document.getElementById('dsh-desktop-workflow-styles')?.remove()
  delete document.documentElement.dataset.dshBusinessSessionId
  delete window.dshDesktop
  delete window.__ModuleLoader__
})

const plan = {
  profileId: 'normal_receipt', label: '正常借据', page: 'repay',
  scenarios: [{ id: 'receipt_normal', apiUrl: '/loanNbr/loanNbr.json', data: { duestatus: '0' } }],
  verificationSteps: [
    { id: 'list', label: '列表正常', route: '/repay/receiptList', containsText: ['正常', 'LOAN-1'], absentText: ['系统繁忙'], apiUrls: ['/loanNbr/loanNbr.json'] },
    { id: 'detail', label: '详情可提前结清', route: '/repay/receiptDetail', containsText: ['提前结清', 'LOAN-1'], absentText: ['系统繁忙'] }
  ]
}

async function scenario({ proposed = false } = {}) {
  const listeners = new Set()
  const runtime = new BusinessWorkflowRuntime({ idFactory: () => 'preview-run', onRunChanged: run => { listeners.forEach(listener => listener(run)) } })
  const page = { route: '/repay/receiptList', selected: false, revisionId: 'activation-1', finalMissing: false, hold: null, createHold: null }
  let at = 1000
  const requestBusiness = vi.fn(async (path, input, sessionId) => {
    if (path === '/__desktop/resolve-target') return { routePath: '/repay/receiptList', source: 'explicit-route', confidence: 'high', candidates: [] }
    if (path === '/__desktop/analyze-target') return { evidenceId: 'evidence-1' }
    if (path === '/__desktop/create-profile' && page.createHold) await page.createHold
    if (path !== '/__desktop/verify') return { ok: true }
    if (page.hold) await page.hold
    if (!page.selected) throw new Error('E_PREVIEW_VERIFICATION_FAILED: manually select the expected Profile')
    if (input.route !== page.route) throw new Error('E_PREVIEW_VERIFICATION_FAILED: route mismatch; open the declared page')
    if (!input.partial && page.finalMissing) throw new Error('E_PREVIEW_VERIFICATION_FAILED: final API evidence missing')
    at += 100
    return { verified: true, sessionId, profileId: plan.profileId, revision: 1, revisionId: page.revisionId,
      checkedAt: new Date(at + 1).toISOString(),
      pageObservation: { route: page.route, profileId: plan.profileId, revision: 1, revisionId: page.revisionId, observedAt: new Date(at).toISOString() },
      checks: { currentProfile: true, observationCurrent: true, route: true, containsText: [], absentText: [],
        scenarios: [{ apiUrl: '/loanNbr/loanNbr.json', scenarioId: 'receipt_normal', passed: true }] } }
  })
  const start = registerBusinessScenarioWorkflow({ runtime, pluginId: 'test.business', requestBusiness })
  const run = await start({ routePath: '/repay/receiptList', query: '正常借据可以提前结清', sessionId: 'session-1' })
  if (proposed) await runtime.proposeCheckpoint(run.id, plan)
  else await runtime.resume(run.id, plan)
  const handlers = new Map()
  const assertTrustedEvent = vi.fn()
  registerBusinessWorkflowHandlers({ ipcMain: { removeHandler: channel => handlers.delete(channel), handle: (channel, handler) => handlers.set(channel, handler) },
    runtime: () => runtime, assertTrustedEvent })
  const invoke = (channel, ...args) => handlers.get(channel)({ trusted: true }, ...args)
  const bridge = {
    businessWorkflowRuns: vi.fn(async () => ({ runs: runtime.listRuns() })),
    onBusinessWorkflowChanged: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    resumeBusinessWorkflow: vi.fn((...args) => invoke('business-workflow:resume', ...args)),
    approveBusinessWorkflowProposal: vi.fn((...args) => invoke('business-workflow:approve-proposal', ...args)),
    retryBusinessWorkflow: vi.fn((...args) => invoke('business-workflow:retry', ...args)),
    cancelBusinessWorkflow: vi.fn((...args) => invoke('business-workflow:cancel', ...args))
  }
  return { runtime, page, requestBusiness, bridge, assertTrustedEvent, listeners }
}

async function mount(bridge, sessionId = 'session-1', locale = 'en') {
  Object.defineProperty(window, 'dshDesktop', { value: bridge, configurable: true })
  document.documentElement.dataset.dshBusinessSessionId = sessionId
  let plugin
  window.__ModuleLoader__ = { load: ({ factory }) => { plugin = factory(name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { BrandWordmark: () => null, FishLogo: () => null }
    throw new Error(name)
  }) } }
  new Function('window', 'document', await readFile('packages/dsh-desktop-business-ui/client.js', 'utf8'))(window, document)
  let WorkflowPanel
  let dictionary
  const disposers = []
  plugin.apply({
    locale: { register: (_ns, values) => { dictionary = values; return () => undefined }, bind: () => key => dictionary[locale][key] },
    effect: setup => { const dispose = setup(); if (dispose) disposers.push(dispose) },
    sidebarRight: { openTab: vi.fn() }, sidebarRightTabs: { register: () => () => undefined },
    slots: { inject: (_name, setup) => setup(), register: (config, component) => {
      if (config.key === 'dsh-desktop-business-workflows') WorkflowPanel = component
      return () => undefined
    } }
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let mounted = true
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()) } }
  cleanups.push(async () => { await unmount(); disposers.reverse().forEach(dispose => dispose()); container.remove() })
  await act(async () => root.render(React.createElement(WorkflowPanel, { t: key => dictionary[locale][key] })))
  const button = key => [...container.querySelectorAll('button')].find(button => button.textContent === dictionary[locale][key])
  return { container, button, dictionary, unmount }
}

it('checks the saved assertions through trusted IPC, waits for manual navigation, and completes the real workflow state machine', async () => {
  const { runtime, page, bridge, requestBusiness, assertTrustedEvent } = await scenario()
  const { container, button } = await mount(bridge)
  expect(container.textContent).toContain('Passed 0/2')
  expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('LOAN-1')
  expect(container.textContent).not.toContain('Waiting for confirmation. Continue this step in the conversation.')
  await act(async () => button('verifyPage').click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('manually select')
  expect(runtime.getRun('preview-run').context.previewVerifications).toBeUndefined()
  page.selected = true
  await act(async () => button('verifyPage').click())
  expect(container.textContent).toContain('Passed 1/2')
  expect(container.textContent).toContain('This step passed.')
  expect(runtime.getRun('preview-run').status).toBe('waiting_for_user')
  await act(async () => button('verifyPage').click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('route mismatch')
  expect(runtime.getRun('preview-run').context.previewVerifications).toHaveLength(1)
  page.route = '/repay/receiptDetail'
  await act(async () => button('verifyPage').click())
  expect(runtime.getRun('preview-run').status).toBe('completed')
  expect(container.textContent).toContain('All pages and the final verification gate passed.')
  expect(container.textContent).toContain('Viewing this record does not recreate or switch Profiles.')
  expect(container.textContent).not.toContain('Manually select this Profile')
  expect(button('verifyPage')).toBeUndefined()
  expect(bridge.resumeBusinessWorkflow.mock.calls).toEqual([
    ['preview-run', { stepId: 'list' }], ['preview-run', { stepId: 'list' }],
    ['preview-run', { stepId: 'detail' }], ['preview-run', { stepId: 'detail' }]
  ])
  expect(assertTrustedEvent).toHaveBeenCalledTimes(4)
  expect(runtime.getRun('preview-run').context.plan).toEqual(plan)
  const verificationRequests = requestBusiness.mock.calls.filter(([path]) => path === '/__desktop/verify')
  expect(verificationRequests.at(-1)).toEqual(['/__desktop/verify', {
    route: '/repay/receiptDetail', containsText: ['提前结清', 'LOAN-1'], absentText: ['系统繁忙'], expectedProfileId: plan.profileId
  }, 'session-1'])
  expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/apply')).toBe(false)
})

it('blocks rapid duplicate clicks and rejects a stale step rather than capturing the next page', async () => {
  const { runtime, page, bridge } = await scenario()
  page.selected = true
  let release
  page.hold = new Promise(done => { release = done })
  const { container, button } = await mount(bridge)
  await act(async () => { const verify = button('verifyPage'); verify.click(); verify.click() })
  expect(bridge.resumeBusinessWorkflow).toHaveBeenCalledTimes(1)
  expect(button('verifyingPage').disabled).toBe(true)
  expect(container.querySelector('.dshWorkflowPreviewChecks').getAttribute('aria-busy')).toBe('true')
  await act(async () => { release(); await page.hold })
  await expect(bridge.resumeBusinessWorkflow('preview-run', { stepId: 'list' })).rejects.toThrow('next declared page step: detail')
  expect(runtime.getRun('preview-run').context.previewVerifications).toHaveLength(1)
})

it('preserves prior receipts on revision change and does not silently restart verification', async () => {
  const { runtime, page, bridge } = await scenario()
  page.selected = true
  const { container, button } = await mount(bridge)
  await act(async () => button('verifyPage').click())
  page.route = '/repay/receiptDetail'
  page.revisionId = 'activation-2'
  await act(async () => button('verifyPage').click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Preview revision changed')
  expect(runtime.getRun('preview-run').context.previewVerifications).toHaveLength(1)
  expect(runtime.getRun('preview-run').status).toBe('waiting_for_user')
  expect(bridge.resumeBusinessWorkflow.mock.calls.at(-1)).toEqual(['preview-run', { stepId: 'detail' }])
})

it('keeps final gate failures distinct from captured pages and uses the existing safe retry', async () => {
  const { runtime, page, bridge } = await scenario()
  page.selected = true
  const { container, button } = await mount(bridge)
  await act(async () => button('verifyPage').click())
  page.route = '/repay/receiptDetail'
  page.finalMissing = true
  await act(async () => button('verifyPage').click())
  expect(container.textContent).toContain('Passed 2/2')
  expect(container.textContent).toContain('final API evidence missing')
  expect(container.textContent).not.toContain('All pages and the final verification gate passed.')
  expect(button('verifyPage')).toBeUndefined()
  page.finalMissing = false
  await act(async () => button('retry').click())
  expect(runtime.getRun('preview-run').status).toBe('completed')
  expect(bridge.retryBusinessWorkflow).toHaveBeenCalledExactlyOnceWith('preview-run', undefined)
})

it('disables verification for another conversation and suppresses late errors after a session switch', async () => {
  const { page, bridge } = await scenario()
  const { container, button } = await mount(bridge, 'other-session')
  expect(button('verifyPage').disabled).toBe(true)
  expect(container.textContent).toContain('Switch to this run’s conversation')
  await act(async () => { document.documentElement.dataset.dshBusinessSessionId = 'session-1'; window.dispatchEvent(new Event('dsh-desktop:business-session-change')) })
  expect(button('verifyPage').disabled).toBe(false)
  let release
  page.hold = new Promise(done => { release = done })
  await act(async () => button('verifyPage').click())
  await act(async () => { document.documentElement.dataset.dshBusinessSessionId = 'other-session'; window.dispatchEvent(new Event('dsh-desktop:business-session-change')) })
  await act(async () => { release(); await page.hold })
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(button('verifyPage').disabled).toBe(true)
})

it('does not update an unmounted panel or retain its workflow listener', async () => {
  const { page, bridge, listeners } = await scenario()
  let release
  page.hold = new Promise(done => { release = done })
  const { button, unmount } = await mount(bridge)
  await act(async () => button('verifyPage').click())
  await unmount()
  await act(async () => { release(); await page.hold })
  expect(listeners.size).toBe(1) // Only the plugin-owned route-choice subscription remains until disposal.
})

it.each(['confirm-plan', 'legacy-single-page', 'cancelled', 'incompatible', 'missing-bridge'])('does not expose an unsafe verification action for %s', async state => {
  const { runtime, bridge } = await scenario()
  const run = runtime.getRun('preview-run')
  if (state === 'confirm-plan') { run.currentStepId = 'confirm-plan'; run.steps.find(step => step.id === 'create-profile').status = 'pending' }
  if (state === 'legacy-single-page') delete run.context.plan.verificationSteps
  if (state === 'cancelled') { run.status = 'cancelled'; delete run.currentStepId }
  if (state === 'incompatible') run.compatibility = { status: 'incompatible' }
  if (state === 'missing-bridge') delete bridge.resumeBusinessWorkflow
  bridge.businessWorkflowRuns.mockResolvedValueOnce({ runs: [run] })
  const { container, button } = await mount(bridge)
  expect(button('verifyPage')).toBeUndefined()
  if (state === 'confirm-plan') expect(container.textContent).toContain('submit a reviewed full plan')
  if (state === 'legacy-single-page') expect(container.textContent).toContain('Continue this step in the conversation.')
})

it('registers matching Chinese and English keys and renders the Chinese verification action', async () => {
  const { bridge } = await scenario()
  const { container, button, dictionary } = await mount(bridge, 'session-1', 'zh')
  expect(Object.keys(dictionary.zh).sort()).toEqual(Object.keys(dictionary.en).sort())
  expect(button('verifyPage').textContent).toBe('验证当前步骤')
  expect(container.textContent).toContain('已通过 0/2')
  expect(container.querySelectorAll('input,textarea')).toHaveLength(0)
})

it('requires deliberate acknowledgement before confirming the exact staged plan through trusted IPC', async () => {
  const { runtime, bridge, requestBusiness, page } = await scenario({ proposed: true })
  const proposalId = runtime.getRun('preview-run').checkpointProposal.id
  const { container, button } = await mount(bridge)
  expect(container.textContent).toContain('Review experience plan')
  expect(container.textContent).toContain('/loanNbr/loanNbr.json')
  expect(container.textContent).toContain('Planned page checks')
  expect(container.textContent).toContain('提前结清')
  expect(button('planConfirm').disabled).toBe(true)
  expect(container.querySelector('.dshWorkflowPlanAck input').checked).toBe(false)
  expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/create-profile')).toBe(false)
  await act(async () => container.querySelector('.dshWorkflowPlanAck input').click())
  expect(button('planConfirm').disabled).toBe(false)
  document.documentElement.dataset.dshBusinessSessionId = 'just-switched-session'
  await act(async () => button('planConfirm').click())
  expect(bridge.approveBusinessWorkflowProposal).not.toHaveBeenCalled()
  document.documentElement.dataset.dshBusinessSessionId = 'session-1'
  let release
  page.createHold = new Promise(done => { release = done })
  await act(async () => { button('planConfirm').click(); button('planConfirm')?.click() })
  expect(bridge.approveBusinessWorkflowProposal).toHaveBeenCalledExactlyOnceWith('preview-run', { proposalId, sessionId: 'session-1' })
  expect(button('planConfirm')).toBeUndefined()
  expect(container.textContent).toContain('The workflow is running')
  await act(async () => { release(); await page.createHold })
  expect(runtime.getRun('preview-run').currentStepId).toBe('wait-for-preview')
  expect(container.textContent).toContain('Profile added, not activated.')
  expect(container.querySelector('.dshWorkflowPlanReview')).toBeNull()
  expect(page.selected).toBe(false)
  expect(requestBusiness.mock.calls.filter(([path]) => path === '/__desktop/create-profile')).toHaveLength(1)
  expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/apply')).toBe(false)
})

it('clears acknowledgement on proposal replacement and keeps an old confirmation from creating', async () => {
  const { runtime, bridge, requestBusiness } = await scenario({ proposed: true })
  const { container, button } = await mount(bridge)
  await act(async () => container.querySelector('.dshWorkflowPlanAck input').click())
  const oldSelection = { proposalId: runtime.getRun('preview-run').checkpointProposal.id, sessionId: 'session-1' }
  await act(async () => runtime.proposeCheckpoint('preview-run', { ...plan, label: 'Revised reviewed plan' }))
  expect(container.textContent).toContain('Revised reviewed plan')
  expect(button('planConfirm').disabled).toBe(true)
  expect(container.querySelector('.dshWorkflowPlanAck input').checked).toBe(false)
  await expect(bridge.approveBusinessWorkflowProposal('preview-run', oldSelection)).rejects.toThrow('changed')
  expect(requestBusiness.mock.calls.some(([path]) => path === '/__desktop/create-profile')).toBe(false)
})

it('disables confirmation outside the proposal conversation and when the approval bridge is unavailable', async () => {
  const { bridge } = await scenario({ proposed: true })
  const { container, button, unmount } = await mount(bridge, 'other-session')
  expect(container.querySelector('.dshWorkflowPlanAck input').disabled).toBe(true)
  expect(button('planConfirm').disabled).toBe(true)
  expect(container.textContent).toContain('Switch to this run’s conversation')
  await unmount()
  delete bridge.approveBusinessWorkflowProposal
  const second = await mount(bridge)
  expect(second.container.querySelector('.dshWorkflowPlanReview')).not.toBeNull()
  expect(second.button('planConfirm')).toBeUndefined()
  expect(second.container.textContent).toContain('Continue this step in the conversation.')
})
