import type {
  CommunityAssignment,
  CommunityDetector,
  Graph as MyceliumGraph,
  HierarchicalCommunities,
} from "./types.js";

export interface InfomapOptions {
  /** Number of hierarchical levels (default: 2 for two-level) */
  numLevels?: number;
  /** Number of optimization trials (default: 10) */
  numTrials?: number;
  /** Random seed for reproducibility */
  seed?: number;
  /** Treat as directed graph (default: true) */
  directed?: boolean;
}

/**
 * Infomap community detection using @mapequation/infomap.
 * Information-theoretic algorithm based on random walks.
 * Optimal for directed graphs like call graphs.
 */
export class InfomapDetector implements CommunityDetector {
  readonly name = "infomap";
  readonly supportsHierarchy = true;

  async detect(
    graph: MyceliumGraph,
    options: InfomapOptions = {}
  ): Promise<CommunityAssignment> {
    const hierarchical = await this.detectHierarchical(graph, options);
    return hierarchical.flat;
  }

  async detectHierarchical(
    graph: MyceliumGraph,
    options: InfomapOptions = {}
  ): Promise<HierarchicalCommunities> {
    const {
      numLevels = 2,
      numTrials = 10,
      seed,
      directed = true,
    } = options;

    // Dynamic import to avoid loading WASM unless needed
    const { Infomap } = await import("@mapequation/infomap");

    // Build node index mapping (Infomap uses numeric IDs internally)
    const nodeIdToIndex = new Map<string, number>();
    const indexToNodeId = new Map<number, string>();
    let index = 1; // Infomap uses 1-indexed nodes
    for (const node of graph.nodes) {
      nodeIdToIndex.set(node.id, index);
      indexToNodeId.set(index, node.id);
      index++;
    }

    // Convert to Infomap link format
    const links: Array<{ source: number; target: number; weight: number }> = [];
    for (const edge of graph.edges) {
      const sourceIdx = nodeIdToIndex.get(edge.source);
      const targetIdx = nodeIdToIndex.get(edge.target);
      if (sourceIdx === undefined || targetIdx === undefined) continue;
      if (sourceIdx === targetIdx) continue; // Skip self-loops

      links.push({
        source: sourceIdx,
        target: targetIdx,
        weight: edge.weight || 1,
      });
    }

    if (links.length === 0) {
      // No edges - each node is its own community
      const flat: CommunityAssignment = new Map();
      let communityId = 0;
      for (const node of graph.nodes) {
        flat.set(node.id, communityId++);
      }
      return { levels: [flat], flat };
    }

    // Build network object
    const network = {
      nodes: graph.nodes.map((n, i) => ({ id: i + 1, name: n.name })),
      links,
      directed,
    };

    // Build arguments string
    const args: string[] = ["--json"];
    if (numLevels === 2) args.push("--two-level");
    args.push(`--num-trials=${numTrials}`);
    if (seed !== undefined) args.push(`--seed=${seed}`);

    // Run Infomap asynchronously
    const im = new Infomap();
    const result = await im.runAsync({ network, args: args.join(" ") });

    // Parse JSON result
    const tree = result.json;
    if (!tree || !tree.nodes) {
      // Fallback: each node is its own community
      const flat: CommunityAssignment = new Map();
      let communityId = 0;
      for (const node of graph.nodes) {
        flat.set(node.id, communityId++);
      }
      return { levels: [flat], flat };
    }

    // Extract hierarchical module assignments from tree nodes
    // Each node has a `path` array like [1, 2, 3] indicating module hierarchy
    const hierarchicalResult: HierarchicalCommunities = {
      levels: [],
      flat: new Map(),
    };

    const maxLevels = Math.max(...tree.nodes.map((n) => n.path?.length || 1), 1);

    for (let level = 0; level < maxLevels; level++) {
      const levelMap: CommunityAssignment = new Map();
      for (const treeNode of tree.nodes) {
        const nodeId = indexToNodeId.get(treeNode.id);
        if (nodeId && treeNode.path) {
          // path is 1-indexed, convert to 0-indexed community IDs
          const communityId = (treeNode.path[level] ?? treeNode.path[treeNode.path.length - 1] ?? 1) - 1;
          levelMap.set(nodeId, communityId);
        }
      }
      hierarchicalResult.levels.push(levelMap);
    }

    // Flat = finest level (last level)
    hierarchicalResult.flat = hierarchicalResult.levels[hierarchicalResult.levels.length - 1] || new Map();

    // Handle nodes not in result (disconnected)
    let nextCommunityId = Math.max(...Array.from(hierarchicalResult.flat.values()), -1) + 1;
    for (const node of graph.nodes) {
      if (!hierarchicalResult.flat.has(node.id)) {
        hierarchicalResult.flat.set(node.id, nextCommunityId++);
        // Add to all levels
        for (const levelMap of hierarchicalResult.levels) {
          if (!levelMap.has(node.id)) {
            levelMap.set(node.id, nextCommunityId);
          }
        }
        nextCommunityId++;
      }
    }

    return hierarchicalResult;
  }
}
