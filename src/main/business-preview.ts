import { BrowserWindow } from 'electron'
import { fork, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

export class BusinessPreview {
  private child?: ChildProcess
  private window?: BrowserWindow
  private starting?: Promise<string>
  private origin?: string
  constructor(private options: { packageRoot: string; sourceRoot: string; userRoot: string; entry: string; node: string; connectionFile: string; log: (text: string) => void }) {}

  async start(): Promise<string> {
    if (this.origin) return this.origin
    if (this.starting) return this.starting
    this.starting = this.launch()
    try { return await this.starting } finally { this.starting = undefined }
  }

  private async launch(): Promise<string> {
    const token = randomBytes(32).toString('hex')
    let outputTail = ''
    const capture = (data: unknown): void => {
      const text = String(data)
      outputTail = `${outputTail}${text}`.slice(-4000)
      this.options.log(text)
    }
    const failure = (message: string): Error => {
      const detail = outputTail.trim()
      return new Error(detail ? `${message}: ${detail}` : message)
    }
    await mkdir(dirname(this.options.connectionFile), { recursive: true })
    const child = fork(this.options.entry, [this.options.packageRoot], {
      execPath: this.options.node, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        DSH_BUSINESS_TOKEN: token,
        DSH_BUSINESS_SOURCE_ROOT: this.options.sourceRoot,
        DSH_BUSINESS_USER_ROOT: this.options.userRoot
      }
    })
    this.child = child
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    child.once('exit', () => {
      if (this.child === child) {
        this.child = undefined; this.origin = undefined
        void rm(this.options.connectionFile, { force: true })
      }
    })
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(failure('Business service startup exceeded 60s')) }, 60_000)
      const fail = (error: Error) => { clearTimeout(timer); reject(error) }
      child.once('error', fail)
      child.once('exit', code => fail(failure(`Business service exited (${code})`)))
      child.once('message', async (message: any) => {
        try {
          if (message?.type !== 'ready' || new URL(message.origin).hostname !== '127.0.0.1') throw new Error('Invalid business service handshake')
          await writeFile(this.options.connectionFile, JSON.stringify({ ...message, token }), { mode: 0o600 })
          this.origin = message.origin
          child.on('message', (nextMessage: any) => {
            if (nextMessage?.type === 'show-preview') void this.show().catch(error => this.options.log(`Unable to show business preview: ${error}`))
          })
          clearTimeout(timer)
          resolve(message.origin)
        } catch (error) { child.kill(); fail(error as Error) }
      })
    })
  }

  async show(): Promise<void> {
    const origin = await this.start()
    if (this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus(); return }
    const window = new BrowserWindow({ width: 1380, height: 920, title: '业务体验 · P0',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'business-preview-p0' } })
    this.window = window
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault() })
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(`${origin}/`) || /^(data:|blob:)/.test(details.url)
      callback({ cancel: !allowed })
    })
    await window.loadURL(`${origin}/?desktop=1`)
  }

  async embeddedUrl(): Promise<string> {
    const origin = await this.start()
    return `${origin}/?desktop=1&embedded=1`
  }

  async stop(): Promise<void> {
    this.window?.destroy(); this.window = undefined
    const child = this.child
    if (child && child.exitCode === null) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL') }, 4000)
        child.once('exit', () => { clearTimeout(timer); resolve() })
        child.kill('SIGTERM')
      })
    }
    await rm(this.options.connectionFile, { force: true })
    this.origin = undefined
  }
}
