import { createSignal, createResource, Show } from "solid-js";
import { Graph } from "./components/Graph";
import type { GraphData, GraphNode } from "./components/Graph";
import "./App.css";

// Load graph data from JSON file or API
async function loadGraphData(): Promise<GraphData> {
  try {
    const response = await fetch("/graph.json");
    if (!response.ok) {
      throw new Error("Failed to load graph data");
    }
    return response.json();
  } catch {
    // Return demo data if no graph.json
    return {
      nodes: [
        { id: "demo::main", name: "main", kind: "function", file_path: "demo.ts", signature: "() => void" },
        { id: "demo::helper", name: "helper", kind: "function", file_path: "demo.ts", signature: "(x: number) => number" },
      ],
      edges: [
        { source: "demo::main", target: "demo::helper", kind: "calls" },
      ],
    };
  }
}

function App() {
  const [graphData] = createResource(loadGraphData);
  const [selectedNode, setSelectedNode] = createSignal<GraphNode | null>(null);
  const [filter, setFilter] = createSignal("");

  return (
    <div class="app">
      <header class="header">
        <h1>Mycelium Graph</h1>
        <input
          type="text"
          placeholder="Filter by name or file..."
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          class="filter-input"
        />
      </header>

      <main class="main">
        <div class="graph-container">
          <Show when={graphData()} fallback={<div class="loading">Loading graph...</div>}>
            {(data) => (
              <Graph
                data={data()}
                onNodeSelect={setSelectedNode}
                filter={filter()}
              />
            )}
          </Show>
        </div>

        <aside class="details-panel">
          <Show
            when={selectedNode()}
            fallback={
              <div class="no-selection">
                <p>Click a node to see details</p>
                <div class="legend">
                  <h4>Nodes</h4>
                  <div class="legend-item">
                    <span class="legend-dot entry-point" />
                    <span>Entry point</span>
                  </div>
                  <div class="legend-item">
                    <span class="legend-dot regular" />
                    <span>Function</span>
                  </div>
                  <div class="legend-item">
                    <span class="legend-dot variable" />
                    <span>Variable</span>
                  </div>
                  <h4>Edges</h4>
                  <div class="legend-item">
                    <span class="legend-line calls" />
                    <span>Calls</span>
                  </div>
                  <div class="legend-item">
                    <span class="legend-line reads" />
                    <span>Reads</span>
                  </div>
                  <div class="legend-item">
                    <span class="legend-line writes" />
                    <span>Writes</span>
                  </div>
                </div>
              </div>
            }
          >
            {(node) => (
              <div class="node-details">
                <h2>{node().name}</h2>
                <div class="detail-row">
                  <span class="label">ID:</span>
                  <code>{node().id}</code>
                </div>
                <div class="detail-row">
                  <span class="label">Kind:</span>
                  <span>{node().kind}</span>
                </div>
                <div class="detail-row">
                  <span class="label">File:</span>
                  <span>{node().file_path}</span>
                </div>
                <div class="detail-row">
                  <span class="label">Signature:</span>
                  <code class="signature">{node().signature}</code>
                </div>
                <Show when={node().description}>
                  <div class="detail-row description">
                    <span class="label">Description:</span>
                    <p>{node().description}</p>
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </aside>
      </main>
    </div>
  );
}

export default App;
