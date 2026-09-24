import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-desktop-business'
export const inject = ['tools', 'workspaceRegistry', 'webServer']

export async function apply(ctx) {
  const descriptor = process.env.DSH_BUSINESS_CONNECTION_FILE
  if (!descriptor) return
  async function connection() {
    const value = JSON.parse(await readFile(descriptor, 'utf8'))
    if (new URL(value.origin).hostname !== '127.0.0.1' || !value.token) throw new Error('Invalid desktop business connection')
    return value
  }
  async function registerWorkspace(value) {
    if (!await ctx.workspaceRegistry.resolveByPath(value.sourceRoot)) {
      await ctx.workspaceRegistry.create(value.sourceRoot, `${value.projectId} · ${value.buildId}`)
    }
  }
  // Absence/failure of the optional business service must not break Harness startup.
  try { await registerWorkspace(await connection()) } catch (error) { ctx.logger.warn(`Business workspace not ready: ${error.message}`) }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-desktop/business-preview',
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' })
        res.end()
        return
      }
      try {
        const value = await connection()
        const requestUrl = new URL(req.url, 'http://127.0.0.1')
        const sessionId = requestUrl.searchParams.get('sessionId') || ''
        const previewUrl = new URL(`${value.origin}/?desktop=1&embedded=1`)
        if (sessionId) previewUrl.searchParams.set('__dshSession', sessionId)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ url: previewUrl.href }))
      } catch (error) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    }
  }), 'dsh-desktop-business: preview discovery route')
  const specs = [
    ['business_context', 'Get the packaged business project, read-only source workspace, writable user Mock root, version and current preview state.', '/__desktop/context', {}, args => args],
    ['business_analyze_target', 'Required read-only preflight before business_create_profile. Resolve an exact business route through CodeIntell, return page/source evidence, candidate APIs, response envelope fields, business fields and existing Scenario IDs. Use apiUrlsJson only to validate API URLs already supported by source evidence; do not guess them. Preserve the returned evidenceId for creation.', '/__desktop/analyze-target', {
      routePath: { type: 'string', required: true, description: 'Exact business hash route, for example /repay/receiptList.' },
      query: { type: 'string', required: true, description: 'Business scenario keywords used to rank APIs and existing scenarios.' },
      apiUrlsJson: { type: 'string', description: 'Optional JSON string array of exact API URLs already found in source evidence.' }
    }, args => ({ routePath: args.routePath, query: args.query, apiUrls: args.apiUrlsJson ? JSON.parse(args.apiUrlsJson) : [] })],
    ['business_list_profiles', 'List packaged and user-created business Mock Profiles and their API bindings. Use exact IDs when applying a scenario.', '/__desktop/profiles', {}, args => args],
    ['business_preview_evidence', 'Read up to 100 recent Mock requests from the preview, including the actually matched Profile and scenario IDs. Use this after applying a Profile; request evidence still does not prove the final rendered UI state.', '/__desktop/evidence', {}, args => args],
    ['business_verify_preview', 'Verify the current preview using current Profile, actual API scenario hits, current iframe observation, route and visible-text assertions. Call only after opening the preview and letting the page settle. A 422 response or null pageObservation means the rendered result is NOT verified; never describe it as normal or successful.', '/__desktop/verify', {
      route: { type: 'string', required: true, description: 'Expected hash route fragment such as /credit/productCombine.' },
      containsTextJson: { type: 'string', required: true, description: 'JSON string array of business text that must be visible.' },
      absentTextJson: { type: 'string', required: true, description: 'JSON string array of business text that must not be visible; use [] when none.' }
    }, args => ({ route: args.route, containsText: JSON.parse(args.containsTextJson), absentText: JSON.parse(args.absentTextJson) })],
    ['business_apply_profile', 'Apply an existing Mock Profile to the persistent sidebar preview without opening a separate window. This only issues a reload command. After the page settles, call business_verify_preview; do not claim success from this result or API evidence alone.', '/__desktop/apply', { profileId: { type: 'string', required: true, description: 'Exact profile ID returned by business_list_profiles.' } }, args => args],
    ['business_create_profile', 'Create or replace one user-owned Mock Profile with 1-12 validated API scenarios. Analyze CodeIntell/source and every target mock.json first; only existing API mocks are accepted. Pass one scenario per API as {id,apiUrl,label?,data}. The service restores missing top-level response-envelope fields, rejects duplicated data envelopes and duplicate API bindings, validates the resulting Profile, and rolls back every file on failure. Returns an operationId for rollback.', '/__desktop/create-profile', {
      profileId: { type: 'string', required: true, description: 'Stable ID beginning with a letter; letters, digits, underscore and dash only.' },
      evidenceId: { type: 'string', required: true, description: 'Unexpired evidenceId returned by business_analyze_target for this exact route and API set.' },
      label: { type: 'string', required: true, description: 'Business-readable scenario label.' },
      routePath: { type: 'string', required: true, description: 'Business hash route beginning with /.' },
      page: { type: 'string', required: true, description: 'Page grouping key.' },
      scenariosJson: { type: 'string', required: true, description: 'JSON array with one item per existing API: ASCII id, exact apiUrl, optional label, and an object data patch matching that API response payload.' }
    }, args => ({ evidenceId: args.evidenceId, profile: { id: args.profileId, label: args.label, branchLabel: args.label, routePath: args.routePath, page: args.page }, scenarios: JSON.parse(args.scenariosJson) })],
    ['business_rollback', 'Rollback a user Mock mutation using the exact operationId returned by business_create_profile.', '/__desktop/rollback', {
      operationId: { type: 'string', required: true, description: 'Mutation operation UUID.' }
    }, args => args]
  ]
  for (const [name, description, route, parameters, body] of specs) {
    ctx.tools.register(defineTool({ name, description, parameters,
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      async execute(args, exec) {
        const value = await connection()
        await registerWorkspace(value)
        const writes = new Set(['/__desktop/open-preview', '/__desktop/analyze-target', '/__desktop/apply', '/__desktop/verify', '/__desktop/create-profile', '/__desktop/rollback'])
        const response = await fetch(`${value.origin}${route}`, {
          method: writes.has(route) ? 'POST' : 'GET',
          headers: { Authorization: `Bearer ${value.token}`, 'Content-Type': 'application/json',
            ...(exec.agent?.id ? { 'X-DSH-Session': exec.agent.id } : {}) },
          body: writes.has(route) ? JSON.stringify(body(args)) : undefined,
          signal: exec.signal
        })
        const text = await response.text()
        if (!response.ok) throw new Error(`Business service ${response.status}: ${text}`)
        return text
      }
    }))
  }
}
