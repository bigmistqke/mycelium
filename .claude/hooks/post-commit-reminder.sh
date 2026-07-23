#!/bin/bash
# post-commit-reminder.sh
# Runs after git commit to remind Claude to link the commit to a knowledge node
# Uses exit code 2 to ensure Claude sees the message and acts on it

KNOWLEDGE_DIR="experiments/v4/docs/knowledge"

# Check if the knowledge graph exists in this project
if [ ! -d "$KNOWLEDGE_DIR" ]; then
    exit 0
fi

# Read the input JSON to check if this was a git commit
input=$(cat)
command=$(echo "$input" | grep -o '"command":"[^"]*"' | head -1 | sed 's/"command":"//;s/"$//')

# Only trigger on git commit commands
if ! echo "$command" | grep -qE '^git commit'; then
    exit 0
fi

# Get the commit hash that was just created
commit_hash=$(git rev-parse --short HEAD 2>/dev/null)
commit_msg=$(git log -1 --format=%s 2>/dev/null)

# Output reminder to stderr (exit 2 ensures Claude sees and processes this)
cat >&2 << EOF
+===================================================================+
|  KNOWLEDGE GRAPH: Link this commit to a knowledge node!           |
+===================================================================+
|  Commit: $commit_hash "$commit_msg"
|                                                                   |
|  Closing out an action you already logged? Add the hash to its    |
|  <knowledge-commit> field by hand - the CLI only creates new       |
|  nodes, it doesn't update existing ones yet.                      |
|                                                                   |
|  New outcome node instead, use the CLI, don't hand-author:        |
|    pnpm --filter @mycelium/v4 mycelium knowledge add outcome \\    |
|      --title "..." --confidence NN --commit $commit_hash --file <slug>
|                                                                   |
|  Either way, link it:                                             |
|    pnpm --filter @mycelium/v4 mycelium knowledge link <from> <to> \\
|      --rel leads_to --label "..."
+===================================================================+
EOF

# Exit 2 to ensure Claude processes this as important feedback
exit 2
