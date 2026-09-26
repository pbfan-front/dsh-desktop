import { join } from 'node:path'

export function createBusinessBuildPlan({ businessRoot, webRoot, nodeExecutable = process.execPath }) {
  return [
    {
      label: 'refresh generated routes',
      command: 'npm',
      args: ['run', 'diffRouter'],
      cwd: businessRoot
    },
    {
      label: 'build CodeIntell',
      command: 'npm',
      args: ['run', 'code-intell:build'],
      cwd: businessRoot
    },
    {
      label: 'refresh CodeIntell index',
      command: 'npm',
      args: ['run', 'code-intell:index'],
      cwd: businessRoot
    },
    {
      label: 'build local-mock business web',
      command: nodeExecutable,
      args: [
        join(businessRoot, 'node_modules', '@vue', 'cli-service', 'bin', 'vue-cli-service.js'),
        'build-env',
        '--mode',
        'dev',
        '--scene',
        'local-mock',
        '--dest',
        webRoot
      ],
      cwd: businessRoot,
      env: { VUE_APP_SCENE: 'local-mock' }
    },
    {
      label: 'build mock platform',
      command: 'npm',
      args: ['run', 'build'],
      cwd: join(businessRoot, 'mock-platform')
    }
  ]
}
