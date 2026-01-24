#!/usr/bin/env node
// v1 CLI: Graph ↔ WAT + Constraints

import { program } from 'commander'
import { readFileSync, writeFileSync } from 'node:fs'
import { graphToWat, watToGraph } from './wat.js'
import { validateConstraints } from './constraints.js'
import type { Graph } from './graph.js'

program
  .name('mycelium')
  .description('v1: Graph ↔ WAT + Constraints')
  .version('0.0.1')

program
  .command('generate')
  .description('Generate WAT from graph')
  .argument('<graph.json>', 'Path to graph JSON file')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .action((inputPath: string, options: { output?: string }) => {
    const graph = readGraph(inputPath)
    const wat = graphToWat(graph)

    if (options.output) {
      writeFileSync(options.output, wat)
      console.log(`Wrote ${options.output}`)
    } else {
      console.log(wat)
    }
  })

program
  .command('validate')
  .description('Validate graph constraints')
  .argument('<graph.json>', 'Path to graph JSON file')
  .action((inputPath: string) => {
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
  })

program
  .command('parse')
  .description('Parse WAT to graph')
  .argument('<file.wat>', 'Path to WAT file')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .action((inputPath: string, options: { output?: string }) => {
    const wat = readFileSync(inputPath, 'utf-8')
    const graph = watToGraph(wat)
    const json = JSON.stringify(graph, null, 2)

    if (options.output) {
      writeFileSync(options.output, json)
      console.log(`Wrote ${options.output}`)
    } else {
      console.log(json)
    }
  })

function readGraph(path: string): Graph {
  const content = readFileSync(path, 'utf-8')
  return JSON.parse(content) as Graph
}

program.parse()
