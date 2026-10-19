#!/usr/bin/env bash
# Wrapper for wf-diff.mjs. Requires Node 20+.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/wf-diff.mjs" "$@"
