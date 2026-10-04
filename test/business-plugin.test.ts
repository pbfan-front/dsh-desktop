import { describe, it, expect } from 'vitest'
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
    } finally {
      if (old === undefined) delete process.env.DSH_BUSINESS_CONNECTION_FILE
      else process.env.DSH_BUSINESS_CONNECTION_FILE = old
      await rm(directory, { recursive: true, force: true })
    }
  })
})
