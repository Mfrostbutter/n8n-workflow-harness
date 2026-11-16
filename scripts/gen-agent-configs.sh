#!/usr/bin/env bash
# Wrapper for gen-agent-configs.mjs. Requires Node 24+.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/gen-agent-configs.mjs" "$@"
