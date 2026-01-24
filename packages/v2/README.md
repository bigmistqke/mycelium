# v2: Full Gradient Experiment

Exploring the full gradient from vision to AST in a unified graph.

## Core thesis

Mycelium is a **compiler of intent**. The graph represents multiple abstraction layers, from human goals down to executable code. Each layer serves a purpose:

| Layer | Has description? | Purpose |
|-------|------------------|---------|
| Vision | yes | Why this exists |
| Architecture | yes | System organization |
| Component | yes | Grouping/coordination |
| Function | yes | Signature/contract (last described layer) |
| Dataflow | no | Data dependencies (flat DAG, shared nodes) |
| AST | no | Syntactic structure (nested tree) → generates code |

## Key insight

- **Dataflow** = flat DAG with explicit wiring, nodes shared
- **AST** = nested tree with duplicated references
- Code is generated FROM the AST, not stored as strings

## Edge types

Cross-layer edges with semantic meaning:

- `motivates` — vision → architecture
- `contains` — architecture → component
- `exposes` — component → function
- `implemented_by` — function → dataflow
- `compiles_to` — dataflow → AST

## Prior art informing this design

- **MLIR**: Multiple abstraction levels in one IR via dialects, progressive lowering
- **Nanopass**: Many small verified transformations between representations
- **Refinement types**: Specs embedded in code, verified at compile time
- **LVS (chip design)**: Structural verification that implementation matches intent

## Status

Hand-written JSON exploration. No tooling yet. See `examples/calculator.json`.

## What's next

- Verification approaches (LVS-style structural, simulation/mocking, property-based)
- Code generation from AST layer
- Introspection: trace any LOC back through layers to vision
