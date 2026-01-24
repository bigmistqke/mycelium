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
│ Layer 2: AI Synthesis + Validation  │
│ - Graph → code derivation           │
│ - Static analysis / constraints     │
│ - Conflict detection, clustering    │
│ - Simulation and verification       │
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

**Constraint-aware synthesis**: AI doesn't just generate code—it validates against declared invariants. Type-checking for intent, not just syntax.

**Simulation before execution**: Run the intent graph to check for conflicts, validate dataflow, stress-test constraints—before committing to artifacts.

## Two Graphs, One Substrate

**Deciduous** captures *why*: decisions, goals, options considered, outcomes observed. The reasoning history.

**Mycelium** captures *what*: semantic structure, scope boundaries, data-flow, side-effects. The topology of the system.

Together they form the shared intent substrate:
- Deciduous tracks the human reasoning that led to choices
- Mycelium tracks the structural consequences of those choices
- Both are queryable by humans and AI
- Neither requires constant manual maintenance

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

## What's Missing

To get from v0 to the vision:

1. **Constraint encoding**: Express invariants in the graph, not just in prose
2. **Bidirectional sync**: Changes to source update the graph automatically (v0 does this); changes to graph update source (not yet)
3. **Simulation layer**: Execute the graph to validate constraints before deriving code
4. **Synthesis from graph**: AI derives code from graph structure, not from scratch each time
5. **Unified deciduous + mycelium**: One interface for reasoning history + semantic structure

## The Collaboration Model

```
Human: shapes structure, declares constraints, makes decisions
   ↓
Graph: persistent, queryable, shared between sessions
   ↓
AI: proposes refinements, synthesizes details, validates constraints
   ↓
Artifacts: derived, not primary; updated when graph changes
```

LLMs become the assistant layer—spitballing ideas, calling CLI tools, synthesizing text—but not the design substrate itself. The graph is the substrate. Both human and AI operate on it.

## Why This Matters

- **No more context loss**: The graph survives session boundaries
- **No more architectural decay**: Intent can't silently diverge from implementation
- **No more reverse-engineering**: The *why* is encoded alongside the *what*
- **No more maintenance burden**: The graph is the work, not a side artifact

The ultimate goal: programming becomes specifying and constraining system intent. Code becomes compilation.
