#!/usr/bin/env bash
# One-time setup for a fresh clone. Idempotent: safe to run again.
#
# Usage:
#   ./setup.sh                 wire up this clone
#   ./setup.sh --global-skills also copy the 20 skills into ~/.claude/skills/
#   ./setup.sh --dry-run       show what it would do
#
# Does NOT write credentials and does NOT touch an n8n instance.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

GLOBAL=0
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --global-skills) GLOBAL=1; shift ;;
    --dry-run)       DRY=1; shift ;;
    -h|--help)       sed -n '2,9p' "${BASH_SOURCE[0]}" | sed -E 's/^# ?//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

run() { if [ "$DRY" = 1 ]; then echo "  would: $*"; else "$@"; fi; }

echo "== node"
if command -v node >/dev/null 2>&1; then
  V="$(node --version | sed 's/^v//')"; MAJ="${V%%.*}"
  if [ "$MAJ" -ge 20 ] 2>/dev/null; then echo "  node $V"
  else echo "  node $V is too old. Install Node 20+ and re-run." >&2; exit 2; fi
else
  echo "  node not found. Install Node 20+ and re-run." >&2; exit 2
fi

echo "== script permissions"
run chmod +x scripts/*.sh .claude/hooks/*.sh
echo "  scripts and hooks are executable"

echo "== n8n-mcp (the engine: node schemas, validation, templates)"
PIN="$(node -p "require('./package.json').dependencies['n8n-mcp']" 2>/dev/null || echo '?')"
if [ -f node_modules/n8n-mcp/package.json ]; then
  HAVE="$(node -p "require('./node_modules/n8n-mcp/package.json').version" 2>/dev/null || echo '?')"
  if [ "$HAVE" = "$PIN" ]; then
    echo "  n8n-mcp $HAVE already installed (pinned $PIN)"
  else
    echo "  installed $HAVE but pinned $PIN: reinstalling"
    run npm ci --no-fund --no-audit
  fi
else
  echo "  installing n8n-mcp $PIN (~100 MB: it carries the prebuilt node database)"
  if [ -d vendor/npm-cache ]; then
    echo "  using vendor/npm-cache (offline)"
    run npm ci --offline --cache vendor/npm-cache --no-fund --no-audit
  else
    run npm ci --no-fund --no-audit
  fi
fi

echo "== .env"
if [ -f .env ]; then
  echo "  .env already exists, left alone"
else
  run cp .env.example .env
  echo "  created .env from .env.example (fill it in; it is gitignored)"
fi

echo "== git"
if [ -d .git ]; then
  echo "  git repository present"
else
  run git init -q
  echo "  git initialized. Commit before your first change: that is the rollback point."
fi

if [ "$GLOBAL" = 1 ]; then
  echo "== global skills"
  DEST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  run mkdir -p "$DEST"
  for src in .claude/skills/*/; do
    name="$(basename "$src")"
    if [ -d "$DEST/$name" ]; then
      BK="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills-backup-$STAMP"
      run mkdir -p "$BK"
      run cp -R "$DEST/$name" "$BK/$name"
      run rm -rf "$DEST/$name"
      echo "  replaced $name (backup in skills-backup-$STAMP/)"
    else
      echo "  installed $name"
    fi
    run cp -R "$src" "$DEST/$name"
  done
  echo "  Skills are now global. They also load per-project from .claude/skills/."
fi

echo
if [ "$DRY" = 1 ]; then echo "(dry run: nothing changed)"; exit 0; fi

echo "== preflight"
./scripts/verify-setup.sh || true

cat <<'NEXT'

Next:
  1. Fill .env with your dev instance URL and API key.
  2. Launch Claude Code with the environment loaded:

       set -a; . ./.env; set +a; claude

     .mcp.json reads N8N_API_URL from the process environment, not from the
     file on disk. Approve both MCP servers when prompted.
  3. Confirm the instance is reachable:  ./scripts/doctor.sh
  4. Snapshot before changing anything:  ./scripts/export-all.sh && git add -A && git commit -m "baseline"

  Handing this to Claude instead? Paste AI_SETUP_PROMPT.md into a fresh session.
NEXT
