#!/usr/bin/env bash
# Offline preflight: is this clone wired correctly? No instance needed.
# Run it after cloning, and again whenever something feels wrong.
#
# Usage: ./scripts/verify-setup.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# --fast skips the server handshake, which loads a ~94 MB node database.
FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

FAIL=0
PASS=0
ok()   { echo "  ok    $*"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $*"; FAIL=$((FAIL+1)); }
note() { echo "  note  $*"; }

echo "== prerequisites"
if command -v node >/dev/null 2>&1; then
  V="$(node --version | sed 's/^v//')"
  MAJ="${V%%.*}"
  if [ "$MAJ" -ge 20 ] 2>/dev/null; then ok "node $V"
  else bad "node $V is too old. Need 20+."; fi
else
  bad "node not found. Install Node 20+; the toolkit and the MCP servers need it."
fi
command -v npx >/dev/null 2>&1 && ok "npx present" || bad "npx not found (ships with Node)"
command -v git >/dev/null 2>&1 && ok "git present" || bad "git not found"
command -v claude >/dev/null 2>&1 && ok "claude CLI present" \
  || note "claude CLI not on PATH. Install Claude Code to use this harness."

echo
echo "== repository wiring"
[ -f .mcp.json ] && ok ".mcp.json present" || bad ".mcp.json missing"
[ -f CLAUDE.md ] && ok "CLAUDE.md present" || bad "CLAUDE.md missing"
[ -d .git ] && ok "git repository (rollback is possible)" \
  || bad "not a git repository. Run: git init"
[ -f .gitignore ] && ok ".gitignore present" || bad ".gitignore missing: .env would be committable"

if [ -f .mcp.json ] && command -v node >/dev/null 2>&1; then
  node -e '
    const c = JSON.parse(require("fs").readFileSync(".mcp.json","utf8"));
    const s = c.mcpServers || {};
    const want = ["n8n-docs","n8n"];
    const missing = want.filter(n => !s[n]);
    if (missing.length) { console.log("  FAIL  .mcp.json missing server(s): "+missing.join(", ")); process.exit(3); }
    if (s["n8n-docs"].env && s["n8n-docs"].env.N8N_API_URL) {
      console.log("  FAIL  n8n-docs must NOT carry N8N_API_URL: keep docs mode credential-free");
      process.exit(3);
    }
    const usesLauncher = want.every(n => (s[n].args||[]).some(a => String(a).includes("mcp-server.mjs")));
    console.log("  ok    .mcp.json declares both servers, docs mode is credential-free");
    if (usesLauncher) console.log("  ok    both servers use the pinned local install");
    else console.log("  note  .mcp.json is not using scripts/mcp-server.mjs (npx fallback?)");
  ' || FAIL=$((FAIL+1))
fi

echo
echo "== n8n-mcp (node schemas, validation, templates)"
if [ -f package.json ]; then
  PIN="$(node -p "require('./package.json').dependencies['n8n-mcp']" 2>/dev/null || echo '')"
  [ -n "$PIN" ] && ok "pinned to n8n-mcp@$PIN in package.json" \
    || bad "package.json does not pin n8n-mcp"
else
  bad "package.json missing: n8n-mcp is not pinned"
fi
[ -f package-lock.json ] && ok "package-lock.json present (reproducible install)" \
  || bad "package-lock.json missing: installs are not reproducible"

if [ -f node_modules/n8n-mcp/package.json ]; then
  HAVE="$(node -p "require('./node_modules/n8n-mcp/package.json').version" 2>/dev/null || echo '?')"
  if [ "$HAVE" = "${PIN:-}" ]; then ok "n8n-mcp $HAVE installed, matches the pin"
  else bad "n8n-mcp $HAVE installed but pinned ${PIN:-?}. Run: npm ci"; fi
  if [ -f node_modules/n8n-mcp/data/nodes.db ]; then
    DBSZ="$(du -h node_modules/n8n-mcp/data/nodes.db 2>/dev/null | cut -f1)"
    ok "node database present ($DBSZ) - this is what makes validation accurate"
  else
    bad "node database missing at node_modules/n8n-mcp/data/nodes.db"
  fi
else
  bad "n8n-mcp not installed. Run: npm ci   (offline: see docs/10-MAINTENANCE.md)"
fi

if [ -f scripts/mcp-server.mjs ]; then
  node --check scripts/mcp-server.mjs 2>/dev/null && ok "mcp-server.mjs launcher parses" \
    || bad "scripts/mcp-server.mjs has a syntax error"
else
  bad "scripts/mcp-server.mjs missing: .mcp.json cannot start the server"
fi

# Real MCP handshake against the server. Skipped with --fast: it costs a few
# seconds because the server loads the node database.
if [ "$FAST" = 1 ]; then
  note "server handshake skipped (--fast)"
elif [ -f scripts/mcp-smoke.mjs ] && [ -f node_modules/n8n-mcp/package.json ]; then
  if node scripts/mcp-smoke.mjs >/dev/null 2>&1; then
    ok "server completes an MCP handshake and exposes all 7 docs tools"
  else
    bad "server failed its handshake. Run: node scripts/mcp-smoke.mjs"
  fi
fi

echo
echo "== skills"
if [ -d .claude/skills ]; then
  N="$(find .claude/skills -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
  [ "$N" -eq 20 ] && ok "20 skills installed" || note "$N skill directories (expected 20)"
  MISSING=""
  for s in using-n8n-mcp-skills n8n-mcp-tools-expert n8n-instance-ops n8n-gotchas \
           n8n-enterprise-delivery n8n-node-dev n8n-canvas-docs; do
    [ -f ".claude/skills/$s/SKILL.md" ] || MISSING="$MISSING $s"
  done
  [ -z "$MISSING" ] && ok "router and harness-original skills present" \
    || bad "missing SKILL.md for:$MISSING"
  BAD=""
  for d in .claude/skills/*/; do
    [ -f "$d/SKILL.md" ] || BAD="$BAD $(basename "$d")"
  done
  [ -z "$BAD" ] && ok "every skill directory has a SKILL.md" || bad "no SKILL.md in:$BAD"
else
  bad ".claude/skills/ missing"
fi

echo
echo "== editor support"
for f in .mcp.json .vscode/mcp.json .cursor/mcp.json; do
  [ -f "$f" ] && ok "$f present" || bad "$f missing"
done
for f in AGENTS.md .github/copilot-instructions.md .cursor/rules/n8n-harness.mdc \
         .windsurf/rules/n8n-harness.md; do
  [ -f "$f" ] || bad "$f missing (run: npm run gen:editors)"
done
if [ -f scripts/gen-editor-configs.mjs ]; then
  if node scripts/gen-editor-configs.mjs --check >/dev/null 2>&1; then
    ok "editor instruction files match CLAUDE.md and the installed skills"
  else
    bad "editor instruction files are stale. Run: npm run gen:editors"
  fi
fi
# VS Code uses "servers"; Cursor and Claude Code use "mcpServers". Mixing them
# up produces a config the editor silently ignores.
if [ -f .vscode/mcp.json ]; then
  node -e '
    const c = JSON.parse(require("fs").readFileSync(".vscode/mcp.json","utf8"));
    if (!c.servers) { console.log("  FAIL  .vscode/mcp.json must use the \"servers\" key, not \"mcpServers\""); process.exit(3); }
    console.log("  ok    .vscode/mcp.json uses the \"servers\" key VS Code expects");
  ' || FAIL=$((FAIL+1))
fi
if [ -f .cursor/mcp.json ]; then
  node -e '
    const c = JSON.parse(require("fs").readFileSync(".cursor/mcp.json","utf8"));
    if (!c.mcpServers) { console.log("  FAIL  .cursor/mcp.json must use the \"mcpServers\" key"); process.exit(3); }
    console.log("  ok    .cursor/mcp.json uses the \"mcpServers\" key Cursor expects");
  ' || FAIL=$((FAIL+1))
fi

echo
echo "== hooks"
for h in session-start pre-n8n-write; do
  if [ -x ".claude/hooks/$h.sh" ]; then
    if echo '{"tool_name":"t","tool_input":{}}' | "./.claude/hooks/$h.sh" >/dev/null 2>&1; then
      ok "$h.sh runs clean"
    else
      bad "$h.sh returned non-zero. Hooks must fail open."
    fi
  else
    bad ".claude/hooks/$h.sh missing or not executable"
  fi
done
[ -f .claude/settings.json ] && command -v node >/dev/null 2>&1 && \
  node -e 'JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"))' 2>/dev/null \
  && ok ".claude/settings.json is valid JSON" \
  || bad ".claude/settings.json missing or malformed (a bad file disables ALL its settings silently)"

echo
echo "== toolkit"
for f in doctor health-check drift-check export-all validate; do
  if [ -f "scripts/$f.mjs" ] && command -v node >/dev/null 2>&1; then
    node --check "scripts/$f.mjs" 2>/dev/null && ok "$f.mjs parses" || bad "$f.mjs has a syntax error"
  else
    [ -f "scripts/$f.mjs" ] || bad "scripts/$f.mjs missing"
  fi
  [ -x "scripts/$f.sh" ] || note "scripts/$f.sh not executable (run: chmod +x scripts/*.sh)"
done

echo
echo "== credentials"
if [ -f .env ]; then
  ok ".env present"
  if [ -n "${N8N_API_URL:-}" ]; then
    ok "N8N_API_URL exported as $N8N_API_URL"
  else
    note ".env exists but N8N_API_URL is not exported. .mcp.json reads the"
    note "process environment, not the file. Launch with:"
    note "  set -a; . ./.env; set +a; claude"
  fi
else
  note "no .env yet. Docs mode works without it; the managed n8n server does not."
  note "  cp .env.example .env"
fi
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  bad ".env is TRACKED BY GIT. Remove it from the index now: git rm --cached .env"
fi

echo
echo "passed: $PASS   failed: $FAIL"
if [ "$FAIL" = 0 ]; then echo "RESULT: ok"; exit 0; else echo "RESULT: BLOCKED"; exit 1; fi
