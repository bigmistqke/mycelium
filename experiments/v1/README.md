# v1: Graph → WAT + Constraints

Structural skeleton experiment. Proves you can go from graph structure to code scaffolding.

## What it does

- **Graph schema**: Recursive box model (nodes with ports, children, edges, constraints)
- **WAT generation**: Graph → WAT function signatures with constraint comments
- **WAT parsing**: WAT → Graph (recovers structure, loses metadata)
- **Constraint validation**: Checks `must_connect`, `must_not_connect` across edges

## CLI

```bash
# Generate WAT from graph
mycelium generate graph.json -o output.wat

# Validate constraints
mycelium validate graph.json

# Parse WAT back to graph
mycelium parse input.wat -o graph.json
```

## Limitations

- Generates scaffolding only (`;; TODO: implementation`)
- Constraints are structural, not semantic (can't verify `pure` without implementation)
- Metadata (edges, constraints) only preserved in comments, not recovered on parse

## What v1 is NOT

- Not the full gradient from intent to code
- Not bidirectional (editing WAT doesn't update graph)
- Not a compiler (no actual code generation)

v1 sits at the structure→scaffold layer. See v2 for the full gradient experiment.
