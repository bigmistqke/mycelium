#!/bin/bash
# require-action-node.sh
# Blocks Edit/Write tools if no recent goal/action knowledge node exists
# Exit code 2 = block the tool and show error to Claude

KNOWLEDGE_DIR="experiments/v4/docs/knowledge"

# Check if the knowledge graph exists in this project
if [ ! -d "$KNOWLEDGE_DIR" ]; then
    # No knowledge graph in this project, allow all edits
    exit 0
fi

# Writing a goal or action node is itself always allowed - it's what
# satisfies this gate, so the gate can't also block it. Without this,
# there's no way to ever write the first node of a fresh window: every
# Write is blocked until a recent goal/action file exists, and writing
# one is itself a Write.
input=$(cat)
file_path=$(echo "$input" | grep -o '"file_path":"[^"]*"' | head -1 | sed 's/"file_path":"//;s/"$//')

case "$file_path" in
    *"$KNOWLEDGE_DIR"/*.goal.html|*"$KNOWLEDGE_DIR"/*.action.html)
        exit 0
        ;;
esac

# No nodes at all - fresh project, allow edits
any_node=$(find "$KNOWLEDGE_DIR" -name "*.html" 2>/dev/null | head -1)
if [ -z "$any_node" ]; then
    exit 0
fi

# Check for a goal or action node written or touched in the last 15 minutes
# We check both because starting new work creates a goal first
recent_node=$(find "$KNOWLEDGE_DIR" \( -name "*.goal.html" -o -name "*.action.html" \) -mmin -15 2>/dev/null | head -1)

if [ -n "$recent_node" ]; then
    # Recent node exists, allow the edit
    exit 0
fi

# No recent node - block and provide guidance
cat >&2 << 'EOF'
+===================================================================+
|  KNOWLEDGE GRAPH: No recent goal/action node found                |
+===================================================================+
|  Before editing files, log what you're about to do. Use the CLI,  |
|  don't hand-author:                                                |
|                                                                   |
|  For new work:                                                    |
|    pnpm --filter @mycelium/v4 mycelium knowledge add goal \       |
|      --title "..." --confidence NN --prompt "..." --file <slug>   |
|                                                                   |
|  For implementation:                                              |
|    pnpm --filter @mycelium/v4 mycelium knowledge add action \     |
|      --title "..." --confidence NN --file <slug>                  |
|                                                                   |
|  Then link it to its parent immediately:                          |
|    pnpm --filter @mycelium/v4 mycelium knowledge link <new> \     |
|      <parent> --rel depends_on --label "..."                      |
+===================================================================+
EOF

exit 2
