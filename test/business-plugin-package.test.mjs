import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const exec = promisify(execFile)

it('ships and loads workflow helpers from a relocated package using the actual npm pack file list', async () => {
  const root = await mkdtemp(join(tmpdir(), 'business-plugin-package-'))
  try {
    const source = resolve('packages/dsh-desktop-business')
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const { stdout } = await exec(npm, ['pack', '--dry-run', '--ignore-scripts', '--offline', '--json'], { cwd: source,
      ...(process.platform === 'win32' ? { shell: true } : {}) })
    const files = JSON.parse(stdout)[0].files.map(item => item.path)
    expect(files).toContain('workflow-summary.js')
    expect(files).toContain('reuse-plan.js')
    expect(files).toContain('review-reads.js')
    expect(files).toContain('index.js')
    const target = join(root, 'node_modules', 'dsh-desktop-business')
    for (const file of files) {
      const destination = join(target, file)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(join(source, file), destination)
    }
    // The package owns its sibling module, while declared Harness peers use
    // the host. Do not make the entire development node_modules a fallback.
    await symlink(resolve('node_modules/@deepseek-ai'), join(root, 'node_modules', '@deepseek-ai'), process.platform === 'win32' ? 'junction' : 'dir')
    const { stdout: loaded } = await exec(process.execPath, ['--input-type=module', '-e', `
      const plugin = await import(${JSON.stringify(pathToFileURL(join(target, 'index.js')).href)});
      const result = plugin.compactBusinessWorkflowRun({id:'package-fixture',status:'waiting_for_user',steps:[]});
      if(result.id !== 'package-fixture' || typeof plugin.apply !== 'function') throw new Error('Incomplete plugin');
      const {businessReviewReads} = await import(${JSON.stringify(pathToFileURL(join(target, 'review-reads.js')).href)});
      const reads = businessReviewReads({id:'package-fixture',status:'waiting_for_user',currentStepId:'confirm-plan',context:{analysis:{evidenceId:'e',analysisPlan:{qualityGate:{level:'insufficient'}}}}});
      if(reads.qualityLevel !== 'insufficient' || reads.calls.length) throw new Error('Incomplete review reads');
      const {parseProposedBusinessPlan} = await import(${JSON.stringify(pathToFileURL(join(target, 'reuse-plan.js')).href)});
      const plan = parseProposedBusinessPlan(JSON.stringify({format:'source-reuse-v1',profileId:'fixture',label:'Reviewed',page:'loan',reuse:[{apiUrl:'/loan/query.json',sourceScenarioId:'source'}],checks:[{route:'/loan/query',containsText:['Normal'],absentText:[]}]}));
      if(plan.scenarios[0].sourceScenarioId !== 'source' || plan.verificationSteps[0].id !== 'check_1') throw new Error('Incomplete plan serializer');
      process.stdout.write('loaded');
    `], { cwd: root, env: { ...process.env, DSH_BUSINESS_CONNECTION_FILE: '' } })
    expect(loaded).toBe('loaded')
    const builder = JSON.parse(await readFile('package.json', 'utf8')).build
    expect(builder.files).toContain('node_modules/**/*')
    expect(builder.files).not.toContain('!node_modules/dsh-desktop-business/**')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
