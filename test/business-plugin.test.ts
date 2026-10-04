import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('business Harness plugin', () => {
  it('registers the real Harness tool schema and one managed workspace without a second runtime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'business-plugin-'))
    const old = process.env.DSH_BUSINESS_CONNECTION_FILE
    const definitions: any[] = []
    const workspaces: any[] = []
    const routes: any[] = []
    try {
      process.env.DSH_BUSINESS_CONNECTION_FILE = join(directory, 'connection.json')
      await writeFile(process.env.DSH_BUSINESS_CONNECTION_FILE, JSON.stringify({ origin: 'http://127.0.0.1:12345', token: 'test-token', sourceRoot: directory, projectId: 'demo', buildId: 'v1' }))
      // Import the actual plugin and upstream defineTool, not a schema stub.
      const { apply } = await import('../packages/dsh-desktop-business/index.js')
      await apply({ tools: { register: (tool: any) => definitions.push(tool) }, workspaceRegistry: {
        resolveByPath: async () => undefined,
        create: async (...args: any[]) => { workspaces.push(args) }
      }, webServer: { register: (route: any) => { routes.push(route); return () => undefined } },
      effect: (effect: () => unknown) => effect(), logger: { warn: () => {} } })
      expect(workspaces).toEqual([[directory, 'demo · v1']])
      expect(routes).toHaveLength(1)
      expect(routes[0]).toMatchObject({ kind: 'exact', path: '/api/dsh-desktop/business-preview' })
      expect(definitions.map(tool => tool.name)).toEqual([
        'business_start_scenario_workflow', 'business_resume_scenario_workflow', 'business_scenario_workflow_status',
        'business_retry_scenario_workflow', 'business_cancel_scenario_workflow',
        'business_context', 'business_code_intell_status', 'business_analysis_mode', 'business_set_analysis_mode', 'business_clear_analysis_cache',
        'business_workflow_mode', 'business_set_workflow_mode',
        'business_user_data_status', 'business_export_scenarios', 'business_import_scenarios',
        'business_analyze_target', 'business_list_profiles', 'business_preview_evidence', 'business_scenario_result', 'business_verify_preview',
        'business_apply_profile', 'business_create_profile', 'business_rollback'
      ])
      expect(definitions.every(tool => typeof tool.execute === 'function')).toBe(true)
      const importTool = definitions.find(tool => tool.name === 'business_import_scenarios')
      expect(importTool.parameters).toMatchObject({
        type: 'object',
        properties: {
          packageJson: { type: 'string' },
          replaceExisting: { type: 'boolean' },
        },
        required: ['packageJson'],
      })
      const statusTool = definitions.find(tool => tool.name === 'business_scenario_workflow_status')
      expect(statusTool.parameters).toMatchObject({
        type: 'object',
        properties: {
          runId: { type: 'string' },
          detail: { type: 'string', enum: ['summary', 'full'] },
        },
        required: ['runId'],
      })
      const analysis = {
        apis: Array.from({ length: 8 }, (_, index) => ({
          apiUrl: `/api/${index}.json`,
          evidence: Array.from({ length: 7 }, (_value, evidenceIndex) => `evidence-${index}-${evidenceIndex}`),
          fields: Array.from({ length: 50 }, (_value, fieldIndex) => `field-${fieldIndex}`),
          scenarios: Array.from({ length: 10 }, (_value, scenarioIndex) => ({ id: `scenario-${index}-${scenarioIndex}` })),
        })),
        analysisPlan: {
          focusApiUrls: ['/api/4.json'],
          existingScenarioMatches: [{ apiUrl: '/api/7.json', scenarioId: 'scenario-7-9' }],
          suggestedPlan: { scenarios: [{ apiUrl: '/api/7.json', sourceScenarioId: 'scenario-7-9' }] },
        },
      }
      const workflowRun = { id: 'run-1', context: { analysis }, steps: [{ id: 'analyze-target', output: analysis }] }
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(workflowRun)))
      const summary = JSON.parse(await statusTool.execute({ runId: 'run-1' }, { signal: undefined, agent: { id: 'agent-1' } }))
      const full = JSON.parse(await statusTool.execute({ runId: 'run-1', detail: 'full' }, { signal: undefined, agent: { id: 'agent-1' } }))
      expect(summary.context.analysis.apis.map((api: any) => api.apiUrl)).toEqual(['/api/7.json', '/api/4.json'])
      expect(summary.context.analysis.apis[0].scenarios[0].id).toBe('scenario-7-9')
      expect(summary.context.analysis.apis[0].evidence).toHaveLength(4)
      expect(summary.context.analysis.apis[0].fields).toHaveLength(40)
      expect(summary.context.analysis.compaction.omittedApiCount).toBe(6)
      expect(full.context.analysis.apis).toHaveLength(8)
      expect(workflowRun.context.analysis.apis).toHaveLength(8)
      expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({ runId: 'run-1' })
      expect(JSON.parse(fetchMock.mock.calls[1]![1]?.body as string)).toEqual({ runId: 'run-1' })
      fetchMock.mockRestore()
    } finally {
      if (old === undefined) delete process.env.DSH_BUSINESS_CONNECTION_FILE
      else process.env.DSH_BUSINESS_CONNECTION_FILE = old
      await rm(directory, { recursive: true, force: true })
    }
  })
})
