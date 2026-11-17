#!/usr/bin/env bash
# Wrapper for drift-check.mjs. Requires Node 24+.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "node is required (24+). Install Node, or run: node $DIR/drift-check.mjs"; exit 2; }
exec node "$DIR/drift-check.mjs" "$@"
