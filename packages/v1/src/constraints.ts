// Constraint validation
//
// Check that graph satisfies its constraints (recursive)
// Deterministic tools, not LLM

import type { Graph, Node, Constraint, Edge } from './graph.js'

export interface ValidationResult {
  valid: boolean
  violations: Violation[]
}

export interface Violation {
  nodeId: string
  nodeName: string
  constraint: Constraint
  message: string
}

// Validate all constraints in the graph (recursive)
export function validateConstraints(graph: Graph): ValidationResult {
  const violations: Violation[] = []
  validateNode(graph, violations)
  return {
    valid: violations.length === 0,
    violations
  }
}

function validateNode(node: Node, violations: Violation[]): void {
  // Check constraints on this node
  if (node.constraints) {
    for (const constraint of node.constraints) {
      const violation = checkConstraint(node, constraint)
      if (violation) {
        violations.push(violation)
      }
    }
  }

  // Recurse into children
  if (node.children) {
    for (const child of node.children) {
      validateNode(child, violations)
    }
  }
}

function checkConstraint(node: Node, constraint: Constraint): Violation | null {
  switch (constraint.kind) {
    case 'must_connect':
      return checkMustConnect(node, constraint)
    case 'must_not_connect':
      return checkMustNotConnect(node, constraint)
    case 'pure':
      return checkPure(node)
    case 'no_side_effects':
      return checkNoSideEffects(node)
    default:
      return null
  }
}

function checkMustConnect(node: Node, constraint: Constraint): Violation | null {
  if (!constraint.target) return null
  if (!node.edges) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      constraint,
      message: `${node.name} must connect to ${constraint.target} but has no edges`
    }
  }

  const connected = node.edges.some(
    e => e.from.includes(constraint.target!) || e.to.includes(constraint.target!)
  )

  if (!connected) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      constraint,
      message: `${node.name} must connect to ${constraint.target}`
    }
  }
  return null
}

function checkMustNotConnect(node: Node, constraint: Constraint): Violation | null {
  if (!constraint.target) return null
  if (!node.edges) return null

  const connected = node.edges.some(
    e => e.from.includes(constraint.target!) || e.to.includes(constraint.target!)
  )

  if (connected) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      constraint,
      message: `${node.name} must not connect to ${constraint.target}`
    }
  }
  return null
}

function checkPure(node: Node): Violation | null {
  // A pure node should have no side effects
  // For now: check that all children are also pure or leaves
  // TODO: more sophisticated purity analysis
  return null
}

function checkNoSideEffects(node: Node): Violation | null {
  // Similar to pure but may allow some internal state
  // TODO: implement side effect detection
  return null
}

// Utility: collect all edges in the graph (recursive)
export function collectEdges(node: Node): Edge[] {
  const edges: Edge[] = [...(node.edges ?? [])]
  for (const child of node.children ?? []) {
    edges.push(...collectEdges(child))
  }
  return edges
}

// Utility: collect all constraints in the graph (recursive)
export function collectConstraints(node: Node): { node: Node; constraint: Constraint }[] {
  const result: { node: Node; constraint: Constraint }[] = []

  for (const constraint of node.constraints ?? []) {
    result.push({ node, constraint })
  }

  for (const child of node.children ?? []) {
    result.push(...collectConstraints(child))
  }

  return result
}
