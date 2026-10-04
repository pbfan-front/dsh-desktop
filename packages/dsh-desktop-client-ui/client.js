window.__ModuleLoader__.load({
  id: 'dsh-desktop-client-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { BrandWordmark, FishLogo } = require('@deepseek-ai/dsh-client-ui-primitives')
    const WORKFLOW_NS = 'dsh-desktop-workflow'
    const workflowZh = {
      tab: '工作流', guide: '查看业务场景工作流的进度、证据和失败原因', scenarioWorkflow: '业务场景创建与验证', loading: '正在读取工作流…',
      empty: '暂无工作流运行记录', emptyHint: '通过对话创建业务场景后，运行进度会显示在这里。',
      loadFailed: '工作流记录加载失败', retryLoad: '重新加载', updated: '更新于', steps: '执行步骤',
      route: '业务页面', profile: '体验分支', session: '关联会话', query: '目标', evidence: '证据', error: '失败原因', input: '输入摘要', output: '输出摘要',
      version: '工作流版本', compatibility: '兼容状态', current: '当前版本', migratable: '可安全迁移', migrated: '已迁移', historical: '历史记录', incompatible: '不兼容',
      incompatibleHint: '当前业务插件无法安全继续此运行；历史记录仍可查看，请重新创建工作流。', migratableHint: '此运行将在下一次继续或重试时迁移到当前兼容版本。',
      retry: '重试失败步骤', cancel: '取消运行', copy: '复制诊断', copied: '已复制', actionFailed: '操作失败',
      waitingHint: '正在等待确认，请回到对话继续该步骤。', runningHint: '工作流正在执行，状态会自动更新。',
      pending: '待执行', running: '执行中', waiting_for_user: '等待确认', completed: '已完成', failed: '失败',
      cancelled: '已取消', skipped: '已跳过', deterministic: '确定性', agent: 'Agent', checkpoint: '检查点'
    }
    const workflowEn = {
      tab: 'Workflows', guide: 'Inspect business workflow progress, evidence, and failures', scenarioWorkflow: 'Create and verify business scenario', loading: 'Loading workflows…',
      empty: 'No workflow runs yet', emptyHint: 'Runs created through business conversations will appear here.',
      loadFailed: 'Unable to load workflow runs', retryLoad: 'Reload', updated: 'Updated', steps: 'Steps',
      route: 'Route', profile: 'Profile', session: 'Conversation', query: 'Target', evidence: 'Evidence', error: 'Failure', input: 'Input summary', output: 'Output summary',
      version: 'Workflow version', compatibility: 'Compatibility', current: 'Current', migratable: 'Safe to migrate', migrated: 'Migrated', historical: 'Historical', incompatible: 'Incompatible',
      incompatibleHint: 'The current business plugin cannot safely continue this run. History remains available; create a new workflow.', migratableHint: 'This run will migrate to the current compatible version when resumed or retried.',
      retry: 'Retry failed step', cancel: 'Cancel run', copy: 'Copy diagnostics', copied: 'Copied', actionFailed: 'Action failed',
      waitingHint: 'Waiting for confirmation. Continue this step in the conversation.', runningHint: 'The workflow is running and will update automatically.',
      pending: 'Pending', running: 'Running', waiting_for_user: 'Waiting', completed: 'Completed', failed: 'Failed',
      cancelled: 'Cancelled', skipped: 'Skipped', deterministic: 'Deterministic', agent: 'Agent', checkpoint: 'Checkpoint'
    }

    // Tight bounds of the mark inside its 1000x1000 source artwork.
    const BRAND_MARK_VIEWBOX = { x: 42, y: 218, width: 898, height: 564 }
    // DSH Desktop whale mark: a window with a tail, drawn in currentColor so
    // it follows the sidebar text color in both themes.
    const BRAND_MARK_PATH = "M478.318 218C605.318 218 683.318 287 687.318 404L691.318 472C693.318 525 697.319 556 726.318 574C746.318 587 774.318 585 790.318 562C799.318 550 802.318 539 792.318 534C747.319 513 727.318 472 738.318 428C739.652 420 742.652 418.667 747.318 424C774.318 450 815.318 460 831.318 501C855.318 457 898.318 456 930.318 436C936.318 431.333 939.318 433.333 939.318 442C938.318 496 903.318 535 850.318 547C841.318 570 833.318 592 819.318 622C773.318 723 661.318 782 491.318 782H294.318C161.319 782 74.3183 714 53.3184 592C41.3184 526 38.3184 433 50.3184 375C70.3184 277 113.82 218 234.32 218H478.318ZM571.82 350.5C469.82 333.5 277.82 329.5 164.82 350.5C138.82 355.5 114.318 379 110.318 404C100.318 451 102.318 551 124.318 596C155.318 660 214.319 697 315.318 705C324.318 678 346.319 662 376.318 662C404.318 662 427.318 678 435.318 705C493.318 699 526.318 680 562.318 652C621.318 606 633.749 527.103 633.749 424C633.749 385.144 604.82 355.5 571.82 350.5ZM179.32 264C167.722 264 158.32 273.402 158.32 285C158.32 296.598 167.722 306 179.32 306C190.918 306 200.32 296.598 200.32 285C200.32 273.402 190.918 264 179.32 264ZM245.551 264C233.953 264 224.551 273.402 224.551 285C224.551 296.598 233.953 306 245.551 306C257.149 306 266.551 296.598 266.551 285C266.551 273.402 257.149 264 245.551 264ZM311.782 264C300.184 264 290.782 273.402 290.782 285C290.782 296.598 300.184 306 311.782 306C323.38 306 332.782 296.598 332.782 285C332.782 273.402 323.38 264 311.782 264Z"

    function DesktopBrandMark() {
      const height = 17
      return React.createElement(
        'svg',
        {
          width: height * BRAND_MARK_VIEWBOX.width / BRAND_MARK_VIEWBOX.height,
          height,
          viewBox: `${BRAND_MARK_VIEWBOX.x} ${BRAND_MARK_VIEWBOX.y} ${BRAND_MARK_VIEWBOX.width} ${BRAND_MARK_VIEWBOX.height}`,
          fill: 'none',
          'aria-hidden': 'true'
        },
        React.createElement('path', { d: BRAND_MARK_PATH, fill: 'currentColor' })
      )
    }

    function DesktopBrandName() {
      return React.createElement(BrandWordmark, { includeMark: false })
    }

    function ConversationBrandMark(props) {
      return React.createElement(FishLogo, props)
    }

    function BusinessSidebarAction(props) {
      return React.createElement('button', {
        type: 'button', onClick: () => {
          let hostWindow = window
          try { if (window.top?.document) hostWindow = window.top } catch {}
          if (props?.sessionId) hostWindow.document.documentElement.dataset.dshBusinessSessionId = props.sessionId
          hostWindow.dispatchEvent(new CustomEvent('dsh-desktop:business-session-change', { detail: { sessionId: props?.sessionId || '' } }))
          ctxForBusiness.sidebarRight.openTab('business-preview')
        },
        title: '在右侧栏中体验业务场景',
        style: { height: 32, padding: '0 12px', border: '1px solid var(--border, #d7dde8)', borderRadius: 8,
          background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 500 }
      }, '侧栏体验')
    }

    let persistentBusinessFrame
    let persistentBusinessFrameParking

    function businessFrameParking() {
      if (persistentBusinessFrameParking?.isConnected) return persistentBusinessFrameParking
      const parking = document.createElement('div')
      parking.dataset.dshBusinessPreviewParking = 'true'
      parking.setAttribute('aria-hidden', 'true')
      Object.assign(parking.style, { display: 'none' })
      document.body.appendChild(parking)
      persistentBusinessFrameParking = parking
      return parking
    }

    function businessFrame() {
      if (persistentBusinessFrame) return persistentBusinessFrame
      const frame = document.createElement('iframe')
      frame.title = '业务场景体验'
      frame.dataset.dshBusinessPreviewPersistent = 'true'
      Object.assign(frame.style, {
        display: 'block', width: '100%', height: '100%', border: '0', background: '#f4f7fb'
      })
      persistentBusinessFrame = frame
      businessFrameParking().appendChild(frame)
      return frame
    }

    function mountBusinessFrame(container, url, onLoadError) {
      const frame = businessFrame()
      const handleError = () => onLoadError?.()
      frame.addEventListener('error', handleError)
      let shouldNavigate = frame.dataset.dshBusinessPreviewInitialized !== 'true'
      if (!shouldNavigate) {
        try {
          const current = new URL(frame.src)
          const next = new URL(url)
          shouldNavigate = current.origin !== next.origin || current.searchParams.get('__dshSession') !== next.searchParams.get('__dshSession')
        }
        catch { shouldNavigate = true }
      }
      if (shouldNavigate) {
        frame.src = url
        frame.dataset.dshBusinessPreviewInitialized = 'true'
      }
      container.appendChild(frame)
      return () => {
        frame.removeEventListener('error', handleError)
        if (frame.parentElement === container) businessFrameParking().appendChild(frame)
      }
    }

    function BusinessPreviewPanel() {
      const [state, setState] = React.useState({ url: '', error: '', codeIntell: null, runtimeState: 'starting', runtimeError: '', failureKind: '' })
      const [frameContainer, setFrameContainer] = React.useState(null)
      React.useEffect(() => {
        let active = true
        let timer
        let retryTimer
        let hostWindow = window
        try {
          // Harness may mount client plugins in a same-origin child frame on
          // Windows, while Electron's preload bridge lives in the top frame.
          if (window.top?.document) hostWindow = window.top
        } catch {}
        const acceptPublishedUrl = () => {
          const root = hostWindow.document.documentElement
          const url = root.dataset.dshBusinessPreviewUrl
          const error = root.dataset.dshBusinessPreviewError
          const runtimeState = root.dataset.dshBusinessPreviewState || ''
          const runtimeError = root.dataset.dshBusinessPreviewRuntimeError || ''
          const failureKind = root.dataset.dshBusinessPreviewFailureKind || ''
          if (url) {
            try {
              const parsed = new URL(url)
              if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('业务预览地址不可信。')
              if (active) setState(previous => {
                try {
                  const sessionId = previous.url ? new URL(previous.url).searchParams.get('__dshSession') : ''
                  if (sessionId) parsed.searchParams.set('__dshSession', sessionId)
                } catch {}
                return { ...previous, url: parsed.href, error: '', runtimeState: runtimeState || 'ready', runtimeError, failureKind }
              })
            } catch (reason) { if (active) setState(previous => ({ ...previous, url: '', error: String(reason) })) }
            return true
          }
          if (error) {
            if (active) setState(previous => ({ ...previous, url: '', error, runtimeState: runtimeState || 'failed', runtimeError, failureKind }))
            return true
          }
          return false
        }
        const bridgeFallback = () => {
          const bridgeRequest = hostWindow.dshDesktop?.businessPreviewUrl?.()
          if (!bridgeRequest) return false
          bridgeRequest
            .then(value => {
              if (!active) return
              const parsed = new URL(value.url)
              if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('业务预览地址不可信。')
              setState(previous => ({ ...previous, url: parsed.href, error: '', runtimeState: 'ready', runtimeError: '', failureKind: '' }))
            })
            .catch(error => { if (active && !acceptPublishedUrl()) setState(previous => ({ ...previous, url: '', error: String(error) })) })
          return true
        }
        const requestMainProcessRecovery = () => {
          try {
            hostWindow.dispatchEvent(new Event('dsh-desktop:business-preview-request'))
            return true
          } catch {
            return false
          }
        }
        const discover = () => {
          const sessionId = hostWindow.document.documentElement.dataset.dshBusinessSessionId || ''
          fetch(`/api/dsh-desktop/business-preview${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`, { cache: 'no-store', credentials: 'same-origin' })
            .then(async response => {
              const value = await response.json()
              if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`)
              if (!active) return
              const parsed = new URL(value.url)
              if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('业务预览地址不可信。')
              setState({ url: parsed.href, error: '', codeIntell: value.codeIntell || null, runtimeState: 'ready', runtimeError: '', failureKind: '' })
            })
            .catch(() => {
              if (!active) return
              if (!acceptPublishedUrl()) {
                bridgeFallback()
                requestMainProcessRecovery()
              }
              retryTimer = window.setTimeout(discover, 1000)
            })
        }
        discover()
        const handleSessionChange = () => discover()
        hostWindow.addEventListener('dsh-desktop:business-session-change', handleSessionChange)
        hostWindow.addEventListener('dsh-desktop:business-preview-ready', acceptPublishedUrl)
        if (!acceptPublishedUrl()) {
          timer = window.setTimeout(() => {
            if (active && !acceptPublishedUrl()) requestMainProcessRecovery()
          }, 5000)
        }
        return () => {
          active = false
          hostWindow.removeEventListener('dsh-desktop:business-session-change', handleSessionChange)
          hostWindow.removeEventListener('dsh-desktop:business-preview-ready', acceptPublishedUrl)
          if (timer) window.clearTimeout(timer)
          if (retryTimer) window.clearTimeout(retryTimer)
        }
      }, [])
      React.useEffect(() => {
        if (!frameContainer || !state.url) return undefined
        return mountBusinessFrame(frameContainer, state.url, () => {
          setState(previous => ({ ...previous, runtimeState: 'failed', failureKind: 'page-load-failed', runtimeError: '业务页面加载失败，业务服务仍可能正常运行。' }))
        })
      }, [frameContainer, state.url])
      const restartPreview = () => {
        setState(previous => ({ ...previous, runtimeState: 'recovering', error: '', runtimeError: '', failureKind: '' }))
        const request = window.top?.dshDesktop?.restartBusinessPreview?.() || window.dshDesktop?.restartBusinessPreview?.()
        request?.catch(error => setState(previous => ({ ...previous, runtimeState: 'failed', error: String(error) })))
      }
      const failureLabel = state.failureKind === 'package-incompatible'
        ? '业务包不兼容或启动失败'
        : state.failureKind === 'page-load-failed' ? '业务页面加载失败' : '业务服务未启动'
      const failurePanel = React.createElement('div', { style: { padding: 20, color: '#b42318', textAlign: 'center' } },
        React.createElement('p', { style: { fontWeight: 600 } }, failureLabel),
        React.createElement('p', { style: { marginTop: 6, fontSize: 12, color: '#667085' } }, state.runtimeError || state.error || '业务预览暂时不可用。'),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 } },
          React.createElement('button', { onClick: restartPreview, style: { height: 34, padding: '0 14px', border: '1px solid #d0d5dd', borderRadius: 8, background: '#fff', color: '#344054', cursor: 'pointer' } }, '重启业务预览'),
          React.createElement('button', { onClick: () => (window.top?.dshDesktop || window.dshDesktop)?.showHarnessLog?.(), style: { height: 34, padding: '0 14px', border: '1px solid #d0d5dd', borderRadius: 8, background: '#fff', color: '#344054', cursor: 'pointer' } }, '查看日志')))
      if (state.error && !state.url) return failurePanel
      if (!state.url) return React.createElement('div', { style: { padding: 20, color: '#667085' } }, '正在加载业务预览…')
      return React.createElement('div', { style: { position: 'relative', width: '100%', height: '100%', minHeight: 0 } },
        (state.runtimeState === 'recovering' || state.runtimeState === 'starting') && React.createElement('div', {
          style: { position: 'absolute', zIndex: 3, inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,250,252,.9)', color: '#475467', fontSize: 13 }
        }, state.runtimeState === 'recovering' ? '业务预览正在自动恢复…' : '业务预览正在启动…'),
        state.runtimeState === 'failed' && React.createElement('div', {
          style: { position: 'absolute', zIndex: 3, inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,250,252,.96)' }
        }, failurePanel),
        React.createElement('div', { ref: setFrameContainer,
          'data-dsh-business-preview-container': true,
          style: { width: '100%', height: '100%', minHeight: 0 } })
      )
    }

    function workflowHostWindow() {
      try { if (window.top?.document) return window.top } catch {}
      return window
    }

    function workflowBridge() {
      return workflowHostWindow().dshDesktop || window.dshDesktop
    }

    async function loadWorkflowRuns() {
      const bridge = workflowBridge()
      if (!bridge?.businessWorkflowRuns) throw new Error('Workflow bridge is unavailable.')
      return bridge.businessWorkflowRuns()
    }

    function installWorkflowStyles() {
      if (document.getElementById('dsh-desktop-workflow-styles')) return
      const style = document.createElement('style')
      style.id = 'dsh-desktop-workflow-styles'
      style.textContent = `
        .dshWorkflowPanel{box-sizing:border-box;height:100%;overflow:auto;padding:16px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
        .dshWorkflowLayout{display:grid;grid-template-columns:minmax(220px,34%) minmax(0,1fr);gap:12px;min-height:100%}
        .dshWorkflowList,.dshWorkflowDetail{min-width:0;border:1px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
        .dshWorkflowList{padding:8px;align-self:start}.dshWorkflowListButton{display:block;width:100%;padding:11px;border:0;border-radius:9px;background:transparent;color:inherit;text-align:left;cursor:pointer}
        .dshWorkflowListButton:hover,.dshWorkflowListButton[aria-current=true]{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-module-platform))}
        .dshWorkflowRow{display:flex;align-items:center;justify-content:space-between;gap:8px}.dshWorkflowTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
        .dshWorkflowMeta,.dshWorkflowSecondary{color:var(--dsw-alias-label-secondary);font-size:11px}.dshWorkflowMeta{margin-top:5px}
        .dshWorkflowBadge{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 7px;font-size:10px}.dshWorkflowBadge[data-status=failed]{color:var(--dsw-alias-state-error-primary)}
        .dshWorkflowDetail{padding:16px}.dshWorkflowHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dshWorkflowHeader h3{margin:0;font-size:16px}.dshWorkflowFacts{display:flex;flex-wrap:wrap;gap:8px 16px;margin:14px 0;font-size:12px}
        .dshWorkflowFact strong{display:block;margin-bottom:3px;font-size:10px;color:var(--dsw-alias-label-tertiary);font-weight:500}.dshWorkflowNotice{margin:12px 0;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-module-platform));font-size:12px}
        .dshWorkflowSteps{display:grid;gap:8px}.dshWorkflowStep{padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:9px}.dshWorkflowStepError{margin-top:7px;color:var(--dsw-alias-state-error-primary);font-size:11px;white-space:pre-wrap}.dshWorkflowEvidence{margin-top:7px;color:var(--dsw-alias-label-secondary);font-size:11px;word-break:break-all}
        .dshWorkflowSummary{margin-top:7px;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:pre-wrap;word-break:break-word}.dshWorkflowSummary strong{color:var(--dsw-alias-label-tertiary);font-weight:500}
        .dshWorkflowActions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.dshWorkflowButton{height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;cursor:pointer}.dshWorkflowButton:disabled{opacity:.45;cursor:not-allowed}.dshWorkflowButtonPrimary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
        .dshWorkflowState{display:flex;min-height:180px;align-items:center;justify-content:center;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary)}
        @media(max-width:760px){.dshWorkflowLayout{grid-template-columns:1fr}.dshWorkflowList{max-height:220px;overflow:auto}}
      `
      document.head.appendChild(style)
    }

    function workflowContextFact(context, key) {
      const value = context && context[key]
      return typeof value === 'string' && value ? value : ''
    }

    function workflowProfileId(run) {
      return workflowContextFact(run.context, 'profileId') || workflowContextFact(run.context?.plan, 'profileId')
    }

    function workflowValueSummary(value) {
      if (value === undefined) return ''
      try {
        const serialized = JSON.stringify(value)
        return serialized.length > 320 ? `${serialized.slice(0, 317)}…` : serialized
      } catch { return String(value).slice(0, 320) }
    }

    function workflowTitle(run, t) {
      return run.workflowId === 'business-scenario-create' ? t('scenarioWorkflow') : run.workflowId
    }

    function WorkflowPanel({ t }) {
      const [state, setState] = React.useState({ runs: [], selectedId: '', loading: true, error: '', busy: '', copied: false })
      const refresh = React.useCallback(async () => {
        try {
          const value = await loadWorkflowRuns()
          const runs = [...(value?.runs || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
          setState(previous => ({ ...previous, runs, selectedId: runs.some(run => run.id === previous.selectedId) ? previous.selectedId : runs[0]?.id || '', loading: false, error: '' }))
        } catch (error) {
          setState(previous => ({ ...previous, loading: false, error: String(error) }))
        }
      }, [])
      React.useEffect(() => {
        let active = true
        void refresh()
        const unsubscribe = workflowBridge()?.onBusinessWorkflowChanged?.(run => {
          if (!active) return
          setState(previous => {
            const runs = [run, ...previous.runs.filter(item => item.id !== run.id)].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
            return { ...previous, runs, selectedId: previous.selectedId || run.id, loading: false, error: '' }
          })
        })
        return () => { active = false; unsubscribe?.() }
      }, [refresh])
      const selected = state.runs.find(run => run.id === state.selectedId) || state.runs[0]
      const action = async (kind) => {
        if (!selected || state.busy) return
        setState(previous => ({ ...previous, busy: kind, error: '' }))
        try {
          const bridge = workflowBridge()
          const result = kind === 'retry'
            ? await bridge.retryBusinessWorkflow(selected.id)
            : await bridge.cancelBusinessWorkflow(selected.id)
          setState(previous => ({ ...previous, runs: [result.run, ...previous.runs.filter(item => item.id !== result.run.id)], busy: '' }))
        } catch (error) {
          setState(previous => ({ ...previous, busy: '', error: `${t('actionFailed')}: ${String(error)}` }))
        }
      }
      const copyDiagnostics = async () => {
        if (!selected) return
        try {
          await navigator.clipboard.writeText(JSON.stringify(selected, null, 2))
          setState(previous => ({ ...previous, copied: true, error: '' }))
          window.setTimeout(() => setState(previous => ({ ...previous, copied: false })), 1500)
        } catch (error) {
          setState(previous => ({ ...previous, error: `${t('actionFailed')}: ${String(error)}` }))
        }
      }
      if (state.loading) return React.createElement('div', { className: 'dshWorkflowPanel dshWorkflowState', 'aria-live': 'polite' }, t('loading'))
      if (state.error && !state.runs.length) return React.createElement('div', { className: 'dshWorkflowPanel dshWorkflowState' }, React.createElement('div', null,
        React.createElement('p', null, t('loadFailed')), React.createElement('button', { className: 'dshWorkflowButton', onClick: refresh }, t('retryLoad'))))
      if (!selected) return React.createElement('div', { className: 'dshWorkflowPanel dshWorkflowState' }, React.createElement('div', null,
        React.createElement('strong', null, t('empty')), React.createElement('p', { className: 'dshWorkflowSecondary' }, t('emptyHint'))))
      const failedStep = selected.steps.find(step => step.id === selected.currentStepId && step.status === 'failed')
      return React.createElement('div', { className: 'dshWorkflowPanel' }, React.createElement('div', { className: 'dshWorkflowLayout' },
        React.createElement('div', { className: 'dshWorkflowList', role: 'list' }, state.runs.map(run => React.createElement('button', {
          key: run.id, type: 'button', role: 'listitem', className: 'dshWorkflowListButton', 'aria-current': run.id === selected.id,
          onClick: () => setState(previous => ({ ...previous, selectedId: run.id }))
        }, React.createElement('div', { className: 'dshWorkflowRow' }, React.createElement('span', { className: 'dshWorkflowTitle' }, workflowTitle(run, t)),
          React.createElement('span', { className: 'dshWorkflowBadge', 'data-status': run.status }, t(run.status))),
          React.createElement('div', { className: 'dshWorkflowMeta' }, new Date(run.updatedAt).toLocaleString())))),
        React.createElement('section', { className: 'dshWorkflowDetail', 'aria-live': 'polite' },
          React.createElement('div', { className: 'dshWorkflowHeader' }, React.createElement('div', null,
            React.createElement('h3', null, workflowTitle(selected, t)), React.createElement('div', { className: 'dshWorkflowMeta' }, `${t('updated')} ${new Date(selected.updatedAt).toLocaleString()}`)),
            React.createElement('span', { className: 'dshWorkflowBadge', 'data-status': selected.status }, t(selected.status))),
          React.createElement('div', { className: 'dshWorkflowFacts' },
            React.createElement('div', { className: 'dshWorkflowFact' }, React.createElement('strong', null, t('version')), `${selected.workflowVersion}${selected.compatibility?.currentVersion && selected.compatibility.currentVersion !== selected.workflowVersion ? ` → ${selected.compatibility.currentVersion}` : ''}`),
            selected.compatibility?.status && React.createElement('div', { className: 'dshWorkflowFact' }, React.createElement('strong', null, t('compatibility')), t(selected.compatibility.status)),
            workflowContextFact(selected.context, 'routePath') && React.createElement('div', { className: 'dshWorkflowFact' }, React.createElement('strong', null, t('route')), workflowContextFact(selected.context, 'routePath')),
            workflowProfileId(selected) && React.createElement('div', { className: 'dshWorkflowFact' }, React.createElement('strong', null, t('profile')), workflowProfileId(selected)),
            workflowContextFact(selected.context, 'sessionId') && React.createElement('div', { className: 'dshWorkflowFact' }, React.createElement('strong', null, t('session')), workflowContextFact(selected.context, 'sessionId')),
            workflowContextFact(selected.context, 'query') && React.createElement('div', { className: 'dshWorkflowFact' }, React.createElement('strong', null, t('query')), workflowContextFact(selected.context, 'query'))),
          selected.status === 'waiting_for_user' && React.createElement('div', { className: 'dshWorkflowNotice' }, t('waitingHint')),
          selected.status === 'running' && React.createElement('div', { className: 'dshWorkflowNotice' }, t('runningHint')),
          selected.compatibility?.status === 'incompatible' && React.createElement('div', { className: 'dshWorkflowStepError' }, selected.compatibility.reason || t('incompatibleHint')),
          selected.compatibility?.status === 'migratable' && React.createElement('div', { className: 'dshWorkflowNotice' }, t('migratableHint')),
          state.error && React.createElement('div', { className: 'dshWorkflowStepError' }, state.error),
          React.createElement('h4', null, t('steps')),
          React.createElement('div', { className: 'dshWorkflowSteps' }, selected.steps.map(step => React.createElement('div', { className: 'dshWorkflowStep', key: step.id },
            React.createElement('div', { className: 'dshWorkflowRow' }, React.createElement('span', { className: 'dshWorkflowTitle' }, step.title),
              React.createElement('span', { className: 'dshWorkflowBadge', 'data-status': step.status }, `${t(step.type)} · ${t(step.status)}`)),
            step.startedAt && React.createElement('div', { className: 'dshWorkflowMeta' }, `${new Date(step.startedAt).toLocaleString()}${step.completedAt ? ` – ${new Date(step.completedAt).toLocaleString()}` : ''}`),
            workflowValueSummary(step.input) && React.createElement('div', { className: 'dshWorkflowSummary' }, React.createElement('strong', null, `${t('input')}: `), workflowValueSummary(step.input)),
            workflowValueSummary(step.output) && React.createElement('div', { className: 'dshWorkflowSummary' }, React.createElement('strong', null, `${t('output')}: `), workflowValueSummary(step.output)),
            step.error && React.createElement('div', { className: 'dshWorkflowStepError' }, `${t('error')}: ${step.error.code} · ${step.error.message}`),
            step.evidenceIds?.length > 0 && React.createElement('div', { className: 'dshWorkflowEvidence' }, `${t('evidence')}: ${step.evidenceIds.join(', ')}`)))),
          React.createElement('div', { className: 'dshWorkflowActions' },
            failedStep?.error?.retryable && selected.compatibility?.status !== 'incompatible' && React.createElement('button', { className: 'dshWorkflowButton dshWorkflowButtonPrimary', disabled: Boolean(state.busy), onClick: () => action('retry') }, t('retry')),
            !['completed', 'cancelled'].includes(selected.status) && selected.status !== 'running' && React.createElement('button', { className: 'dshWorkflowButton', disabled: Boolean(state.busy), onClick: () => action('cancel') }, t('cancel')),
            React.createElement('button', { className: 'dshWorkflowButton', disabled: Boolean(state.busy), onClick: copyDiagnostics }, state.copied ? t('copied') : t('copy'))))))
    }

    let ctxForBusiness

    const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'locale']
    function apply(ctx) {
      ctxForBusiness = ctx
      installWorkflowStyles()
      ctx.effect(() => ctx.locale.register(WORKFLOW_NS, { zh: workflowZh, en: workflowEn }), 'dsh-desktop: workflow locale')
      const workflowT = ctx.locale.bind(WORKFLOW_NS)
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: 'dsh-desktop-business-preview', kind: 'business-preview',
        title: () => '业务体验',
        guide: [{ order: 20, title: () => '业务体验', description: () => '在侧边栏中预览并切换业务 Mock 场景' }]
      }), 'dsh-desktop: business preview tab')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: 'dsh-desktop-business-preview' },
        BusinessPreviewPanel
      )), 'dsh-desktop: business preview body')
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: 'dsh-desktop-business-workflows', kind: 'business-workflows',
        title: () => workflowT('tab'),
        guide: [{ order: 21, title: () => workflowT('tab'), description: () => workflowT('guide') }]
      }), 'dsh-desktop: business workflows tab')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: 'dsh-desktop-business-workflows', inject: () => ({ t: workflowT }) },
        WorkflowPanel
      )), 'dsh-desktop: business workflows body')
      ctx.slots.inject('sidebar.brand.mark', () => {
        return ctx.slots.inject('sidebar.brand.name', () => {
          return ctx.slots.inject('conversation.hero.brand.mark', () => {
            return ctx.slots.inject('conversation.session.header.actions', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, DesktopBrandMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name' }, DesktopBrandName)
            yield ctx.slots.register(
              { name: 'conversation.hero.brand.mark' },
              ConversationBrandMark
            )
            yield ctx.slots.register(
              { name: 'conversation.session.header.actions', id: 'business-sidebar-preview', order: 81, label: '侧栏体验' },
              BusinessSidebarAction
            )
            })
          })
        })
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
