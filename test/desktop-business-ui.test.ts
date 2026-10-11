import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

describe('business sidebar plugin on Harness 0.2', () => {
  it('registers two page types and opens preview only on the user action', async () => {
    const source = await readFile(path.join(root, 'packages/dsh-desktop-business-ui/client.js'), 'utf8')
    const tabs: Array<{ id: string; kind: string; guide: Array<{ id: string }> }> = []
    const seats: Array<{ name: string; key?: string; id?: string; component: (props: Record<string, unknown>) => unknown }> = []
    const openTab = vi.fn()
    let definition: { factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void; inject: string[] } } | undefined
    const document = {
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' }),
      head: { appendChild: vi.fn() },
      documentElement: { dataset: {} as Record<string, string> }
    }
    const hostWindow = {
      document,
      dispatchEvent: vi.fn(),
      __ModuleLoader__: { load: (value: typeof definition) => { definition = value } }
    }
    vm.runInNewContext(source, { window: hostWindow, document, CustomEvent: class { constructor(public name: string) {} } })
    expect(definition).toBeDefined()
    const plugin = definition!.factory((id) => {
      if (id === 'react') return { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }) }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
      throw new Error(`Unexpected dependency ${id}`)
    })
    const slots = {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: (config: { name: string; key?: string; id?: string }, component: (props: Record<string, unknown>) => unknown) => {
        seats.push({ ...config, component })
        return () => undefined
      }
    }
    plugin.apply({
      slots,
      sidebarRight: { openTab },
      sidebarRightTabs: { register: (definition: typeof tabs[number]) => { tabs.push(definition); return () => undefined } },
      locale: { register: () => () => undefined, bind: () => (key: string) => key },
      effect: (setup: () => unknown) => setup()
    })

    expect(plugin.inject).toEqual(['slots', 'sidebarRight', 'sidebarRightTabs', 'locale'])
    expect(tabs.map(({ id, kind }) => [id, kind])).toEqual([
      ['dsh-desktop-business-preview', 'business-preview'],
      ['dsh-desktop-business-workflows', 'business-workflows']
    ])
    expect(tabs.flatMap(({ guide }) => guide.map(({ id }) => id))).toEqual(['business-preview', 'business-workflows'])
    expect(seats.map(({ name }) => name)).toEqual([
      'sidebar.right.pane.tab', 'sidebar.right.pane.tab', 'conversation.session.header.actions'
    ])
    expect(openTab).not.toHaveBeenCalled()
    const action = seats.find(({ name }) => name === 'conversation.session.header.actions')?.component({ sessionId: 's1' }) as {
      props: { onClick: () => void }
    }
    action.props.onClick()
    expect(document.documentElement.dataset.dshBusinessSessionId).toBe('s1')
    expect(openTab).toHaveBeenCalledWith('business-preview')
  })
})
