# Changelog

## 2026-08-25 (b)

n8n-mcp promoted from an implicit runtime download to a first-class pinned
dependency. It is the component that makes builds and validation correct, so it
is now installed, version-locked, and verified rather than assumed.

- `package.json` pins `n8n-mcp: 2.73.0`; `package-lock.json` committed with the
  resolved URL and `sha512` integrity hash for it and all 122 transitive
  packages. `npm ci` reproduces the install byte for byte.
- `.mcp.json` now launches the local install through `scripts/mcp-server.mjs`,
  which resolves the package relative to its own path (so the client's working
  directory is irrelevant) and prints an actionable message if `npm ci` was
  skipped, instead of a bare `ENOENT`.
- `scripts/mcp-smoke.mjs` (`npm run smoke`): completes a real MCP `initialize`
  and `tools/list` against the server, asserts all 7 documentation tools, and
  with credentials exported asserts the 18 `n8n_*` instance tools appeared.
  Distinguishes "server broken" (exit 2) from "server answered wrong" (exit 1).
- `scripts/vendor-mcp.sh`: packs a warmed npm cache plus the tarball for
  `npm ci --offline`, for networks with no registry access. `setup.sh` uses
  `vendor/npm-cache` automatically when present.
- `.mcp.npx.json`: fallback config for anyone who cannot run `npm ci`.
- `setup.sh` installs the pinned server; `verify-setup.sh` grew a dedicated
  n8n-mcp section (pin vs installed version, the `data/nodes.db` node database,
  launcher, live handshake) and a `--fast` flag to skip the handshake. 19 checks
  to 25.
- `npm run` scripts for setup, verify, smoke, test, doctor, drift, export.
- Docs: `03-MCP-SERVERS.md` leads with n8n-mcp and documents five install paths
  (pinned local, air-gapped, npx, Docker, from source). README, quickstart,
  setup, toolkit, troubleshooting, maintenance, ATTRIBUTION, CLAUDE.md, and the
  AI setup prompt all updated to match.

Corrected: the tool counts were taken from the server's own
`tools_documentation` output ("24 tools"), which does not count
`tools_documentation` itself. Measured over the wire, the server exposes **7**
tools without credentials and **25** with. Docs now cite the measured numbers,
and `npm run smoke` prints them.

## 2026-08-25 (a)

Initial release.

- 20 n8n skills, project-scoped in `.claude/skills/`: 15 vendored from
  `czlonkowski/n8n-skills`, 5 original to this harness.
- Both MCP servers wired in `.mcp.json`, pinned to `n8n-mcp@2.73.0`:
  `n8n-docs` (no credentials) and `n8n` (managed, instance access).
- `CLAUDE.md` operating contract, loaded automatically.
- `AI_SETUP_PROMPT.md`: paste-in prompt that sets up and verifies the harness
  end to end, including a disposable probe workflow.
- Hook layer replacing the upstream plugin's enforcement: `SessionStart`
  contract injection and `PreToolUse` reminders on instance-mutating tools.
  Both fail open.
- Toolkit (`doctor`, `health-check`, `drift-check`, `export-all`, `validate`),
  Node built-ins only, plus `verify-setup` (offline preflight) and
  `refresh-skills` (re-vendor from upstream).
- 44 tests, including integration tests against a fake n8n API server.
- Ten documentation files under `docs/`.
- `setup.sh` and `setup.ps1` for a fresh clone.

Fixed in the inherited toolkit: `export-all` wrote a `staging`
export into `workflows/dev/` while logging `workflows/staging/`, so a staging
export followed by `drift-check staging` failed on a missing directory.
