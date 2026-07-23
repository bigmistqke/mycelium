---
description: Explore the mycelium graph - query entities, relations, and entry points
allowed-tools: Bash(mycelium:*)
argument-hint: <query> [target]
---

# Mycelium Explore

Query the semantic graph to understand codebase structure.

## Quick Queries

Based on $ARGUMENTS:

| Query | Command |
|-------|---------|
| `entities` | `mycelium query entities` |
| `entry-points` | `mycelium query entry-points` |
| `calls <id>` | `mycelium query calls "<id>"` |
| `callers <id>` | `mycelium query callers "<id>"` |
| `describe <id>` | `mycelium describe "<id>"` |
| `history` | `mycelium history` |
| `diff <from> <to>` | `mycelium diff <from> <to>` |

## Understanding the Graph

### Entry Points

Entry points are **call graph roots** - functions that:
- Have outgoing calls (they call other functions)
- Have no incoming calls (nothing calls them)

These typically represent:
- API handlers
- CLI commands
- Event handlers
- Main entry points

```bash
mycelium query entry-points
```

### Call Graph

Explore how functions connect:

```bash
# What does this function call?
mycelium query calls "src/db.ts::GraphStore.getEntities"

# What calls this function?
mycelium query callers "src/hash.ts::computeHash"
```

### Temporal Queries

The graph is versioned by git commit:

```bash
# See all commits in the database
mycelium history

# Query at a specific commit
mycelium query entities --at abc123

# See what changed between commits
mycelium diff abc123 def456
```

## Common Exploration Patterns

### 1. Understand a Module

```bash
# List all functions in a file
mycelium query entities | grep "src/db.ts"

# For each, check what it calls
mycelium query calls "src/db.ts::GraphStore.getEntities"
```

### 2. Trace a Call Chain

```bash
# Start from entry point
mycelium query entry-points

# Follow calls down
mycelium query calls "entry-point-id"
mycelium query calls "next-function-id"
# ... continue down the chain
```

### 3. Find Impact of Changes

```bash
# What calls this function? (will be affected by changes)
mycelium query callers "src/utils.ts::helperFunction"
```

### 4. Review Descriptions

```bash
# See all descriptions
mycelium descriptions

# Find undocumented functions
mycelium descriptions --missing
```
