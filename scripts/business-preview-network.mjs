import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function debuggingPort(directory, child) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before DevTools became ready (${child.exitCode})`)
    try {
      const [port] = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')
      if (/^\d+$/.test(port)) return Number(port)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await pause(100)
  }
  throw new Error('Chrome DevTools startup timed out')
}

async function openSocket(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return socket
}

export async function openBusinessPreviewNetwork({ chromePath, requestPath, mobileViewport, userAgent }) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-business-network-'))
  const child = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--disable-gpu', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank'
  ], { stdio: 'ignore' })
  let socket
  const pending = new Map()
  const responses = []
  const observedMockPaths = new Set()
  const requestMeta = new Map()
  let nextId = 0
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return reject(new Error('Chrome DevTools is closed'))
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const onMessage = async event => {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    if (message.id) {
      const item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id)
      if (message.error) item.reject(new Error(`${message.error.code}: ${message.error.message}`))
      else item.resolve(message.result)
      return
    }
    if (message.method === 'Network.responseReceived') {
      const { requestId, response } = message.params
      try {
        const path = new URL(response.url).pathname
        if (path.startsWith('/mock/')) observedMockPaths.add(path)
        if (path !== requestPath) return
      } catch { return }
      const headers = Object.fromEntries(Object.entries(response.headers || {})
        .map(([name, value]) => [name.toLowerCase(), value]))
      requestMeta.set(requestId, { statusCode: response.status,
        timestamp: new Date().toISOString(),
        profileId: decodeURIComponent(String(headers['x-local-mock-profile'] || '')),
        scenarioId: decodeURIComponent(String(headers['x-local-mock-scenario'] || '')) })
    }
    if (message.method === 'Network.loadingFinished') {
      const meta = requestMeta.get(message.params.requestId)
      if (!meta) return
      requestMeta.delete(message.params.requestId)
      try {
        const body = await call('Network.getResponseBody', { requestId: message.params.requestId })
        if (body?.base64Encoded) return
        responses.push({ ...meta, path: requestPath, body: JSON.parse(body.body) })
      } catch { /* Failed or non-JSON responses cannot satisfy a Mock assertion. */ }
    }
  }
  try {
    const port = await debuggingPort(directory, child)
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = pages.find(item => item.type === 'page')
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome did not expose a page target')
    socket = await openSocket(page.webSocketDebuggerUrl)
    socket.addEventListener('message', onMessage)
    socket.addEventListener('close', () => {
      for (const item of pending.values()) item.reject(new Error('Chrome DevTools closed'))
      pending.clear()
    })
    await call('Page.enable')
    await call('Network.enable')
    if (mobileViewport) {
      await call('Emulation.setDeviceMetricsOverride', { ...mobileViewport, mobile: true })
      await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    if (userAgent) await call('Network.setUserAgentOverride', { userAgent })
    return {
      navigate: url => call('Page.navigate', { url }),
      reload: () => call('Page.reload', { ignoreCache: true }),
      async tap(x, y) {
        if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 10000)) throw new Error('Invalid tap coordinates')
        await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
        await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      },
      async evaluate(expression) {
        const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser expression failed')
        return result.result?.value
      },
      responses,
      observedMockPaths,
      async close() {
        socket?.close()
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise(resolve => child.once('exit', resolve))
          child.kill('SIGTERM')
          await Promise.race([exited, pause(5000)])
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        }
        await rm(directory, { recursive: true, force: true })
      }
    }
  } catch (error) {
    socket?.close()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
