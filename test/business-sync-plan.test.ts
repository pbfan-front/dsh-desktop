import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { createBusinessBuildPlan } from '../scripts/business-sync-plan.mjs'

describe('business package sync plan', () => {
  it('rebuilds every derived business input before packaging', () => {
    const businessRoot = join('workspace', 'demo-test')
    const webRoot = join(businessRoot, '.desktop-build', 'web')
    const plan = createBusinessBuildPlan({ businessRoot, webRoot, nodeExecutable: '/node' })

    expect(plan.map(step => step.label)).toEqual([
      'refresh generated routes',
      'build CodeIntell',
      'refresh CodeIntell index',
      'build local-mock business web',
      'build mock platform'
    ])
    expect(plan[3]).toMatchObject({
      command: '/node',
      cwd: businessRoot,
      env: { VUE_APP_SCENE: 'local-mock' }
    })
    expect(plan[3]?.args).toEqual(expect.arrayContaining([
      'build-env', '--mode', 'dev', '--scene', 'local-mock', '--dest', webRoot
    ]))
    expect(plan[4]?.cwd).toBe(join(businessRoot, 'mock-platform'))
  })
})
