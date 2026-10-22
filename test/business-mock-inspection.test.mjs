import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBusinessMockStore } from '../build/business-mock-store.mjs'

const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const apiUrl = '/loanNbr/loanNbr.json'
const scenarioId = 'normal-source'
const config = () => ({ baseData: { status: '0', inheritedOnly: true }, scenarios: [{ id: scenarioId,
  mode: 'replace', delay: 200, label: 'Normal source', data: { data: { list: [
    { loan_acct_no: 'fixture-normal-loan', duestatus: '0', amount: 0, enabled: false, optional: null, empty: '' }
  ] } } }] })
const scenarioArray = document => Array.isArray(document.scenarios) ? document.scenarios
  : Object.entries(document.scenarios || {}).map(([id, value]) => ({ ...value, id }))

async function fixture(document = config()) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-mock-inspect-')))
  roots.push(root)
  const source = join(root, 'source'), userRoot = join(root, 'user')
  const relativePath = join('src/baseTypes/api/loanNbr/loanNbr/mock.json')
  const sourceFile = join(source, relativePath), overlayFile = join(userRoot, relativePath)
  await mkdir(dirname(sourceFile), { recursive: true })
  await mkdir(dirname(overlayFile), { recursive: true })
  await writeFile(sourceFile, JSON.stringify(document))
  const atomicJson = vi.fn()
  const apiMockRelative = vi.fn(() => relativePath)
  const store = await createBusinessMockStore({ source, userRoot, manifest: { projectId: 'fixture', buildId: 'v1' },
    atomicJson, apiMockRelative, scenarioArray })
  const inspect = fieldPaths => store.inspectScenario({ apiUrl, scenarioId, ...(fieldPaths === undefined ? {} : { fieldPaths }) })
  return { root, source, userRoot, sourceFile, overlayFile, store, inspect, atomicJson, apiMockRelative }
}

describe('focused current Mock Scenario inspection', () => {
  it('reads typed exact values without merging baseData or returning unrelated Scenario configuration', async () => {
    const f = await fixture()
    const before = await readFile(f.sourceFile, 'utf8')
    const result = await f.inspect([['data', 'list', 0], ['status'], ['data', 'list', 1]])
    expect(result).toMatchObject({ apiUrl, scenarioId, fullScenario: false, scope: 'scenario.data-only',
      snapshot: 'fresh-file-read', source: { layer: 'project-source', mockPath: 'src/baseTypes/api/loanNbr/loanNbr/mock.json' } })
    expect(result.fields).toEqual([
      { path: ['data', 'list', 0], present: true, kind: 'object', complete: true,
        value: { loan_acct_no: 'fixture-normal-loan', duestatus: '0', amount: 0, enabled: false, optional: null, empty: '' } },
      { path: ['status'], present: false }, { path: ['data', 'list', 1], present: false }
    ])
    expect(result).not.toHaveProperty('evidenceId')
    expect(result).not.toHaveProperty('mode')
    expect(result).not.toHaveProperty('delay')
    const scalars = await f.inspect(['amount', 'enabled', 'optional', 'empty'].map(key => ['data', 'list', 0, key]))
    expect(scalars.fields.map(item => item.value)).toEqual([0, false, null, ''])
    expect((await f.inspect([['data', 'list', 'length']])).fields[0]).toEqual({ path: ['data', 'list', 'length'], present: false })
    await f.store.close()
    expect(await readFile(f.sourceFile, 'utf8')).toBe(before)
    expect(f.atomicJson).not.toHaveBeenCalled()
    expect(await readdir(f.userRoot)).toEqual(['src'])
  })

  it('discovers shape by default and explicitly marks values that exceed byte, node or depth budgets', async () => {
    const document = config()
    document.scenarios[0].data.large = '长'.repeat(6000)
    document.scenarios[0].data.many = Array.from({ length: 3000 }, () => 0)
    document.scenarios[0].data.deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: { l: { m: true } } } } } } } } } } } } }
    const f = await fixture(document)
    expect((await f.inspect()).fields[0]).toMatchObject({ path: [], present: true, complete: false, reason: 'shape-only', shape: { keys: ['data', 'large', 'many', 'deep'] } })
    const result = await f.inspect([['large'], ['many'], ['deep']])
    expect(result.fields.every(item => item.complete === false && !Object.hasOwn(item, 'value'))).toBe(true)
    expect(result.fields[0].shape).toEqual({ length: 6000 })
    expect(result.fields[1].shape).toEqual({ length: 3000 })
    const small = await fixture({ scenarios: [{ id: scenarioId, data: { a: '测'.repeat(1000) } }] })
    const budget = await small.inspect(Array.from({ length: 16 }, () => ['a']))
    expect(budget.fields.some(item => !item.complete)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(budget.fields.flatMap(item => item.complete ? [item.value] : [])))).toBeLessThan(16400)
    expect(Buffer.byteLength(JSON.stringify(budget))).toBeLessThan(65536)
  })

  it('uses Overlay first with no source-Scenario/default fallback and sees immediate edits and deletion', async () => {
    const f = await fixture()
    const overlay = { scenarios: { [scenarioId]: { id: 'ignored-object-id', data: { duestatus: '1' } } } }
    await writeFile(f.overlayFile, JSON.stringify(overlay))
    expect(await f.inspect([['duestatus']])).toMatchObject({ source: { layer: 'user-overlay' }, fields: [{ value: '1' }] })
    overlay.scenarios[scenarioId].data.duestatus = 1
    await writeFile(f.overlayFile, JSON.stringify(overlay))
    expect((await f.inspect([['duestatus']])).fields[0]).toMatchObject({ value: 1, kind: 'number' })
    await writeFile(f.overlayFile, JSON.stringify({ scenarios: [{ id: 'other', data: { normal: true } }], defaultScenario: 'other' }))
    await expect(f.inspect()).rejects.toMatchObject({ code: 'E_MOCK_SCENARIO_NOT_FOUND', status: 404 })
    await rm(f.overlayFile)
    expect((await f.inspect([['data', 'list', 0, 'duestatus']])).fields[0]).toMatchObject({ value: '0', kind: 'string' })
    expect(f.store.stats.hits).toBe(0)
  })

  it.each([
    null, {}, { apiUrl, scenarioId, fieldPaths: [] },
    { apiUrl, scenarioId, fieldPaths: 'data.list' },
    { apiUrl, scenarioId, fieldPaths: Array.from({ length: 17 }, () => ['data']) },
    { apiUrl, scenarioId, fieldPaths: [Array.from({ length: 13 }, () => 'data')] },
    ...['__proto__', 'constructor', 'prototype', '0', 'a.b'].map(key => ({ apiUrl, scenarioId, fieldPaths: [[key]] })),
    ...[-1, 1.5, 1001, null].map(index => ({ apiUrl, scenarioId, fieldPaths: [['data', index]] })),
    ...['/a/../mock.json', '/a//b', '//a/b', '/a/b/c', '/a/%2e%2e', 'http://host/a/b'].map(value => ({ apiUrl: value, scenarioId }))
  ])('rejects invalid or unsafe input before reading a path: %j', async input => {
    const f = await fixture()
    await expect(f.store.inspectScenario(input)).rejects.toMatchObject({ code: 'E_MOCK_INSPECT_INVALID', status: 422 })
    expect(f.apiMockRelative).not.toHaveBeenCalled()
  })

  it('rejects duplicate IDs, missing files and malformed Overlay without exposing JSON content', async () => {
    const f = await fixture({ scenarios: [config().scenarios[0], config().scenarios[0]] })
    await expect(f.inspect()).rejects.toMatchObject({ code: 'E_MOCK_SCENARIO_AMBIGUOUS' })
    await rm(f.sourceFile)
    await expect(f.inspect()).rejects.toMatchObject({ code: 'E_MOCK_CONFIG_NOT_FOUND', status: 404 })
    await writeFile(f.overlayFile, 'PRIVATE-DIAGNOSTIC-MARKER-not-json')
    await expect(f.inspect()).rejects.toThrow('Mock file is not valid JSON')
    await expect(f.inspect()).rejects.not.toThrow('PRIVATE-DIAGNOSTIC-MARKER')
    await writeFile(f.overlayFile, JSON.stringify({ scenarios: 'invalid' }))
    await expect(f.inspect()).rejects.toMatchObject({ code: 'E_MOCK_CONFIG_INVALID' })
  })

  it('reports recoverable count limits without reading or silently dropping requested paths', async () => {
    const f = await fixture()
    const paths = Array.from({ length: 17 }, () => ['data', 'list', 0, 'duestatus'])
    await expect(f.inspect(paths)).rejects.toMatchObject({ code: 'E_MOCK_INSPECT_INVALID', status: 422,
      recovery: { action: 'retry-same-source-in-batches', maxPaths: 16, receivedPaths: 17, requiredBatches: 2, preserveAllPaths: true } })
    expect(f.apiMockRelative).not.toHaveBeenCalled()
    const batches = [await f.inspect(paths.slice(0, 16)), await f.inspect(paths.slice(16))]
    expect(batches.flatMap(batch => batch.fields)).toHaveLength(17)
    expect(batches.flatMap(batch => batch.fields).every(item => item.complete && item.value === '0')).toBe(true)
    expect(f.atomicJson).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('rejects a Mock symlink outside its declared root', async () => {
    const f = await fixture()
    const outside = join(f.root, 'outside.json')
    await writeFile(outside, JSON.stringify(config()))
    await symlink(outside, f.overlayFile)
    await expect(f.inspect()).rejects.toMatchObject({ code: 'E_MOCK_INSPECT_PATH_OUTSIDE_ROOT', status: 403 })
  })

  it('executes the real registered Harness tool through an authenticated Runtime child against the exported package', async () => {
    const f = await fixture()
    const token = randomBytes(32).toString('hex')
    const child = fork(resolve('build/business-runtime.mjs'), [resolve('build/business-package')], {
      execPath: process.execPath, execArgv: [],
      env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_WORKFLOW_TOKEN: randomBytes(32).toString('hex'),
        DSH_BUSINESS_USER_ROOT: f.userRoot }, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    const oldDescriptor = process.env.DSH_BUSINESS_CONNECTION_FILE
    let output = ''
    child.stderr.on('data', chunk => { output = `${output}${chunk}`.slice(-2000) })
    const ready = new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error('Inspection Runtime startup timeout')), 30000)
      child.on('message', event => { if (event?.type === 'ready') { clearTimeout(timer); resolveReady(event) } })
      child.once('error', error => { clearTimeout(timer); rejectReady(error) })
      child.once('exit', code => { clearTimeout(timer); rejectReady(new Error(`Inspection Runtime exited (${code}): ${output}`)) })
    })
    try {
      const connection = await ready
      const descriptor = join(f.root, 'connection.json')
      await writeFile(descriptor, JSON.stringify({ ...connection, token }))
      process.env.DSH_BUSINESS_CONNECTION_FILE = descriptor
      const tools = []
      const { apply } = await import('../packages/dsh-desktop-business/index.js')
      await apply({ tools: { register: definition => tools.push(definition) },
        workspaceRegistry: { resolveByPath: async () => ({ id: 'fixture-existing' }) },
        webServer: { register: () => () => undefined }, effect: callback => callback(), on() {}, logger: { warn() {} } })
      const tool = tools.find(item => item.name === 'business_inspect_mock_scenario')
      expect(tool).toBeDefined()
      const args = { apiUrl, scenarioId: '正常借据可以提前结清', fieldPathsJson: '[["data","list",0,"duestatus"]]' }
      const exec = { agent: { id: 'inspection-bridge' }, signal: undefined }
      const result = JSON.parse(await tool.execute(args, exec))
      expect(result).toMatchObject({ source: { layer: 'project-source' }, fullScenario: false,
        fields: [{ present: true, complete: true, kind: 'string', value: '0' }] })
      const overLimit = { ...args, fieldPathsJson: JSON.stringify(Array.from({ length: 17 }, () => ['data', 'list', 0, 'duestatus'])) }
      await expect(tool.execute(overLimit, exec)).rejects.toThrow('retry-same-source-in-batches')
      const focused = JSON.stringify({ ...config(), scenarios: [{ id: args.scenarioId, data: { duestatus: 1 } }] })
      await writeFile(f.overlayFile, focused)
      const overlay = JSON.parse(await tool.execute({ ...args, fieldPathsJson: '[["duestatus"]]' }, exec))
      expect(overlay).toMatchObject({ source: { layer: 'user-overlay' }, fields: [{ kind: 'number', value: 1 }] })
      await expect(tool.execute({ ...args, scenarioId: 'missing-exact-id' }, exec)).rejects.toThrow('E_MOCK_SCENARIO_NOT_FOUND')
      expect(await readFile(f.overlayFile, 'utf8')).toBe(focused)
      expect(await readdir(f.userRoot)).toEqual(['src'])
    } finally {
      if (oldDescriptor === undefined) delete process.env.DSH_BUSINESS_CONNECTION_FILE
      else process.env.DSH_BUSINESS_CONNECTION_FILE = oldDescriptor
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolveExit => child.once('exit', resolveExit))
        child.kill('SIGTERM')
        await exited
      }
    }
  }, 45000)
})
