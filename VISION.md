# Mycelium Vision

## The Problem

Code embodies intent but doesn't expose it cleanly. It's optimized for deterministic execution, not semantic clarity.

```
intent → design → code
```

But the only persistent artifact is the last one. Intent and design evaporate into tacit assumptions, mental models, and tribal knowledge. Comments rarely help—they drift out of sync and often signal that the code itself isn't clear enough.

Reading code becomes an inverse problem:

```
code → inferred design → reconstructed intent
```

LLMs and humans are doing this inverse transform constantly. Context gets filled with noise. Every interaction requires re-interpreting what exists to decode and encode intent from it.

## The Insight

What if we flip the ontology?

```
intent → graph → code (derived)
```

Code becomes a compilation target. Intent becomes the source. The graph is the shared substrate where both humans and AI operate.

## v0: Analyzing What Exists

The first exploration (`packages/v0`) goes in one direction:

```
existing code → static analysis → semantic graph
```

It extracts:
- Functions, types, classes, variables
- Call relationships (who calls whom)
- Side-effects (reads/writes to shared state)
- Scope boundaries and crossings
- Data-flow dependencies

This is valuable for understanding existing codebases. But it's still working backwards from artifacts.

## The Vision: Intent-First Programming

The end goal is the inverse direction:

```
human intent → shared graph → AI synthesis → executable artifacts
```

### Layered Architecture

```
┌─────────────────────────────────────┐
│ Layer 0: Human Intent               │
│ - Goals, constraints, tradeoffs     │
│ - Natural language reasoning        │
│ - Decision rationale (deciduous)    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Layer 1: Shared Intent Graph        │
│ - Nodes: components, tasks, goals   │
│ - Edges: dependencies, dataflow     │
│ - Attributes: constraints, status   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Layer 2: Synthesis + Validation     │
│ - AI: graph → code derivation       │
│ - Tools: static analysis, types     │
│ - Tools: conflict detection         │
│ - Tools: simulation, verification   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Layer 3: Executable Artifacts       │
│ - Code (WASM, TypeScript, etc.)     │
│ - Tests derived from constraints    │
│ - Documentation from intent         │
└─────────────────────────────────────┘
```

### Key Properties

**Bidirectional mapping**: Changes to the intent graph update code. Changes to code update the intent graph. Without bidirectionality, architectural drift still happens.

**Macro/micro layering**: Humans handle structure and constraints (macro). AI fills in implementation details (micro). Like sketching composition and having a model paint in texture.

**Deterministic validation**: Constraints are checked by static analysis and CLI tools, not LLMs. Type-checking for intent, not just syntax. AI drives the conversation; tools verify the results.

**Simulation before commitment**: Like electrical engineers use SPICE before committing to silicon, simulate the intent graph before deriving code. Run dataflow, check for conflicts, stress-test constraints, explore "what-if" scenarios. Catch architectural mistakes before they become artifacts that AI keeps painting on top of.

## Dual-Mode Representation

The shared intent space has two interlocking layers:

**Linguistic / Narrative Layer**
- Humans express goals, constraints, rationale
- Flexible, intuitive, supports brainstorming
- Ambiguous, hard to compile directly

**Structural / Graph Layer**
- Explicit nodes/edges for components, dataflow, dependencies
- Machine-readable, allows simulation and validation
- Grows combinatorially, requires curation

### Bridging the Two

Words drive graph creation and refinement. Graph operations feed back to narrative ("This node violates constraint X"). The user speaks intent; AI proposes graph structure.

### The Messy Graph Problem

Graphs explode because every node and edge is visible. This is a UX problem, not inherent. Mitigations:

- **Hierarchical abstraction**: Collapse into subgraphs/modules
- **Semantic folding**: Show only nodes relevant to current focus
- **Temporal layers**: Older decisions fade unless queried
- **Hybrid views**: Toggle macro (goals) vs micro (dataflow)
- **AI-driven cleanup**: Detect redundancy, suggest merges

### Minimizing Maintenance

The burden that kills SPECS.md and architectural diagrams. Reduce it through:

- **Two-way sync**: Edit words → graph updates; edit graph → words summarize
- **Change tracking**: System highlights inconsistencies
- **Auto-pruning**: Merge redundant nodes, collapse low-impact decisions
- **Live feedback**: See consequences before committing

Human resolves conflicts, not redraws everything.

## Two Graphs, One Substrate

**Deciduous** captures *why*: decisions, goals, options considered, outcomes observed. The reasoning history.

**Mycelium** captures *what*: semantic structure, scope boundaries, data-flow, side-effects. The topology of the system.

Together they form the shared intent substrate:
- Deciduous tracks the human reasoning that led to choices
- Mycelium tracks the structural consequences of those choices
- Both are queryable by humans and AI
- Neither requires constant manual maintenance

## Lessons from Electronic Engineering

Hardware design solved these problems decades ago. Software can learn from it.

### The EE Stack

```
Specification / Requirements
        ↓
Block Diagrams (functional decomposition)
        ↓
Behavioral Models (simulate before building)
        ↓
RTL / HDL (structural description)
        ↓
Synthesis (automated gate-level derivation)
        ↓
Physical Layout (the actual artifact)
```

At every level, engineers can:
- **Simulate** before committing to the next level
- **Verify** against constraints from higher levels
- **Iterate** without touching the final artifact

### What Software Lacks

Software jumps straight from fuzzy intent to implementation:

```
Vague requirements → Code → Hope it works
```

We lack:
- **Behavioral models**: No way to simulate intent before coding
- **Hierarchical abstraction**: Code is flat; architecture lives in heads
- **Constraint propagation**: Invariants aren't enforced across levels
- **Synthesis**: Humans write all the glue; nothing is derived

### Bringing EE Practices to Code

| EE Concept | Software Equivalent |
|------------|---------------------|
| Block diagrams | Intent graph (components, dataflow) |
| Behavioral simulation | Graph execution, "what-if" analysis |
| Constraint-driven synthesis | Derive code from graph + invariants |
| Hierarchical refinement | Macro (architecture) → micro (implementation) |
| Design rule checking | Static analysis against declared constraints |
| Formal verification | Prove properties hold across the graph |

The intent graph is the "schematic" of software. Code is the "layout"—derived, not primary.

### Why This Works in EE

1. **The model is executable**: You can run a block diagram before building hardware
2. **Constraints flow down**: High-level requirements constrain low-level choices
3. **Synthesis is automated**: HDL → gates is done by tools, not humans
4. **Simulation catches errors early**: Before you commit to expensive artifacts

Software has none of this. We write code directly, then try to reverse-engineer whether it matches intent.

## AI Techniques Beyond LLMs

LLMs are stochastic approximators, not solvers. They're good at fuzzy reasoning and synthesis, but constraint enforcement needs deterministic tools. The future stack likely combines multiple AI approaches:

### Relevant Techniques

**Diffusion models / iterative refinement**
Not single-shot generation, but a loop: propose → critique → refine → converge. Maps well to architecture evolution.

**Editable latent spaces**
Edit intent directly without patching artifacts. Today's LLMs only let you edit the output (code), not the latent intent that produced it.

**Neuro-symbolic systems**
Symbolic structures (graphs, constraints, types) + neural models share state:
- Symbolic = discrete logic, hard constraints
- Neural = fuzzy generative detail
- Together = intent ↔ implementation bridge

**Differentiable programming / compilers**
Make programs differentiable so gradient-based optimization can search the implementation space.

Traditional compilation:
```
source → fixed rules → output
```

Differentiable compilation:
```
intent + constraints → gradient search → optimal implementation
```

Declare "minimize latency under memory budget X" — instead of hand-optimizing, the compiler explores valid implementations and converges on one satisfying constraints. Relevant tools: JAX, Halide, TVM/MLIR, program synthesis via gradient descent.

**World-model AIs**
Persistent understanding of states, goals, actions, consequences. Avoids stateless LLM drift where each session starts fresh.

**Tool-using agents**
Model invokes: solvers, CLI, compilers, simulators, verifiers. Offloads precise work to deterministic tools instead of hallucinating.

### The Pattern

Human and machine operate on the **same representation of the problem**, not just the artifact.

Today we only share artifacts (tokens, code, diffs). We don't share the latent intent space. The graph is that shared space.

### Division of Labor

| Task | Tool |
|------|------|
| Fuzzy reasoning, ideation | LLMs |
| Structure manipulation | Graph operations |
| Constraint solving | SAT/SMT solvers |
| Type checking | Type systems |
| Simulation | Deterministic execution |
| Synthesis | Compiler/codegen |

LLMs are the "texture generator" — they fill in detail. But the structure comes from the graph, and validation comes from solvers.

## Compilation Targets

Syntax is noise. The ideal target is:
- Minimal syntax (AI-friendly, tree-structured)
- Type-safe (constraints enforced by compiler/VM)
- Portable (runs anywhere)

**WASM/WAT** fits well:
- S-expressions = trees = code as data
- Type-safe at VM level (with GC, reference types)
- Portable: browser, server, edge
- Graph nodes → functions/structs, edges → references/calls

But the compilation target is secondary. The primary artifact is the intent graph. Code is one view of it.

## Roadmap

### v1: Graph ↔ WAT + Simple Constraints

Prove: graph is primary, code is derived, constraints validated deterministically.

**In scope:**
- Simple graph schema (functions, types, modules, calls, dataflow)
- Constraint attributes ("must call X", "pure", "no side effects")
- Graph → WAT generation (deterministic synthesis)
- WAT → Graph parsing (lossless roundtrip)
- Constraint validation CLI (tools verify, not LLM)

**Not in scope:**
- LLM integration (v2)
- UI (CLI only)
- Simulation
- Complex constraint solving

### v2: Words → Graph

Layer LLM on top of v1's symbolic foundation.

- Natural language → graph structure
- LLM interprets intent, proposes nodes/edges
- More expressive constraints (SAT/SMT solving)
- Basic simulation

### v3+: Full Vision

- Differentiable compilation
- Live bidirectional sync
- Collaborative editing
- Production runtime

## What's Missing (from full vision)

To get from here to there:

1. **Constraint encoding**: Express invariants in the graph, not just in prose
2. **Bidirectional sync**: Changes to source update the graph automatically (v0 does this); changes to graph update source (not yet)
3. **Simulation layer**: Execute the graph to validate constraints before deriving code
4. **Synthesis from graph**: AI derives code from graph structure, not from scratch each time
5. **Unified deciduous + mycelium**: One interface for reasoning history + semantic structure

## The Collaboration Model

```
Human ←→ AI: bounce ideas, explore tradeoffs, drive the graph together
      ↓
   Graph: persistent, queryable, shared between sessions
      ↓
   Static analysis / CLI tools: deterministic constraint validation
      ↓
   Artifacts: derived, not primary; updated when graph changes
```

AI is a peer from the start—exploring ideas, asking questions, proposing structure. It understands the graph and keeps the conversation in sync with what's recorded. Validation is separate: static analysis, type checking, and CLI tools provide deterministic verification. LLMs reason; tools verify.

## Why This Matters

- **No more context loss**: The graph survives session boundaries
- **No more architectural decay**: Intent can't silently diverge from implementation
- **No more reverse-engineering**: The *why* is encoded alongside the *what*
- **No more maintenance burden**: The graph is the work, not a side artifact

The ultimate goal: programming becomes specifying and constraining system intent. Code becomes compilation.
