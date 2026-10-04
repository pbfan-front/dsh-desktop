export const BUSINESS_PLUGIN_TYPE = 'dsh-business-plugin' as const

export const businessPluginCapabilities = [
  'business-preview',
  'mock-runtime',
  'code-intell',
  'scenario-editor'
] as const

export type BusinessPluginCapability = (typeof businessPluginCapabilities)[number]

export interface BusinessPluginIdentity {
  pluginId: string
  projectId: string
  displayName: string
  capabilities: BusinessPluginCapability[]
}

export interface BusinessPluginWorkflowDeclaration {
  id: string
  version: string
  title: string
  inputSchema: Record<string, unknown>
  compatibleRunVersions?: string[]
  steps: Array<{
    id: string
    type: 'deterministic' | 'agent' | 'checkpoint'
    title: string
    handler?: string
    gate?: string
  }>
}

export interface BusinessPluginTargetAlias {
  routePath: string
  aliases: string[]
}

const capabilitySet = new Set<string>(businessPluginCapabilities)
const safeId = /^[a-z0-9][a-z0-9._-]{1,127}$/
const workflowStepTypes = new Set(['deterministic', 'agent', 'checkpoint'])
const workflowHandlers = new Set([
  'business.analyze-target',
  'business.create-profile',
  'business.apply-profile',
  'business.verify-preview'
])
const workflowGates = new Set(['business.preview-verification'])

export function parseBusinessPluginIdentity(manifest: Record<string, unknown>): BusinessPluginIdentity {
  if (manifest.type !== BUSINESS_PLUGIN_TYPE) throw new Error(`Unsupported business plugin type: ${String(manifest.type)}`)
  if (typeof manifest.pluginId !== 'string' || !safeId.test(manifest.pluginId)) {
    throw new Error('Business plugin pluginId is missing or unsafe.')
  }
  if (typeof manifest.projectId !== 'string' || !safeId.test(manifest.projectId)) {
    throw new Error('Business plugin projectId is missing or unsafe.')
  }
  if (typeof manifest.displayName !== 'string' || manifest.displayName.trim().length === 0) {
    throw new Error('Business plugin displayName is missing.')
  }
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    throw new Error('Business plugin capabilities are missing.')
  }
  const capabilities = [...new Set(manifest.capabilities)]
  if (capabilities.some((value) => typeof value !== 'string' || !capabilitySet.has(value))) {
    throw new Error('Business plugin requests an unsupported capability.')
  }
  for (const required of ['business-preview', 'mock-runtime', 'code-intell'] as const) {
    if (!capabilities.includes(required)) throw new Error(`Business plugin requires capability: ${required}`)
  }
  return {
    pluginId: manifest.pluginId,
    projectId: manifest.projectId,
    displayName: manifest.displayName.trim(),
    capabilities: capabilities as BusinessPluginCapability[]
  }
}

export function parseBusinessPluginWorkflows(manifest: Record<string, unknown>): BusinessPluginWorkflowDeclaration[] {
  if (manifest.workflows === undefined) return []
  if (!Array.isArray(manifest.workflows) || manifest.workflows.length > 16) {
    throw new Error('Business plugin workflows must be an array of at most 16 declarations.')
  }
  const ids = new Set<string>()
  return manifest.workflows.map((value) => {
    const workflow = object(value, 'Business plugin workflow must be an object.')
    const id = safeText(workflow.id, 'Business plugin workflow id is missing.', 128)
    if (!safeId.test(id) || ids.has(id)) throw new Error(`Business plugin workflow id is unsafe or duplicated: ${id}`)
    ids.add(id)
    const steps = workflow.steps
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 32) {
      throw new Error(`Business plugin workflow ${id} must declare 1-32 steps.`)
    }
    const stepIds = new Set<string>()
    const parsedSteps = steps.map((stepValue) => {
      const step = object(stepValue, `Workflow ${id} step must be an object.`)
      const stepId = safeText(step.id, `Workflow ${id} step id is missing.`, 128)
      if (!safeId.test(stepId) || stepIds.has(stepId)) throw new Error(`Workflow ${id} step id is unsafe or duplicated: ${stepId}`)
      stepIds.add(stepId)
      if (typeof step.type !== 'string' || !workflowStepTypes.has(step.type)) throw new Error(`Workflow ${id} step ${stepId} has unsupported type.`)
      const handler = step.handler === undefined ? undefined : safeText(step.handler, `Workflow ${id} step ${stepId} handler is invalid.`, 128)
      const gate = step.gate === undefined ? undefined : safeText(step.gate, `Workflow ${id} step ${stepId} gate is invalid.`, 128)
      if (step.type === 'checkpoint' && handler) throw new Error(`Workflow ${id} checkpoint ${stepId} cannot declare a handler.`)
      if (step.type === 'checkpoint' && gate) throw new Error(`Workflow ${id} checkpoint ${stepId} cannot declare a gate.`)
      if (step.type !== 'checkpoint' && (!handler || !workflowHandlers.has(handler))) {
        throw new Error(`Workflow ${id} step ${stepId} requests an unsupported handler.`)
      }
      if (gate && !workflowGates.has(gate)) throw new Error(`Workflow ${id} step ${stepId} requests an unsupported gate.`)
      return { id: stepId, type: step.type as 'deterministic' | 'agent' | 'checkpoint', title: safeText(step.title, `Workflow ${id} step ${stepId} title is missing.`, 200), ...(handler ? { handler } : {}), ...(gate ? { gate } : {}) }
    })
    const inputSchema = object(workflow.inputSchema, `Workflow ${id} inputSchema must be an object.`)
    if (inputSchema.type !== 'object') throw new Error(`Workflow ${id} inputSchema type must be object.`)
    const compatibleRunVersions = workflow.compatibleRunVersions === undefined
      ? undefined
      : stringList(workflow.compatibleRunVersions, `Workflow ${id} compatibleRunVersions`, 16, 64)
    if (compatibleRunVersions?.includes(safeText(workflow.version, `Workflow ${id} version is missing.`, 64))) {
      throw new Error(`Workflow ${id} compatibleRunVersions must not repeat the current version.`)
    }
    return {
      id,
      version: safeText(workflow.version, `Workflow ${id} version is missing.`, 64),
      title: safeText(workflow.title, `Workflow ${id} title is missing.`, 200),
      inputSchema,
      ...(compatibleRunVersions ? { compatibleRunVersions } : {}),
      steps: parsedSteps
    }
  })
}

export function parseBusinessPluginTargetAliases(manifest: Record<string, unknown>): BusinessPluginTargetAlias[] {
  if (manifest.targetAliases === undefined) return []
  if (!Array.isArray(manifest.targetAliases) || manifest.targetAliases.length > 256) {
    throw new Error('Business plugin targetAliases must be an array of at most 256 route declarations.')
  }
  const routes = new Set<string>()
  return manifest.targetAliases.map((value) => {
    const declaration = object(value, 'Business plugin target alias must be an object.')
    const routePath = safeText(declaration.routePath, 'Business plugin target alias routePath is missing.', 500)
    if (!routePath.startsWith('/') || routePath.startsWith('//') || routes.has(routePath)) {
      throw new Error(`Business plugin target alias routePath is unsafe or duplicated: ${routePath}`)
    }
    routes.add(routePath)
    const aliases = stringList(declaration.aliases, `Business plugin target aliases for ${routePath}`, 32, 200)
      .map(alias => alias.trim())
    if (aliases.length === 0) throw new Error(`Business plugin target aliases for ${routePath} cannot be empty.`)
    return { routePath, aliases }
  })
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function safeText(value: unknown, message: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(message)
  return value.trim()
}

function stringList(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || !item || item.length > maxLength)) {
    throw new Error(`${label} must be an array of at most ${maxItems} strings.`)
  }
  return [...new Set(value)]
}
