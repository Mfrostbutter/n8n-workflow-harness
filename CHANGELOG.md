# Changelog

## 2026-10-22

Windows, VS Code + Copilot, corporate proxies. Everything reproduced on a
Windows 11 clone before it was fixed.

- **Skills on Windows.** A default checkout (`core.symlinks=false`) turns the
  25 committed `.claude/skills/` symlinks into text files and Claude Code loads
  no project skills. `gen-agent-configs.mjs` now copies on Windows by default
  (`--link` to opt out) and marks the copies `skip-worktree`, so git neither
  shows nor commits them. `setup.ps1` runs it, installs the pinned n8n-mcp,
  wires the textconv and runs the preflight, matching `setup.sh`.
- **Hooks are Node.** `session-start.sh` and `pre-n8n-write.sh` became
  `.mjs`, registered as `node .claude/hooks/<name>.mjs` with repo-relative
  paths. No bash, no `$CLAUDE_PROJECT_DIR`, so the same file is harmless when
  VS Code loads it.
- **Copilot guard.** `.github/hooks/n8n-guard.json` uses the cross-platform
  `command` key (Copilot picks `bash` or `powershell` from it). The guard
  answers Copilot with `{"permissionDecision": "deny" | "ask", ...}` on
  stdout and exit 0; a non-zero exit is a plain error there. Copilot can ask,
  so it does. Tested in `tests/guard.test.mjs`.
- **SSRF guard.** n8n-mcp 2.94 refuses loopback and RFC1918 instance URLs in
  its default `strict` mode; every `n8n_*` call returned
  `SSRF protection: Private IP addresses not allowed` against an on-prem
  instance while the toolkit passed. `scripts/mcp-server.mjs` defaults
  `WEBHOOK_SECURITY_MODE=permissive`, `.mcp.json` passes it through, `doctor`
  prints the mode and fails when it would block the configured URL.
- **doctor.** Used `??` on the per-environment lookup, so a template `.env`
  with blank `N8N_API_URL_DEV=` lines made `doctor dev` fail with the active
  pair exported. Now `||`, and `loadEnv` treats a blank value as unset.
  Status-0 errors carry the cause code (`ECONNREFUSED`,
  `DEPTH_ZERO_SELF_SIGNED_CERT`) instead of `fetch failed`, and doctor prints
  the matching fix: `NODE_EXTRA_CA_CERTS` for TLS inspection,
  `NODE_USE_ENV_PROXY=1` for a proxy, never `NODE_TLS_REJECT_UNAUTHORIZED=0`
  (which it now fails on). It also lists the proxy variables in force, names
  and lengths only.
- **Exit codes on Windows.** `fail()` and the `organize` / `secret-map`
  entrypoints called `process.exit()` right after a fetch; on Windows that
  fast-fails with a libuv assertion (exit 3221226505) and 12 tests failed.
  `fail()` now throws an `ExitSignal` and sets `process.exitCode`; the scripts
  end on their own.
- **Context budget.** `AGENTS.md` and the prompt recipes say which tool forms
  to prefer, with measured sizes (`search_templates` default ~115 KB,
  `get_node` full on HTTP Request ~54 KB, `minimal` under 400 bytes).
- `secret-map`: `N8N_INFISICAL_CLI` names the Infisical CLI when it is not
  `infisical` on PATH; a `.js`/`.cjs`/`.mjs` path runs under Node. The test
  fake uses it, since Windows cannot spawn a shebang script, and the test's
  PATH now uses the platform delimiter.
- Docs: 02 (Windows, proxy, private addresses), 09 (SSRF, proxy, Windows),
  11 (Windows section, Copilot asks). `tests/network.test.mjs`. CI runs the
  test suite on Ubuntu and Windows.

## 2026-10-19 (c)

Credential mapping. Every credential on an instance traces to a named secret.

- New skill `n8n-credential-mapping` (25 skills, ten original): the committed
  secret map, the three homes a value can have, creating credentials from the
  secret manager without a value reaching the terminal, rotation without a
  value-update endpoint, verifying, reading back.
- `scripts/secret-map.mjs` (`./scripts/secret-map.sh`): `check`, `sync`,
  `rotate`, `verify`, `ids` over `deploy/secret-map.<env>.json` (committed)
  and `deploy/creds.<env>.json` (ids, gitignored). Output scrubbed against
  resolved values. `tests/secret-map.test.mjs` runs it against a fake API and
  a fake `infisical` on `PATH`, asserting no value reaches the output.
- `deploy/secret-map.example.json`; `AGENTS.md` non-negotiable 6 and the
  toolkit row; `npm run secrets:verify`; docs 04, 06, 08, 12.

## 2026-10-19 (b)

Placement. Every workflow is tagged, in a project and in a folder, and the
credentials and data tables it binds live in the same project.

- New skill `n8n-project-organization` (24 skills, nine original): the
  placement declared in the JSON, the organize tool, credentials and data
  tables following a workflow into a project, reading placement back from an
  API that is mostly write-only, retrofitting a grown instance.
- `scripts/organize.mjs` (`./scripts/organize.sh`): `audit`, `place`,
  `credentials`, `tables`, `project`. Node built-ins only; `tests/organize.test.mjs`
  runs it against a fake public API.
- `lint-workflow --require-placement` fails a file without `project` and
  `folder`; `npm run lint` and both CI templates pass it. `export-all` now
  writes the workflow `id` and keeps `project` and `folder` from the file it
  replaces, so an export does not strip the placement.
- The guard asks before `organize credentials --force`, which takes a
  credential away from every workflow outside the destination.
- `AGENTS.md` non-negotiable 9 and the toolkit row; `organize place` in the
  working order. `n8n-gotchas` refreshed with eight entries, including the
  post-transfer runtime failure.

## 2026-10-19

Enterprise delivery. One contract for every agent, the official n8n MCP server
alongside the community one, a promotion pipeline over the official CLI, and a
guard that works in every editor that runs hooks.

- `AGENTS.md` is the contract; `CLAUDE.md` is `@AGENTS.md` plus a Claude-only
  section. Replaces the generated `.github/copilot-instructions.md`,
  `.cursor/rules/` and `.windsurf/rules/` copies, since Codex, Cursor, Copilot,
  Devin, Junie and Claude Code all read `AGENTS.md` natively.
- Skills move to `.agents/skills/` (23, up from 20) and are linked into
  `.claude/skills/` by `scripts/gen-agent-configs.mjs`, which also fans
  `.mcp.json` out to `.vscode/mcp.json`, `.cursor/mcp.json` and
  `.codex/config.toml`. `npm run gen:agents` / `check:agents` replace
  `gen:editors` / `check:editors`.
- New skills: `n8n-promotion-pipeline` (n8n Promotions over `@n8n/cli`),
  `n8n-workflow-as-code` (`@n8n/workflow-sdk`), `n8n-upgrade-plan`.
  `n8n-enterprise-delivery` rewritten for Promotions versus source control.
- Third MCP server `n8n-official`: the instance's own `/mcp-server/http`, for
  the Workflow SDK build loop, version history, publish, Agents and data tables.
  `N8N_MCP_ACCESS_TOKEN` in `.env.example`.
- `n8n-mcp` 2.73.0 → 2.94.3 (2.73 cannot write to n8n ≥ 2.36); telemetry
  disabled in every config. `@n8n/cli` 0.22.0 and `@n8n/workflow-sdk` 0.36.5
  pinned.
- Toolkit: `lint-workflow` (promotion lint and the credentials/variables
  manifest), `wf-diff`, `wf-textconv` (wired as the git textconv by `setup.sh`),
  `node-inventory`. `drift-check` names what differs per workflow.
- `scripts/guard-pre-tool.mjs`: denies delete tools and commands, asks before a
  deploy or promotion to staging or prod, a `source-control pull`, a CLI
  activate, or any workflow write while `N8N_API_URL` is the prod URL. Wired
  for Claude Code, Codex, Cursor, Copilot and Devin. Tested in the Claude Code
  shape.
- CI templates for GitHub and GitLab: validate and lint on push, drift on a
  schedule. `docs/12-ENTERPRISE.md` and `docs/managed-settings.example.json`.
- n8n-skills refreshed to v1.35.0 (upstream 19cd793).

## 2026-08-25 (c)

Editor support beyond Claude Code. The engine is a standard MCP server, so the
schemas and validation were always portable; what was missing was the config and
the guidance layer for other clients.

- `.vscode/mcp.json` for VS Code + GitHub Copilot. Uses the `servers` key (VS
  Code differs from every other client here) and an `inputs` block, so VS Code
  prompts for the instance URL and API key and stores them itself. `verify-setup`
  now checks both files use the key their editor actually expects, since the
  wrong one is silently ignored.
- `.cursor/mcp.json` for Cursor.
- `scripts/gen-editor-configs.mjs` (`npm run gen:editors`) generates `AGENTS.md`,
  `.github/copilot-instructions.md`, `.cursor/rules/n8n-harness.mdc`, and
  `.windsurf/rules/n8n-harness.md` from **one source**: the contract in
  `CLAUDE.md` plus the frontmatter of every installed skill. Four editors want
  the same rules in four formats; this stops them becoming four copies that
  drift. `npm run check:editors` exits 1 when stale, and `verify-setup` fails on
  drift.
- The generated files carry an index of all 20 skills with their file paths and
  what each owns, which is the degradation path outside Claude Code: the agent is
  told the skills exist and where to read them, rather than loading them
  automatically.
- `docs/11-EDITORS.md`: support matrix, per-editor setup (including Windsurf and
  Codex, whose MCP config is global and needs absolute paths), how to get value
  from the skills without auto-loading, and an explicit statement of what cannot
  port — the hooks are Claude Code only.
- README, docs index, and the AI setup prompt are now editor-agnostic.

Fixed in the generator's frontmatter parser: five skills declare `description`
as a YAML folded block scalar (`>-`), and a naive line match produced the
literal `>-` as the description. It now handles block and plain scalars, so all
20 routing entries are correct.

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
