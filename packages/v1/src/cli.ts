#!/usr/bin/env node
// v1 CLI: Graph ↔ WAT + Constraints

import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'
import { graphToWat, watToGraph } from './wat.js'
import { validateConstraints } from './constraints.js'
import type { Graph } from './graph.js'

const USAGE = `
mycelium v1 - Graph ↔ WAT + Constraints

Commands:
  generate <graph.json> [-o output.wat]   Generate WAT from graph
  validate <graph.json>                   Validate constraints
  parse <file.wat> [-o output.json]       Parse WAT to graph

Examples:
  mycelium generate graph.json
  mycelium generate graph.json -o out.wat
  mycelium validate graph.json
  mycelium parse module.wat -o graph.json
`

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE)
    process.exit(0)
  }

  const command = args[0]
  const rest = args.slice(1)

  switch (command) {
    case 'generate':
      return cmdGenerate(rest)
    case 'validate':
      return cmdValidate(rest)
    case 'parse':
      return cmdParse(rest)
    default:
      console.error(`Unknown command: ${command}`)
      console.log(USAGE)
      process.exit(1)
  }
}

function cmdGenerate(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      output: { type: 'string', short: 'o' }
    },
    allowPositionals: true
  })

  if (positionals.length === 0) {
    console.error('Error: missing graph.json path')
    process.exit(1)
  }

  const inputPath = positionals[0]
  const graph = readGraph(inputPath)
  const wat = graphToWat(graph)

  if (values.output) {
    writeFileSync(values.output, wat)
    console.log(`Wrote ${values.output}`)
  } else {
    console.log(wat)
  }
}

function cmdValidate(args: string[]) {
  const { positionals } = parseArgs({
    args,
    options: {},
    allowPositionals: true
  })

  if (positionals.length === 0) {
    console.error('Error: missing graph.json path')
    process.exit(1)
  }

  const inputPath = positionals[0]
  const graph = readGraph(inputPath)
  const result = validateConstraints(graph)

  if (result.valid) {
    console.log('✓ All constraints satisfied')
  } else {
    console.log(`✗ ${result.violations.length} violation(s):`)
    for (const v of result.violations) {
      console.log(`  - ${v.nodeName}: ${v.message}`)
    }
    process.exit(1)
  }
}

function cmdParse(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      output: { type: 'string', short: 'o' }
    },
    allowPositionals: true
  })

  if (positionals.length === 0) {
    console.error('Error: missing .wat file path')
    process.exit(1)
  }

  const inputPath = positionals[0]
  const wat = readFileSync(inputPath, 'utf-8')
  const graph = watToGraph(wat)
  const json = JSON.stringify(graph, null, 2)

  if (values.output) {
    writeFileSync(values.output, json)
    console.log(`Wrote ${values.output}`)
  } else {
    console.log(json)
  }
}

function readGraph(path: string): Graph {
  const content = readFileSync(path, 'utf-8')
  return JSON.parse(content) as Graph
}

main()
