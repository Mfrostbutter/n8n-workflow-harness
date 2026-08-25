#!/usr/bin/env bash
# Refreshes the fifteen vendored skills from upstream n8n-skills, wholesale.
# The five harness-original skills are never touched.
#
# Usage: ./scripts/refresh-skills.sh [--ref <branch|tag>] [--dry-run]
#
# Vendored skills are replaced, not merged: local edits to them are lost by
# design (see ATTRIBUTION.md). Review the diff and commit deliberately.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

UPSTREAM="https://github.com/czlonkowski/n8n-skills.git"
REF="main"
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ref)     REF="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed -E 's/^# ?//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

VENDORED="using-n8n-mcp-skills n8n-mcp-tools-expert n8n-workflow-patterns
n8n-node-configuration n8n-expression-syntax n8n-validation-expert
n8n-code-javascript n8n-code-python n8n-code-tool n8n-agents
n8n-binary-and-data n8n-error-handling n8n-multi-instance n8n-self-hosting
n8n-subworkflows"

# Never overwritten by this script.
ORIGINAL="n8n-instance-ops n8n-enterprise-delivery n8n-node-dev n8n-gotchas n8n-canvas-docs"

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== cloning $UPSTREAM ($REF)"
git clone --depth 1 --branch "$REF" --quiet "$UPSTREAM" "$TMP/up" \
  || { echo "clone failed. No network, or bad ref: $REF" >&2; exit 1; }

SRC=""
for c in "$TMP/up/skills" "$TMP/up"; do
  [ -d "$c/using-n8n-mcp-skills" ] && { SRC="$c"; break; }
done
[ -n "$SRC" ] || { echo "cannot locate skills in upstream layout. Inspect $TMP/up" >&2; exit 1; }

UPVER="$(git -C "$TMP/up" rev-parse --short HEAD)"
echo "== upstream commit $UPVER"

MISSING=""
for s in $VENDORED; do
  [ -d "$SRC/$s" ] || MISSING="$MISSING $s"
done
if [ -n "$MISSING" ]; then
  echo "upstream no longer ships:$MISSING" >&2
  echo "The pack was restructured. Refresh by hand and update ATTRIBUTION.md." >&2
  exit 1
fi

for s in $VENDORED; do
  if [ "$DRY" = 1 ]; then
    echo "  would replace: $s"
  else
    rm -rf ".claude/skills/$s"
    cp -R "$SRC/$s" ".claude/skills/$s"
    echo "  replaced: $s"
  fi
done

if [ "$DRY" = 0 ]; then
  find .claude/skills -name '.DS_Store' -delete 2>/dev/null || true
  echo
  echo "== untouched (original to this harness)"
  for s in $ORIGINAL; do echo "  kept: $s"; done
  echo
  echo "Upstream commit: $UPVER"
  echo "Next: git diff --stat, note the version in ATTRIBUTION.md, then commit."
fi
