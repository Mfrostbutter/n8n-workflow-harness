#!/usr/bin/env bash
# Wrapper for lint-workflow.mjs. Requires Node 20+.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/lint-workflow.mjs" "$@"
