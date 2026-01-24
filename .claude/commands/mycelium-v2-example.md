# Create v2 Example

Protocol for creating a full-gradient example in `packages/v2/examples/`.

## 1. Define Intent

Start with the user's request. What function/behavior do they want?

- Name it
- Describe it in plain language
- What are the inputs/outputs?

## 2. Write Tests First

Before implementation, define tests at the function layer:

```json
"tests": [
  { "in": { "a": ..., "b": ... }, "out": ... },
  ...
]
```

These tests ARE the intent. Cover:
- Normal cases
- Edge cases (zero, negative, equal values)
- Boundary conditions

## 3. Build Layers Top-Down

### Vision (optional for small examples)
```json
{ "id": "vision-...", "layer": "vision", "title": "..." }
```

### Architecture (optional for small examples)
```json
{ "id": "arch-...", "layer": "architecture", "title": "..." }
```

### Component (optional for small examples)
```json
{ "id": "comp-...", "layer": "component", "title": "..." }
```

### Function (required)
```json
{
  "id": "func-...",
  "layer": "function",
  "title": "name",
  "inputs": ["a: type", "b: type"],
  "outputs": ["type"],
  "description": "What it does",
  "tests": [...]
}
```

### Dataflow (required)
Flat DAG with explicit wiring:
```json
{
  "id": "flow-...",
  "layer": "dataflow",
  "nodes": [
    { "id": "a", "kind": "input" },
    { "id": "b", "kind": "input" },
    { "id": "op1", "kind": "op", "op": "i32.add" },
    { "id": "result", "kind": "output" }
  ],
  "edges": [
    { "from": "a", "to": "op1", "port": 0 },
    { "from": "b", "to": "op1", "port": 1 },
    { "from": "op1", "to": "result" }
  ]
}
```

Node kinds: `input`, `output`, `op`, `const`, `select`

### AST (required)
Nested tree structure:
```json
{
  "id": "ast-...",
  "layer": "ast",
  "root": {
    "kind": "func",
    "name": "...",
    "params": [{ "name": "a", "type": "i32" }],
    "result": "i32",
    "body": { ... }
  }
}
```

AST node kinds: `func`, `op`, `local.get`, `const`, `select`, `if`

## 4. Connect Layers

```json
"edges": [
  { "from": "vision-...", "to": "arch-...", "type": "motivates" },
  { "from": "arch-...", "to": "comp-...", "type": "contains" },
  { "from": "comp-...", "to": "func-...", "type": "exposes" },
  { "from": "func-...", "to": "flow-...", "type": "implemented_by" },
  { "from": "flow-...", "to": "ast-...", "type": "compiles_to" }
]
```

## 5. Verify

- [ ] Tests cover intent
- [ ] Dataflow nodes match function signature
- [ ] AST structure matches dataflow operations
- [ ] All layers connected with appropriate edge types

## 6. Save

Save to `packages/v2/examples/NN_name.json` where NN is sequence number.

## File naming

- `00_max.json` - max(a, b)
- `01_abs.json` - abs(x)
- `02_clamp.json` - clamp(x, min, max)
- etc.
