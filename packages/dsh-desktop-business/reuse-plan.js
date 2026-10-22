import { createHash } from 'node:crypto'

function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error(`${label} has unsupported fields; use the full plan format for custom IDs or data.`)
  }
  return value
}

function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is invalid.`)
  return value
}

function items(value, max, label, min = 1) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label} must contain ${min}-${max} items.`)
  return value
}

function route(value, label) {
  const result = text(value, 500, label)
  if (!result.startsWith('/') || result.startsWith('//')) throw new Error(`${label} must be an absolute business path.`)
  return result
}

function assertions(value, label, min) {
  return items(value, 20, label, min).map(item => text(item, 200, label))
}

/**
 * Expand an explicitly reviewed source-reuse shorthand into the ORIGINAL full
 * plan request. This is deterministic serialization, not source selection,
 * approval, fresh evidence or an alternative workflow validator. The Main and
 * Runtime gates must still validate the resulting plan and current sources.
 *
 * Legacy full plans pass through unchanged. Shorthand without its explicit
 * discriminator is rejected with recovery guidance, never auto-detected.
 * The opt-in format accepts no data,
 * custom IDs or unknown fields, so unsupported intent cannot be silently lost.
 * @param {string} planJson - Full plan JSON or format=source-reuse-v1.
 * @returns {unknown} Parsed legacy plan or fully expanded source-only plan.
 */
export function parseProposedBusinessPlan(planJson) {
  const input = JSON.parse(planJson)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  if (!Object.hasOwn(input, 'format')) {
    if (!Object.hasOwn(input, 'scenarios') && (Object.hasOwn(input, 'reuse') || Object.hasOwn(input, 'checks'))) {
      throw Object.assign(new Error('E_PLAN_FORMAT_REQUIRED: Add the literal top-level field "format":"source-reuse-v1" only if you intend source-only reuse. Preserve the reviewed bindings and every page check. Otherwise send the original full plan with scenarios. No proposal request was sent or approved.'), { code: 'E_PLAN_FORMAT_REQUIRED' })
    }
    return input
  }
  if (input.format !== 'source-reuse-v1') throw new Error('Unsupported plan format; use a full plan or source-reuse-v1.')
  if (planJson.length > 131072) throw new Error('Source reuse plan exceeds the proposal size budget.')
  record(input, ['format', 'profileId', 'label', 'page', 'reuse', 'checks'], 'Source reuse plan')
  const profileId = text(input.profileId, 128, 'profileId')
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(profileId)) throw new Error('profileId is unsafe.')
  const label = text(input.label, 200, 'label')
  const page = text(input.page, 64, 'page')
  const apiUrls = new Set()
  const scenarios = items(input.reuse, 12, 'reuse').map(value => {
    const binding = record(value, ['apiUrl', 'sourceScenarioId', 'label'], 'Reuse binding')
    const apiUrl = route(binding.apiUrl, 'apiUrl')
    const sourceScenarioId = text(binding.sourceScenarioId, 128, 'sourceScenarioId')
    if (apiUrls.has(apiUrl)) throw new Error('Reuse bindings must have unique API URLs.')
    apiUrls.add(apiUrl)
    // Stable across reorder/retry and short enough even for max-length Profile
    // IDs. Hash the exact tuple: never normalize a source or pick a candidate.
    const id = `reuse_${createHash('sha256').update(JSON.stringify([profileId, apiUrl, sourceScenarioId])).digest('hex').slice(0, 32)}`
    return { id, apiUrl, sourceScenarioId,
      label: binding.label === undefined ? sourceScenarioId : text(binding.label, 200, 'Scenario label') }
  })
  const verificationSteps = items(input.checks, 5, 'checks').map((value, index) => {
    const check = record(value, ['route', 'label', 'containsText', 'absentText', 'apiUrls'], 'Page check')
    const path = route(check.route, 'Page check route')
    const checkedApis = check.apiUrls === undefined ? undefined
      : items(check.apiUrls, 12, 'Page check apiUrls').map(value => text(value, 500, 'Page check API'))
    if (checkedApis?.some(api => !apiUrls.has(api))) throw new Error('Page check APIs must be declared in reuse bindings.')
    return { id: `check_${index + 1}`, label: text(check.label === undefined ? path : check.label, 200,
      'Page check label (provide one for routes longer than 200 characters)'),
      route: path, containsText: assertions(check.containsText, 'containsText', 1),
      absentText: assertions(check.absentText, 'absentText', 0),
      ...(checkedApis === undefined ? {} : { apiUrls: checkedApis }) }
  })
  return { profileId, label, page, scenarios, verificationSteps }
}
