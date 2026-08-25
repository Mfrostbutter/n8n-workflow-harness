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

## `verify-setup`

```bash
./scripts/verify-setup.sh
```

Offline preflight over the whole clone: Node version, git, `.mcp.json` shape
(including that `n8n-docs` carries no credentials), all twenty skills and their
`SKILL.md` files, both hooks executing cleanly, every toolkit script parsing,
and whether `.env` is exported or accidentally tracked.

Exit 0 with `RESULT: ok`, or exit 1 with `RESULT: BLOCKED`.

## `refresh-skills`

```bash
./scripts/refresh-skills.sh [--ref <branch|tag>] [--dry-run]
```

Re-vendors the fifteen upstream skills wholesale from
`czlonkowski/n8n-skills`. Never touches the five originals. Prints the upstream
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

## Tests

```bash
node --test tests/tools.test.mjs tests/instance.test.mjs
```

44 tests. `instance.test.mjs` runs the real HTTP paths against a fake n8n API
server, so the instance-touching tools are covered offline with no instance
involved. Pass explicit file paths: `node --test tests/` fails on current Node,
which resolves the directory as a module.
