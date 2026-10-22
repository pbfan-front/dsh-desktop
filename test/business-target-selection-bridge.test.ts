import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerBusinessScenarioWorkflow } from '../src/main/business-scenario-workflow'
import { BusinessWorkflowRuntime } from '../src/main/business-workflow-runtime'
import { approveBusinessScenarioPlan, proposeBusinessScenarioPlan } from '../src/main/business-scenario-plan'
import { parseBusinessPluginSemanticRules } from '../src/main/business-plugin-contract'

describe('business target selection over the process bridge', () => {
  it('resumes the same run only after a confirmed saved candidate is selected', async () => {
    const manifest = JSON.parse(await readFile('build/business-package/manifest.json', 'utf8'))
    const semanticRules = parseBusinessPluginSemanticRules(manifest)
    expect(semanticRules.find(rule => rule.id === 'receipt-normal-status')?.intentMatch).toBe('leading-clause')
    expect(semanticRules.find(rule => rule.id === 'receipt-overdue-status')?.intentMatch).toBe('leading-clause')
    const userRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-target-selection-bridge-')))
    const resources = join(userRoot, 'packaged-resources')
    await mkdir(resources)
    const packaging = JSON.parse(await readFile('package.json', 'utf8')) as {
      build: { extraResources: { from: string; to: string }[] }
    }
    for (const resource of packaging.build.extraResources.filter(item => /^business-.*\.mjs$/.test(item.to))) {
      await copyFile(resource.from, join(resources, resource.to))
    }
    const token = randomBytes(32).toString('hex')
    const workflowToken = randomBytes(32).toString('hex')
    // Consume the configured distribution inputs from a relocated directory.
    // Omitting a sibling Runtime import from extraResources must fail here.
    const child = fork(join(resources, 'business-runtime.mjs'), [resolve('build/business-package')], {
      execPath: process.execPath, execArgv: [],
      env: { ...process.env, DSH_BUSINESS_TOKEN: token, DSH_BUSINESS_WORKFLOW_TOKEN: workflowToken,
        DSH_BUSINESS_USER_ROOT: userRoot },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    let origin = ''
    let output = ''
    child.stderr?.on('data', chunk => { output = `${output}${chunk}`.slice(-2000) })
    const runtime = new BusinessWorkflowRuntime()
    const requestBusiness = async (path: string, body: unknown, sessionId?: string) => {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          'X-DSH-Workflow-Token': workflowToken, ...(sessionId ? { 'X-DSH-Session': sessionId } : {}) },
        body: JSON.stringify(body)
      })
      const payload = await response.json() as Record<string, unknown>
      if (!response.ok) throw Object.assign(new Error(String(payload.error || `HTTP ${response.status}`)), {
        code: payload.code, retryable: true, candidates: payload.candidates
      })
      return payload
    }
    const start = registerBusinessScenarioWorkflow({ runtime, pluginId: manifest.pluginId, requestBusiness, semanticRules })
    const previousConnection = process.env.DSH_BUSINESS_CONNECTION_FILE
    const ready = new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error(`Business runtime did not start: ${output}`)), 30000)
      child.on('message', (message: unknown) => {
        if (!message || typeof message !== 'object') return
        const event = message as Record<string, unknown>
        if (event.type === 'ready' && typeof event.origin === 'string') {
          origin = event.origin
          clearTimeout(timeout)
          resolveReady()
        }
        if (event.type === 'workflow-request' && typeof event.id === 'string') {
          void (async () => {
            try {
              const payload = event.payload as Record<string, unknown>
              const result = event.action === 'start-scenario'
                ? await start(payload as unknown as Parameters<typeof start>[0])
                : event.action === 'propose-plan'
                  ? await proposeBusinessScenarioPlan(runtime, payload)
                  : event.action === 'retry'
                  ? await runtime.retry(String(payload.runId), payload.retryInput)
                  : event.action === 'get'
                    ? { run: runtime.getRun(String(payload.runId)) }
                    : await runtime.cancel(String(payload.runId))
              child.send({ type: 'workflow-response', id: event.id, ok: true, result })
            } catch (error) {
              child.send({ type: 'workflow-response', id: event.id, ok: false,
                error: error instanceof Error ? error.message : String(error) })
            }
          })()
        }
      })
      child.once('exit', code => rejectReady(new Error(`Business runtime exited (${code}): ${output}`)))
    })
    try {
      await ready
      const sessionId = `bridge-${randomBytes(8).toString('hex')}`
      process.env.DSH_BUSINESS_CONNECTION_FILE = join(userRoot, 'connection.json')
      await writeFile(process.env.DSH_BUSINESS_CONNECTION_FILE, JSON.stringify({ origin, token, sourceRoot: userRoot,
        projectId: 'bridge-fixture', buildId: manifest.buildId }))
      const definitions: { name: string; execute: (args: Record<string, unknown>, exec: unknown) => Promise<string> }[] = []
      const { apply } = await import('../packages/dsh-desktop-business/index.js')
      await apply({ tools: { register: (tool: typeof definitions[number]) => definitions.push(tool) }, workspaceRegistry: {
        resolveByPath: async () => ({}), create: async () => undefined
      }, webServer: { register: () => () => undefined }, effect: (effect: () => unknown) => effect(), on: () => undefined,
      logger: { warn: () => undefined } })
      const callTool = async (name: string, args: Record<string, unknown>) => {
        const tool = definitions.find(item => item.name === name)
        if (!tool) throw new Error(`Missing real tool: ${name}`)
        const text = await tool.execute(args, { agent: { id: sessionId } })
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(24000)
        return JSON.parse(text)
      }
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`${origin}${path}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-DSH-Session': sessionId },
          body: JSON.stringify(body)
        })
        return { status: response.status, body: await response.json() as Record<string, any> }
      }
      const query = '借据列表正常展示：同一卡片显示借据号和正常。创建后不自动选中。'
      const started = await post('/__desktop/workflow/start-scenario', { query })
      expect(started.status).toBe(200)
      expect(started.body.status).toBe('failed')
      expect(started.body.steps[0].error).toMatchObject({ code: 'E_TARGET_ROUTE_AMBIGUOUS' })
      expect(started.body.steps[0].error.candidates).toContainEqual(expect.objectContaining({ routePath: '/repay/receiptList' }))
      const runId = started.body.id
      for (const retryInput of [undefined,
        { selectedRoutePath: '/repay/receiptList', confirmedByUser: false },
        { selectedRoutePath: '/credit/productCombine', confirmedByUser: true }]) {
        const rejected = await post('/__desktop/workflow/retry', { runId, ...(retryInput ? { retryInput } : {}) })
        expect(rejected.status).toBe(422)
        expect(runtime.getRun(runId)?.status).toBe('failed')
      }
      const selected = await post('/__desktop/workflow/retry', {
        runId, retryInput: { selectedRoutePath: '/repay/receiptList', confirmedByUser: true }
      })
      expect(selected.status).toBe(200)
      expect(selected.body).toMatchObject({ id: runId, status: 'waiting_for_user', currentStepId: 'confirm-plan' })
      expect(selected.body.context).toMatchObject({ target: { routePath: '/repay/receiptList' },
        query, targetSelection: { source: 'user-confirmed-candidate' }, analysis: { evidenceId: expect.any(String) },
        intentResolution: { canonicalIntent: '借据列表正常展示', source: 'declared-leading-clause' } })
      expect(selected.body.context.semanticExpectations).toHaveLength(1)
      expect(selected.body.steps.find((step: Record<string, unknown>) => step.id === 'create-profile')?.status).toBe('pending')
      // Exercise the real defineTool -> child HTTP -> Main bridge envelope,
      // not just a bare-run fetch mock. Full evidence remains lossless.
      const summary = await callTool('business_scenario_workflow_status', { runId })
      expect(summary.run).toMatchObject({ id: runId, status: 'waiting_for_user', currentStepId: 'confirm-plan' })
      expect(summary.run.steps[0].output).toBeUndefined()
      expect(summary.run.steps[0].outputRef.evidenceId).toBe(selected.body.context.analysis.evidenceId)
      const readsBefore = JSON.stringify(runtime.getRun(runId))
      const reads = await callTool('business_scenario_workflow_status', { runId, detail: 'full', section: 'reads' })
      expect(reads.evidence).toMatchObject({ section: 'reads', complete: true, value: {
        evidenceId: selected.body.context.analysis.evidenceId, qualityLevel: expect.stringMatching(/ready|review/)
      } })
      const mockRead = reads.evidence.value.calls.find((call: any) => call.tool === 'business_inspect_mock_scenario'
        && call.args.scenarioId === '正常借据可以提前结清')
      expect(mockRead).toBeDefined()
      expect(JSON.parse(mockRead.args.fieldPathsJson)).toEqual(selected.body.context.semanticExpectations
        .flatMap((rule: any) => rule.fieldAssertions.map((assertion: any) => assertion.path)))
      const focusedValues = await callTool(mockRead.tool, mockRead.args)
      expect(focusedValues.fields[0]).toMatchObject({ present: true, complete: true, value: '0' })
      const sourceRead = reads.evidence.value.calls.find((call: any) => call.tool === 'business_inspect_source_evidence')
      expect(JSON.parse(sourceRead.args.identifiersJson)).toContain('duestatus')
      const focusedSource = await callTool(sourceRead.tool, sourceRead.args)
      expect(focusedSource.items.length).toBeGreaterThan(0)
      expect(focusedSource.complete).toBe(false)
      expect(JSON.stringify(runtime.getRun(runId))).toBe(readsBefore)
      const first = await callTool('business_scenario_workflow_status', { runId, detail: 'full', section: 'analysis' })
      const pieces = first.evidencePage ? [first.evidencePage.content] : []
      let nextOffset = first.evidencePage?.nextOffset ?? null
      while (nextOffset !== null) {
        const next = await callTool('business_scenario_workflow_status', { runId, detail: 'full', section: 'analysis',
          offset: nextOffset, documentId: first.evidencePage.documentId })
        pieces.push(next.evidencePage.content)
        nextOffset = next.evidencePage.nextOffset
      }
      expect(first.evidence?.value ?? JSON.parse(pieces.join(''))).toEqual(selected.body.context.analysis)
      const sourceArgs = { evidenceId: selected.body.context.analysis.evidenceId,
        identifiersJson: JSON.stringify(['duestatus', 'loan_acct_no', 'RECEIPT_STATUS']) }
      const sourcePacket = await callTool('business_inspect_source_evidence', sourceArgs)
      expect(sourcePacket).toMatchObject({ kind: 'source-location-hints', complete: false,
        componentFile: 'src/views/repay/receiptList/index.vue', snapshot: 'independent-fresh-files' })
      expect(sourcePacket.items).toContainEqual(expect.objectContaining({ file: 'src/views/repay/receiptList/components/ReceiptItem.vue' }))
      expect(sourcePacket.items).toContainEqual(expect.objectContaining({ file: 'src/domains/repay/entities/receipt/abstract.ts' }))
      const wrongSession = await fetch(`${origin}/__desktop/source/inspect-evidence`, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-DSH-Session': 'another-session' },
        body: JSON.stringify({ evidenceId: sourceArgs.evidenceId, identifiers: ['duestatus'] }) })
      expect(wrongSession.status).toBe(403)
      expect((await wrongSession.json() as { code: string }).code).toBe('E_SOURCE_REVIEW_SESSION')
      const unauthenticated = await fetch(`${origin}/__desktop/source/inspect-evidence`, { method: 'POST', body: '{}' })
      expect(unauthenticated.status).toBe(401)
      expect((await post('/__desktop/source/inspect-evidence', { evidenceId: 'unknown', identifiers: ['duestatus'] })).status).toBe(410)
      const pinnedTarget = await post('/__desktop/source/inspect-evidence', { evidenceId: sourceArgs.evidenceId,
        componentFile: 'src/unrelated.ts', routePath: '/credit/productCombine', identifiers: ['duestatus'] })
      expect(pinnedTarget.body.componentFile).toBe('src/views/repay/receiptList/index.vue')
      expect((await post('/__desktop/source/inspect-evidence', { evidenceId: sourceArgs.evidenceId, identifiers: ['a.b'] })).status).toBe(422)
      expect(runtime.getRun(runId)?.status).toBe('waiting_for_user')
      expect(runtime.getRun(runId)?.context.profileId).toBeUndefined()
      const staged = await post('/__desktop/workflow/propose-plan', { runId, sessionId: 'forged-session', plan: {
        profileId: 'bridge_review', label: 'Reviewed normal receipt', page: 'repay',
        scenarios: [{ id: 'bridge_normal', apiUrl: '/loanNbr/loanNbr.json', sourceScenarioId: '正常借据可以提前结清' }],
        verificationSteps: [{ id: 'list', label: 'Normal receipt', route: '/repay/receiptList', containsText: ['正常'], absentText: ['系统繁忙'] }]
      } })
      expect(staged.status).toBe(200)
      expect(staged.body.currentStepId).toBe('confirm-plan')
      expect(staged.body.checkpointProposal.output.profileId).toBe('bridge_review')
      expect(staged.body.context.profileId).toBeUndefined()
      const receipt = await callTool('business_propose_scenario_plan', { runId,
        planJson: JSON.stringify(staged.body.checkpointProposal.output) })
      expect(receipt).toMatchObject({ currentStepId: 'confirm-plan', checkpointProposal: {
        approval: 'explicit-user-action-required', planSummary: { profileId: 'bridge_review', scenarioCount: 1 }
      } })
      expect(receipt.context.analysis).toBeUndefined()
      expect(receipt.checkpointProposal.output).toBeUndefined()
      expect(runtime.getRun(runId)?.context.profileId).toBeUndefined()
      const reusePlan = { format: 'source-reuse-v1', profileId: 'bridge_review', label: 'Reviewed normal receipt', page: 'repay',
        reuse: [{ apiUrl: '/loanNbr/loanNbr.json', sourceScenarioId: '正常借据可以提前结清' }],
        checks: [{ route: '/repay/receiptList', containsText: ['正常'], absentText: ['系统繁忙'] }] }
      const { format: _format, ...missingFormat } = reusePlan
      await expect(callTool('business_propose_scenario_plan', { runId, planJson: JSON.stringify(missingFormat) }))
        .rejects.toThrow('E_PLAN_FORMAT_REQUIRED')
      expect(runtime.getRun(runId)?.checkpointProposal?.id).toBe(receipt.checkpointProposal.id)
      const shortReceipt = await callTool('business_propose_scenario_plan', { runId, planJson: JSON.stringify(reusePlan) })
      const expanded = runtime.getRun(runId)?.checkpointProposal?.output as Record<string, any>
      expect(expanded).toMatchObject({ profileId: 'bridge_review', page: 'repay',
        scenarios: [{ id: expect.stringMatching(/^reuse_[0-9a-f]{32}$/), sourceScenarioId: '正常借据可以提前结清' }],
        verificationSteps: [{ id: 'check_1', route: '/repay/receiptList', containsText: ['正常'], absentText: ['系统繁忙'] }] })
      expect(expanded.scenarios[0].data).toBeUndefined()
      expect(shortReceipt.checkpointProposal.id).not.toBe(receipt.checkpointProposal.id)
      expect(shortReceipt.checkpointProposal.approval).toBe('explicit-user-action-required')
      expect(runtime.getRun(runId)?.context.profileId).toBeUndefined()
      expect(runtime.getRun(runId)?.steps.find(step => step.id === 'create-profile')?.status).toBe('pending')
      await expect(callTool('business_propose_scenario_plan', { runId, planJson: JSON.stringify({ ...reusePlan,
        checks: [{ ...reusePlan.checks[0], route: '/credit/productCombine' }] }) })).rejects.toThrow('first page check')
      const proposalTool = definitions.find(item => item.name === 'business_propose_scenario_plan')!
      await expect(proposalTool.execute({ runId, planJson: JSON.stringify(reusePlan) },
        { agent: { id: 'another-session' } })).rejects.toThrow('conversation')
      expect(runtime.getRun(runId)?.checkpointProposal?.id).toBe(shortReceipt.checkpointProposal.id)
      await expect(approveBusinessScenarioPlan(runtime, runId, { proposalId: receipt.checkpointProposal.id,
        sessionId })).rejects.toThrow('changed')
      expect((await post('/__desktop/workflow/approve-proposal', { runId, proposalId: staged.body.checkpointProposal.id })).status).toBe(404)
      const created = await approveBusinessScenarioPlan(runtime, runId, { proposalId: shortReceipt.checkpointProposal.id, sessionId })
      expect(created).toMatchObject({ currentStepId: 'wait-for-preview', context: { profileId: 'bridge_review' } })
      expect((await requestBusiness('/__desktop/state', {}, sessionId) as { profileId: string }).profileId).toBe('')
      expect((await post('/__desktop/workflow/cancel', { runId })).status).toBe(200)

      const overdueQuery = '借据列表展示逾期借据，借据号 JQ20250320QG0M00003006，同一张卡片显示完整借据号与“逾期”'
      const overdue = await post('/__desktop/workflow/start-scenario', { routePath: '/repay/receiptList', query: overdueQuery })
      expect(overdue.body).toMatchObject({ status: 'waiting_for_user', currentStepId: 'confirm-plan', context: {
        query: overdueQuery, semanticExpectations: [expect.objectContaining({ id: 'receipt-overdue-status' })],
        intentResolution: { canonicalIntent: '借据列表展示逾期借据', source: 'declared-leading-clause' }
      } })
      const overduePlan = { profileId: 'bridge_overdue', label: 'Reviewed overdue receipt', page: 'repay',
        scenarios: [{ id: 'bridge_overdue_data', apiUrl: '/loanNbr/loanNbr.json', sourceScenarioId: '多个优惠券提示' }] }
      expect((await post('/__desktop/workflow/propose-plan', { runId: overdue.body.id, plan: { ...overduePlan,
        scenarios: [{ ...overduePlan.scenarios[0], sourceScenarioId: '正常借据可以提前结清' }] } })).status).toBe(422)
      await expect(callTool('business_propose_scenario_plan', { runId: overdue.body.id,
        planJson: JSON.stringify({ ...reusePlan, profileId: 'wrong_overdue_source' }) })).rejects.toThrow('semantic rule receipt-overdue-status')
      expect(runtime.getRun(overdue.body.id)?.checkpointProposal).toBeUndefined()
      const overdueStaged = await post('/__desktop/workflow/propose-plan', { runId: overdue.body.id, plan: overduePlan })
      expect(overdueStaged.status).toBe(200)
      const overdueCreated = await approveBusinessScenarioPlan(runtime, overdue.body.id, {
        proposalId: overdueStaged.body.checkpointProposal.id, sessionId
      })
      expect(overdueCreated.currentStepId).toBe('wait-for-preview')
      expect((await requestBusiness('/__desktop/state', {}, sessionId) as { profileId: string }).profileId).toBe('')
      expect((await post('/__desktop/workflow/cancel', { runId: overdue.body.id })).status).toBe(200)
    } finally {
      if (previousConnection === undefined) delete process.env.DSH_BUSINESS_CONNECTION_FILE
      else process.env.DSH_BUSINESS_CONNECTION_FILE = previousConnection
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolveExit => child.once('exit', resolveExit))
        child.kill('SIGTERM')
        await exited
      }
      await rm(userRoot, { recursive: true, force: true })
    }
  }, 45000)
})
