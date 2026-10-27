import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { createDefaultBranchService, isDefaultDataBranch } from '../build/business-default-branch.mjs'

test('serializes default creations, preserves existing Profiles and makes retries idempotent without Mock writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'default-branch-'))
  const profileFile = join(root, 'profiles.json')
  const writes = [], created = []
  const readProfiles = async () => JSON.parse(await readFile(profileFile, 'utf8')).profiles
  try {
    const original = { id: 'custom_branch', apis: { '/loan/detail.json': 'custom' } }
    await writeFile(profileFile, JSON.stringify({ profiles: [original] }))
    const service = createDefaultBranchService({
      profileFile, userRoot: root, projectId: 'fixture', schemaVersion: 2,
      readProfiles, catalog: readProfiles,
      atomicJson: async (file, data) => { writes.push({ file, data }); if (file === profileFile) await writeFile(file, JSON.stringify(data)) },
      resolveTarget: async () => ({ routePath: '/loan/fullLoanApply', pageTitle: '企业借款' }),
      onCreated: profile => created.push(profile), semanticRules: []
    })
    const input = { profileId: 'default_branch', query: '创建合并套餐页的体验分支', targetPage: '合并套餐页' }
    const [first, retry, second] = await Promise.all([
      service.create(input, 'session-a'), service.create(input, 'session-a'),
      service.create({ ...input, profileId: 'another_branch' }, 'session-a')
    ])
    assert.equal(first.created, true)
    assert.equal(retry.created, false)
    assert.equal(first.operationId, retry.operationId)
    assert.equal(second.created, true)
    const profiles = await readProfiles()
    assert.deepEqual(profiles[0], original)
    assert.equal(profiles.length, 3)
    assert.equal(created.length, 2)
    assert.ok(created.every(isDefaultDataBranch))
    assert.ok(writes.every(({ file }) => file === profileFile || file.includes('.rollbacks')))
    assert.equal(writes.length, 4)
    await assert.rejects(service.create(input, 'session-b'), { code: 'E_DEFAULT_BRANCH_EXISTS' })
    await assert.rejects(service.create({ ...input, scenarios: [] }, 'session-a'), { code: 'E_DEFAULT_BRANCH_INVALID' })
    assert.equal((await readProfiles()).length, 3)
    assert.equal(isDefaultDataBranch({ ...created[0], apis: { '/loan/detail.json': 'other' } }), false)
    assert.equal(isDefaultDataBranch({ ...created[0], externalCapabilities: { face: 'success' } }), false)
    assert.equal(isDefaultDataBranch({ apis: {} }), false)
    const rollback = writes.find(({ data }) => data.operationId === first.operationId).data
    assert.deepEqual(await service.rollback(rollback, first.operationId), { removed: true })
    assert.deepEqual((await readProfiles()).map(item => item.id), ['custom_branch', 'another_branch'])
    assert.deepEqual(await service.rollback(rollback, first.operationId), { removed: false })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects ambiguous routes and declared custom intents before persisting anything', async () => {
  let writes = 0
  const options = { semanticRules: [{ id: 'hit', routePath: '/loan/fullLoanApply', intentEquals: '命中贴息' }],
    resolveTarget: async () => ({ routePath: '/loan/fullLoanApply' }),
    atomicJson: async () => { writes++ } }
  const input = { profileId: 'default_branch', query: '命中贴息', targetPage: '合并套餐页' }
  await assert.rejects(createDefaultBranchService(options).create(input, 'session'), { code: 'E_DEFAULT_BRANCH_CUSTOM_INTENT' })
  const ambiguous = Object.assign(new Error('Choose target'), { code: 'E_TARGET_ROUTE_AMBIGUOUS', candidates: [{ routePath: '/loan/one' }, { routePath: '/loan/two' }] })
  await assert.rejects(createDefaultBranchService({ ...options, resolveTarget: async () => { throw ambiguous } })
    .create({ ...input, query: '创建分支' }, 'session'), error => error === ambiguous)
  assert.equal(writes, 0)
})
