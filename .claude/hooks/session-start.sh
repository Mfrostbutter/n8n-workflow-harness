#!/usr/bin/env bash
# SessionStart: inject the harness contract so the rules are loaded from turn
# one instead of depending on a skill description matching the prompt.
# Fails open: any error means no context, never a broken session.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CTX="$ROOT/.claude/hooks/session-context.md"
[ -f "$CTX" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

node -e '
const fs = require("fs");
let t = fs.readFileSync(process.argv[1], "utf8");
const target = process.env.N8N_API_URL || "not set (docs mode only: the managed n8n server cannot reach an instance)";
t = t.split("{{TARGET}}").join(target);
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: t }
}));
' "$CTX" 2>/dev/null || exit 0
