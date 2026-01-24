// Graph schema and operations
//
// Nodes: functions, types, modules
// Edges: calls, dataflow
// Attributes: constraints

export interface Node {
  id: string
  kind: 'function' | 'type' | 'module'
  name: string
  constraints?: Constraint[]
}

export interface Edge {
  from: string
  to: string
  kind: 'calls' | 'dataflow' | 'contains'
}

export interface Constraint {
  kind: 'must_call' | 'must_not_call' | 'pure' | 'no_side_effects'
  target?: string
}

export interface Graph {
  nodes: Node[]
  edges: Edge[]
}

export function createGraph(): Graph {
  return { nodes: [], edges: [] }
}

export function addNode(graph: Graph, node: Node): Graph {
  return { ...graph, nodes: [...graph.nodes, node] }
}

export function addEdge(graph: Graph, edge: Edge): Graph {
  return { ...graph, edges: [...graph.edges, edge] }
}
