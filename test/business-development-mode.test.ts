import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

describe('business development mode', () => {
  it('starts the business dev server and Desktop with one shared mock overlay', async () => {
    const script = await readFile(join(process.cwd(), 'scripts/dev-with-business.mjs'), 'utf8')
    expect(script).toContain("['run', 'dev:local-mock']")
    expect(script).toContain('LOCAL_MOCK_OVERLAY_ROOT: userRoot')
    expect(script).toContain('DSH_BUSINESS_APP_URL: appUrl')
    expect(script).toContain('DSH_BUSINESS_USER_ROOT: userRoot')
  })

  it('does not forward an inherited development URL unless main explicitly enables it', async () => {
    const source = await readFile(join(process.cwd(), 'src/main/business-preview.ts'), 'utf8')
    expect(source).toContain('delete childEnv.DSH_BUSINESS_APP_URL')
    expect(source).toContain('if (this.options.developmentAppUrl)')
    const main = await readFile(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    expect(main).toContain("developmentAppUrl: !app.isPackaged ? process.env.DSH_BUSINESS_APP_URL : undefined")
  })

  it('recovers an unexpectedly exited business runtime without restarting Desktop', async () => {
    const source = await readFile(join(process.cwd(), 'src/main/business-preview.ts'), 'utf8')
    expect(source).toContain('scheduleRecovery(`业务服务已退出')
    expect(source).toContain('this.recoveryAttempts.length >= 5')
    expect(source).toContain('Math.min(8_000, 500 * (2 ** (attempt - 1)))')
    expect(source).toContain("phase: 'recovering'")
    expect(source).toContain('async restart(): Promise<string>')
  })
})
