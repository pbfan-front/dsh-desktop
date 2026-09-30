import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { createBusinessBuildPlan } from '../scripts/business-sync-plan.mjs'

describe('business package sync plan', () => {
  it('rebuilds every derived business input before packaging', () => {
    const businessRoot = join('workspace', 'demo-test')
    const webRoot = join(businessRoot, '.desktop-build', 'web')
    const desktopRoot = join('workspace', 'dsh-desktop')
    const plan = createBusinessBuildPlan({ businessRoot, webRoot, desktopRoot, nodeExecutable: '/node' })

    expect(plan.map(step => step.label)).toEqual([
      'refresh generated routes',
      'build CodeIntell',
      'refresh CodeIntell index',
      'write CodeIntell lifecycle metadata',
      'build local-mock business web',
      'build mock platform'
    ])
    expect(plan[3]).toMatchObject({ command: '/node', cwd: desktopRoot })
    expect(plan[4]).toMatchObject({
      command: '/node',
      cwd: businessRoot,
      env: { VUE_APP_SCENE: 'local-mock' }
    })
    expect(plan[4]?.args).toEqual(expect.arrayContaining([
      'build-env', '--mode', 'dev', '--scene', 'local-mock', '--dest', webRoot
    ]))
    expect(plan[5]?.cwd).toBe(join(businessRoot, 'mock-platform'))
  })
})
