// Constraint validation
//
// Check that generated WAT satisfies graph constraints
// Deterministic tools, not LLM

import type { Graph, Node, Constraint } from './graph.js'

export interface ValidationResult {
  valid: boolean
  violations: Violation[]
}

export interface Violation {
  node: string
  constraint: Constraint
  message: string
}

export function validateConstraints(graph: Graph, wat: string): ValidationResult {
  const violations: Violation[] = []

  for (const node of graph.nodes) {
    if (!node.constraints) continue

    for (const constraint of node.constraints) {
      const violation = checkConstraint(node, constraint, graph, wat)
      if (violation) {
        violations.push(violation)
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations
  }
}

function checkConstraint(
  node: Node,
  constraint: Constraint,
  graph: Graph,
  wat: string
): Violation | null {
  switch (constraint.kind) {
    case 'must_call':
      return checkMustCall(node, constraint, graph)
    case 'must_not_call':
      return checkMustNotCall(node, constraint, graph)
    case 'pure':
      return checkPure(node, graph)
    case 'no_side_effects':
      return checkNoSideEffects(node, graph)
    default:
      return null
  }
}

function checkMustCall(node: Node, constraint: Constraint, graph: Graph): Violation | null {
  const calls = graph.edges.filter(e => e.from === node.id && e.kind === 'calls')
  const callsTarget = calls.some(e => e.to === constraint.target)

  if (!callsTarget) {
    return {
      node: node.id,
      constraint,
      message: `${node.name} must call ${constraint.target}`
    }
  }
  return null
}

function checkMustNotCall(node: Node, constraint: Constraint, graph: Graph): Violation | null {
  const calls = graph.edges.filter(e => e.from === node.id && e.kind === 'calls')
  const callsTarget = calls.some(e => e.to === constraint.target)

  if (callsTarget) {
    return {
      node: node.id,
      constraint,
      message: `${node.name} must not call ${constraint.target}`
    }
  }
  return null
}

function checkPure(node: Node, graph: Graph): Violation | null {
  // TODO: check for side effects in the graph
  return null
}

function checkNoSideEffects(node: Node, graph: Graph): Violation | null {
  // TODO: check for side effects in the graph
  return null
}
