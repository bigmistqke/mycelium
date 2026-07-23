#!/bin/bash
# post-commit-reminder.sh
# Runs after git commit to remind Claude to link the commit to a knowledge node
# Uses exit code 2 to ensure Claude sees the message and acts on it

KNOWLEDGE_DIR="experiments/v4/knowledge"

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
|  Write or update a knowledge-outcome node:                        |
|    experiments/v4/knowledge/<slug>.outcome.html                   |
|    <knowledge-commit>$commit_hash</knowledge-commit>
|                                                                   |
|  Or if this was mid-work (not a completed outcome), a              |
|  knowledge-action node instead, same field.                       |
|                                                                   |
|  Either way, link it: <a data-rel="leads_to" href="./parent…">    |
+===================================================================+
EOF

# Exit 2 to ensure Claude processes this as important feedback
exit 2
