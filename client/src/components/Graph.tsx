import type { Core, NodeSingular } from "cytoscape";
import cytoscape from "cytoscape";
import { createEffect, onCleanup, onMount } from "solid-js";

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  file_path: string;
  signature: string;
  description?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphProps {
  data: GraphData;
  onNodeSelect?: (node: GraphNode | null) => void;
  filter?: string;
}

export function Graph(props: GraphProps) {
  let containerRef: HTMLDivElement | undefined;
  let cy: Core | undefined;

  onMount(() => {
    if (!containerRef) return;

    cy = cytoscape({
      container: containerRef,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "center",
            "text-halign": "center",
            "background-color": "#4a9eff",
            color: "#fff",
            "text-outline-color": "#4a9eff",
            "text-outline-width": 2,
            "font-size": "12px",
            width: "150px",
            height: "35px",
            "text-wrap": "ellipsis",
            "text-max-width": "140px",
            shape: "round-rectangle",
          },
        },
        {
          selector: "node:selected",
          style: {
            "background-color": "#ff6b6b",
            "text-outline-color": "#ff6b6b",
          },
        },
        {
          selector: "node.entry-point",
          style: {
            "background-color": "#51cf66",
            "text-outline-color": "#51cf66",
          },
        },
        {
          selector: "node.filtered-out",
          style: {
            opacity: 0.2,
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#ccc",
            "target-arrow-color": "#ccc",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
          },
        },
        {
          selector: "edge.filtered-out",
          style: {
            opacity: 0.1,
          },
        },
      ],
      layout: {
        name: "cose",
        fit: true,
        padding: 30,
        spacingFactor: 2,
      },
    });

    cy.on("tap", "node", (evt) => {
      const node = evt.target as NodeSingular;
      const nodeData = node.data() as GraphNode;
      props.onNodeSelect?.(nodeData);
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        props.onNodeSelect?.(null);
      }
    });

    updateGraph();
  });

  onCleanup(() => {
    cy?.destroy();
  });

  function updateGraph() {
    if (!cy) return;

    const elements = [
      ...props.data.nodes.map((node) => ({
        data: {
          ...node,
          label: node.name,
        },
      })),
      ...props.data.edges.map((edge, i) => ({
        data: {
          id: `edge-${i}`,
          source: edge.source,
          target: edge.target,
          kind: edge.kind,
        },
      })),
    ];

    cy.elements().remove();
    cy.add(elements);

    // Mark entry points (nodes with outgoing edges but no incoming)
    cy.nodes().forEach((node) => {
      const hasOutgoing = node.outgoers("edge").length > 0;
      const hasIncoming = node.incomers("edge").length > 0;
      if (hasOutgoing && !hasIncoming) {
        node.addClass("entry-point");
      }
    });

    cy.layout({
      name: "cose",
      fit: true,
      padding: 30,
      spacingFactor: 1.5,
    }).run();

    cy.fit(undefined, 10);
  }

  // React to data changes
  createEffect(() => {
    props.data; // Track dependency
    updateGraph();
  });

  // React to filter changes
  createEffect(() => {
    const filter = props.filter?.toLowerCase() || "";
    if (!cy) return;

    cy.nodes().forEach((node) => {
      const data = node.data() as GraphNode;
      const matches =
        !filter ||
        data.name.toLowerCase().includes(filter) ||
        data.file_path.toLowerCase().includes(filter) ||
        data.id.toLowerCase().includes(filter);

      if (matches) {
        node.removeClass("filtered-out");
        node.connectedEdges().removeClass("filtered-out");
      } else {
        node.addClass("filtered-out");
      }
    });
  });

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        "background-color": "#1a1a2e",
      }}
    />
  );
}
