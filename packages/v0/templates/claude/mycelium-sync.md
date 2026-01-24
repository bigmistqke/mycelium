---
description: Analyze TypeScript codebase and update the mycelium graph
allowed-tools: Bash(mycelium:*, git:*)
---

# Mycelium Sync

Analyzes the TypeScript codebase and updates the semantic graph.

## Step 1: Run Sync

```bash
mycelium sync
```

This will:
1. Parse all TypeScript files
2. Extract functions and their signatures
3. Build the call graph (who calls whom)
4. Detect entry points (call graph roots)
5. Store everything with the current git commit SHA

## Step 2: Review Results

```bash
# See all entities
mycelium query entities

# See entry points (call graph roots)
mycelium query entry-points

# Check what needs descriptions
mycelium descriptions --missing
```

## Step 3: Generate Descriptions (Optional)

For each entity missing a description:

```bash
# View entity details
mycelium describe "src/module.ts::functionName"

# Set description after analyzing the code
mycelium describe "src/module.ts::functionName" "Description of what this function does"
```

## After Sync

The graph is stored in `.mycelium/graph.db` with the commit SHA.
You can query historical snapshots:

```bash
mycelium history                    # List commits in database
mycelium diff <from> <to>          # Compare two commits
mycelium query entities --at <sha>  # Query at specific commit
```
