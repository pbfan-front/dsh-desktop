import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { validSemanticExpectations } from './business-control-contract.mjs'

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
      return { file, config: cached.config }
    }
    if (cached) stats.invalidations += 1
    const config = JSON.parse(await readFile(file, 'utf8'))
    stats.misses += 1
    fileCache.set(file, { fingerprint, config, restored: false })
    dirty = true
    while (fileCache.size > 500) fileCache.delete(fileCache.keys().next().value)
    return { file, config }
  }
  const read = async relativePath => {
    for (const file of [join(userRoot, relativePath), join(source, relativePath)]) {
      const result = await readCachedFile(file)
      if (result) return result
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
    read, readFresh, validSemanticExpectations, checkScenarioSemanticValues, checkFreshSemanticSources,
    stats, schedulePersistence, get cacheEntries() { return fileCache.size },
    close: async () => {
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = undefined }
      await persist()
    }
  }
}
