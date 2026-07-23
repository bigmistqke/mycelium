import { describe, expect, it } from "vitest";
import { LouvainDetector } from "../src/community/louvain.ts";
import { buildGraph, type Graph } from "../src/community/types.ts";

// Simple test graph: two clusters connected by one edge
function createTestGraph(): Graph {
  return {
    nodes: [
      // Cluster A
      { id: "a1", kind: "function", name: "a1", filePath: "a.ts" },
      { id: "a2", kind: "function", name: "a2", filePath: "a.ts" },
      { id: "a3", kind: "function", name: "a3", filePath: "a.ts" },
      // Cluster B
      { id: "b1", kind: "function", name: "b1", filePath: "b.ts" },
      { id: "b2", kind: "function", name: "b2", filePath: "b.ts" },
      { id: "b3", kind: "function", name: "b3", filePath: "b.ts" },
    ],
    edges: [
      // Dense connections in cluster A
      { source: "a1", target: "a2", kind: "calls" },
      { source: "a2", target: "a3", kind: "calls" },
      { source: "a3", target: "a1", kind: "calls" },
      { source: "a1", target: "a3", kind: "calls" },
      // Dense connections in cluster B
      { source: "b1", target: "b2", kind: "calls" },
      { source: "b2", target: "b3", kind: "calls" },
      { source: "b3", target: "b1", kind: "calls" },
      { source: "b1", target: "b3", kind: "calls" },
      // Single bridge between clusters
      { source: "a2", target: "b1", kind: "calls" },
    ],
  };
}

describe("LouvainDetector", () => {
  it("detects two communities in a two-cluster graph", async () => {
    const detector = new LouvainDetector();
    const graph = createTestGraph();

    const communities = await detector.detect(graph, { seed: 42 });

    // Should assign all nodes
    expect(communities.size).toBe(6);

    // Nodes in cluster A should be in the same community
    const a1Community = communities.get("a1");
    const a2Community = communities.get("a2");
    const a3Community = communities.get("a3");
    expect(a1Community).toBe(a2Community);
    expect(a2Community).toBe(a3Community);

    // Nodes in cluster B should be in the same community
    const b1Community = communities.get("b1");
    const b2Community = communities.get("b2");
    const b3Community = communities.get("b3");
    expect(b1Community).toBe(b2Community);
    expect(b2Community).toBe(b3Community);

    // The two clusters should be in different communities
    expect(a1Community).not.toBe(b1Community);
  });

  it("returns hierarchical result with single level", async () => {
    const detector = new LouvainDetector();
    const graph = createTestGraph();

    const result = await detector.detectHierarchical(graph, { seed: 42 });

    expect(result.levels).toHaveLength(1);
    expect(result.flat).toBe(result.levels[0]);
  });
});

describe("buildGraph", () => {
  it("filters nodes by kind", () => {
    const entities = [
      {
        id: "f1",
        kind: "function" as const,
        name: "f1",
        file_path: "a.ts",
        start_line: 1,
        end_line: 5,
        signature: "",
        signature_hash: "",
        impl_hash: null,
        commit_sha: "abc",
        created_at: "",
      },
      {
        id: "t1",
        kind: "type" as const,
        name: "T1",
        file_path: "a.ts",
        start_line: 10,
        end_line: 12,
        signature: "",
        signature_hash: "",
        impl_hash: null,
        commit_sha: "abc",
        created_at: "",
      },
    ];
    const relations = [
      {
        id: 1,
        from_id: "f1",
        to_id: "t1",
        kind: "uses_type" as const,
        commit_sha: "abc",
        metadata: null,
      },
    ];

    // Default: only functions
    const graph1 = buildGraph(entities, relations);
    expect(graph1.nodes).toHaveLength(1);
    expect(graph1.edges).toHaveLength(0); // t1 filtered out, so edge is dropped

    // Include both
    const graph2 = buildGraph(entities, relations, {
      nodeKinds: ["function", "type"],
    });
    expect(graph2.nodes).toHaveLength(2);
    expect(graph2.edges).toHaveLength(0); // edge type "uses_type" not in default edgeTypes

    // Include uses_type edges
    const graph3 = buildGraph(entities, relations, {
      nodeKinds: ["function", "type"],
      edgeTypes: ["uses_type"],
    });
    expect(graph3.nodes).toHaveLength(2);
    expect(graph3.edges).toHaveLength(1);
  });
});
