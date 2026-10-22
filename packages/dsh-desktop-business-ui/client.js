window.__ModuleLoader__.load({
  id: 'dsh-desktop-business-ui',
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
      chooseRoute: '选择要分析的业务页面', chooseRouteHint: '以下路线没有推荐顺序。请选择目标页面，确认后将在当前工作流中继续分析；此操作不会创建或启用体验分支。',
      confirmRoute: '确认路线并继续分析', continuingAnalysis: '正在继续分析…', routeCandidatesMissing: '候选路线不可用，请回到对话重新说明目标页面。', routeAmbiguousError: '目标页面有多个匹配项，请在上方选择。', routeAmbiguousHistory: '目标页面有多个匹配项；该运行未选择路线。',
      waitingHint: '正在等待确认，请回到对话继续该步骤。', runningHint: '工作流正在执行，状态会自动更新。',
      previewChecks: '预览页面核验', previewProgress: '已通过', previewCheckHint: '先在业务体验中手动选择该分支并打开待验页面，再验证当前步骤。仅使用已确认断言，不会切换分支或提交业务操作。',
      previewHistoryHint: '以下展示已确认的页面及核验进度。查看记录不会重新创建或切换体验分支。',
      previewRequired: '应出现', previewForbidden: '不应出现', previewApis: '本页接口', previewCurrent: '待验证', previewPassed: '已通过', previewPending: '待前序通过',
      verifyPage: '验证当前步骤', verifyingPage: '正在验证当前步骤…', previewOtherSession: '请切回此运行的关联会话后再验证，避免核验错误的预览。', previewVerified: '本步骤已通过。请在业务体验中打开下一页后继续验证。', previewAllVerified: '所有页面及最终门禁均已通过。',
      previewFinalPending: '页面步骤已采集；请处理下方最终验证失败项，再重试失败步骤。',
      planReview: '确认体验方案', planReviewHint: '这是一份待确认方案，尚未创建分支。确认后仅新增分支，当前默认或已选分支保持不变；页面仍需实际体验与验证。',
      planNotProposed: '请先让对话助手将审核后的完整方案提交到工作流面板；分析器草案不会自动成为待确认方案。',
      planSource: '复用来源场景', planData: '新增 Mock 数据', planValues: '来源字段快照', planSnapshotHint: '仅为分析时的有界字段快照，不是完整响应或页面验证；创建前仍按原门禁复核。',
      planFull: '查看完整待确认方案（只读）', planChecks: '计划验证页面', planLegacy: '未声明分步验证，创建后使用原对话入口提交单页验证断言。',
      planQuality: '分析等级（不代表页面已验证）', planReviewRisk: '分析仍有待复核证据。请核对助手的聚焦复核结论，不能仅凭候选分数或名称确认。', planSemantic: '业务声明的字段规则（仅覆盖声明项）',
      planAcknowledge: '我已核对以上方案，确认仅新增体验分支', planConfirm: '确认并创建分支', planCreating: '正在确认并创建…', planCreated: '分支已新增，尚未启用。请在业务体验中手动选择后验证。', planEditHint: '需要修改时请回到对话说明，再提交新版本；旧版本的确认将失效。',
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
      chooseRoute: 'Choose the business page to analyze', chooseRouteHint: 'These routes are unordered and none is recommended. Choose the target page to continue analysis in this run; this will not create or activate a Profile.',
      confirmRoute: 'Confirm route and continue analysis', continuingAnalysis: 'Continuing analysis…', routeCandidatesMissing: 'Route candidates are unavailable. Clarify the target page in the conversation.', routeAmbiguousError: 'Multiple pages match the target. Choose one above.', routeAmbiguousHistory: 'Multiple pages matched the target; no route was chosen for this run.',
      waitingHint: 'Waiting for confirmation. Continue this step in the conversation.', runningHint: 'The workflow is running and will update automatically.',
      previewChecks: 'Preview page checks', previewProgress: 'Passed', previewCheckHint: 'Manually select this Profile in Business Preview and open the page before checking it. Checks use confirmed assertions only; they never switch Profiles or submit business actions.',
      previewHistoryHint: 'These are the confirmed pages and their verification progress. Viewing this record does not recreate or switch Profiles.',
      previewRequired: 'Must contain', previewForbidden: 'Must not contain', previewApis: 'Page APIs', previewCurrent: 'Ready to check', previewPassed: 'Passed', previewPending: 'Waiting for preceding checks',
      verifyPage: 'Verify current step', verifyingPage: 'Verifying current step…', previewOtherSession: 'Switch to this run’s conversation before checking its preview.', previewVerified: 'This step passed. Open the next page in Business Preview before continuing.', previewAllVerified: 'All pages and the final verification gate passed.',
      previewFinalPending: 'Page checks were captured. Resolve the final verification failure below, then retry the failed step.',
      planReview: 'Review experience plan', planReviewHint: 'This proposal has not created a Profile. Confirmation only adds a Profile and leaves the current selection unchanged. Real preview verification is still required.',
      planNotProposed: 'Ask the assistant to submit a reviewed full plan to this panel first. An analyzer draft is not a review proposal.',
      planSource: 'Source Scenario', planData: 'New Mock data', planValues: 'Source field snapshot', planSnapshotHint: 'A bounded analysis-time snapshot, not the full response or UI proof. Existing creation gates still revalidate their evidence.',
      planFull: 'Inspect the complete proposal (read-only)', planChecks: 'Planned page checks', planLegacy: 'No ordered checks declared. Use the original conversation entry to supply single-page assertions after creation.',
      planQuality: 'Analysis level (not UI verification)', planReviewRisk: 'Some evidence still needs review. Check the assistant’s focused review; candidate names and scores alone are not sufficient.', planSemantic: 'Business-declared field rules (declared fields only)',
      planAcknowledge: 'I reviewed this plan and confirm adding a Profile only', planConfirm: 'Confirm and create Profile', planCreating: 'Confirming and creating…', planCreated: 'Profile added, not activated. Select it manually in Business Preview before verification.', planEditHint: 'To change the plan, describe the revision in the conversation and submit a new version. The old confirmation will expire.',
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

    function publishBusinessSession(sessionId, force = false) {
      const hostWindow = workflowHostWindow()
      const root = hostWindow.document.documentElement
      const nextSessionId = sessionId || ''
      if (root.dataset.dshBusinessSessionId === nextSessionId && !force) return
      if (nextSessionId) root.dataset.dshBusinessSessionId = nextSessionId
      else delete root.dataset.dshBusinessSessionId
      hostWindow.dispatchEvent(new CustomEvent('dsh-desktop:business-session-change', { detail: { sessionId: nextSessionId } }))
    }

    function BusinessSidebarAction(props) {
      React.useEffect(() => { publishBusinessSession(props?.sessionId) }, [props?.sessionId])
      return React.createElement('button', {
        type: 'button', onClick: () => {
          publishBusinessSession(props?.sessionId, true)
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
        .dshWorkflowSteps{display:grid;gap:8px}.dshWorkflowStep{padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:9px}.dshWorkflowStepError{margin-top:7px;color:var(--dsw-alias-state-error-primary);font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}.dshWorkflowEvidence{margin-top:7px;color:var(--dsw-alias-label-secondary);font-size:11px;word-break:break-all}
        .dshWorkflowSummary{margin-top:7px;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:pre-wrap;word-break:break-word}.dshWorkflowSummary strong{color:var(--dsw-alias-label-tertiary);font-weight:500}
        .dshWorkflowActions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.dshWorkflowButton{height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;cursor:pointer}.dshWorkflowButton:disabled{opacity:.45;cursor:not-allowed}.dshWorkflowButtonPrimary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
        .dshWorkflowRouteChoice{margin:14px 0;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-module-platform))}
        .dshWorkflowRouteChoice fieldset{margin:0;padding:0;border:0;min-width:0}.dshWorkflowRouteChoice legend{padding:0;font-size:14px;font-weight:600}.dshWorkflowRouteHint{margin:6px 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
        .dshWorkflowRouteOptions{display:grid;gap:8px}.dshWorkflowRouteOption{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;overflow-wrap:anywhere}
        .dshWorkflowRouteOption:has(input:checked){border-color:var(--dsw-alias-button-primary-fill)}.dshWorkflowRouteOption:focus-within,.dshWorkflowButton:focus-visible,.dshWorkflowListButton:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill);outline-offset:2px}
        .dshWorkflowRouteOption input{flex:none;margin:0;accent-color:var(--dsw-alias-button-primary-fill)}.dshWorkflowRouteLabel{display:grid;gap:2px;min-width:0;font-size:12px}.dshWorkflowRouteLabel strong{font-size:13px;font-weight:600}.dshWorkflowRouteLabel code{font:inherit;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
        .dshWorkflowRouteChoice .dshWorkflowButton{min-height:44px;height:auto;margin-top:12px}
        .dshWorkflowPreviewChecks{margin:14px 0;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
        .dshWorkflowPreviewChecks h4{margin:0;font-size:14px}.dshWorkflowPreviewChecks ol{list-style:none;margin:12px 0;padding:0;display:grid;gap:8px}
        .dshWorkflowPreviewCheck{padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;min-width:0}.dshWorkflowPreviewCheck[aria-current=step]{border-color:var(--dsw-alias-button-primary-fill)}
        .dshWorkflowPreviewCheck strong{font-size:13px}.dshWorkflowPreviewCheck code{display:block;margin-top:5px;font-size:12px;overflow-wrap:anywhere}
        .dshWorkflowPreviewAssertions{margin:8px 0 0;font-size:12px;line-height:1.5}.dshWorkflowPreviewAssertions dt{margin-top:6px;color:var(--dsw-alias-label-secondary)}.dshWorkflowPreviewAssertions dd{margin:2px 0 0;white-space:pre-wrap}
        .dshWorkflowPreviewChecks .dshWorkflowButton{min-height:44px;height:auto}.dshWorkflowPreviewFeedback{margin-top:10px;font-size:12px;line-height:1.5}
        .dshWorkflowPlanReview{margin:14px 0;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow-wrap:anywhere}.dshWorkflowPlanReview h4{margin:0;font-size:14px}
        .dshWorkflowPlanReview dl{font-size:12px;line-height:1.5}.dshWorkflowPlanReview dt{margin-top:8px;color:var(--dsw-alias-label-secondary)}.dshWorkflowPlanReview dd{margin:3px 0;white-space:pre-wrap}
        .dshWorkflowPlanReview pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:280px;overflow:auto}.dshWorkflowPlanReview details{margin:12px 0;font-size:12px}.dshWorkflowPlanReview summary{cursor:pointer;min-height:32px}
        .dshWorkflowPlanReview .dshWorkflowButton{min-height:44px;height:auto;margin-top:10px}.dshWorkflowPlanAck{display:flex;align-items:center;gap:8px;min-height:44px;font-size:12px;cursor:pointer}.dshWorkflowPlanAck input{flex:none}.dshWorkflowPlanReview :is(summary,input):focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill);outline-offset:3px}
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

    function workflowRouteCandidates(step) {
      if (step?.id !== 'analyze-target' || step.error?.code !== 'E_TARGET_ROUTE_AMBIGUOUS' || !step.error.retryable) return []
      const seen = new Set()
      return (Array.isArray(step.error.candidates) ? step.error.candidates : []).filter(candidate => {
        const routePath = candidate?.routePath
        if (typeof routePath !== 'string' || !routePath.startsWith('/') || seen.has(routePath)) return false
        seen.add(routePath)
        return true
      })
    }

    function workflowNeedsRouteChoice(run) {
      return run?.status === 'failed' && workflowRouteCandidates(run.steps?.find(step => step.id === run.currentStepId)).length > 0
    }

    function workflowPreferredRunId(runs, selectedId) {
      if (runs.some(run => run.id === selectedId)) return selectedId
      const sessionId = workflowHostWindow().document.documentElement.dataset.dshBusinessSessionId
      const sessionRuns = sessionId ? runs.filter(run => workflowContextFact(run.context, 'sessionId') === sessionId) : []
      return sessionRuns.find(run => workflowNeedsRouteChoice(run) || workflowPlanProposal(run))?.id || sessionRuns[0]?.id || runs[0]?.id || ''
    }

    function workflowStepErrorMessage(step, activeRouteChoice, t) {
      if (step.error?.code !== 'E_TARGET_ROUTE_AMBIGUOUS') return step.error?.message || ''
      return t(activeRouteChoice ? 'routeAmbiguousError' : 'routeAmbiguousHistory')
    }

    function workflowPlanProposal(run) {
      if (run?.workflowId !== 'business-scenario-create' || run.status !== 'waiting_for_user' || run.currentStepId !== 'confirm-plan') return null
      const proposal = run.checkpointProposal
      const plan = proposal?.output
      if (proposal?.checkpointId !== 'confirm-plan' || typeof proposal.id !== 'string' || !/^[0-9a-f-]{36}$/.test(proposal.id)
        || typeof plan?.profileId !== 'string' || typeof plan.label !== 'string' || !Array.isArray(plan.scenarios)
        || !plan.scenarios.length || plan.scenarios.length > 12 || plan.scenarios.some(item => typeof item?.id !== 'string' || typeof item.apiUrl !== 'string')) return null
      if (plan.verificationSteps !== undefined && (!Array.isArray(plan.verificationSteps) || !plan.verificationSteps.length || plan.verificationSteps.length > 5
        || plan.verificationSteps.some(step => typeof step?.id !== 'string' || typeof step.label !== 'string' || typeof step.route !== 'string'
          || !Array.isArray(step.containsText) || !Array.isArray(step.absentText) || [...step.containsText, ...step.absentText].some(value => typeof value !== 'string')))) return null
      return proposal
    }

    function WorkflowPlanReview({ run, proposal, t, busy, creating, sameSession, available, acknowledged, onAcknowledge, onConfirm }) {
      const plan = proposal.output
      const analysisPlan = run.context?.analysis?.analysisPlan
      return React.createElement('section', { className: 'dshWorkflowPlanReview', 'aria-label': t('planReview'), 'aria-busy': busy },
        React.createElement('h4', null, t('planReview')),
        React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('planReviewHint')),
        analysisPlan?.qualityGate?.level && React.createElement('p', { className: 'dshWorkflowRouteHint' }, `${t('planQuality')}: ${analysisPlan.qualityGate.level}`),
        analysisPlan?.qualityGate?.level === 'review' && React.createElement('p', { className: 'dshWorkflowNotice' }, t('planReviewRisk')),
        React.createElement('dl', null,
          React.createElement('dt', null, t('profile')), React.createElement('dd', null, `${plan.label} · ${plan.profileId}`),
          React.createElement('dt', null, t('route')), React.createElement('dd', null, run.context?.target?.routePath || run.context?.routePath || ''),
          plan.scenarios.map(scenario => {
            const candidates = [analysisPlan?.leadingScenarioValuePreview, ...(analysisPlan?.reviewPacket?.candidates || [])]
            const preview = candidates.find(item => item?.apiUrl === scenario.apiUrl && item?.scenarioId === scenario.sourceScenarioId)?.valuePreview
            return React.createElement('div', { key: `${scenario.apiUrl}:${scenario.id}` },
              React.createElement('dt', null, scenario.apiUrl),
              React.createElement('dd', null, `${scenario.label || scenario.id} · ${scenario.id}`),
              React.createElement('dt', null, t(scenario.sourceScenarioId ? 'planSource' : 'planData')),
              React.createElement('dd', null, scenario.sourceScenarioId || React.createElement('details', null,
                React.createElement('summary', null, t('planData')), React.createElement('pre', null, JSON.stringify(scenario.data, null, 2)))),
              preview && React.createElement(React.Fragment, null,
                React.createElement('dt', null, t('planValues')),
                React.createElement('dd', null, React.createElement('details', null,
                  React.createElement('summary', null, `${t('planValues')} (${preview.returnedFieldCount ?? 0})`),
                  React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('planSnapshotHint')),
                  React.createElement('pre', null, JSON.stringify(preview, null, 2)))))
            )
          })),
        React.createElement('h4', null, t('planChecks')),
        Array.isArray(plan.verificationSteps) ? React.createElement('ol', null, plan.verificationSteps.map(step => React.createElement('li', { key: step.id },
          React.createElement('strong', null, step.label), React.createElement('div', null, step.route),
          React.createElement('dl', null, React.createElement('dt', null, t('previewRequired')), React.createElement('dd', null, step.containsText.join('\n')),
            step.absentText.length > 0 && React.createElement(React.Fragment, null, React.createElement('dt', null, t('previewForbidden')), React.createElement('dd', null, step.absentText.join('\n')))))))
          : React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('planLegacy')),
        React.createElement('details', null, React.createElement('summary', null, t('planFull')), React.createElement('pre', null, JSON.stringify(plan, null, 2))),
        run.context?.semanticExpectations?.length > 0 && React.createElement('details', null, React.createElement('summary', null, t('planSemantic')), React.createElement('pre', null, JSON.stringify(run.context.semanticExpectations, null, 2))),
        React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('planEditHint')),
        !sameSession && React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('previewOtherSession')),
        !available && React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('waitingHint')),
        available && React.createElement(React.Fragment, null,
          React.createElement('label', { className: 'dshWorkflowPlanAck' }, React.createElement('input', { type: 'checkbox', checked: acknowledged,
            disabled: busy || !sameSession, onChange: event => onAcknowledge(event.target.checked) }), t('planAcknowledge')),
          React.createElement('button', { type: 'button', className: 'dshWorkflowButton dshWorkflowButtonPrimary',
            disabled: busy || !sameSession || !acknowledged, onClick: onConfirm }, t(creating ? 'planCreating' : 'planConfirm'))))
    }

    // Presentation only: the existing checkpoint validates the step ID and uses
    // the saved plan, current Profile/revision, real requests and page evidence.
    function workflowPreviewProgress(run) {
      if (run?.workflowId !== 'business-scenario-create') return null
      const steps = run.context?.plan?.verificationSteps
      const progress = run.context?.previewVerifications || []
      if (!Array.isArray(steps) || !steps.length || steps.length > 5 || !Array.isArray(progress) || progress.length > steps.length) return null
      const ids = new Set()
      for (const step of steps) {
        if (typeof step?.id !== 'string' || ids.has(step.id) || typeof step.label !== 'string' || typeof step.route !== 'string'
          || !Array.isArray(step.containsText) || !step.containsText.length || !Array.isArray(step.absentText)
          || [...step.containsText, ...step.absentText].some(value => typeof value !== 'string')) return null
        ids.add(step.id)
      }
      if (progress.some((item, index) => item?.id !== steps[index].id || item.result?.verified !== true)) return null
      const waiting = run.status === 'waiting_for_user' && run.currentStepId === 'wait-for-preview'
        && run.steps.some(step => step.id === 'wait-for-preview' && step.type === 'checkpoint' && step.status === 'running')
      const created = run.steps.some(step => step.id === 'create-profile' && step.status === 'completed')
      if (!created) return null
      return { steps, done: progress.length, next: steps[progress.length], waiting }
    }

    function WorkflowPreviewChecks({ run, progress, t, busy, verifying, sameSession, available, feedback, error, onVerify }) {
      return React.createElement('section', { className: 'dshWorkflowPreviewChecks', 'aria-label': t('previewChecks'), 'aria-busy': busy },
        React.createElement('div', { className: 'dshWorkflowRow' }, React.createElement('h4', null, t('previewChecks')),
          React.createElement('span', { className: 'dshWorkflowSecondary', role: 'status' }, `${t('previewProgress')} ${progress.done}/${progress.steps.length}`)),
        React.createElement('p', { className: 'dshWorkflowRouteHint' }, t(progress.waiting && progress.next ? 'previewCheckHint' : 'previewHistoryHint')),
        React.createElement('ol', null, progress.steps.map((step, index) => {
          const current = progress.waiting && index === progress.done
          return React.createElement('li', { key: step.id, className: 'dshWorkflowPreviewCheck', 'aria-current': current ? 'step' : undefined },
            React.createElement('div', { className: 'dshWorkflowRow' }, React.createElement('strong', null, `${index + 1}. ${step.label}`),
              React.createElement('span', { className: 'dshWorkflowBadge' }, t(index < progress.done ? 'previewPassed' : current ? 'previewCurrent' : 'previewPending'))),
            React.createElement('code', null, step.route),
            current && React.createElement('dl', { className: 'dshWorkflowPreviewAssertions' },
              React.createElement('dt', null, t('previewRequired')), React.createElement('dd', null, step.containsText.join('\n')),
              step.absentText.length > 0 && React.createElement(React.Fragment, null, React.createElement('dt', null, t('previewForbidden')), React.createElement('dd', null, step.absentText.join('\n'))),
              step.apiUrls?.length > 0 && React.createElement(React.Fragment, null, React.createElement('dt', null, t('previewApis')), React.createElement('dd', null, step.apiUrls.join('\n')))))
        })),
        progress.waiting && progress.next && React.createElement(React.Fragment, null,
          !sameSession && React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('previewOtherSession')),
          !available && run.compatibility?.status !== 'incompatible' && React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('waitingHint')),
          available && React.createElement('button', { type: 'button', className: 'dshWorkflowButton dshWorkflowButtonPrimary', disabled: busy || !sameSession, onClick: onVerify }, t(verifying ? 'verifyingPage' : 'verifyPage'))),
        feedback && React.createElement('p', { className: 'dshWorkflowPreviewFeedback', role: 'status' }, feedback),
        error && React.createElement('p', { className: 'dshWorkflowStepError', role: 'alert' }, error),
        run.status === 'completed' && React.createElement('p', { className: 'dshWorkflowPreviewFeedback', role: 'status' }, t('previewAllVerified')),
        run.status === 'failed' && run.currentStepId === 'verify-preview' && React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('previewFinalPending')))
    }

    function WorkflowPanel({ t }) {
      const [state, setState] = React.useState({ runs: [], selectedId: '', loading: true, error: '', busy: '', copied: false })
      const [routeSelection, setRouteSelection] = React.useState({ runId: '', routePath: '' })
      const [planAcknowledgement, setPlanAcknowledgement] = React.useState({ proposalId: '', checked: false })
      const [previewFeedback, setPreviewFeedback] = React.useState({ runId: '', message: '', error: '' })
      const lifetime = React.useRef({ active: true, epoch: 0, busy: false })
      const refresh = React.useCallback(async () => {
        try {
          const value = await loadWorkflowRuns()
          if (!lifetime.current.active) return
          const runs = [...(value?.runs || [])].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
          setState(previous => ({ ...previous, runs, selectedId: workflowPreferredRunId(runs, previous.selectedId), loading: false, error: '' }))
        } catch (error) {
          if (!lifetime.current.active) return
          setState(previous => ({ ...previous, loading: false, error: String(error) }))
        }
      }, [])
      React.useEffect(() => {
        let active = true
        lifetime.current.active = true
        void refresh()
        const unsubscribe = workflowBridge()?.onBusinessWorkflowChanged?.(run => {
          if (!active) return
          setState(previous => {
            const runs = [run, ...previous.runs.filter(item => item.id !== run.id)].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
            const sessionId = workflowHostWindow().document.documentElement.dataset.dshBusinessSessionId
            const currentSessionReview = sessionId && workflowContextFact(run.context, 'sessionId') === sessionId && (workflowNeedsRouteChoice(run) || workflowPlanProposal(run))
            return { ...previous, runs, selectedId: currentSessionReview ? run.id : workflowPreferredRunId(runs, previous.selectedId), loading: false, error: '' }
          })
        })
        const hostWindow = workflowHostWindow()
        const handleSessionChange = () => {
          if (!active) return
          lifetime.current.epoch++
          setRouteSelection({ runId: '', routePath: '' })
          setPlanAcknowledgement({ proposalId: '', checked: false })
          setPreviewFeedback({ runId: '', message: '', error: '' })
          setState(previous => ({ ...previous, error: '', selectedId: workflowPreferredRunId(previous.runs, '') }))
        }
        hostWindow.addEventListener('dsh-desktop:business-session-change', handleSessionChange)
        return () => {
          active = false
          lifetime.current.active = false
          lifetime.current.epoch++
          unsubscribe?.()
          hostWindow.removeEventListener('dsh-desktop:business-session-change', handleSessionChange)
        }
      }, [refresh])
      const selected = state.runs.find(run => run.id === state.selectedId) || state.runs[0]
      const failedStep = selected?.steps.find(step => step.id === selected.currentStepId && step.status === 'failed')
      const routeAmbiguous = failedStep?.id === 'analyze-target' && failedStep.error?.code === 'E_TARGET_ROUTE_AMBIGUOUS'
      const routeCandidates = workflowRouteCandidates(failedStep)
      const selectedRoutePath = routeSelection.runId === selected?.id ? routeSelection.routePath : ''
      const routeSelected = routeCandidates.some(candidate => candidate.routePath === selectedRoutePath)
      const previewProgress = workflowPreviewProgress(selected)
      const planProposal = workflowPlanProposal(selected)
      const planAcknowledged = Boolean(planProposal && planAcknowledgement.proposalId === planProposal.id && planAcknowledgement.checked)
      const samePreviewSession = workflowContextFact(selected?.context, 'sessionId') === (workflowHostWindow().document.documentElement.dataset.dshBusinessSessionId || '')
      const previewAvailable = selected?.compatibility?.status !== 'incompatible' && typeof workflowBridge()?.resumeBusinessWorkflow === 'function'
      const planAvailable = selected?.compatibility?.status !== 'incompatible' && typeof workflowBridge()?.approveBusinessWorkflowProposal === 'function'
      const action = async (kind) => {
        if (!selected || lifetime.current.busy) return
        const sessionStillCurrent = workflowContextFact(selected.context, 'sessionId') === (workflowHostWindow().document.documentElement.dataset.dshBusinessSessionId || '')
        if (['approve', 'verify'].includes(kind) && !sessionStillCurrent) return
        if (kind === 'retry' && routeAmbiguous && !routeSelected) return
        if (kind === 'verify' && (!previewProgress?.waiting || !previewProgress.next || !samePreviewSession || !previewAvailable)) return
        if (kind === 'approve' && (!planProposal || !planAcknowledged || !samePreviewSession || !planAvailable)) return
        lifetime.current.busy = true
        const epoch = lifetime.current.epoch
        setPreviewFeedback({ runId: '', message: '', error: '' })
        setState(previous => ({ ...previous, busy: kind, error: '' }))
        try {
          const bridge = workflowBridge()
          const result = kind === 'approve'
            ? await bridge.approveBusinessWorkflowProposal(selected.id, { proposalId: planProposal.id, sessionId: workflowContextFact(selected.context, 'sessionId') || 'default' })
            : kind === 'verify'
            ? await bridge.resumeBusinessWorkflow(selected.id, { stepId: previewProgress.next.id })
            : kind === 'retry'
            ? await bridge.retryBusinessWorkflow(selected.id, routeAmbiguous
              ? { selectedRoutePath, confirmedByUser: true } : undefined)
            : await bridge.cancelBusinessWorkflow(selected.id)
          if (!lifetime.current.active) return
          if (lifetime.current.epoch === epoch) {
            setRouteSelection({ runId: '', routePath: '' })
            setPlanAcknowledgement({ proposalId: '', checked: false })
            if (kind === 'approve' && result.run.context?.profileId) setPreviewFeedback({ runId: selected.id, message: t('planCreated'), error: '' })
            if (kind === 'verify' && result.run.status === 'waiting_for_user') setPreviewFeedback({ runId: selected.id, message: t('previewVerified'), error: '' })
          }
          setState(previous => ({ ...previous, runs: [result.run, ...previous.runs.filter(item => item.id !== result.run.id)], busy: '' }))
        } catch (error) {
          if (lifetime.current.active && lifetime.current.epoch === epoch) {
            if (kind === 'verify') setPreviewFeedback({ runId: selected.id, message: '', error: `${t('actionFailed')}: ${String(error)}` })
            else setState(previous => ({ ...previous, error: `${t('actionFailed')}: ${String(error)}` }))
          }
        } finally {
          lifetime.current.busy = false
          if (lifetime.current.active) setState(previous => ({ ...previous, busy: '' }))
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
      return React.createElement('div', { className: 'dshWorkflowPanel' }, React.createElement('div', { className: 'dshWorkflowLayout' },
        React.createElement('div', { className: 'dshWorkflowList', role: 'list' }, state.runs.map(run => React.createElement('button', {
          key: run.id, type: 'button', role: 'listitem', className: 'dshWorkflowListButton', 'aria-current': run.id === selected.id,
          onClick: () => { lifetime.current.epoch++; setPlanAcknowledgement({ proposalId: '', checked: false }); setPreviewFeedback({ runId: '', message: '', error: '' }); setRouteSelection({ runId: '', routePath: '' }); setState(previous => ({ ...previous, error: '', selectedId: run.id })) }
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
          selected.status === 'waiting_for_user' && !previewProgress?.waiting && !planProposal && React.createElement('div', { className: 'dshWorkflowNotice' }, t(selected.currentStepId === 'confirm-plan' ? 'planNotProposed' : 'waitingHint')),
          selected.status === 'running' && React.createElement('div', { className: 'dshWorkflowNotice' }, t('runningHint')),
          selected.compatibility?.status === 'incompatible' && React.createElement('div', { className: 'dshWorkflowStepError' }, selected.compatibility.reason || t('incompatibleHint')),
          selected.compatibility?.status === 'migratable' && React.createElement('div', { className: 'dshWorkflowNotice' }, t('migratableHint')),
          state.error && React.createElement('div', { className: 'dshWorkflowStepError', role: 'alert' }, state.error),
          planProposal && React.createElement(WorkflowPlanReview, { run: selected, proposal: planProposal, t, busy: Boolean(state.busy), creating: state.busy === 'approve',
            sameSession: samePreviewSession, available: planAvailable, acknowledged: planAcknowledged,
            onAcknowledge: checked => setPlanAcknowledgement({ proposalId: planProposal.id, checked }), onConfirm: () => action('approve') }),
          !previewProgress && previewFeedback.runId === selected.id && previewFeedback.message && React.createElement('p', { className: 'dshWorkflowPreviewFeedback', role: 'status' }, previewFeedback.message),
          previewProgress && React.createElement(WorkflowPreviewChecks, { run: selected, progress: previewProgress, t,
            busy: Boolean(state.busy), verifying: state.busy === 'verify', sameSession: samePreviewSession, available: previewAvailable,
            feedback: previewFeedback.runId === selected.id ? previewFeedback.message : '',
            error: previewFeedback.runId === selected.id ? previewFeedback.error : '', onVerify: () => action('verify') }),
          routeAmbiguous && selected.compatibility?.status !== 'incompatible' && React.createElement('div', { className: 'dshWorkflowRouteChoice' },
            routeCandidates.length ? React.createElement('fieldset', { disabled: Boolean(state.busy) },
              React.createElement('legend', null, t('chooseRoute')),
              React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('chooseRouteHint')),
              React.createElement('div', { className: 'dshWorkflowRouteOptions' }, routeCandidates.map(candidate => React.createElement('label', { className: 'dshWorkflowRouteOption', key: candidate.routePath },
                React.createElement('input', { type: 'radio', name: `dsh-workflow-route-${selected.id}`, value: candidate.routePath,
                  checked: selectedRoutePath === candidate.routePath,
                  onChange: () => setRouteSelection({ runId: selected.id, routePath: candidate.routePath }) }),
                React.createElement('span', { className: 'dshWorkflowRouteLabel' },
                  candidate.pageTitle && React.createElement('strong', null, candidate.pageTitle),
                  React.createElement('code', null, candidate.routePath))))),
              React.createElement('button', { type: 'button', className: 'dshWorkflowButton dshWorkflowButtonPrimary',
                disabled: !routeSelected || Boolean(state.busy), onClick: () => action('retry'), 'aria-live': 'polite' },
              state.busy === 'retry' ? t('continuingAnalysis') : t('confirmRoute')))
              : React.createElement('p', { className: 'dshWorkflowRouteHint' }, t('routeCandidatesMissing'))),
          React.createElement('h4', null, t('steps')),
          React.createElement('div', { className: 'dshWorkflowSteps' }, selected.steps.map(step => React.createElement('div', { className: 'dshWorkflowStep', key: step.id },
            React.createElement('div', { className: 'dshWorkflowRow' }, React.createElement('span', { className: 'dshWorkflowTitle' }, step.title),
              React.createElement('span', { className: 'dshWorkflowBadge', 'data-status': step.status }, `${t(step.type)} · ${t(step.status)}`)),
            step.startedAt && React.createElement('div', { className: 'dshWorkflowMeta' }, `${new Date(step.startedAt).toLocaleString()}${step.completedAt ? ` – ${new Date(step.completedAt).toLocaleString()}` : ''}`),
            workflowValueSummary(step.input) && React.createElement('div', { className: 'dshWorkflowSummary' }, React.createElement('strong', null, `${t('input')}: `), workflowValueSummary(step.input)),
            workflowValueSummary(step.output) && React.createElement('div', { className: 'dshWorkflowSummary' }, React.createElement('strong', null, `${t('output')}: `), workflowValueSummary(step.output)),
            step.error && React.createElement('div', { className: 'dshWorkflowStepError' }, `${t('error')}: ${step.error.code} · ${workflowStepErrorMessage(step, routeAmbiguous && step.id === failedStep.id, t)}`),
            step.evidenceIds?.length > 0 && React.createElement('div', { className: 'dshWorkflowEvidence' }, `${t('evidence')}: ${step.evidenceIds.join(', ')}`)))),
          React.createElement('div', { className: 'dshWorkflowActions' },
            failedStep?.error?.retryable && !routeAmbiguous && selected.compatibility?.status !== 'incompatible' && React.createElement('button', { className: 'dshWorkflowButton dshWorkflowButtonPrimary', disabled: Boolean(state.busy), onClick: () => action('retry') }, t('retry')),
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
        guide: [{ id: 'business-preview', order: 20, title: () => '业务体验', description: () => '在侧边栏中预览并切换业务 Mock 场景' }]
      }), 'dsh-desktop: business preview tab')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: 'dsh-desktop-business-preview' },
        BusinessPreviewPanel
      )), 'dsh-desktop: business preview body')
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: 'dsh-desktop-business-workflows', kind: 'business-workflows',
        title: () => workflowT('tab'),
        guide: [{ id: 'business-workflows', order: 21, title: () => workflowT('tab'), description: () => workflowT('guide') }]
      }), 'dsh-desktop: business workflows tab')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: 'dsh-desktop-business-workflows', inject: () => ({ t: workflowT }) },
        WorkflowPanel
      )), 'dsh-desktop: business workflows body')
      ctx.effect(() => workflowBridge()?.onBusinessWorkflowChanged?.(run => {
        if (!workflowNeedsRouteChoice(run) && !workflowPlanProposal(run)) return
        const activeSessionId = workflowHostWindow().document.documentElement.dataset.dshBusinessSessionId
        if (activeSessionId && workflowContextFact(run.context, 'sessionId') === activeSessionId) {
          ctx.sidebarRight.openTab('business-workflows')
        }
      }), 'dsh-desktop: show current conversation review checkpoints')
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'business-sidebar-preview', order: 81, label: '侧栏体验' },
        BusinessSidebarAction
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
