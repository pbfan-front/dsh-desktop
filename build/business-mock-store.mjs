import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { validSemanticExpectations } from './business-control-contract.mjs'

const inspectionError = (code, message, status = 422) => Object.assign(new Error(message), { code, status })
const inspectionKey = key => typeof key === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(key)
  && !['__proto__', 'constructor', 'prototype'].includes(key)
const inspectionKind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
const inspectionShape = value => {
  if (Array.isArray(value)) return { length: value.length }
  if (value && typeof value === 'object') {
    const all = Object.keys(value)
    const keys = all.filter(key => key.length <= 64 && inspectionKey(key)).slice(0, 8)
    return { keys, keyCount: all.length, omittedKeyCount: all.length - keys.length }
  }
  return typeof value === 'string' ? { length: value.length } : {}
}

// Count only up to the response budget, rather than stringify an entire large
// Scenario just to find out it cannot be returned. No partial value is emitted.
const inspectionValueBytes = (value, limit) => {
  let bytes = 0
  let nodes = 0
  const add = count => { bytes += count; return bytes <= limit }
  const visit = (item, depth) => {
    if (++nodes > 2048 || depth > 12) return false
    if (item === null || typeof item !== 'object') {
      if (typeof item === 'number' && !Number.isFinite(item)) return false
      if (typeof item === 'string' && item.length > limit) return false
      const json = JSON.stringify(item)
      return typeof json === 'string' && add(Buffer.byteLength(json))
    }
    if (!add(2)) return false
    let first = true
    for (const key of Object.keys(item)) {
      if (!first && !add(1)) return false
      first = false
      if (!Array.isArray(item) && (!add(Buffer.byteLength(JSON.stringify(key))) || !add(1))) return false
      if (!visit(item[key], depth + 1)) return false
    }
    return true
  }
  return visit(value, 0) ? bytes : null
}

// Runtime-owned Mock reads and semantic checks. No Profile mutation occurs here.
export async function createBusinessMockStore({ source, userRoot, manifest, atomicJson, apiMockRelative, scenarioArray }) {
  const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  const safeText = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  const safeRoute = value => typeof value === 'string' && /^\/[a-zA-Z0-9_./-]*$/.test(value) && !value.includes('..') && !value.startsWith('//')
  const cacheFile = join(userRoot, '.mock-config-cache.json')
  const fileCache = new Map()
  const stats = { hits: 0, misses: 0, invalidations: 0, restoredHits: 0 }
  let dirty = false
  try {
    const persisted = JSON.parse(await readFile(cacheFile, 'utf8'))
    if (persisted?.schemaVersion === 1 && persisted.projectId === manifest.projectId
      && persisted.buildId === manifest.buildId && persisted.sourceRoot === source && Array.isArray(persisted.entries)) {
      for (const entry of persisted.entries.slice(-500)) {
        if (!plainObject(entry) || typeof entry.file !== 'string' || typeof entry.fingerprint !== 'string' || !plainObject(entry.config)) continue
        fileCache.set(entry.file, { fingerprint: entry.fingerprint, config: entry.config, restored: true })
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`[business-runtime] ignored invalid Mock config cache: ${error.message}`)
  }
  let persistQueue = Promise.resolve()
  let persistTimer
  const persist = async () => {
    if (dirty) {
      dirty = false
      const document = { schemaVersion: 1, projectId: manifest.projectId, buildId: manifest.buildId, sourceRoot: source,
        entries: [...fileCache.entries()].map(([file, value]) => ({ file, fingerprint: value.fingerprint, config: value.config })) }
      persistQueue = persistQueue.catch(() => {}).then(() => atomicJson(cacheFile, document)).catch(error => {
        dirty = true
        console.warn(`[business-runtime] failed to persist Mock config cache: ${error.message}`)
      })
    }
    await persistQueue
  }
  const schedulePersistence = () => {
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      void persist()
    }, 500)
    persistTimer.unref()
  }
  const readCachedFile = async file => {
    let metadata
    try { metadata = await stat(file) } catch (error) {
      if (error.code === 'ENOENT') {
        if (fileCache.delete(file)) dirty = true
        return null
      }
      throw error
    }
    const fingerprint = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`
    const cached = fileCache.get(file)
    if (cached?.fingerprint === fingerprint) {
      stats.hits += 1
      if (cached.restored) stats.restoredHits += 1
      return { file, config: cached.config, fingerprint }
    }
    if (cached) stats.invalidations += 1
    const config = JSON.parse(await readFile(file, 'utf8'))
    stats.misses += 1
    fileCache.set(file, { fingerprint, config, restored: false })
    dirty = true
    while (fileCache.size > 500) fileCache.delete(fileCache.keys().next().value)
    return { file, config, fingerprint }
  }
  const read = async relativePath => {
    const probes = []
    for (const file of [join(userRoot, relativePath), join(source, relativePath)]) {
      const result = await readCachedFile(file)
      probes.push({ file, fingerprint: result?.fingerprint ?? null })
      if (result) return { ...result, probes }
    }
    return null
  }
  const readFresh = async relativePath => {
    for (const file of [join(userRoot, relativePath), join(source, relativePath)]) {
      try { return { file, config: JSON.parse(await readFile(file, 'utf8')) } }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return null
  }
  /**
   * Read-only, current-file inspection. fieldPaths are typed JSON paths relative
   * to Scenario.data, not baseData or the middleware's merged response. Omitted
   * fieldPaths returns its shape; requested values are complete or shape-only.
   * This grants no creation evidence, source approval or UI verification.
   * @param {unknown} input
   */
  const inspectScenario = async input => {
    const invalid = () => inspectionError('E_MOCK_INSPECT_INVALID', 'Expected an exact two-segment API URL, Scenario ID and optional 1-16 typed fieldPaths of depth 0-12.')
    if (plainObject(input) && Array.isArray(input.fieldPaths) && input.fieldPaths.length > 16) {
      throw Object.assign(inspectionError('E_MOCK_INSPECT_INVALID',
        `fieldPaths contains ${input.fieldPaths.length} paths; at most 16 are allowed per request. Retry the same exact API and Scenario in batches of at most 16 paths, preserving every requested path. No Mock file was read. Do not fall back to a full file read solely because of this count limit.`), {
        recovery: { action: 'retry-same-source-in-batches', maxPaths: 16, receivedPaths: input.fieldPaths.length,
          requiredBatches: Math.ceil(input.fieldPaths.length / 16), preserveAllPaths: true }
      })
    }
    if (!plainObject(input) || !safeText(input.apiUrl, 256) || !safeRoute(input.apiUrl)
      || input.apiUrl.split('/').length !== 3 || !input.apiUrl.split('/').slice(1).every(Boolean)
      || !safeText(input.scenarioId, 128)
      || (input.fieldPaths !== undefined && (!Array.isArray(input.fieldPaths) || input.fieldPaths.length < 1 || input.fieldPaths.length > 16
        || !input.fieldPaths.every(path => Array.isArray(path) && path.length <= 12 && path.every(part =>
          typeof part === 'number' ? Number.isSafeInteger(part) && part >= 0 && part <= 1000 : inspectionKey(part)))))) throw invalid()
    let relativePath
    try { relativePath = apiMockRelative(input.apiUrl) } catch { throw invalid() }
    let existing
    for (const [layer, root] of [['user-overlay', userRoot], ['project-source', source]]) {
      let file
      try { file = await realpath(join(root, relativePath)) } catch (error) {
        if (error.code === 'ENOENT') continue
        throw inspectionError('E_MOCK_INSPECT_READ_FAILED', 'Cannot resolve the Mock file.')
      }
      const within = relative(await realpath(root), file)
      if (within.startsWith('..') || isAbsolute(within)) throw inspectionError('E_MOCK_INSPECT_PATH_OUTSIDE_ROOT', 'Mock file resolves outside its declared root.', 403)
      let text
      try { text = await readFile(file, 'utf8') } catch { throw inspectionError('E_MOCK_INSPECT_READ_FAILED', 'Cannot read the Mock file.') }
      let config
      try { config = JSON.parse(text) } catch { throw inspectionError('E_MOCK_CONFIG_INVALID', 'Mock file is not valid JSON; inspect the exact source file for diagnosis.') }
      if (!plainObject(config) || (!Array.isArray(config.scenarios) && !plainObject(config.scenarios))) {
        throw inspectionError('E_MOCK_CONFIG_INVALID', 'Mock file must declare an array or object of scenarios.')
      }
      existing = { layer, config }
      break
    }
    if (!existing) throw inspectionError('E_MOCK_CONFIG_NOT_FOUND', 'No Mock config exists for this API.', 404)
    const matches = scenarioArray(existing.config).filter(item => item && item.id === input.scenarioId)
    if (!matches.length) throw inspectionError('E_MOCK_SCENARIO_NOT_FOUND', 'Scenario ID does not exist in the selected Mock layer; no default or source-layer fallback was used.', 404)
    if (matches.length !== 1) throw inspectionError('E_MOCK_SCENARIO_AMBIGUOUS', 'Duplicate Scenario IDs must be resolved before inspecting this source.')
    const scenario = matches[0]
    let remaining = 16384
    const fields = (input.fieldPaths ?? [[]]).map(path => {
      let value = scenario.data
      let present = Object.hasOwn(scenario, 'data')
      for (const part of path) {
        if (!present || !value || typeof value !== 'object' || (Array.isArray(value) ? typeof part !== 'number' : typeof part !== 'string')
          || !Object.hasOwn(value, part)) { present = false; break }
        value = value[part]
      }
      if (!present) return { path, present: false }
      const bytes = input.fieldPaths === undefined ? null : inspectionValueBytes(value, Math.min(8192, remaining))
      if (bytes !== null) {
        remaining -= bytes
        return { path, present: true, kind: inspectionKind(value), complete: true, value }
      }
      return { path, present: true, kind: inspectionKind(value), complete: false, shape: inspectionShape(value),
        reason: input.fieldPaths === undefined ? 'shape-only' : 'value-budget-or-depth-limit' }
    })
    return { apiUrl: input.apiUrl, scenarioId: input.scenarioId,
      source: { layer: existing.layer, mockPath: relativePath.split('\\').join('/') },
      scope: 'scenario.data-only', snapshot: 'fresh-file-read', fullScenario: false,
      fields, limits: { maxPaths: 16, maxDepth: 12, maxValueBytes: 8192, totalValueBytes: 16384 },
      guidance: 'Projection only: missing fields are not inherited from baseData. Shape-only values are not partial Mock data. Request narrower typed paths or use focused source inspection. Reuse sourceScenarioId only after the existing workflow review and fresh semantic checks; all original Scenario configuration must be preserved.' }
  }
  const checkScenarioSemanticValues = (rules, item, sourceScenario) => {
    const applicable = rules.filter(rule => rule.apiUrl === item.apiUrl && rule.fieldAssertions.length)
    if (!applicable.length) return { status: 'matched' }
    if (!sourceScenario) return { status: 'unknown', apiUrl: item.apiUrl, scenarioId: item.sourceScenarioId }
    for (const rule of applicable) {
      if (!rule.sourceScenarioIds.includes(item.sourceScenarioId)) return { status: 'conflict', apiUrl: item.apiUrl, scenarioId: item.sourceScenarioId, ruleId: rule.id }
      for (const assertion of rule.fieldAssertions) {
        let value = sourceScenario.data
        let present = true
        for (const part of assertion.path) {
          if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) { present = false; break }
          value = value[part]
        }
        if (!present || (value !== null && !['string', 'number', 'boolean'].includes(typeof value))) {
          return { status: 'unknown', apiUrl: item.apiUrl, scenarioId: item.sourceScenarioId, ruleId: rule.id, path: assertion.path }
        }
        if (value !== assertion.equals) return { status: 'conflict', apiUrl: item.apiUrl, scenarioId: item.sourceScenarioId, ruleId: rule.id, path: assertion.path }
      }
    }
    return { status: 'matched' }
  }
  const checkFreshSemanticSources = async (rules, scenarios) => {
    for (const item of scenarios) {
      if (!item?.sourceScenarioId) continue
      const applicable = rules.filter(rule => rule.apiUrl === item.apiUrl && rule.fieldAssertions.length)
      if (!applicable.length) continue
      if (!safeRoute(item.apiUrl) || !safeText(item.sourceScenarioId, 128)) return { status: 'unknown', apiUrl: item.apiUrl, scenarioId: item.sourceScenarioId }
      const existing = await readFresh(apiMockRelative(item.apiUrl))
      const sourceScenario = existing && scenarioArray(existing.config).find(value => value.id === item.sourceScenarioId)
      const result = checkScenarioSemanticValues(rules, item, sourceScenario)
      if (result.status !== 'matched') return result
    }
    return { status: 'matched' }
  }
  return {
    read, readFresh, inspectScenario, validSemanticExpectations, checkScenarioSemanticValues, checkFreshSemanticSources,
    stats, schedulePersistence, get cacheEntries() { return fileCache.size },
    close: async () => {
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = undefined }
      await persist()
    }
  }
}
