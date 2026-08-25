#!/usr/bin/env bash
# Wrapper for doctor.mjs. Requires Node 20+.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "node is required (20+). Install Node, or run: node $DIR/doctor.mjs"; exit 2; }
exec node "$DIR/doctor.mjs" "$@"
