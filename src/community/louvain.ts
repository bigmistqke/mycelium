import { DirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import type {
  CommunityAssignment,
  CommunityDetector,
  HierarchicalCommunities,
  Graph as MyceliumGraph,
} from "./types.js";

type LouvainFn = (
  graph: DirectedGraph,
  options?: {
    resolution?: number;
    fastLocalMoves?: boolean;
    randomWalk?: boolean;
    rng?: () => number;
  },
) => Record<string, number>;

export interface LouvainOptions {
  /** Resolution parameter - higher values produce more communities (default: 1) */
  resolution?: number;
  /** Use fast local moves optimization (default: true) */
  fastLocalMoves?: boolean;
  /** Randomize node traversal order (default: true) */
  randomWalk?: boolean;
  /** Random seed for reproducibility */
  seed?: number;
}

/**
 * Louvain community detection using graphology-communities-louvain.
 * Modularity-based algorithm, O(n log n), works with directed graphs.
 */
export class LouvainDetector implements CommunityDetector {
  readonly name = "louvain";
  readonly supportsHierarchy = false;

  async detect(
    graph: MyceliumGraph,
    options: LouvainOptions = {},
  ): Promise<CommunityAssignment> {
    const {
      resolution = 1,
      fastLocalMoves = true,
      randomWalk = true,
      seed,
    } = options;

    // Build graphology graph (directed)
    const g = new DirectedGraph<
      { kind: string; name: string },
      { weight: number }
    >();

    // Add nodes
    for (const node of graph.nodes) {
      g.addNode(node.id, { kind: node.kind, name: node.name });
    }

    // Add edges with weights
    for (const edge of graph.edges) {
      // Skip self-loops
      if (edge.source === edge.target) continue;

      // graphology-louvain handles edge merging, but we pre-merged in buildGraph
      if (!g.hasEdge(edge.source, edge.target)) {
        g.addEdge(edge.source, edge.target, { weight: edge.weight || 1 });
      }
    }

    // Handle CJS/ESM interop - vitest and tsc behave differently
    const runLouvain = ((louvain as { default?: LouvainFn }).default ??
      louvain) as LouvainFn;

    // Run Louvain
    const communities = runLouvain(g, {
      resolution,
      fastLocalMoves,
      randomWalk,
      rng: seed !== undefined ? createSeededRng(seed) : undefined,
    });

    // Convert to Map
    const result: CommunityAssignment = new Map();
    for (const [nodeId, communityId] of Object.entries(communities) as [
      string,
      number,
    ][]) {
      result.set(nodeId, communityId);
    }

    return result;
  }

  async detectHierarchical(
    graph: MyceliumGraph,
    options: LouvainOptions = {},
  ): Promise<HierarchicalCommunities> {
    // Louvain doesn't natively support hierarchy, return flat as single level
    const flat = await this.detect(graph, options);
    return {
      levels: [flat],
      flat,
    };
  }
}

/**
 * Create a simple seeded random number generator for reproducibility.
 */
function createSeededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
