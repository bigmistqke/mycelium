#!/usr/bin/env npx tsx
/**
 * CLI for dataflow → WAT compilation
 */

import { readFileSync } from 'fs'
import { dataflowToWat, FunctionInfo } from './dataflow-to-wat'

const path = process.argv[2]

if (!path) {
  console.log('Usage: npx tsx src/cli.ts <example.json>')
  process.exit(1)
}

const content = readFileSync(path, 'utf-8')
const graph = JSON.parse(content)

// Find function and dataflow nodes
const funcNode = graph.nodes.find((n: any) => n.layer === 'function')
const flowNode = graph.nodes.find((n: any) => n.layer === 'dataflow')

if (!funcNode || !flowNode) {
  console.error('Need function and dataflow layers')
  process.exit(1)
}

// Parse function signature
const params = funcNode.inputs.map((inp: string) => {
  const [name, type] = inp.split(':').map((s: string) => s.trim())
  return { name, type }
})

const func: FunctionInfo = {
  name: funcNode.title,
  params,
  results: funcNode.outputs
}

const wat = dataflowToWat(flowNode, func)
console.log(wat)
