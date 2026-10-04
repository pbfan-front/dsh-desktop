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
        const statusResponse = await fetch(`${value.origin}/__desktop/code-intell/status`, { headers: { Authorization: `Bearer ${value.token}` } })
        const codeIntell = statusResponse.ok ? await statusResponse.json() : { state: 'unavailable', fresh: false, error: `HTTP ${statusResponse.status}` }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ url: previewUrl.href, codeIntell }))
      } catch (error) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    }
  }), 'dsh-desktop-business: preview discovery route')
  const specs = [
    ['business_start_scenario_workflow', 'Default stateful entry for creating a business Mock scenario. Target priority is explicit routePath, explicit targetPage, a uniquely recognized page in the business intent, then the current preview page. The current page is only a fallback and must not override a cross-page request. It performs evidence analysis and pauses before any write. Return the run ID, resolved target and analysis to the user, prepare a reviewed plan, then call business_resume_scenario_workflow.', '/__desktop/workflow/start-scenario', {
      routePath: { type: 'string', description: 'Optional exact target business hash route beginning with /. Omit when the intent or current preview should resolve it.' },
      targetPage: { type: 'string', description: 'Optional target business page name or route hint. This takes priority over the current preview page.' },
      query: { type: 'string', required: true, description: 'Business scenario intent used for evidence analysis.' },
      apiUrlsJson: { type: 'string', description: 'Optional JSON array of exact API URLs already supported by source evidence.' }
    }, args => ({ ...(args.routePath ? { routePath: args.routePath } : {}), ...(args.targetPage ? { targetPage: args.targetPage } : {}), query: args.query, apiUrls: args.apiUrlsJson ? JSON.parse(args.apiUrlsJson) : [] })],
    ['business_resume_scenario_workflow', 'Resume a paused stateful scenario workflow. At confirm-plan pass checkpointJson with profileId, label, page and scenarios. At wait-for-preview call only after the page settles and pass route, containsText and absentText. The workflow preserves its timeline and deterministic gates.', '/__desktop/workflow/resume', {
      runId: { type: 'string', required: true, description: 'Workflow run ID.' },
      checkpointJson: { type: 'string', required: true, description: 'JSON object for the current checkpoint.' }
    }, args => ({ runId: args.runId, checkpointOutput: JSON.parse(args.checkpointJson) })],
    ['business_scenario_workflow_status', 'Read one stateful scenario workflow timeline, including current checkpoint, completed steps and structured failure.', '/__desktop/workflow/get', {
      runId: { type: 'string', required: true, description: 'Workflow run ID.' }
    }, args => ({ runId: args.runId })],
    ['business_retry_scenario_workflow', 'Retry only the current retryable failed step of a stateful scenario workflow; completed analysis and writes are not replayed.', '/__desktop/workflow/retry', {
      runId: { type: 'string', required: true, description: 'Workflow run ID.' }
    }, args => ({ runId: args.runId })],
    ['business_cancel_scenario_workflow', 'Cancel a paused or failed stateful scenario workflow. This does not roll back an already-created Profile; use business_rollback with its operationId when rollback is required.', '/__desktop/workflow/cancel', {
      runId: { type: 'string', required: true, description: 'Workflow run ID.' }
    }, args => ({ runId: args.runId })],
    ['business_context', 'Get the packaged business project, read-only source workspace, writable user Mock root, version, CodeIntell health and current preview state.', '/__desktop/context', {}, args => args],
    ['business_code_intell_status', 'Inspect CodeIntell index version, freshness, compatibility, coverage and the latest load error. Check this when source evidence is missing or scenario analysis fails.', '/__desktop/code-intell/status', {}, args => args],
    ['business_analysis_mode', 'Read the current Mock scenario analysis mode. strict is the default and performs the normal evidence-first workflow. assisted may use same-build cache and real requests only to rank candidates; it still revalidates current CodeIntell/source and keeps every create/verify guard.', '/__desktop/analysis-mode', {}, args => args],
    ['business_set_analysis_mode', 'Switch Mock scenario analysis between strict and assisted. Use strict to restore the original default behavior immediately. assisted accelerates candidate location but never treats cache or request history as proof.', '/__desktop/analysis-mode/set', {
      mode: { type: 'string', required: true, enum: ['strict', 'assisted'], description: 'strict restores the default full-evidence workflow; assisted enables verified candidate acceleration.' }
    }, args => ({ mode: args.mode })],
    ['business_clear_analysis_cache', 'Clear all optional Mock analysis candidate cache entries. This does not change Profiles, Mock data, conversations, CodeIntell artifacts or the selected analysis mode.', '/__desktop/analysis-cache/clear', {}, args => args],
    ['business_workflow_mode', 'Read whether scenario creation uses the default stateful workflow or the reversible legacy tool chain. This setting does not modify Profiles, scenarios or workflow history.', '/__desktop/workflow-mode', {}, args => args],
    ['business_set_workflow_mode', 'Switch scenario creation between workflow (default, recommended) and legacy compatibility mode. Use legacy only for controlled fallback; verification requirements remain unchanged.', '/__desktop/workflow-mode/set', {
      mode: { type: 'string', required: true, enum: ['workflow', 'legacy'], description: 'workflow restores the default orchestrated path; legacy temporarily enables direct scenario tools.' }
    }, args => ({ mode: args.mode })],
    ['business_user_data_status', 'Inspect the user Mock schema version, latest startup migration, compatibility conflicts, rollback operation and persistence location before applying or moving scenarios.', '/__desktop/user-data/status', {}, args => args],
    ['business_export_scenarios', 'Export every user-owned Profile and Scenario as a versioned, portable JSON package. The package contains Mock data only, never credentials, sessions or source files.', '/__desktop/user-data/export', {}, args => args],
    ['business_import_scenarios', 'Import a versioned user Mock JSON package for this exact business project. Existing Profile IDs are rejected unless replaceExisting is true. The import is atomic, validates all bindings and returns an operationId for rollback.', '/__desktop/user-data/import', {
      packageJson: { type: 'string', required: true, description: 'Exact JSON object returned by business_export_scenarios.' },
      replaceExisting: { type: 'boolean', description: 'Replace user Profiles with matching IDs. Defaults to false.' }
    }, args => ({ package: JSON.parse(args.packageJson), replaceExisting: args.replaceExisting === true })],
    ['business_analyze_target', 'Legacy compatibility preflight, disabled while the default workflow mode is active. Prefer business_start_scenario_workflow; enable legacy mode explicitly only for controlled recovery. When enabled, call this before business_create_profile and before open-ended repository grep. In strict mode it follows the original full-evidence workflow. In assisted mode same-build cache and this session\'s real requests only rank candidates; the tool still reads current CodeIntell/source, rejects unsupported API URLs, rechecks Mock/Rsp evidence and returns acceleration.sourceRevalidated=true. If hints are absent, stale or conflicting it falls back automatically. If it returns E_API_ROUTE_EVIDENCE_GAP, stop: do not inspect generated CodeIntell files, retry URL spelling variants, or call business_create_profile with that API. Explain the dynamic/untrackable evidence gap and offer a reviewed business-source Mock change or a separate CodeIntell enhancement. Preserve a successful evidenceId for creation.', '/__desktop/analyze-target', {
      routePath: { type: 'string', required: true, description: 'Exact business hash route, for example /repay/receiptList.' },
      query: { type: 'string', required: true, description: 'Business scenario keywords used to rank APIs and existing scenarios.' },
      apiUrlsJson: { type: 'string', description: 'Optional JSON string array of exact API URLs already found in source evidence.' }
    }, args => ({ routePath: args.routePath, query: args.query, apiUrls: args.apiUrlsJson ? JSON.parse(args.apiUrlsJson) : [] })],
    ['business_list_profiles', 'List packaged and user-created business Mock Profiles and their API bindings. Use exact IDs when applying a scenario.', '/__desktop/profiles', {}, args => args],
    ['business_preview_evidence', 'Read up to 100 recent Mock requests from the preview, including the actually matched Profile and scenario IDs. Use this after applying a Profile; request evidence still does not prove the final rendered UI state.', '/__desktop/evidence', {}, args => args],
    ['business_scenario_result', 'Explain the current scenario as four separate stages: created, applied, real API/Scenario hit, and page verification. Includes CodeIntell creation evidence when available, API bindings and field drivers, real requests, route/UI checks, and a precise failure category. Use this instead of describing a created or applied Profile as successfully verified.', '/__desktop/result', {}, args => args],
    ['business_verify_preview', 'Legacy compatibility verification, disabled while the default workflow mode is active. Prefer the workflow verification step; enable legacy mode explicitly only for controlled recovery. It verifies the current Profile, actual API scenario hits, current iframe observation, route and visible-text assertions. A 422 response or null pageObservation means the rendered result is NOT verified.', '/__desktop/verify', {
      route: { type: 'string', required: true, description: 'Expected hash route fragment such as /credit/productCombine.' },
      containsTextJson: { type: 'string', required: true, description: 'JSON string array of business text that must be visible.' },
      absentTextJson: { type: 'string', required: true, description: 'JSON string array of business text that must not be visible; use [] when none.' }
    }, args => ({ route: args.route, containsText: JSON.parse(args.containsTextJson), absentText: JSON.parse(args.absentTextJson) })],
    ['business_apply_profile', 'Legacy compatibility apply, disabled while the default workflow mode is active. Prefer the workflow apply step; enable legacy mode explicitly only for controlled recovery. This only reloads the persistent sidebar preview, so it never proves business success.', '/__desktop/apply', { profileId: { type: 'string', required: true, description: 'Exact profile ID returned by business_list_profiles.' } }, args => args],
    ['business_create_profile', 'Legacy compatibility write, disabled while the default workflow mode is active. Prefer the reviewed workflow checkpoint; enable legacy mode explicitly only for controlled recovery. It creates or replaces one user-owned Mock Profile with 1-12 evidence-validated API scenarios and returns an operationId for rollback.', '/__desktop/create-profile', {
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
        const writes = new Set(['/__desktop/open-preview', '/__desktop/analyze-target', '/__desktop/analysis-mode/set', '/__desktop/analysis-cache/clear', '/__desktop/workflow-mode/set', '/__desktop/apply', '/__desktop/verify', '/__desktop/create-profile', '/__desktop/rollback', '/__desktop/user-data/import', '/__desktop/workflow/start-scenario', '/__desktop/workflow/resume', '/__desktop/workflow/get', '/__desktop/workflow/retry', '/__desktop/workflow/cancel'])
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
