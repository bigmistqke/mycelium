---
description: Generate descriptions for TypeScript entities in the mycelium graph
allowed-tools: Bash(mycelium:*), Read
argument-hint: [entity-id or "all" or "missing"]
---

# Mycelium Describe

Generate and store descriptions for TypeScript entities.

## Based on $ARGUMENTS:

### If "missing" or no argument:

```bash
# Get entities without descriptions
mycelium descriptions --missing
```

Then for each entity:
1. Read the source file to understand the implementation
2. Generate a concise description
3. Store it with `mycelium describe`

### If "all":

```bash
# Get all entities
mycelium query entities
```

Then describe each one (will overwrite existing).

### If specific entity ID:

```bash
# Get entity details
mycelium describe "$ARGUMENTS"
```

## Workflow

### Step 1: Get Entity Info

```bash
mycelium describe "src/module.ts::functionName"
```

This shows:
- Signature
- File location
- Current description (if any)

### Step 2: Read Source Code

Read the actual implementation:

```bash
# Use Read tool to view the source file at the line number shown
```

### Step 3: Generate Description

Based on:
- Function signature (parameters, return type)
- Implementation details
- What it calls (use `mycelium query calls <id>`)
- Who calls it (use `mycelium query callers <id>`)

Write a concise description that explains:
- **What** the function does
- **Why** it exists (its purpose in the system)
- Any important behavior or side effects

### Step 4: Store Description

```bash
mycelium describe "src/module.ts::functionName" "Your description here"
```

Or for longer descriptions:

```bash
echo "Multi-line description
that explains the function
in detail" | mycelium describe "src/module.ts::functionName" --stdin
```

## Description Guidelines

- **Concise**: 1-3 sentences for most functions
- **Purpose-focused**: Explain WHY not just WHAT
- **Context-aware**: Mention important callers/callees if relevant
- **Technical but clear**: Use precise terms but be readable

## Examples

Good:
```
"Retrieves all entities from the graph database, optionally filtered by commit SHA. Returns the latest version of each entity if no commit is specified."
```

Bad:
```
"Gets entities"  # Too vague
"This function takes an optional commitSha parameter and queries the database..."  # Restates signature
```
