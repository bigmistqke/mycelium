---
description: Name and manage code communities detected by mycelium
allowed-tools: Bash(mycelium:*)
argument-hint: [name | list | detect]
---

# Mycelium Community

Name and manage code communities (automatically detected code groupings).

## Based on $ARGUMENTS:

### If "name" or no argument:

Name all unnamed communities with 2+ members.

### If "list":

Show all communities with their current names.

### If "detect":

Re-run community detection (preserves user-named communities via overlap).

## Naming Workflow

### Step 1: Get Unnamed Communities

```bash
mycelium community list --unnamed --members
```

This shows communities that need naming, with all their members listed.

### Step 2: Analyze Each Community

For each unnamed community, look at the member functions:
- What file(s) are they from?
- What do they have in common?
- What subsystem or feature do they represent?

### Step 3: Choose Meaningful Names

Good naming patterns:
- `auth-system` - feature/domain based
- `database-queries` - functionality based
- `scope-analysis` - what the code does
- `test-*` - prefix test fixtures

Avoid:
- Generic names like `utils`, `helpers`
- Names that duplicate file paths
- Single-word names without context

### Step 4: Rename Communities

```bash
mycelium community rename <old-name> <new-name>
```

Example:
```bash
mycelium community rename src-4 variable-analysis
mycelium community rename community-12 louvain-detector
```

### Step 5: Verify

```bash
# Check no unnamed communities remain
mycelium community list --unnamed

# Re-run detect to verify names persist
mycelium community detect
```

## Commands Reference

```bash
# List all communities
mycelium community list

# List unnamed communities with members (AI-friendly)
mycelium community list --unnamed --members

# Show specific community
mycelium community show <name>

# Rename a community (marks as user-named)
mycelium community rename <id-or-name> <new-name>

# Add description to community
mycelium community describe <id-or-name> "Description text"

# Re-run detection (preserves user names via 70%+ overlap)
mycelium community detect
```

## Name Preservation

When re-running `mycelium community detect`:
- User-named communities are matched to new communities via Jaccard overlap
- If overlap >= 70%, the name is preserved
- Each name can only be assigned to one community (highest overlap wins)

This means you can safely re-run detection after code changes without losing your names.
