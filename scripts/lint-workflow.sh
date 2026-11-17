#!/usr/bin/env bash
# Wrapper for lint-workflow.mjs. Requires Node 24+.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/lint-workflow.mjs" "$@"
