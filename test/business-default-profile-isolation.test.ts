import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('business default preview isolation', () => {
  it('preserves unopened restored sessions when another session saves its default selection', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-restored-sessions-'))
    const token = randomBytes(32).toString('hex')
    const manifest = JSON.parse(await readFile(resolve('build/business-package/manifest.json'), 'utf8'))
    const idle = { revision: 7, profileId: 'restoredProfile', route: '/repay/receiptList' }
    await mkdir(join(userRoot, 'src/baseTypes/api'), { recursive: true })
    await writeFile(join(userRoot, 'src/baseTypes/api/mock-profiles.json'), JSON.stringify({
      schemaVersion: 2, projectId: manifest.projectId,
      profiles: [{ id: 'restoredProfile', schemaVersion: 2, page: 'repay', routePath: '/repay/receiptList', apis: {} }]
    }))
    await writeFile(join(userRoot, '.preview-runtime-state.json'), JSON.stringify({
      schemaVersion: 1, projectId: manifest.projectId, sessions: {
        idle, active: { revision: 3, profileId: '', route: '/credit/productCombine' }
      }
    }))
    const child = fork(resolve('build/business-runtime.mjs'), [resolve('build/business-package')], {
      execPath: process.execPath, execArgv: [],
      env: { ...process.env, DSH_BUSINESS_TOKEN: token,
        DSH_BUSINESS_WORKFLOW_TOKEN: randomBytes(32).toString('hex'), DSH_BUSINESS_USER_ROOT: userRoot },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    let output = ''
    child.stderr?.on('data', chunk => { output = `${output}${chunk}`.slice(-2000) })
    const ready = new Promise<string>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error('Business runtime did not start')), 30000)
      child.on('message', (message: unknown) => {
        if (message && typeof message === 'object' && 'type' in message && message.type === 'ready' && 'origin' in message && typeof message.origin === 'string') {
          clearTimeout(timer)
          resolveReady(message.origin)
        }
      })
      child.once('exit', code => { clearTimeout(timer); rejectReady(new Error(`Business runtime exited (${code}): ${output}`)) })
    })
    try {
      const origin = await ready
      const response = await fetch(`${origin}/__desktop/default-ui`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-DSH-Session': 'active' }
      })
      expect(response.status).toBe(200)
      const saved = JSON.parse(await readFile(join(userRoot, '.preview-runtime-state.json'), 'utf8'))
      expect(saved.sessions.idle).toEqual(idle)
      expect(saved.sessions.active).toMatchObject({ revision: 4, profileId: '' })
      const restored = await fetch(`${origin}/__desktop/state`, {
        headers: { Authorization: `Bearer ${token}`, 'X-DSH-Session': 'idle' }
      })
      expect(restored.status).toBe(200)
      expect(await restored.json()).toMatchObject({ profileId: idle.profileId, revision: idle.revision })
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolveExit => child.once('exit', resolveExit))
        child.kill('SIGTERM')
        await exited
      }
      await rm(userRoot, { recursive: true, force: true })
    }
  }, 45000)

  it('expires the business Profile cookie when returning to default', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-default-profile-'))
    const child = fork(resolve('build/business-runtime.mjs'), [resolve('build/business-package')], {
      execPath: process.execPath,
      execArgv: [],
      env: {
        ...process.env,
        DSH_BUSINESS_TOKEN: randomBytes(32).toString('hex'),
        DSH_BUSINESS_WORKFLOW_TOKEN: randomBytes(32).toString('hex'),
        DSH_BUSINESS_USER_ROOT: userRoot
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    let output = ''
    child.stderr?.on('data', chunk => { output = `${output}${chunk}`.slice(-2000) })
    const ready = new Promise<string>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error(`Business runtime did not start: ${output}`)), 30000)
      child.on('message', (message: unknown) => {
        if (!message || typeof message !== 'object') return
        const event = message as Record<string, unknown>
        if (event.type === 'ready' && typeof event.origin === 'string') {
          clearTimeout(timeout)
          resolveReady(event.origin)
        }
      })
      child.once('exit', code => {
        clearTimeout(timeout)
        rejectReady(new Error(`Business runtime exited (${code}): ${output}`))
      })
    })
    try {
      const origin = await ready
      const response = await fetch(`${origin}/__desktop/default-ui`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Sec-Fetch-Site': 'same-origin',
          Cookie: '__mockProfile=previousProfile',
          'X-DSH-Session': 'default-isolation-test'
        }
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toContain('__mockProfile=; Path=/; Max-Age=0; SameSite=Lax')
      expect(await response.json()).toMatchObject({ profileId: '', status: 'default' })

      const unauthorized = await fetch(`${origin}/__desktop/default-ui`, { method: 'POST' })
      expect(unauthorized.status).toBe(401)
      expect(unauthorized.headers.get('set-cookie')).toBeNull()
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolveExit => child.once('exit', resolveExit))
        child.kill('SIGTERM')
        await exited
      }
      await rm(userRoot, { recursive: true, force: true })
    }
  }, 45000)
})
