import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveSemanticIntent } from './business-control-contract.mjs'

const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const route = value => text(value, 240) && /^\/[a-zA-Z0-9_./-]*$/.test(value) && !value.includes('..') && !value.startsWith('//')
const fail = (message, code = 'E_DEFAULT_BRANCH_INVALID', status = 422) => Object.assign(new Error(message), { code, status })

export function isDefaultDataBranch(profile) {
  return object(profile) && profile.dataMode === 'default' && profile._dshDefaultBranch?.version === 1
    && object(profile.apis) && Object.keys(profile.apis).length === 0 && !profile.externalCapabilities
}

/** A default branch adds only a Profile identity/route; requests keep using the live default Mock selection. */
export function createDefaultBranchService(options) {
  let pending = Promise.resolve()
  async function create(input, sessionId) {
    const startedAt = performance.now()
    const allowed = ['profileId', 'query', 'routePath', 'targetPage', 'label']
    if (!object(input) || Object.keys(input).some(key => !allowed.includes(key))
      || !/^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/.test(input.profileId || '')
      || !text(input.query, 1000) || (input.label !== undefined && !text(input.label, 120))
      || (input.routePath !== undefined && !route(input.routePath))
      || (input.targetPage !== undefined && !text(input.targetPage, 200))
      || (!input.routePath && !input.targetPage)) {
      throw fail('Provide profileId, original query and an explicit routePath or literal targetPage. Default branches accept no data, API or Scenario overrides.')
    }
    const target = await options.resolveTarget(input, sessionId)
    const resolvedAt = performance.now()
    if (resolveSemanticIntent(options.semanticRules, target.routePath, input.query).status !== 'unmatched') {
      throw fail('This request declares a business state. Use the scenario workflow for source/data review.', 'E_DEFAULT_BRANCH_CUSTOM_INTENT')
    }
    const owner = createHash('sha256').update(sessionId).digest('hex')
    const label = input.label || `${target.pageTitle || target.routePath}（默认数据）`
    const profiles = await options.readProfiles(options.profileFile)
    const existing = (await options.catalog()).find(profile => profile.id === input.profileId)
    const receipt = (profile, created) => ({ status: 'created', created, profileId: profile.id, label: profile.label,
      routePath: profile.routePath, page: profile.page, dataMode: 'default', apiOverrideCount: 0,
      activation: 'user-selection-required', applied: false, verified: false,
      operationId: profile._dshDefaultBranch.operationId, target,
      timings: { resolveTargetMs: resolvedAt - startedAt, totalMs: performance.now() - startedAt } })
    if (existing) {
      if (!isDefaultDataBranch(existing) || existing._dshDefaultBranch.owner !== owner
        || existing.routePath !== target.routePath || existing.label !== label) {
        throw fail('Profile ID already exists; choose a new ID. Existing branches are never replaced.', 'E_DEFAULT_BRANCH_EXISTS', 409)
      }
      return receipt(existing, false)
    }
    const operationId = randomUUID()
    const profile = { id: input.profileId, label, branchLabel: label,
      page: target.routePath.split('/').filter(Boolean).at(-1) || 'home', routePath: target.routePath,
      schemaVersion: options.schemaVersion, dataMode: 'default', apis: {},
      _dshDefaultBranch: { version: 1, owner, operationId, createdAt: new Date().toISOString() } }
    let before = null
    try { before = await readFile(options.profileFile, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const rollback = { operationId, defaultBranch: { profileId: profile.id, owner },
      files: [{ file: options.profileFile, content: before }] }
    // Save recovery material before publishing the Profile. No Mock files are written.
    await options.atomicJson(join(options.userRoot, '.rollbacks', `${operationId}.json`), rollback)
    await options.atomicJson(options.profileFile, { schemaVersion: options.schemaVersion,
      projectId: options.projectId, updatedAt: new Date().toISOString(), profiles: [...profiles, profile] })
    options.onCreated(profile)
    return receipt(profile, true)
  }
  const serialize = action => {
    // Tool retries and simultaneous default-branch requests must not overwrite one another.
    const result = pending.then(action)
    pending = result.then(() => undefined, () => undefined)
    return result
  }
  return {
    create: (input, sessionId) => serialize(() => create(input, sessionId)),
    rollback: (rollback, operationId) => serialize(async () => {
      if (rollback.operationId !== operationId || !object(rollback.defaultBranch)) throw fail('Invalid default branch rollback record.')
      const profiles = await options.readProfiles(options.profileFile)
      const profile = profiles.find(item => item.id === rollback.defaultBranch.profileId)
      if (!profile) return { removed: false }
      if (!isDefaultDataBranch(profile) || profile._dshDefaultBranch.operationId !== operationId
        || profile._dshDefaultBranch.owner !== rollback.defaultBranch.owner) {
        throw fail('The branch changed after creation; rollback cannot replace later edits.', 'E_DEFAULT_BRANCH_CHANGED', 409)
      }
      await options.atomicJson(options.profileFile, { schemaVersion: options.schemaVersion,
        projectId: options.projectId, updatedAt: new Date().toISOString(), profiles: profiles.filter(item => item.id !== profile.id) })
      return { removed: true }
    })
  }
}
