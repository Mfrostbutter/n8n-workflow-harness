# Toolkit

`scripts/` holds the deterministic checks. **Node built-ins only**: no packages,
no `jq`, nothing for a security team to approve, and it runs on Windows.

They exist because the model can be wrong or unavailable, and because "the repo
is the source of truth" needs something that actually verifies it. When
reasoning and reality disagree, these are reality.

Every tool is a `.mjs` file with a `.sh` wrapper. The wrapper is convenience;
the `.mjs` is directly callable, which is how you run them under PowerShell:

```bash
./scripts/doctor.sh dev          # bash / Git Bash
node scripts/doctor.mjs dev      # anywhere with Node
```

## `doctor` — run it first

```bash
./scripts/doctor.sh [env]
```

Environment, instance reachability, API capability, and repo state in one pass:
Node version, `.env` presence, whether the URL resolves and the key is accepted,
whether the public API is enabled, the n8n version, exported workflow count, git
presence, `.gitignore` presence.

Warns if the active target equals `N8N_API_URL_PROD`. Run it at the start of a
session and whenever something feels wrong.

## `health-check`

```bash
./scripts/health-check.sh [hours]
```

Instance up, how many workflows are active, and the recent failure count over
the window (default 24h). Run it **before** diagnosing anything: a workflow that
looks broken on an instance with 200 recent failures is a symptom, not the cause.

## `drift-check` — the one that earns its keep

```bash
./scripts/drift-check.sh [env]
```

Compares `workflows/<env>/` against what is actually deployed. **Exit 1 on
drift**, so it works in CI or a pre-push hook.

Ignores: canvas positions, ids, timestamps, pinned data, sticky notes.
Reports: parameters, connections, credentials, `typeVersion`s, disabled nodes,
active state.

A moved node is not drift. A changed parameter is.

Run it before trusting anything in `workflows/`, and before taking a snapshot
you intend to roll back to.

## `export-all` — the rollback point

```bash
./scripts/export-all.sh [env]
```

Snapshots every workflow to `workflows/<env>/`, one file per workflow, keys
sorted so diffs are readable. Two workflows sharing a name both survive rather
than one silently overwriting the other.

Run it and **commit** before every change. Uncommitted, it is not a rollback
point.

## `validate`

```bash
./scripts/validate.sh <file.json>
```

Offline structural checks on a workflow JSON: no instance, no MCP, no network.
Useful in CI and for reviewing a file someone sent you.

It says so itself: passing means the JSON is well-formed, not that the workflow
is correct. Use `validate_workflow` via MCP for semantic checks, and an
execution for the truth.

## `lint-workflow` — promotion readiness

```bash
./scripts/lint-workflow.sh workflows/dev/order-intake.json
./scripts/lint-workflow.sh workflows/dev --strict --json
```

Static checks on a workflow file or directory before it moves environments.
Errors: local, private or environment-labelled hosts in a parameter, a
credential reference with no name, a token-shaped literal. Warnings: no tags,
no `project` or `folder`, no error workflow, pinned data, disabled nodes, TODO
markers, `$env` or `process.env` in code, a webhook path that is a bare UUID.
Exit 1 on an error, or on a warning with `--strict`.

It ends with the manifest: every credential name and type, every `$vars`
reference, every sub-workflow reference, every host. That list is what the
target environment must provide. Flags: `--require-tags`,
`--require-placement` (both set by `npm run lint` and the CI templates),
`--require-error-workflow`, `--allow-host <pattern>`.

## `wf-diff` — what changed

```bash
./scripts/wf-diff.sh workflows/staging/x.json workflows/prod/x.json
```

Semantic diff of two workflow files over the same normalisation `drift-check`
uses: nodes only on one side, parameter, typeVersion, credential or disabled
changes per node, connection and settings changes. Canvas moves do not count.
Exit 1 on a difference. `setup.sh` also wires `wf-textconv.mjs` as the git
textconv for `workflows/**/*.json`, so `git diff` and `git log -p` render the
same view.

## `node-inventory` — the input to an upgrade plan

```bash
./scripts/node-inventory.sh workflows/prod
```

Every node type in use with its typeVersions and the workflows that carry each,
mixed versions flagged, plus the credential types referenced. Feed it to the
`n8n-upgrade-plan` skill before an instance upgrade, or to an approved-node
review.

## `organize` — projects, folders, tags, credential scope

```bash
./scripts/organize.sh audit dev
./scripts/organize.sh place workflows/dev/order-intake.json dev --dry-run
./scripts/organize.sh place workflows/dev dev
./scripts/organize.sh credentials "Acme API" --to "Acme Corp" --env dev
./scripts/organize.sh tables orders --to "Acme Corp" --env dev
./scripts/organize.sh project "Acme Corp" dev
```

A workflow JSON carries `tags`, `project` and `folder`; `place` makes the
instance agree. For every file with an `id`: the credentials only this batch
uses are transferred into the project (one another workflow still uses is a
stop, with the fix named), the workflow is transferred, the folder path is
created, the folder and tags are set, and the result is read back. `--dry-run`
prints the plan and writes nothing. `audit` lists every project with its
counts, the untagged workflows, the ones left in a personal project, and every
credential or data table a workflow binds that its project cannot reach;
`RESULT: ok` or exit 1. `tables` recreates a data table inside a project with
its rows and archives the original, because tables have no transfer endpoint;
rebind the node ids it prints. Every command writes, so a named environment
needs its own `N8N_API_URL_<ENV>` pair; there is no fallback to the bare one.
The rule and the API detail: the `n8n-project-organization` skill.

## `secret-map` — credentials from the secret manager

```bash
./scripts/secret-map.sh check dev
infisical run --env dev -- ./scripts/secret-map.sh sync dev
./scripts/secret-map.sh verify dev
./scripts/secret-map.sh ids dev
infisical run --env dev -- ./scripts/secret-map.sh rotate "Acme API (dev)"
```

`deploy/secret-map.<env>.json` (committed; `deploy/secret-map.example.json`
is the template) names each credential, its type, its project and where each
field comes from: `secret:NAME` from the secret manager, `env:VAR` from the
environment, anything else a literal. `check` lists the secret names at the
map's path and compares the data keys with the target's credential schema;
`sync` creates what is missing, in its project, and records the ids in
`deploy/creds.<env>.json` (gitignored); `verify` reports mapped credentials
missing from the target, ledger ids that disagree, and credentials in use that
the map does not name; `rotate` creates a replacement because the public API
cannot update a value; `ids` rebuilds the ledger by name. Values stay in the
process; every printed line is scrubbed against them, and none goes on a
command line. The rule and the API detail: the `n8n-credential-mapping` skill.

## `gen-agent-configs` — one source per tool

```bash
./scripts/gen-agent-configs.sh            # regenerate
./scripts/gen-agent-configs.sh --check    # exit 1 if stale
```

From `AGENTS.md`: `CLAUDE.md` (only if absent) and `.aiassistant/rules/`.
From `.mcp.json` (plus `.mcp.official.json`): `.cursor/mcp.json`, `.codex/config.toml`. VS Code and Claude Code read `.mcp.json` directly.
From `.agents/skills/`: links in `.claude/skills/` (`--copy` on Windows).

## `guard-pre-tool` — the hook every editor runs

Besides deny and ask, the guard keeps a **skill gate**: it records every
skill load in the session (the Skill tool, or a read of a `SKILL.md`) in a
small file under the OS temp dir keyed by session id, and refuses a workflow
write that carries a Code node, a Code Tool or an AI Agent until the owning
skill (`n8n-code-javascript`, `n8n-code-python`, `n8n-code-tool`,
`n8n-agents`) was loaded. The refusal names the skill; the agent loads it and
retries. Claude Code, Codex and Copilot hooks see skill loads, so the gate is
on there; Cursor and Devin hooks see MCP calls only, so it is off there.
`N8N_GUARD_SKILL_GATE=0` turns it off everywhere.

Not called by hand. Reads the hook payload on stdin, detects the vendor shape,
and exits 2 with the reason on a delete tool or delete command, or asks (Claude
Code, Codex) or denies (Cursor, Copilot, Devin) on a deploy or promotion to
staging or prod. [11-EDITORS.md](11-EDITORS.md) has the wiring per tool;
`tests/guard.test.mjs` the contract.

## `verify-setup`

```bash
./scripts/verify-setup.sh
./scripts/verify-setup.sh --fast    # skip the server handshake
```

Preflight over the whole clone: Node version, git, `.mcp.json` shape (including
that `n8n-docs` carries no credentials), the n8n-mcp pin against what is
actually installed, the node database, a real MCP handshake, all twenty-five
skills and their `SKILL.md` files, the generated agent configs, the hooks
executing cleanly, every toolkit script
parsing, and whether `.env` is exported or accidentally tracked.

25 checks. `--fast` skips the handshake, the only slow one, since it loads the
~94 MB node database.

Needs no instance. Exit 0 with `RESULT: ok`, or exit 1 with `RESULT: BLOCKED`.

## `mcp-smoke` — prove the engine works

```bash
npm run smoke
node scripts/mcp-smoke.mjs
```

Starts the pinned `n8n-mcp` and completes a real MCP `initialize` and
`tools/list`. Reports the server version and tool counts, and asserts all seven
documentation tools are present.

With `N8N_API_URL` exported it also asserts the 18 `n8n_*` instance tools
appeared. That makes it the fastest check for the most common setup failure:
7 tools when you expected 25 means the credentials never reached the server
process.

Exit 0 pass, 1 the server started but answered wrong, 2 it could not start.

`scripts/mcp-server.mjs` is the launcher this and `.mcp.json` both use. It
resolves n8n-mcp relative to its own path, so the working directory does not
matter, and prints an actionable message if `npm ci` was skipped.

## `vendor-mcp` — air-gapped install

```bash
./scripts/vendor-mcp.sh [--out <dir>]
```

Run on a machine **with** registry access. Warms a self-contained npm cache
covering every dependency in `package-lock.json`, and packs the n8n-mcp tarball.
Move `vendor/` to the target machine, then:

```bash
npm ci --offline --cache vendor/npm-cache
```

`vendor/` is gitignored by default because it is large. Commit it deliberately
if offline delivery is the point of your copy. Regenerate whenever the pin in
`package.json` changes.

## `refresh-skills`

```bash
./scripts/refresh-skills.sh [--ref <branch|tag>] [--dry-run]
```

Re-vendors the fifteen upstream skills wholesale from
`czlonkowski/n8n-skills`. Never touches the ten originals. Prints the upstream
commit so you can record it in `ATTRIBUTION.md`. Fails loudly if upstream has
restructured and a skill it expects is gone.

Local edits to vendored skills are destroyed by design. See
[04-SKILLS.md](04-SKILLS.md#editing-skills).

## Environment resolution

Every instance-touching tool resolves its target the same way:

1. `N8N_API_URL_<ENV>` / `N8N_API_KEY_<ENV>` if you passed an env name
2. otherwise the active `N8N_API_URL` / `N8N_API_KEY`

Values come from the process environment first, then `.env` (the tools read
`.env` directly; the MCP servers do not). So `./scripts/doctor.sh staging` works
without editing the active pair.

## Exit codes

| Code | Means |
|---|---|
| 0 | Pass |
| 1 | A real finding: drift detected, validation failed, preflight blocked |
| 2 | Cannot run: Node missing, no target configured, unreadable input |

Exit 1 versus 2 matters in CI: 1 is "the thing you checked is wrong", 2 is "the
check did not happen". Treating them the same lets a broken check pass as a
clean result.

## npm scripts

Convenience wrappers, for anyone who reaches for npm first:

| Script | Runs |
|---|---|
| `npm run setup` | `./setup.sh` |
| `npm run verify` | `./scripts/verify-setup.sh` |
| `npm run smoke` | the MCP handshake |
| `npm test` | toolkit, instance, organize, secret-map and guard tests |
| `npm run lint` | `lint-workflow.mjs --require-tags --require-placement` |
| `npm run organize` | `organize.mjs audit` |
| `npm run secrets:verify` | `secret-map.mjs verify` |
| `npm run inventory` | `node-inventory.mjs` |
| `npm run gen:agents` / `check:agents` | `gen-agent-configs.mjs` |
| `npm run doctor` | `doctor.mjs` |
| `npm run drift` | `drift-check.mjs` |
| `npm run export` | `export-all.mjs` |

## Tests

```bash
npm test
```

`tools.test.mjs` covers the normaliser, diff, lint and inventory logic;
`guard.test.mjs` the hook contract. `instance.test.mjs`, `organize.test.mjs`
and `secret-map.test.mjs` run the real HTTP paths against a fake n8n API server
(workflows, executions, projects, folders, tags, credentials, data tables and
the transfer endpoints), so the instance-touching tools are covered offline
with no instance involved. `secret-map.test.mjs` also puts a fake `infisical`
on `PATH` and asserts that no resolved value ever reaches the tool's output. Pass explicit file paths: `node --test tests/` fails on current Node,
which resolves the directory as a module.
