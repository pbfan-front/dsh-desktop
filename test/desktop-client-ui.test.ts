import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

interface Registration {
  config: { name: string; id?: string; order?: number }
  component: (props: Record<string, unknown>) => unknown
}

describe('DSH Desktop client slot occupants', () => {
  it('supports the preload-published business URL when a context bridge is unavailable', async () => {
    const [client, preload] = await Promise.all([
      readFile(path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'), 'utf8'),
      readFile(path.join(projectRoot, 'src', 'preload', 'index.ts'), 'utf8')
    ])

    expect(preload).toContain("document.documentElement.dataset.dshBusinessPreviewUrl = value.url")
    expect(preload).toContain("if (!document.documentElement.dataset.dshBusinessPreviewUrl)")
    expect(preload).toContain("window.dispatchEvent(new Event(BUSINESS_PREVIEW_READY_EVENT))")
    expect(client).toContain('if (window.top?.document) hostWindow = window.top')
    expect(client).toContain('hostWindow.dshDesktop?.businessPreviewUrl?.()')
    expect(client).toContain('fetch(`/api/dsh-desktop/business-preview')
    expect(client).toContain("dataset.dshBusinessSessionId = props.sessionId")
    expect(client).toContain("hostWindow.addEventListener('dsh-desktop:business-session-change'")
    expect(client).toContain("current.searchParams.get('__dshSession') !== next.searchParams.get('__dshSession')")
    expect(client).toContain('retryTimer = window.setTimeout(discover, 1000)')
    expect(client).not.toContain('客户端未能发现业务预览地址。')
    expect(client).toContain("frame.dataset.dshBusinessPreviewPersistent = 'true'")
    expect(client).toContain('businessFrameParking().appendChild(frame)')
    expect(client).toContain('return mountBusinessFrame(frameContainer, state.url, () =>')
    expect(client).toContain("hostWindow.addEventListener('dsh-desktop:business-preview-ready'")
    expect(client).toContain("parsed.hostname !== '127.0.0.1'")
    expect(preload).toContain("ipcRenderer.on('business:preview-state'")
    expect(preload).toContain("if (phase === 'ready') void publishBusinessPreviewUrl()")
    expect(client).toContain("state.runtimeState === 'recovering'")
    expect(client).toContain('restartBusinessPreview?.()')
    expect(client).toContain("failureKind: 'page-load-failed'")
    expect(client).toContain('showHarnessLog?.()')
    expect(client).toContain("id: 'dsh-desktop-business-workflows'")
    expect(client).toContain('businessWorkflowRuns()')
    expect(client).toContain('onBusinessWorkflowChanged?.(run =>')
    expect(client).toContain('retryBusinessWorkflow(selected.id)')
    expect(client).toContain('cancelBusinessWorkflow(selected.id)')
    expect(client).toContain('navigator.clipboard.writeText(JSON.stringify(selected, null, 2))')
    expect(client).toContain("selected.compatibility?.status === 'incompatible'")
    expect(client).toContain("selected.compatibility?.status !== 'incompatible'")
    expect(client).toContain("ctx.locale.register(WORKFLOW_NS, { zh: workflowZh, en: workflowEn })")
  })

  it('registers one occupant per brand seat and keeps the official name mark-free', async () => {
    const source = await readFile(
      path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'),
      'utf8'
    )
    let definition: {
      factory: (require: (id: string) => unknown) => {
        apply: (ctx: unknown) => void
        inject: string[]
      }
    } | undefined
    const appended: Array<{ textContent?: string }> = []
    const document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({ id: '', dataset: {}, textContent: '' })),
      head: { appendChild: (node: { textContent?: string }) => appended.push(node) }
    }
    vm.runInNewContext(source, {
      document,
      navigator: { language: 'en-US' },
      window: {
        __ModuleLoader__: {
          load: (value: typeof definition) => {
            definition = value
          }
        }
      }
    })

    expect(definition).toBeDefined()
    const createElement = (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): { type: unknown; props: Record<string, unknown> } => ({
      type,
      props: { ...props, children }
    })
    const BrandWordmark = vi.fn()
    const FishLogo = vi.fn()
    const plugin = definition!.factory((id) => {
      if (id === 'react') {
        return {
          createElement,
          useEffect: (effect: () => void | (() => void)) => effect(),
          useState: (initial: unknown) => [initial, vi.fn()]
        }
      }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return { BrandWordmark, FishLogo }
      }
      throw new Error(`Unexpected client dependency: ${id}`)
    })

    const registrations: Registration[] = []
    const slots = {
      inject: (_name: string, callback: () => unknown): unknown => {
        const result = callback()
        if (result && typeof result === 'object' && Symbol.iterator in result) {
          for (const _entry of result as Iterable<unknown>) void _entry
        }
        return result
      },
      register: (
        config: Registration['config'],
        component: Registration['component']
      ): (() => void) => {
        registrations.push({ config, component })
        return () => undefined
      }
    }
    const tabDefinitions: Array<{ id: string; kind: string }> = []
    const sidebarRight = { openTab: vi.fn() }
    const locale = {
      register: vi.fn(() => () => undefined),
      bind: vi.fn(() => (key: string) => key)
    }
    const sidebarRightTabs = {
      register: (definition: { id: string; kind: string }) => {
        tabDefinitions.push(definition)
        return () => undefined
      }
    }
    plugin.apply({
      slots,
      sidebarRight,
      sidebarRightTabs,
      locale,
      effect: (effect: () => unknown) => effect()
    })

    expect(plugin.inject).toEqual(['slots', 'sidebarRight', 'sidebarRightTabs', 'locale'])
    expect(registrations.map(({ config }) => config.name)).toEqual([
      'sidebar.right.pane.tab',
      'sidebar.right.pane.tab',
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.brand.mark',
      'conversation.session.header.actions'
    ])
    expect(tabDefinitions).toHaveLength(2)
    expect(tabDefinitions[0]).toMatchObject({ id: 'dsh-desktop-business-preview', kind: 'business-preview' })
    expect(tabDefinitions[1]).toMatchObject({ id: 'dsh-desktop-business-workflows', kind: 'business-workflows' })
    expect(locale.register).toHaveBeenCalledOnce()
    expect(registrations.find(({ config }) => config.id === 'business-preview')).toBeUndefined()
    expect(registrations.find(({ config }) => config.id === 'business-sidebar-preview')?.config.order).toBe(81)
    // The mark is drawn in currentColor; the only stylesheet belongs to the workflow panel.
    expect(appended).toHaveLength(1)

    const sidebarName = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.name'
    )!.component({}) as { type: unknown; props: Record<string, unknown> }
    expect(sidebarName.type).toBe(BrandWordmark)
    expect(sidebarName.props.includeMark).toBe(false)

    const sidebarMark = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.mark'
    )!.component({ size: 24 }) as { type: unknown; props: Record<string, unknown> }
    expect(sidebarMark.type).toBe('svg')
    expect(sidebarMark.props.height).toBe(17)
    const [markPath] = sidebarMark.props.children as Array<{ type: unknown; props: Record<string, unknown> }>
    if (!markPath) throw new Error('Expected the sidebar brand SVG path')
    expect(markPath.type).toBe('path')
    expect(markPath.props.fill).toBe('currentColor')

    const heroMark = registrations.find(
      ({ config }) => config.name === 'conversation.hero.brand.mark'
    )!.component({ size: 48 }) as { type: unknown; props: Record<string, unknown> }
    expect(heroMark.type).toBe(FishLogo)
    expect(heroMark.props.size).toBe(48)
  })
})
