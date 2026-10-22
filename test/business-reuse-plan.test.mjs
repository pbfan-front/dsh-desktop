import { describe, expect, it } from 'vitest'
import { parseProposedBusinessPlan } from '../packages/dsh-desktop-business/reuse-plan.js'

const fixture = () => ({ format: 'source-reuse-v1', profileId: 'loan_review', label: '已复核完整来源', page: 'loan',
  reuse: [{ apiUrl: '/loan/detail.json', sourceScenarioId: '已有完整来源' }],
  checks: [{ route: '/loan/detail', containsText: ['借据00001', '逾期'], absentText: ['系统繁忙'] }] })
const parse = input => parseProposedBusinessPlan(JSON.stringify(input))

describe('explicit source-reuse plan serialization', () => {
  it('only generates mechanical IDs and labels, preserving exact bindings and all ordered assertions', () => {
    const input = fixture()
    input.reuse[0].label = '精确来源标签'
    input.checks[0].label = '同一卡片检查'
    input.checks[0].apiUrls = ['/loan/detail.json']
    input.checks.push({ route: '/loan/history?type=overdue', containsText: [' 00001 ', '00001'], absentText: [] })
    const before = JSON.stringify(input), plan = parse(input)
    expect(plan).toEqual({ profileId: input.profileId, label: input.label, page: input.page,
      scenarios: [{ id: expect.stringMatching(/^reuse_[0-9a-f]{32}$/), ...input.reuse[0] }],
      verificationSteps: [{ id: 'check_1', ...input.checks[0] }, { id: 'check_2', label: input.checks[1].route, ...input.checks[1] }] })
    expect(JSON.stringify(input)).toBe(before)
    expect(plan.scenarios[0]).not.toHaveProperty('data')
    expect(plan).not.toHaveProperty('confirmed')
    expect(plan).not.toHaveProperty('format')
    expect(parse(input)).toEqual(plan)
    const longRoute = fixture()
    longRoute.checks[0].route = '/' + 'r'.repeat(499)
    longRoute.checks[0].label = 'Explicit long-route label'
    expect(parse(longRoute).verificationSteps[0]).toMatchObject({ route: longRoute.checks[0].route,
      label: 'Explicit long-route label' })
  })

  it('keeps generated IDs stable across reorder, distinct by exact API/source/Profile, within existing limits', () => {
    const input = fixture()
    input.profileId = 'p'.repeat(128)
    input.reuse.push({ apiUrl: '/loan/other.json', sourceScenarioId: input.reuse[0].sourceScenarioId })
    const first = parse(input)
    expect(first.scenarios[0].label).toBe(input.reuse[0].sourceScenarioId)
    expect(first.scenarios[0].id).not.toBe(first.scenarios[1].id)
    expect(first.scenarios[0].id.length).toBeLessThanOrEqual(128)
    input.reuse.reverse()
    expect(parse(input).scenarios).toEqual([...first.scenarios].reverse())
    input.reuse[1].sourceScenarioId += ' '
    expect(parse(input).scenarios[1].id).not.toBe(first.scenarios[0].id)
    input.profileId = 'different_profile'
    expect(parse(input).scenarios[0].id).not.toBe(first.scenarios[1].id)
  })

  it('retains the unmodified original full-plan path, including custom IDs, data and extra fields', () => {
    const input = { profileId: 'legacy', label: 'legacy', page: 'loan',
      scenarios: [{ id: 'user_chosen_id', apiUrl: '/loan/detail.json', data: { code: '0', zero: 0, off: false, optional: null } }],
      verificationSteps: [{ id: 'custom_page', label: 'custom', route: '/loan/detail', containsText: ['正常'], absentText: [] }],
      customMetadata: { intact: true } }
    expect(parse(input)).toEqual(input)
    expect(parse({ ...input, reuse: [{ label: 'Legacy metadata, not a binding' }], checks: [] }))
      .toEqual({ ...input, reuse: [{ label: 'Legacy metadata, not a binding' }], checks: [] })
    for (const legacyInvalid of [null, false, [], 'not a plan', {}]) expect(parse(legacyInvalid)).toEqual(legacyInvalid)
  })

  it.each(['reuse', 'checks', 'both'])('diagnoses %s shorthand without format, never guessing a mode or dropping checks', shape => {
    const input = fixture()
    delete input.format
    if (shape === 'reuse') delete input.checks
    if (shape === 'checks') delete input.reuse
    const before = JSON.stringify(input)
    expect(() => parse(input)).toThrow('E_PLAN_FORMAT_REQUIRED')
    expect(() => parse(input)).toThrow('"format":"source-reuse-v1"')
    expect(() => parse(input)).toThrow('Preserve the reviewed bindings and every page check')
    expect(JSON.stringify(input)).toBe(before)
    const explicit = fixture()
    expect(parse(explicit).verificationSteps[0].containsText).toEqual(explicit.checks[0].containsText)
  })

  it.each([
    ['unknown version', v => { v.format = 'source-reuse-v2' }],
    ['data at root', v => { v.data = { status: '0' } }],
    ['mixed full plan', v => { v.scenarios = [{ id: 'not silently lost' }] }],
    ['approval boolean', v => { v.confirmed = true }],
    ['source data override', v => { v.reuse[0].data = { status: '0' } }],
    ['custom Scenario ID', v => { v.reuse[0].id = 'custom' }],
    ['unknown source key', v => { v.reuse[0].sourceScenarioID = 'typo' }],
    ['custom page ID', v => { v.checks[0].id = 'custom' }],
    ['assertion typo', v => { v.checks[0].containsTexts = ['not silently lost'] }],
    ['unsafe Profile ID', v => { v.profileId = '../unsafe' }],
    ['empty source', v => { v.reuse[0].sourceScenarioId = '' }],
    ['empty bindings', v => { v.reuse = [] }],
    ['too many bindings', v => { v.reuse = Array(13).fill(v.reuse[0]) }],
    ['duplicate API', v => { v.reuse.push({ ...v.reuse[0], sourceScenarioId: 'different' }) }],
    ['missing page checks', v => { delete v.checks }],
    ['empty page checks', v => { v.checks = [] }],
    ['too many page checks', v => { v.checks = Array(6).fill(v.checks[0]) }],
    ['unsafe route', v => { v.checks[0].route = '//other.test/loan' }],
    ['long route without explicit label', v => { v.checks[0].route = '/' + 'r'.repeat(201) }],
    ['empty required assertion', v => { v.checks[0].containsText = [' '] }],
    ['missing negative assertions', v => { delete v.checks[0].absentText }],
    ['wrong assertion type', v => { v.checks[0].containsText = [0, false, null] }],
    ['too many assertions', v => { v.checks[0].containsText = Array(21).fill('must retain') }],
    ['too long assertion', v => { v.checks[0].absentText = ['字'.repeat(201)] }],
    ['empty API filter', v => { v.checks[0].apiUrls = [] }],
    ['undeclared API filter', v => { v.checks[0].apiUrls = ['/loan/unreviewed.json'] }],
    ['unknown metadata', v => { v.verificationSteps = [{ route: '/not-silently-dropped' }] }]
  ])('rejects %s instead of dropping intent or guessing replacements', (_label, change) => {
    const input = fixture()
    change(input)
    expect(() => parse(input)).toThrow()
  })

  it('rejects malformed and oversized shorthand JSON without a fallback or partial plan', () => {
    expect(() => parseProposedBusinessPlan('{broken')).toThrow()
    const value = JSON.stringify(fixture())
    expect(() => parseProposedBusinessPlan(value + ' '.repeat(131073 - value.length))).toThrow('size budget')
  })
})
