import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { patchPath } from './patch-path'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('DSH Desktop sidebar branding', () => {

  it('uses upstream platform-aware collapsed titlebar spacing', async () => {
    const client = await readFile(
      path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js'),
      'utf8'
    )

    expect(client).toContain('document.documentElement.dataset.platform === "darwin"')
    expect(client).toContain('document.documentElement.hasAttribute("data-windows-titlebar") ? 0 : 56')
    expect(client).toContain('sidebar === 0 ? collapsedWidth')
  })

  it('uses the upstream Windows caption row rather than a sidebar overlay', async () => {
    const titlebar = await readFile(
      path.join(projectRoot, 'src', 'preload', 'windows-titlebar.ts'),
      'utf8'
    )

    expect(titlebar).toContain('markWindowsTitlebar(document)')
    expect(titlebar).toContain("root.dataset.windowsTitlebar = ''")
    expect(titlebar).toContain('mountWindowsMenuBar({ document, ipcRenderer })')
    expect(titlebar).not.toContain('[data-sidebar-right-panel]')
  })

  it('keeps the phone entry aligned at the right edge of the settings row', async () => {
    const [patch, preload, main, client] = await Promise.all([
      readFile(patchPath('@deepseek-ai/dsh-client-ui-sidebar'), 'utf8'),
      readFile(path.join(projectRoot, 'src', 'preload', 'index.ts'), 'utf8'),
      readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8'),
      readFile(path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'), 'utf8')
    ])

    expect(patch).toContain('data-dsh-sidebar-root')
    expect(patch).toContain('data-dsh-sidebar-wide')
    expect(patch).not.toContain('data-dsh-sidebar-footer')
    expect(patch).toContain('data-dsh-sidebar-settings')
    expect(client).not.toContain("ctx.slots.inject('sidebar.footer.action'")
    expect(preload).toContain("liveElement(sidebarSettingsArea, '[data-dsh-sidebar-settings]')")
    expect(preload).toContain('settingsArea.appendChild(mobileButton)')
    expect(preload).toContain('[data-dsh-sidebar-settings] { position:relative')
    expect(preload).toContain('padding-right:46px')
    expect(preload).toContain('position:absolute; right:-2px; top:50%')
    expect(preload).toContain('const hidden = !wide && !phoneConnected')
    expect(main).toContain("ipcMain.handle('mobile:open-pairing'")
    expect(main).toContain("ipcMain.handle('mobile:status'")
  })

  it('installs the source logo into the Harness static frontend', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { scripts: { postinstall: string } }

    expect(packageJson.scripts.postinstall).toContain('node scripts/install-brand-assets.mjs')
  })
})
