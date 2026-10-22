import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { summarizeBusinessExperienceCorpus } from './business-experience-corpus.mjs'

const [casesArg, runsArg, selectionsArg] = process.argv.slice(2)
const cases = JSON.parse(await readFile(resolve(casesArg || 'scripts/fixtures/business-experience-cases.json'), 'utf8'))
const runs = runsArg ? JSON.parse(await readFile(resolve(runsArg), 'utf8')).runs : []
const selections = selectionsArg ? JSON.parse(await readFile(resolve(selectionsArg), 'utf8')) : []
console.log(JSON.stringify(summarizeBusinessExperienceCorpus(cases, runs, selections), null, 2))
