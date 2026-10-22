import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { groupEquivalentScenarioMatches } from '../build/business-scenario-equivalence.mjs'

const match = (id, apiUrl = '/orders/list.json') => ({ apiUrl, scenarioId: id, score: 100 })
const scenario = (id, data = { status: '0', data: { items: [{ state: 'normal' }] } }) => ({ id, label: 'Normal', data })
const group = (configs, options) => groupEquivalentScenarioMatches(configs.map(value => match(value.id)),
  candidate => configs.find(value => value.id === candidate.scenarioId), options)

describe('exact Scenario config equivalence', () => {
  it('keeps every input and the first ranked representative while grouping only metadata copies', () => {
    const original = scenario('original')
    const copy = { ...structuredClone(original), id: 'copy', label: 'Reviewed copy' }
    const result = group([original, copy])
    assert.deepEqual(result.representatives, [match('original')])
    assert.deepEqual(result.summary.groups, [{ apiUrl: '/orders/list.json', representativeScenarioId: 'original',
      memberCount: 2, scenarioIds: ['original', 'copy'] }])
    assert.equal(result.summary.equivalentCandidateCount, 1)
    assert.equal(original.id, 'original')
    assert.equal(copy.id, 'copy')
    assert.deepEqual(group([copy, original]).representatives, [match('copy')])
  })

  it.each([
    [{ x: 1 }, { x: '1' }], [{ x: 0 }, { x: false }], [{ x: null }, {}],
    [{ x: [1, 2] }, { x: [2, 1] }], [{ id: 'one' }, { id: 'two' }],
    [{ label: 'one' }, { label: 'two' }], [{ x: -0 }, { x: 0 }],
    [{ first: 1, second: 2 }, { second: 2, first: 1 }]
  ])('does not normalize distinct payloads or JSON ordering (%#)', (left, right) => {
    assert.equal(group([scenario('left', left), scenario('right', right)]).summary.groupCount, 2)
  })

  it.each([
    { status: 'FAIL' }, { msg: 'Busy' }, { delay: 500 }, { responseType: 'blob' },
    { contentType: 'application/pdf' }, { headers: { test: 'different' } }, { http: 503 },
    { patch: { x: true } }, { unknownBehavior: true }, { sourceScenarioId: 'another' }
  ])('retains every additional Scenario configuration difference (%#)', extra => {
    const original = scenario('original')
    assert.equal(group([original, { ...scenario('copy'), ...extra }]).summary.groupCount, 2)
  })

  it('never groups identical configs from different API URLs', () => {
    const matches = [match('a', '/orders/list.json'), match('b', '/other/list.json')]
    assert.equal(groupEquivalentScenarioMatches(matches, candidate => scenario(candidate.scenarioId)).summary.groupCount, 2)
  })

  it('considers alternatives beyond the display limit and bounds only the reported group details', () => {
    const configs = Array.from({ length: 30 }, (_, index) => scenario(`copy${index}`))
    configs.push(scenario('different', { state: 'overdue' }))
    const result = group(configs)
    assert.deepEqual(result.representatives.map(value => value.scenarioId), ['copy0', 'different'])
    assert.equal(result.summary.candidateCount, 31)
    assert.equal(result.summary.groupCount, 2)
    assert.equal(result.summary.groups[0].memberCount, 30)
    assert.equal(result.summary.groups[0].scenarioIds.length, 12)
    assert.equal(result.summary.groupDetailsTruncated, true)
  })

  it('can restore the previous candidate-by-candidate decision without even reading configs', () => {
    const matches = [match('a'), match('b')]
    const result = groupEquivalentScenarioMatches(matches, () => { throw new Error('Must not read') }, { enabled: false })
    assert.deepEqual(result.representatives, matches)
    assert.equal(result.summary.enabled, false)
    assert.equal(result.summary.equivalentCandidateCount, 0)
  })

  it('keeps unknown, unsupported or oversized configs as separate candidates', () => {
    for (const value of [undefined, null, [], { data: undefined }, { data: NaN }, { data: () => 1 },
      { data: 1n }, { data: new Date(0) }, { data: { toJSON: () => 'same' } }]) {
      assert.equal(groupEquivalentScenarioMatches([match('a'), match('b')], () => value).summary.groupCount, 2)
    }
    const circular = {}; circular.self = circular
    assert.equal(group([scenario('a', circular), scenario('b', circular)]).summary.groupCount, 2)
    assert.equal(group([scenario('a'), scenario('b')], { maxConfigBytes: 1 }).summary.ungroupableCount, 2)
    const bytes = group([scenario('a')]).summary.comparedBytes
    const bounded = group([scenario('a'), scenario('b')], { maxTotalBytes: bytes })
    assert.equal(bounded.summary.groupCount, 2)
    assert.equal(bounded.summary.ungroupableCount, 1)
  })
})
