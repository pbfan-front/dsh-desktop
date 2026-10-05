import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateBusinessExperience } from './business-experience-evaluation.mjs'

const [runsArg, runId, caseId] = process.argv.slice(2)
if (!runsArg || !runId || !caseId) {
  console.error('Usage: node scripts/evaluate-business-experience.mjs <workflow-runs.json> <run-id> <case-id>')
  process.exit(2)
}
const casesPath = fileURLToPath(new URL('./fixtures/business-experience-cases.json', import.meta.url))
const [store, cases] = await Promise.all([
  readFile(resolve(runsArg), 'utf8').then(JSON.parse),
  readFile(casesPath, 'utf8').then(JSON.parse)
])
const run = store.runs?.find(item => item.id === runId)
const scenario = cases.find(item => item.id === caseId)
if (!run || !scenario) {
  console.error(`Unknown ${!run ? 'run ID' : 'case ID'}`)
  process.exit(2)
}
const result = evaluateBusinessExperience(run, scenario)
console.log(JSON.stringify(result, null, 2))
if (result.outcome === 'failed') process.exitCode = 1
