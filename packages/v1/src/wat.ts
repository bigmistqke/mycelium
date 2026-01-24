// WAT generation and parsing
//
// Graph → WAT (synthesis)
// WAT → Graph (analysis)

import type { Graph, Node, Edge } from './graph.js'

// Generate WAT from graph
export function graphToWat(graph: Graph): string {
  const functions = graph.nodes
    .filter(n => n.kind === 'function')
    .map(nodeToWatFunction)
    .join('\n\n')

  return `(module\n${indent(functions)}\n)`
}

function nodeToWatFunction(node: Node): string {
  // TODO: generate proper WAT based on node properties
  return `(func $${node.name}\n  ;; TODO: implementation\n)`
}

// Parse WAT to graph
export function watToGraph(wat: string): Graph {
  // TODO: parse WAT S-expressions into graph
  return { nodes: [], edges: [] }
}

function indent(s: string, level = 2): string {
  const spaces = ' '.repeat(level)
  return s.split('\n').map(line => spaces + line).join('\n')
}
