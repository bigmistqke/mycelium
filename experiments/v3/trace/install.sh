#!/usr/bin/env bash
# Install the trace hook into this repository.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
HERE="$(cd "$(dirname "$0")" && pwd)"
ln -sf "$HERE/commit-msg" "$ROOT/.git/hooks/commit-msg"
chmod +x "$HERE/commit-msg" "$HERE/trace"
echo "installed: .git/hooks/commit-msg -> packages/v3/trace/commit-msg"
echo "every commit must now cite the decision it serves."
