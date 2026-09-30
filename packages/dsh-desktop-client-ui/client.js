window.__ModuleLoader__.load({
  id: 'dsh-desktop-client-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { BrandWordmark, FishLogo } = require('@deepseek-ai/dsh-client-ui-primitives')

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
        state.codeIntell && React.createElement('div', {
          title: state.codeIntell.error || `索引生成于 ${state.codeIntell.generatedAt || '未知时间'}`,
          style: { position: 'absolute', zIndex: 2, right: 12, top: 10, padding: '4px 8px', borderRadius: 12,
            fontSize: 11, lineHeight: '16px', background: state.codeIntell.state === 'ready' ? '#e8f7ee' : '#fff0ed',
            color: state.codeIntell.state === 'ready' ? '#08783e' : '#b42318', boxShadow: '0 1px 4px rgba(0,0,0,.12)' }
        }, state.codeIntell.state === 'ready'
          ? `索引正常 · ${state.codeIntell.coverage?.routes || 0} 路由`
          : '索引异常 · 场景分析已降级'),
        React.createElement('div', { ref: setFrameContainer,
          'data-dsh-business-preview-container': true,
          style: { width: '100%', height: '100%', minHeight: 0 } })
      )
    }

    let ctxForBusiness

    const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']
    function apply(ctx) {
      ctxForBusiness = ctx
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: 'dsh-desktop-business-preview', kind: 'business-preview',
        title: () => '业务体验',
        guide: [{ order: 20, title: () => '业务体验', description: () => '在侧边栏中预览并切换业务 Mock 场景' }]
      }), 'dsh-desktop: business preview tab')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: 'dsh-desktop-business-preview' },
        BusinessPreviewPanel
      )), 'dsh-desktop: business preview body')
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
