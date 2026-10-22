import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { summarizeBusinessScenarioBaseline } from './business-scenario-baseline.mjs'

const file = resolve(process.argv[2] || 'build/workflow-runs.json')
const document = JSON.parse(await readFile(file, 'utf8'))
if (document?.version !== 1 || !Array.isArray(document.runs)) throw new Error('Unsupported workflow store')
console.log(JSON.stringify(summarizeBusinessScenarioBaseline(document.runs), null, 2))
