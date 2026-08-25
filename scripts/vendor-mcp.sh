#!/usr/bin/env bash
# Packs n8n-mcp and its dependencies into vendor/ so the harness can be
# installed with no npm registry access.
#
# Run this on a machine that CAN reach the registry, commit or copy vendor/,
# then on the target machine:
#
#     npm ci --offline --cache vendor/npm-cache
#
# Usage: ./scripts/vendor-mcp.sh [--out <dir>]
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

OUT="$REPO/vendor"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed -E 's/^# ?//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 2; }
[ -f package-lock.json ] || { echo "no package-lock.json. Run npm install first." >&2; exit 2; }

mkdir -p "$OUT"

echo "== warming a self-contained npm cache"
# A populated cache plus the lockfile is enough for `npm ci --offline`, and it
# carries every transitive dependency, not just n8n-mcp itself.
npm ci --cache "$OUT/npm-cache" --prefer-online >/dev/null
echo "  cache: $OUT/npm-cache"

echo "== packing the n8n-mcp tarball"
( cd "$OUT" && npm pack n8n-mcp@"$(node -p "require('$REPO/package.json').dependencies['n8n-mcp']")" >/dev/null )
TARBALL="$(find "$OUT" -maxdepth 1 -name 'n8n-mcp-*.tgz' | head -1)"
[ -n "$TARBALL" ] && echo "  tarball: $TARBALL"

cat > "$OUT/README.md" <<'INNER'
# vendor/

Offline install artifacts for a network that cannot reach the npm registry.

- `npm-cache/` — a warmed npm cache covering every dependency in
  `package-lock.json`, not just n8n-mcp.
- `n8n-mcp-<version>.tgz` — the server tarball on its own.

On the target machine, from the repository root:

```bash
npm ci --offline --cache vendor/npm-cache
```

Then confirm the server starts:

```bash
./scripts/verify-setup.sh
```

Regenerate with `./scripts/vendor-mcp.sh` on a machine with registry access
whenever the pin in `package.json` changes.

These artifacts are large. Committing them is a deliberate choice for
air-gapped delivery; otherwise move them out of band and keep `vendor/`
gitignored.
INNER

echo
du -sh "$OUT" 2>/dev/null || true
echo "done. See $OUT/README.md"
