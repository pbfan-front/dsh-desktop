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
    const listeners = new Map<string, (...args: any[]) => void>()
    try {
      process.env.DSH_BUSINESS_CONNECTION_FILE = join(directory, 'connection.json')
      await writeFile(process.env.DSH_BUSINESS_CONNECTION_FILE, JSON.stringify({ origin: 'http://127.0.0.1:12345', token: 'test-token', sourceRoot: directory, projectId: 'demo', buildId: 'v1' }))
      // Import the actual plugin and upstream defineTool, not a schema stub.
      const { apply } = await import('../packages/dsh-desktop-business/index.js')
      await apply({ tools: { register: (tool: any) => definitions.push(tool) }, workspaceRegistry: {
        resolveByPath: async () => undefined,
        create: async (...args: any[]) => { workspaces.push(args) }
      }, webServer: { register: (route: any) => { routes.push(route); return () => undefined } },
      effect: (effect: () => unknown) => effect(), logger: { warn: () => {} },
      on: (event: string, listener: (...args: any[]) => void) => { listeners.set(event, listener) } })
      expect(workspaces).toEqual([[directory, 'demo · v1']])
      expect(routes).toHaveLength(1)
      expect(routes[0]).toMatchObject({ kind: 'exact', path: '/api/dsh-desktop/business-preview' })
      expect(definitions.map(tool => tool.name)).toEqual([
        'business_create_default_branch',
        'business_propose_scenario_plan',
        'business_start_scenario_workflow', 'business_resume_scenario_workflow', 'business_scenario_workflow_status',
        'business_retry_scenario_workflow', 'business_cancel_scenario_workflow',
        'business_context', 'business_code_intell_status', 'business_analysis_mode', 'business_set_analysis_mode', 'business_clear_analysis_cache',
        'business_workflow_mode', 'business_set_workflow_mode',
        'business_user_data_status', 'business_export_scenarios', 'business_import_scenarios',
        'business_analyze_target', 'business_list_profiles', 'business_inspect_source_evidence', 'business_inspect_mock_scenario', 'business_preview_evidence', 'business_preview_diagnostics', 'business_scenario_result', 'business_verify_preview',
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
      const proposalTool = definitions.find(tool => tool.name === 'business_propose_scenario_plan')
      expect(proposalTool.parameters).toMatchObject({ required: ['runId', 'planJson'], properties: { runId: { type: 'string' }, planJson: { type: 'string' } } })
      expect(proposalTool.parameters.properties.planJson.description).toContain('source-reuse-v1')
      expect(proposalTool.parameters.properties.planJson.description).toContain('"format":"source-reuse-v1"')
      expect(proposalTool.description).toContain('does not approve, create, apply, or verify')
      expect(statusTool.parameters).toMatchObject({
        type: 'object',
        properties: {
          runId: { type: 'string' },
          detail: { type: 'string', enum: ['summary', 'full'] },
          section: { type: 'string', enum: ['run', 'analysis', 'review', 'semantic', 'api', 'plan', 'reads'] },
          offset: { type: 'number' }, documentId: { type: 'string' }, apiUrl: { type: 'string' },
        },
        required: ['runId'],
      })
      const retryTool = definitions.find(tool => tool.name === 'business_retry_scenario_workflow')
      const startTool = definitions.find(tool => tool.name === 'business_start_scenario_workflow')
      const resumeTool = definitions.find(tool => tool.name === 'business_resume_scenario_workflow')
      expect(startTool.description).toContain('context.intentResolution')
      expect(startTool.parameters.properties.query.description).toContain('Never replace it with a guessed canonical label')
      expect(resumeTool.description).toContain('verificationSteps')
      expect(resumeTool.description).toContain('Partial success retains this checkpoint, not overall success')
      expect(resumeTool.description).toContain('Never weaken saved assertions')
      expect(startTool.description).toContain('before any repository search, source reading, or retry')
      expect(startTool.description).toContain('The candidates are unordered, not recommendations')
      expect(startTool.description).toContain('analysisPlan.leadingScenarioValuePreview')
      expect(startTool.description).toContain('first use business_inspect_mock_scenario')
      expect(resumeTool.description).toContain('Preserve the original full source Scenario')
      expect(retryTool.description).toContain('Do not search the repository or read source before this choice')
      expect(retryTool.parameters).toMatchObject({
        type: 'object',
        properties: {
          runId: { type: 'string' },
          selectedRoutePath: { type: 'string' },
          confirmedByUser: { type: 'boolean' }
        },
        required: ['runId']
      })
      const analysisModeTool = definitions.find(tool => tool.name === 'business_set_analysis_mode')
      expect(analysisModeTool.parameters).toMatchObject({
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['strict', 'assisted'] },
          sessionReuse: { type: 'boolean' },
          exactScenarioEquivalence: { type: 'boolean' },
        },
        required: ['mode'],
      })
      const analysis = {
        apis: Array.from({ length: 8 }, (_, index) => ({
          apiUrl: `/api/${index}.json`,
          evidence: Array.from({ length: 7 }, (_value, evidenceIndex) => `evidence-${index}-${evidenceIndex}`),
          fields: Array.from({ length: 50 }, (_value, fieldIndex) => `field-${fieldIndex}`),
          scenarios: Array.from({ length: 10 }, (_value, scenarioIndex) => ({
            id: `scenario-${index}-${scenarioIndex}`,
            changedFields: Array.from({ length: 30 }, (_item, fieldIndex) => `field-${fieldIndex}`),
            fieldImpact: {
              consumedFields: Array.from({ length: 30 }, (_item, fieldIndex) => `field-${fieldIndex}`),
              unprovenFields: Array.from({ length: 30 }, (_item, fieldIndex) => `other-${fieldIndex}`),
              evidence: Array.from({ length: 12 }, (_item, fieldIndex) => ({
                field: `field-${fieldIndex}`,
                evidence: [{ line: 1 }, { line: 2 }, { line: 3 }],
              })),
            },
          })),
        })),
        analysisPlan: {
          focusApiUrls: ['/api/4.json'],
          existingScenarioMatches: [{ apiUrl: '/api/7.json', scenarioId: 'scenario-7-9' }],
          suggestedPlan: { scenarios: [{ apiUrl: '/api/7.json', sourceScenarioId: 'scenario-7-9' }] },
        },
      }
      const workflowRun = { id: 'run-1', context: { analysis }, steps: [{ id: 'analyze-target', output: analysis }] }
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(workflowRun)))
      const inspectionTool = definitions.find(tool => tool.name === 'business_inspect_mock_scenario')
      const sourceTool = definitions.find(tool => tool.name === 'business_inspect_source_evidence')
      expect(sourceTool.parameters).toMatchObject({ required: ['evidenceId', 'identifiersJson'], properties: {
        evidenceId: { type: 'string' }, identifiersJson: { type: 'string' }
      } })
      expect(sourceTool.description).toContain('NOT data-flow proof')
      expect(startTool.description).toContain('first use business_inspect_source_evidence')
      await sourceTool.execute({ evidenceId: 'test-evidence', identifiersJson: '["statusLabel"]' },
        { signal: undefined, agent: { id: 'source-session' } })
      expect(fetchMock.mock.lastCall?.[0]).toBe('http://127.0.0.1:12345/__desktop/source/inspect-evidence')
      expect(fetchMock.mock.lastCall?.[1]).toMatchObject({ method: 'POST', headers: { 'X-DSH-Session': 'source-session' } })
      expect(JSON.parse(fetchMock.mock.lastCall?.[1]?.body as string)).toEqual({ evidenceId: 'test-evidence', identifiers: ['statusLabel'] })
      expect(inspectionTool.parameters).toMatchObject({ required: ['apiUrl', 'scenarioId'],
        properties: { apiUrl: { type: 'string' }, scenarioId: { type: 'string' }, fieldPathsJson: { type: 'string' } } })
      expect(inspectionTool.description).toContain('not creation evidence, source approval or final UI proof')
      expect(inspectionTool.description).toContain('Never send more than 16 paths')
      expect(inspectionTool.description).toContain('retry-same-source-in-batches')
      expect(inspectionTool.description).toContain('FIRST business_inspect_mock_scenario call')
      expect(proposalTool.description).toContain('neither a successful API envelope nor source inspection proves the final page')
      const inspectionArgs = { apiUrl: '/loanNbr/loanNbr.json', scenarioId: 'normal', fieldPathsJson: '[["data","list",0,"duestatus"]]' }
      const inspectionExec = { signal: undefined, agent: { id: 'inspection-session' } }
      await inspectionTool.execute(inspectionArgs, inspectionExec)
      expect(fetchMock.mock.lastCall?.[0]).toBe('http://127.0.0.1:12345/__desktop/mock/inspect-scenario')
      expect(fetchMock.mock.lastCall?.[1]).toMatchObject({ method: 'POST', headers: { 'X-DSH-Session': 'inspection-session' } })
      expect(JSON.parse(fetchMock.mock.lastCall?.[1]?.body as string)).toEqual({ apiUrl: '/loanNbr/loanNbr.json', scenarioId: 'normal', fieldPaths: [['data', 'list', 0, 'duestatus']] })
      const calls = fetchMock.mock.calls.length
      await expect(inspectionTool.execute({ ...inspectionArgs, fieldPathsJson: '{bad' }, inspectionExec)).rejects.toThrow()
      expect(fetchMock.mock.calls).toHaveLength(calls)
      fetchMock.mockClear()
      const summary = JSON.parse(await statusTool.execute({ runId: 'run-1' }, { signal: undefined, agent: { id: 'agent-1' } }))
      const full = JSON.parse(await statusTool.execute({ runId: 'run-1', detail: 'full' }, { signal: undefined, agent: { id: 'agent-1' } }))
      expect(summary.context.analysis.apis.map((api: any) => api.apiUrl)).toEqual(['/api/7.json', '/api/4.json'])
      expect(summary.context.analysis.apis[0].scenarios[0].id).toBe('scenario-7-9')
      expect(summary.context.analysis.apis[0].evidence).toHaveLength(4)
      expect(summary.context.analysis.apis[0].fields).toHaveLength(24)
      expect(summary.context.analysis.apis[0].scenarios[0].changedFields).toHaveLength(12)
      expect(summary.context.analysis.apis[0].scenarios[0].fieldImpact.evidence).toHaveLength(4)
      expect(summary.context.analysis.apis[0].scenarios[0].fieldImpact.evidence[0].evidence).toHaveLength(2)
      expect(summary.context.analysis.compaction.omittedApiCount).toBe(6)
      expect(full.evidencePage).toMatchObject({ section: 'run', offset: 0, complete: false, documentId: expect.any(String) })
      expect(summary.steps[0].outputRef).toMatchObject({ path: 'context.analysis' })
      expect(summary.steps[0].output).toBeUndefined()
      expect(workflowRun.context.analysis.apis).toHaveLength(8)
      expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({ runId: 'run-1' })
      expect(JSON.parse(fetchMock.mock.calls[1]![1]?.body as string)).toEqual({ runId: 'run-1' })
      const chunks = [full.evidencePage.content]
      let nextOffset = full.evidencePage.nextOffset
      while (nextOffset !== null) {
        const page = JSON.parse(await statusTool.execute({ runId: 'run-1', detail: 'full',
          offset: nextOffset, documentId: full.evidencePage.documentId }, { signal: undefined, agent: { id: 'agent-1' } }))
        expect(page.evidencePage.documentId).toBe(full.evidencePage.documentId)
        chunks.push(page.evidencePage.content)
        nextOffset = page.evidencePage.nextOffset
      }
      expect(JSON.parse(chunks.join(''))).toEqual(workflowRun)
      expect(JSON.parse(fetchMock.mock.lastCall![1]?.body as string)).toEqual({ runId: 'run-1' })
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ run: workflowRun })))
      const wrapped = JSON.parse(await statusTool.execute({ runId: 'run-1' }, { signal: undefined, agent: { id: 'agent-1' } }))
      expect(wrapped.run.context.analysis.apis).toHaveLength(2)
      fetchMock.mockResolvedValueOnce(new Response('invalid raw workflow text'))
      await expect(statusTool.execute({ runId: 'run-1' }, { signal: undefined, agent: { id: 'agent-1' } })).rejects.toThrow('invalid JSON; no raw response')
      await proposalTool.execute({ runId: 'run-1', planJson: '{"profileId":"reviewed_profile"}' }, { signal: undefined, agent: { id: 'agent-1' } })
      expect(fetchMock.mock.lastCall?.[0]).toBe('http://127.0.0.1:12345/__desktop/workflow/propose-plan')
      expect(JSON.parse(fetchMock.mock.lastCall![1]?.body as string)).toEqual({ runId: 'run-1', plan: { profileId: 'reviewed_profile' } })
      const reusePlan = { format: 'source-reuse-v1', profileId: 'reviewed_reuse', label: 'Reviewed source', page: 'loan',
        reuse: [{ apiUrl: '/loan/detail.json', sourceScenarioId: 'reviewed-source' }],
        checks: [{ route: '/loan/detail', containsText: ['Exact ID', 'Normal'], absentText: ['Error'] }] }
      await proposalTool.execute({ runId: 'run-1', planJson: JSON.stringify(reusePlan) }, { signal: undefined, agent: { id: 'agent-1' } })
      expect(fetchMock.mock.lastCall?.[1]).toMatchObject({ method: 'POST', headers: { 'X-DSH-Session': 'agent-1' } })
      expect(JSON.parse(fetchMock.mock.lastCall![1]?.body as string)).toEqual({ runId: 'run-1', plan: {
        profileId: reusePlan.profileId, label: reusePlan.label, page: reusePlan.page,
        scenarios: [{ id: expect.stringMatching(/^reuse_[0-9a-f]{32}$/), apiUrl: '/loan/detail.json',
          sourceScenarioId: 'reviewed-source', label: 'reviewed-source' }],
        verificationSteps: [{ id: 'check_1', label: '/loan/detail', ...reusePlan.checks[0] }]
      } })
      const beforeBadReuse = fetchMock.mock.calls.length
      const { format: _format, ...missingFormat } = reusePlan
      await expect(proposalTool.execute({ runId: 'run-1', planJson: JSON.stringify(missingFormat) },
        { signal: undefined, agent: { id: 'agent-1' } })).rejects.toThrow('E_PLAN_FORMAT_REQUIRED')
      expect(fetchMock.mock.calls).toHaveLength(beforeBadReuse)
      await expect(proposalTool.execute({ runId: 'run-1', planJson: JSON.stringify({ ...reusePlan,
        scenarios: [{ id: 'not-ignored' }] }) }, { signal: undefined, agent: { id: 'agent-1' } })).rejects.toThrow('unsupported')
      expect(fetchMock.mock.calls).toHaveLength(beforeBadReuse)
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...workflowRun,
        checkpointProposal: { id: 'proposal-1', checkpointId: 'confirm-plan', output: { profileId: 'reviewed_profile', label: 'review', scenarios: [{ data: { secretBody: 'not echoed' } }] } }
      })))
      const compactProposal = JSON.parse(await proposalTool.execute({ runId: 'run-1', planJson: '{}' }, { signal: undefined, agent: { id: 'agent-1' } }))
      expect(compactProposal.checkpointProposal).toMatchObject({ approval: 'explicit-user-action-required', planSummary: { profileId: 'reviewed_profile', scenarioCount: 1 } })
      expect(compactProposal.checkpointProposal.output).toBeUndefined()
      expect(compactProposal.context.analysis).toBeUndefined()
      expect(compactProposal.steps).toBeUndefined()
      const session = {}
      const emit = listeners.get('session/event')!
      const startArgs = { query: 'test intent' }
      const execution = { signal: undefined, agent: { id: 'agent-1', session } }
      emit(session, { type: 'agent/inbox/spliced', data: { inserted: [{ id: 'message-1', source: { kind: 'user' } }] }, time: 900 })
      emit(session, { type: 'turn/start', data: { turn: 1 }, time: 1000 })
      emit(session, { type: 'user/message', data: { source: { kind: 'agent-inject' } }, time: 1100 })
      await startTool.execute(startArgs, execution)
      expect(JSON.parse(fetchMock.mock.lastCall![1]?.body as string)).toEqual({ query: 'test intent', apiUrls: [] })
      emit(session, { type: 'step/start', data: { turn: 1, step: 1 }, time: 1150 })
      emit(session, { type: 'user/message', data: { id: 'message-1', source: { kind: 'user' } }, time: 1200 })
      emit(session, { type: 'assistant/message', data: { turn: 1, step: 1 }, time: 1250 })
      emit(session, { type: 'tool/call', data: { name: 'unrelated_tool' }, time: 1280 })
      emit(session, { type: 'tool/call', data: { name: 'business_start_scenario_workflow' }, time: 1290 })
      await startTool.execute(startArgs, execution)
      expect(JSON.parse(fetchMock.mock.lastCall![1]?.body as string)).toMatchObject({ humanPromptAt: 1200,
        humanPromptAdmittedAt: 900, agentTurnStartAt: 1000, agentFirstStepAt: 1150,
        agentFirstAssistantMessageAt: 1250,
        agentFirstToolCallAt: 1280, workflowToolCallAt: 1290 })
      emit(session, { type: 'turn/end', data: { turn: 1 }, time: 1300 })
      emit(session, { type: 'turn/start', data: { turn: 2 }, time: 1400 })
      await startTool.execute(startArgs, execution)
      expect(JSON.parse(fetchMock.mock.lastCall![1]?.body as string)).toEqual({ query: 'test intent', apiUrls: [] })
      emit(session, { type: 'user/message', data: { id: 'message-2', source: { kind: 'user' } }, time: 1500 })
      await startTool.execute(startArgs, execution)
      expect(JSON.parse(fetchMock.mock.lastCall![1]?.body as string)).toEqual({ query: 'test intent', apiUrls: [],
        humanPromptAt: 1500, agentTurnStartAt: 1400 })
      await analysisModeTool.execute({ mode: 'strict', exactScenarioEquivalence: false }, { signal: undefined, agent: { id: 'agent-1' } })
      expect(JSON.parse(fetchMock.mock.lastCall![1]?.body as string)).toEqual({ mode: 'strict', exactScenarioEquivalence: false })
      fetchMock.mockRestore()
    } finally {
      if (old === undefined) delete process.env.DSH_BUSINESS_CONNECTION_FILE
      else process.env.DSH_BUSINESS_CONNECTION_FILE = old
      await rm(directory, { recursive: true, force: true })
    }
  })
})
