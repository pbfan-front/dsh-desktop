import { BrowserWindow } from 'electron'
import { fork, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

export type BusinessPreviewState = {
  phase: 'stopped' | 'starting' | 'ready' | 'recovering' | 'failed'
  kind?: 'service-exited' | 'package-incompatible'
  origin?: string
  attempt: number
  error?: string
}

export class BusinessPreview {
  private child?: ChildProcess
  private window?: BrowserWindow
  private starting?: Promise<string>
  private origin?: string
  private desiredRunning = false
  private stopping = false
  private recoveryTimer?: NodeJS.Timeout
  private stableTimer?: NodeJS.Timeout
  private recoveryAttempts: number[] = []
  private state: BusinessPreviewState = { phase: 'stopped', attempt: 0 }
  constructor(private options: { packageRoot: string; sourceRoot: string; userRoot: string; entry: string; node: string; connectionFile: string; developmentAppUrl?: string; log: (text: string) => void; onStateChange?: (state: BusinessPreviewState) => void }) {}

  snapshot(): BusinessPreviewState {
    return { ...this.state }
  }

  private updateState(next: BusinessPreviewState): void {
    this.state = next
    this.options.onStateChange?.(this.snapshot())
  }

  async start(): Promise<string> {
    this.desiredRunning = true
    if (this.origin) return this.origin
    if (this.starting) return this.starting
    this.updateState({ phase: this.recoveryAttempts.length > 0 ? 'recovering' : 'starting', attempt: this.recoveryAttempts.length })
    this.starting = this.launch()
    try { return await this.starting } finally { this.starting = undefined }
  }

  private scheduleRecovery(error: string, kind: BusinessPreviewState['kind']): void {
    if (!this.desiredRunning || this.stopping || this.recoveryTimer) return
    const now = Date.now()
    this.recoveryAttempts = this.recoveryAttempts.filter(timestamp => now - timestamp < 60_000)
    if (this.recoveryAttempts.length >= 5) {
      this.updateState({ phase: 'failed', kind, attempt: this.recoveryAttempts.length, error: `${error}；60 秒内恢复次数已达上限` })
      return
    }
    this.recoveryAttempts.push(now)
    const attempt = this.recoveryAttempts.length
    const delay = Math.min(8_000, 500 * (2 ** (attempt - 1)))
    this.updateState({ phase: 'recovering', kind, attempt, error })
    this.options.log(`Business service recovery ${attempt}/5 scheduled in ${delay}ms: ${error}`)
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined
      void this.start().catch(nextError => {
        this.options.log(`Business service recovery failed: ${nextError}`)
      })
    }, delay)
    this.recoveryTimer.unref()
  }

  private async launch(): Promise<string> {
    const token = randomBytes(32).toString('hex')
    let handshakeComplete = false
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
    const childEnv = { ...process.env }
    delete childEnv.DSH_BUSINESS_APP_URL
    if (this.options.developmentAppUrl) childEnv.DSH_BUSINESS_APP_URL = this.options.developmentAppUrl
    const child = fork(this.options.entry, [this.options.packageRoot], {
      execPath: this.options.node, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...childEnv,
        DSH_BUSINESS_TOKEN: token,
        DSH_BUSINESS_SOURCE_ROOT: this.options.sourceRoot,
        DSH_BUSINESS_USER_ROOT: this.options.userRoot
      }
    })
    this.child = child
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    child.once('exit', (code, signal) => {
      if (this.child === child) {
        if (this.stableTimer) clearTimeout(this.stableTimer)
        this.stableTimer = undefined
        this.child = undefined; this.origin = undefined
        void rm(this.options.connectionFile, { force: true })
        const kind = handshakeComplete ? 'service-exited' : 'package-incompatible'
        this.scheduleRecovery(`业务服务已退出（code=${code ?? 'null'}, signal=${signal ?? 'none'}）`, kind)
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
          handshakeComplete = true
          this.origin = message.origin
          child.on('message', (nextMessage: any) => {
            if (nextMessage?.type === 'show-preview') void this.show().catch(error => this.options.log(`Unable to show business preview: ${error}`))
          })
          clearTimeout(timer)
          if (this.stableTimer) clearTimeout(this.stableTimer)
          this.stableTimer = setTimeout(() => { this.recoveryAttempts = [] }, 30_000)
          this.stableTimer.unref()
          this.updateState({ phase: 'ready', origin: message.origin, attempt: this.recoveryAttempts.length })
          resolve(message.origin)
        } catch (error) { child.kill(); fail(error as Error) }
      })
    })
  }

  async show(): Promise<void> {
    const origin = await this.start()
    if (this.window && !this.window.isDestroyed()) {
      const currentUrl = this.window.webContents.getURL()
      if (!currentUrl || new URL(currentUrl).origin !== origin) await this.window.loadURL(`${origin}/?desktop=1`)
      this.window.show(); this.window.focus(); return
    }
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

  async restart(): Promise<string> {
    await this.stop(false)
    return await this.start()
  }

  async stop(permanent = true): Promise<void> {
    this.stopping = true
    if (permanent) this.desiredRunning = false
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = undefined
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.stableTimer = undefined
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
    this.starting = undefined
    this.stopping = false
    this.recoveryAttempts = permanent ? [] : this.recoveryAttempts
    this.updateState({ phase: permanent ? 'stopped' : 'recovering', attempt: this.recoveryAttempts.length })
  }
}
