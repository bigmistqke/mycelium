import type { Entity, Relation } from "../db.js";

/**
 * A graph representation suitable for community detection algorithms.
 * Converts mycelium's Entity/Relation model to a generic graph format.
 */
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  kind: Entity["kind"];
  name: string;
  filePath: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: Relation["kind"];
  weight?: number;
}

/**
 * Result of community detection - maps entity IDs to community IDs.
 * Community IDs are integers starting from 0.
 */
export type CommunityAssignment = Map<string, number>;

/**
 * Hierarchical community structure (for algorithms like Infomap that support it).
 * Each level maps entity IDs to community IDs at that hierarchical level.
 */
export interface HierarchicalCommunities {
  levels: CommunityAssignment[];
  /** Flattened assignment using the finest granularity */
  flat: CommunityAssignment;
}

/**
 * Options common to all community detection algorithms.
 */
export interface CommunityDetectorOptions {
  /** Which relation types to include as edges (default: ["calls"]) */
  edgeTypes?: Relation["kind"][];
  /** Which entity kinds to include as nodes (default: ["function"]) */
  nodeKinds?: Entity["kind"][];
  /** Minimum edge weight to include (default: 0) */
  minWeight?: number;
}

/**
 * Common interface for community detection algorithms.
 * Implementations wrap specific algorithm libraries (Louvain, Infomap, etc.)
 */
export interface CommunityDetector {
  /** Algorithm name for display/logging */
  readonly name: string;

  /**
   * Detect communities in the given graph.
   * @param graph - The graph to partition
   * @param options - Algorithm-specific options (varies by implementation)
   * @returns Community assignments for each node
   */
  detect(graph: Graph, options?: Record<string, unknown>): Promise<CommunityAssignment>;

  /**
   * Whether this algorithm supports hierarchical community detection.
   */
  readonly supportsHierarchy: boolean;

  /**
   * Detect hierarchical communities (if supported).
   * Falls back to flat detection wrapped in single-level hierarchy if not supported.
   */
  detectHierarchical?(graph: Graph, options?: Record<string, unknown>): Promise<HierarchicalCommunities>;
}

/**
 * Convert mycelium entities and relations to a Graph for community detection.
 */
export function buildGraph(
  entities: Entity[],
  relations: Relation[],
  options: CommunityDetectorOptions = {}
): Graph {
  const {
    edgeTypes = ["calls"],
    nodeKinds = ["function"],
    minWeight = 0,
  } = options;

  const nodeKindSet = new Set(nodeKinds);
  const edgeTypeSet = new Set(edgeTypes);

  // Filter nodes by kind
  const nodeMap = new Map<string, GraphNode>();
  for (const entity of entities) {
    if (nodeKindSet.has(entity.kind)) {
      nodeMap.set(entity.id, {
        id: entity.id,
        kind: entity.kind,
        name: entity.name,
        filePath: entity.file_path,
      });
    }
  }

  // Filter edges by type and ensure both endpoints exist
  const edges: GraphEdge[] = [];
  const edgeCounts = new Map<string, number>();

  for (const relation of relations) {
    if (!edgeTypeSet.has(relation.kind)) continue;
    if (!nodeMap.has(relation.from_id) || !nodeMap.has(relation.to_id)) continue;

    // Count edges for weight (multiple relations = higher weight)
    const key = `${relation.from_id}:${relation.to_id}:${relation.kind}`;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  }

  // Create weighted edges
  const seenEdges = new Set<string>();
  for (const relation of relations) {
    if (!edgeTypeSet.has(relation.kind)) continue;
    if (!nodeMap.has(relation.from_id) || !nodeMap.has(relation.to_id)) continue;

    const key = `${relation.from_id}:${relation.to_id}:${relation.kind}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    const weight = edgeCounts.get(key) || 1;
    if (weight < minWeight) continue;

    edges.push({
      source: relation.from_id,
      target: relation.to_id,
      kind: relation.kind,
      weight,
    });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
  };
}
