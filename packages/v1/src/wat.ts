// WAT generation and parsing
//
// Graph → WAT (synthesis)
// WAT → Graph (analysis)
//
// The recursive node structure maps to WAT's nested S-expressions:
// - Node with children → (module ...)
// - Leaf node → (func ...)
// - Ports → params/results
// - Edges → calls

import type { Graph, Node, Port, isLeaf, getInputs, getOutputs } from './graph.js'

// Generate WAT from graph (recursive)
export function graphToWat(graph: Graph): string {
  return nodeToWat(graph, 0)
}

function nodeToWat(node: Node, depth: number): string {
  const indent = '  '.repeat(depth)

  if (!node.children || node.children.length === 0) {
    // Leaf node → function
    return leafToWat(node, depth)
  }

  // Node with children → module
  const childrenWat = node.children
    .map(child => nodeToWat(child, depth + 1))
    .join('\n\n')

  const edgesComment = node.edges?.length
    ? `\n${indent}  ;; edges: ${node.edges.map(e => `${e.from} → ${e.to}`).join(', ')}`
    : ''

  return `${indent}(module $${node.name}${edgesComment}\n${childrenWat}\n${indent})`
}

function leafToWat(node: Node, depth: number): string {
  const indent = '  '.repeat(depth)

  const inputs = node.ports.filter(p => p.direction === 'in')
  const outputs = node.ports.filter(p => p.direction === 'out')

  const params = inputs
    .map(p => `(param $${p.name} ${p.type ?? 'i32'})`)
    .join(' ')

  const results = outputs
    .map(p => `(result ${p.type ?? 'i32'})`)
    .join(' ')

  const signature = [params, results].filter(Boolean).join(' ')

  const constraints = node.constraints?.length
    ? `\n${indent}  ;; constraints: ${node.constraints.map(c => c.kind).join(', ')}`
    : ''

  return `${indent}(func $${node.name} ${signature}${constraints}\n${indent}  ;; TODO: implementation\n${indent})`
}

// Parse WAT to graph (recursive)
export function watToGraph(wat: string): Graph {
  const tokens = tokenize(wat)
  const ast = parse(tokens)
  return astToGraph(ast)
}

// Simple S-expression tokenizer
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inString = false

  for (const char of input) {
    if (char === '"') {
      inString = !inString
      current += char
    } else if (inString) {
      current += char
    } else if (char === '(' || char === ')') {
      if (current.trim()) tokens.push(current.trim())
      tokens.push(char)
      current = ''
    } else if (/\s/.test(char)) {
      if (current.trim()) tokens.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) tokens.push(current.trim())

  return tokens
}

// Parse tokens to AST
type SExp = string | SExp[]

function parse(tokens: string[]): SExp {
  let pos = 0

  function parseExpr(): SExp {
    if (tokens[pos] === '(') {
      pos++ // skip (
      const list: SExp[] = []
      while (tokens[pos] !== ')') {
        list.push(parseExpr())
      }
      pos++ // skip )
      return list
    } else {
      return tokens[pos++]
    }
  }

  return parseExpr()
}

// Convert AST to Graph
function astToGraph(ast: SExp): Graph {
  if (!Array.isArray(ast)) {
    return { id: ast, name: ast, ports: [] }
  }

  const [head, ...rest] = ast

  if (head === 'module') {
    const name = typeof rest[0] === 'string' && rest[0].startsWith('$')
      ? rest[0].slice(1)
      : 'root'

    const children = rest
      .filter(Array.isArray)
      .map(astToGraph)

    return {
      id: name,
      name,
      ports: [],
      children: children.length ? children : undefined
    }
  }

  if (head === 'func') {
    const name = typeof rest[0] === 'string' && rest[0].startsWith('$')
      ? rest[0].slice(1)
      : 'anonymous'

    const ports: Port[] = []

    // Parse params and results
    for (const item of rest) {
      if (Array.isArray(item)) {
        if (item[0] === 'param') {
          const paramName = typeof item[1] === 'string' && item[1].startsWith('$')
            ? item[1].slice(1)
            : `in${ports.length}`
          ports.push({
            id: `${name}.${paramName}`,
            name: paramName,
            type: String(item[2] ?? 'i32'),
            direction: 'in'
          })
        } else if (item[0] === 'result') {
          ports.push({
            id: `${name}.out${ports.filter(p => p.direction === 'out').length}`,
            name: `out${ports.filter(p => p.direction === 'out').length}`,
            type: String(item[1] ?? 'i32'),
            direction: 'out'
          })
        }
      }
    }

    return { id: name, name, ports }
  }

  // Default: treat as named node
  const name = typeof head === 'string' ? head : 'unknown'
  return { id: name, name, ports: [] }
}
