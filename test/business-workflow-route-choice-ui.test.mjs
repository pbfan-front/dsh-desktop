// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

it('requires a deliberate route choice before retrying the same workflow run', async () => {
  const source = await readFile(resolve('packages/dsh-desktop-business-ui/client.js'), 'utf8')
  const initialRun = {
    id: 'ambiguous-run', workflowId: 'business-scenario-create', workflowVersion: '1.3.0', pluginId: 'demo.business',
    status: 'failed', currentStepId: 'analyze-target', context: { query: '借据列表', sessionId: 'current-conversation' },
    updatedAt: '2026-10-16T10:00:00.000Z', steps: [{
      id: 'analyze-target', title: '分析页面与接口证据', type: 'deterministic', status: 'failed', evidenceIds: [],
      error: { code: 'E_TARGET_ROUTE_AMBIGUOUS', message: 'Choose route Candidates: a very long diagnostic payload', retryable: true, candidates: [
        { routePath: '/loanPurpose/receiptList/:batchId', pageTitle: '借据列表' },
        { routePath: '/repay/receiptList', pageTitle: '还款借据列表' }
      ] }
    }]
  }
  const retryBusinessWorkflow = vi.fn(async (runId, retryInput) => ({
    run: { ...initialRun, id: runId, status: 'waiting_for_user', currentStepId: 'confirm-plan',
      context: { ...initialRun.context, routePath: retryInput.selectedRoutePath },
      steps: [{ ...initialRun.steps[0], status: 'completed', error: undefined }]
    }
  }))
  const previousRun = { ...initialRun, id: 'previous-run', status: 'completed', currentStepId: undefined,
    updatedAt: '2026-10-16T09:00:00.000Z', steps: [{ ...initialRun.steps[0], status: 'completed', error: undefined }] }
  const otherRun = { ...initialRun, id: 'other-run', updatedAt: '2026-10-16T11:00:00.000Z', context: { sessionId: 'other-conversation', query: 'other session query' } }
  const listeners = []
  const bridge = {
    businessWorkflowRuns: vi.fn(async () => ({ runs: [previousRun] })),
    onBusinessWorkflowChanged: vi.fn(listener => { listeners.push(listener); return () => undefined }),
    retryBusinessWorkflow,
    cancelBusinessWorkflow: vi.fn()
  }
  Object.defineProperty(window, 'dshDesktop', { value: bridge, configurable: true })
  let plugin
  new Function('window', 'document', source)(windowWithLoader(), document)
  function windowWithLoader() {
    window.__ModuleLoader__ = { load({ factory }) {
      plugin = factory(name => {
        if (name === 'react') return React
        if (name === '@deepseek-ai/dsh-client-ui-primitives') return { BrandWordmark: () => null, FishLogo: () => null }
        throw new Error(name)
      })
    } }
    return window
  }
  let WorkflowPanel
  let BusinessSidebarAction
  const openTab = vi.fn()
  plugin.apply({
    locale: { register: () => () => undefined, bind: () => key => key },
    effect: setup => setup(),
    sidebarRight: { openTab },
    sidebarRightTabs: { register: () => () => undefined },
    slots: {
      inject: (_name, setup) => setup(),
      register: (config, component) => {
        if (config.key === 'dsh-desktop-business-workflows') WorkflowPanel = component
        if (config.id === 'business-sidebar-preview') BusinessSidebarAction = component
        return () => undefined
      }
    }
  })
  const container = document.createElement('div')
  document.body.append(container)
  let root = createRoot(container)
  const panelForSession = sessionId => React.createElement(React.Fragment, null,
    React.createElement(BusinessSidebarAction, { sessionId }), React.createElement(WorkflowPanel, { t: key => key }))
  try {
    await act(async () => root.render(panelForSession('current-conversation')))
    expect(document.documentElement.dataset.dshBusinessSessionId).toBe('current-conversation')
    expect(container.querySelector('.dshWorkflowRouteChoice')).toBeNull()
    await act(async () => listeners.forEach(listener => listener(otherRun)))
    expect(openTab).not.toHaveBeenCalled()
    expect(container.querySelector('.dshWorkflowRouteChoice')).toBeNull()
    await act(async () => listeners.forEach(listener => listener(initialRun)))
    expect(openTab).toHaveBeenCalledExactlyOnceWith('business-workflows')
    expect(container.querySelector('.dshWorkflowRouteChoice')).not.toBeNull()
    await act(async () => root.render(panelForSession('other-conversation')))
    expect(document.documentElement.dataset.dshBusinessSessionId).toBe('other-conversation')
    expect(container.textContent).toContain('other session query')
    await act(async () => root.render(panelForSession('current-conversation')))
    expect(document.documentElement.dataset.dshBusinessSessionId).toBe('current-conversation')
    expect(container.textContent).not.toContain('other session query')
    const radios = [...container.querySelectorAll('.dshWorkflowRouteOption input[type="radio"]')]
    expect(radios.map(radio => radio.value)).toEqual(['/loanPurpose/receiptList/:batchId', '/repay/receiptList'])
    expect(radios.every(radio => !radio.checked)).toBe(true)
    const confirm = [...container.querySelectorAll('button')].find(button => button.textContent === 'confirmRoute')
    expect(confirm.disabled).toBe(true)
    expect(container.textContent).not.toContain('Recommended')
    expect(container.textContent).toContain('routeAmbiguousError')
    expect(container.textContent).not.toContain('Candidates:')
    await act(async () => radios[1].click())
    expect(confirm.disabled).toBe(false)
    expect(retryBusinessWorkflow).not.toHaveBeenCalled()
    await act(async () => confirm.click())
    expect(retryBusinessWorkflow).toHaveBeenCalledExactlyOnceWith('ambiguous-run', {
      selectedRoutePath: '/repay/receiptList', confirmedByUser: true
    })
    expect(bridge.cancelBusinessWorkflow).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    bridge.businessWorkflowRuns.mockResolvedValueOnce({ runs: [otherRun, initialRun] })
    root = createRoot(container)
    await act(async () => root.render(panelForSession('current-conversation')))
    expect(container.querySelector('.dshWorkflowRouteChoice')).not.toBeNull()
    expect(container.querySelector('.dshWorkflowRouteOption input')?.value).toBe('/loanPurpose/receiptList/:batchId')
    await act(async () => listeners.forEach(listener => listener({ ...initialRun, status: 'cancelled', currentStepId: undefined })))
    expect(container.querySelector('.dshWorkflowRouteChoice')).toBeNull()
    expect(container.textContent).toContain('routeAmbiguousHistory')
    expect(container.textContent).not.toContain('Candidates:')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    document.getElementById('dsh-desktop-workflow-styles')?.remove()
    delete document.documentElement.dataset.dshBusinessSessionId
    delete window.dshDesktop
    delete window.__ModuleLoader__
  }
})
