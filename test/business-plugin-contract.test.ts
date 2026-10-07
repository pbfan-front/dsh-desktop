import { describe, expect, it } from 'vitest'
import { parseBusinessPluginSemanticRules, parseBusinessPluginTargetAliases, parseBusinessPluginWorkflows } from '../src/main/business-plugin-contract'

const workflow = {
  id: 'business-scenario-create',
  version: '1.0.0',
  title: '创建并验证业务体验场景',
  inputSchema: { type: 'object', required: ['routePath'] },
  steps: [
    { id: 'analyze-target', type: 'deterministic', title: '分析', handler: 'business.analyze-target' },
    { id: 'confirm-plan', type: 'checkpoint', title: '确认' }
  ]
}

describe('business plugin workflow declarations', () => {
  it('accepts declarative schemas with allowlisted handlers', () => {
    expect(parseBusinessPluginWorkflows({ workflows: [workflow] })).toEqual([workflow])
  })

  it('rejects arbitrary executable handler names', () => {
    expect(() => parseBusinessPluginWorkflows({
      workflows: [{ ...workflow, steps: [{ id: 'run-shell', type: 'deterministic', title: '执行', handler: 'shell.exec' }] }]
    })).toThrow('unsupported handler')
  })

  it('rejects handlers on user checkpoints', () => {
    expect(() => parseBusinessPluginWorkflows({
      workflows: [{ ...workflow, steps: [{ id: 'confirm', type: 'checkpoint', title: '确认', handler: 'business.apply-profile' }] }]
    })).toThrow('cannot declare a handler')
  })

  it('accepts the preview evidence gate and rejects unknown gates', () => {
    const verifyStep = { id: 'verify-preview', type: 'deterministic', title: '验证', handler: 'business.verify-preview', gate: 'business.preview-verification' }
    expect(parseBusinessPluginWorkflows({ workflows: [{ ...workflow, steps: [verifyStep] }] })[0]?.steps[0]?.gate).toBe('business.preview-verification')
    expect(() => parseBusinessPluginWorkflows({ workflows: [{ ...workflow, steps: [{ ...verifyStep, gate: 'plugin.run-anything' }] }] })).toThrow('unsupported gate')
  })

  it('validates explicitly compatible persisted run versions', () => {
    const parsed = parseBusinessPluginWorkflows({ workflows: [{ ...workflow, compatibleRunVersions: ['0.9.0'] }] })
    expect(parsed[0]?.compatibleRunVersions).toEqual(['0.9.0'])
    expect(() => parseBusinessPluginWorkflows({ workflows: [{ ...workflow, compatibleRunVersions: ['1.0.0'] }] })).toThrow('must not repeat')
  })
})

describe('business plugin semantic rules', () => {
  const rule = {
    id: 'receipt-normal-status', routePath: '/repay/receiptList', intentEquals: '借据列表正常展示',
    apiUrl: '/loanNbr/loanNbr.json',
    fieldAssertions: [{ path: ['data', 'list', 0, 'duestatus'], equals: '0' }],
    sourceScenarioIds: ['正常借据可以提前结清']
  }

  it('accepts bounded declarative assertions without executable code', () => {
    expect(parseBusinessPluginSemanticRules({ scenarioSemanticRules: [rule] })).toEqual([rule])
  })

  it('rejects unsafe paths and duplicate identifiers', () => {
    expect(() => parseBusinessPluginSemanticRules({ scenarioSemanticRules: [rule, rule] })).toThrow('duplicated')
    expect(() => parseBusinessPluginSemanticRules({ scenarioSemanticRules: [{
      ...rule, fieldAssertions: [{ path: ['__proto__'], equals: '0' }]
    }] })).toThrow('unsafe')
  })

  it('rejects semantic rules that the Runtime would reject', () => {
    expect(() => parseBusinessPluginSemanticRules({ scenarioSemanticRules: [{
      ...rule, apiUrl: '/../private'
    }] })).toThrow('shared business control contract')
  })
})

describe('business plugin target aliases', () => {
  it('accepts declarative business page aliases', () => {
    expect(parseBusinessPluginTargetAliases({
      targetAliases: [{ routePath: '/loan/receiveAcct', aliases: ['收款账户', '借款账户'] }]
    })).toEqual([{ routePath: '/loan/receiveAcct', aliases: ['收款账户', '借款账户'] }])
  })

  it('rejects unsafe, duplicated or empty route declarations', () => {
    expect(() => parseBusinessPluginTargetAliases({
      targetAliases: [{ routePath: '//evil', aliases: ['页面'] }]
    })).toThrow('unsafe')
    expect(() => parseBusinessPluginTargetAliases({
      targetAliases: [
        { routePath: '/loan/receiveAcct', aliases: ['收款账户'] },
        { routePath: '/loan/receiveAcct', aliases: ['借款账户'] }
      ]
    })).toThrow('duplicated')
    expect(() => parseBusinessPluginTargetAliases({
      targetAliases: [{ routePath: '/loan/receiveAcct', aliases: [] }]
    })).toThrow('cannot be empty')
  })
})
