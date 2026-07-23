// Graph schema - recursive box model
//
// Same structure at every zoom level (Russian doll):
// - Ports (inputs/outputs)
// - Children (nested nodes = implementation)
// - Edges (connections between ports)
// - Constraints (contracts at this level)

export interface Port {
  id: string
  name: string
  type?: string
  direction: 'in' | 'out'
}

export interface Edge {
  from: string  // port id
  to: string    // port id
}

export interface Constraint {
  kind: 'must_connect' | 'must_not_connect' | 'pure' | 'no_side_effects' | 'custom'
  target?: string
  description?: string
}

export interface Node {
  id: string
  name: string
  ports: Port[]
  children?: Node[]         // recursive - same structure inside
  edges?: Edge[]            // connections between children's ports
  constraints?: Constraint[]
}

// A graph is just a root node
export type Graph = Node

// Create empty node
export function createNode(id: string, name: string): Node {
  return { id, name, ports: [] }
}

// Add port to node
export function addPort(node: Node, port: Port): Node {
  return { ...node, ports: [...node.ports, port] }
}

// Add child node (zoom in = this becomes visible)
export function addChild(parent: Node, child: Node): Node {
  return {
    ...parent,
    children: [...(parent.children ?? []), child]
  }
}

// Add edge between ports
export function addEdge(node: Node, edge: Edge): Node {
  return {
    ...node,
    edges: [...(node.edges ?? []), edge]
  }
}

// Add constraint
export function addConstraint(node: Node, constraint: Constraint): Node {
  return {
    ...node,
    constraints: [...(node.constraints ?? []), constraint]
  }
}

// Find node by id (recursive)
export function findNode(root: Node, id: string): Node | undefined {
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}

// Get all ports (inputs)
export function getInputs(node: Node): Port[] {
  return node.ports.filter(p => p.direction === 'in')
}

// Get all ports (outputs)
export function getOutputs(node: Node): Port[] {
  return node.ports.filter(p => p.direction === 'out')
}

// Check if node is a leaf (no children)
export function isLeaf(node: Node): boolean {
  return !node.children || node.children.length === 0
}

// Get depth of node tree
export function getDepth(node: Node): number {
  if (isLeaf(node)) return 0
  return 1 + Math.max(...(node.children ?? []).map(getDepth))
}
