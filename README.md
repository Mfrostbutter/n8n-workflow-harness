# n8n workflow harness

A Claude Code harness for building n8n workflows, built around
**[n8n-mcp](https://github.com/czlonkowski/n8n-mcp)**: twenty n8n skills, both
n8n-mcp servers pinned as a real dependency, a deterministic toolkit, and the
discipline that keeps a generated workflow from failing quietly in production.

Clone it, point it at a dev instance, and build. Everything is project-scoped,
so it runs without touching your global Claude Code configuration.

```bash
git clone <repo-url> n8n-workflow-harness
cd n8n-workflow-harness
./setup.sh                      # Windows: .\setup.ps1 - installs n8n-mcp
cp .env.example .env            # fill in your dev instance URL and API key
set -a; . ./.env; set +a        # .mcp.json reads the process environment
claude
```

Then paste [AI_SETUP_PROMPT.md](AI_SETUP_PROMPT.md) into that session and Claude
will verify the whole loop end to end, including a disposable probe workflow it
deletes afterwards. Prefer to drive it yourself: [docs/02-SETUP.md](docs/02-SETUP.md).

New here? [docs/01-QUICKSTART.md](docs/01-QUICKSTART.md) is the fifteen-minute path.

## Why this exists

An LLM writing n8n workflows from training data alone gets the shape right and
the details wrong: a `typeVersion` that no longer exists, a webhook body read
from `$json` instead of `$json.body`, a Code node returning the wrong envelope,
an error output that was never wired. Those workflows validate. Some of them
even deploy. They fail later, quietly, in the customer's tenant.

This harness closes that gap three ways:

1. **Live schemas instead of recall.** `n8n-mcp` serves real node schemas,
   validators, and 2,700+ templates from a prebuilt database of 2,500+ nodes.
   This is the component that makes builds and validation correct, so the
   harness pins it and verifies it rather than hoping npm resolves it.
2. **Skills that fire before the mistake.** Twenty skills carry the rules for
   expressions, node configuration, Code nodes, AI agents, error handling, and
   the field-discovered traps that look like success.
3. **Verification that does not trust the model.** A Node-only toolkit that
   checks whether the repo and the live instance actually agree, plus hooks that
   put the validate-and-verify rule in front of every instance write.

## Layout

```
CLAUDE.md                   the operating contract, loaded automatically
AI_SETUP_PROMPT.md          paste-in prompt that sets up and verifies the harness
setup.sh / setup.ps1        one-time wiring for a fresh clone
package.json                pins n8n-mcp; package-lock.json locks it
.mcp.json                   both MCP servers, project-scoped
.mcp.npx.json               fallback config if you cannot run npm ci
.env.example                instance URL and API key template
.claude/
  settings.json             permissions allowlist and hook registration
  skills/                   20 skills, loaded automatically in this project
  hooks/                    session contract injection, pre-write reminders
scripts/                    the deterministic toolkit (Node built-ins only)
  mcp-server.mjs            launches the pinned n8n-mcp, cwd-independent
  mcp-smoke.mjs             real MCP handshake against the server
  vendor-mcp.sh             pack n8n-mcp for an air-gapped install
  refresh-skills.sh         re-vendor the 15 upstream skills
  verify-setup.sh           preflight over the whole clone
workflows/{dev,staging,prod}/   workflow JSON: the source of truth
examples/hello-set.json     minimal validated workflow
docs/                       full documentation, see the index below
tests/                      44 tests over the toolkit
```

## The rules that matter

Six rules earn their place by preventing a class of workflow that looks correct
and breaks in production. They are in [CLAUDE.md](CLAUDE.md), so Claude loads
them every session, and the hooks repeat the sharpest ones at the moment of the
write.

| Rule | Why |
|---|---|
| Load the skill before the action | Skills prevent the mistake; reading one after the failure only explains it |
| `get_node` before setting parameters | n8n's surface drifts between versions. Recall is stale, the schema is not |
| Validate **and** verify | `validate_workflow` proves the JSON is well-formed. Read `connections` back to prove it is wired |
| A 200 is not proof | Confirm with a fresh execution and read the execution data |
| Dev first | Promotion goes through your release path, never an ad-hoc write from a build session |
| Secrets through the credential system | A Set node holding a token is a leak with extra steps |

Working order for any change:

```
drift-check → export-all + commit → change on dev → validate →
get_workflow and read connections → execute → verify → promote → verify again
```

## Skills

Twenty skills in `.claude/skills/`, loaded automatically when Claude Code runs
in this directory. `using-n8n-mcp-skills` is the router: it fires first and
points at the specialist that owns the decision.

**Authoring**

| Skill | Owns |
|---|---|
| `using-n8n-mcp-skills` | Router. Which skill owns what, and the cross-cutting rules |
| `n8n-mcp-tools-expert` | Tool selection, `nodeType` formats, validation profiles |
| `n8n-workflow-patterns` | Architecture: webhook, API, database, AI, batch, scheduled |
| `n8n-node-configuration` | Required fields per operation, `displayOptions`, dependencies |
| `n8n-expression-syntax` | `{{ }}`, `$json`/`$node`, and the `$json.body` webhook trap |
| `n8n-validation-expert` | Reading validation output, and which warnings are false positives |
| `n8n-code-javascript` | Code node JS, `this.helpers`, batching, `pairedItem` |
| `n8n-code-python` | Code node Python and its standard-library-only limits |
| `n8n-code-tool` | The agent-callable Custom Code Tool: a different contract entirely |
| `n8n-agents` | AI Agent vs chain vs classifier, tools, memory, structured output, RAG |
| `n8n-binary-and-data` | Files, `$binary`, keeping binary alive across transforms |
| `n8n-error-handling` | Error outputs, retries, Error Trigger, 4xx/5xx shapes |
| `n8n-subworkflows` | Execute Workflow, typed inputs, `all` vs `each` |
| `n8n-canvas-docs` | Sticky notes and canvas groups, sizing math, no overlaps |

**Operations and delivery**

| Skill | Owns |
|---|---|
| `n8n-instance-ops` | Live instances: activation cache, export/import, webhook reachability |
| `n8n-gotchas` | Behaviors that report success and do nothing. Read before a first build |
| `n8n-multi-instance` | Targeting the right instance, and recovering from a misroute |
| `n8n-enterprise-delivery` | Environments, RBAC, external secrets, scaling, air-gap, promotion |
| `n8n-self-hosting` | Deploying n8n itself: Docker Compose, Caddy, queue mode |
| `n8n-node-dev` | Custom node packaging, the every-worker rule, air-gapped install |

Fifteen are vendored from the upstream `n8n-skills` pack; five are original to
this harness. See [ATTRIBUTION.md](ATTRIBUTION.md) and
[docs/04-SKILLS.md](docs/04-SKILLS.md).

## n8n-mcp: the engine

Everything correct about the builds comes from
**[n8n-mcp](https://github.com/czlonkowski/n8n-mcp)** by Romuald Członkowski
(MIT). It is what replaces the model's stale recall with the truth for the n8n
version you are actually on: 2,500+ node schemas, real validators, and 2,700+
workflow templates, served from a prebuilt ~94 MB database that ships inside
the package.

Without it, an LLM writes plausible n8n JSON. With it, it writes JSON that
matches your instance.

So this harness treats it as a **pinned dependency, not a runtime download**:

```json
"dependencies": { "n8n-mcp": "2.73.0" }
```

`package-lock.json` is committed with the integrity hash, `npm ci` gives a
byte-identical install on every machine, and `./setup.sh` does it for you. That
matters for an enterprise: the version is a reviewed change, two engineers get
the same tool surface, and a security team can audit exactly what runs. An
unpinned `npx -y n8n-mcp` resolves to whatever is newest at spawn, which makes a
bug unreproducible and an audit meaningless.

`scripts/mcp-server.mjs` launches it, resolving the package relative to itself
so the working directory does not matter, and printing an actionable message if
`npm ci` was skipped.

### Two servers, one package

`n8n-mcp` changes behaviour depending on whether it can see instance
credentials, so it is registered twice. Verified tool counts:

| Server | Credentials | Tools | Serves | Risk |
|---|---|---|---|---|
| `n8n-docs` | none | 7 | Node schemas, validators, templates | Safe anywhere. Cannot reach an instance |
| `n8n` | `N8N_API_URL` + `N8N_API_KEY` | 25 (7 + 18) | Workflow CRUD, executions, credentials, audit | Writes to a real instance |

There is no separate `n8n-docs-mcp` package on npm. "Docs mode" is this same
package started without an API URL, which is what makes it safe to leave on.

`.mcp.json` expands `${N8N_API_URL}` from the **process environment**, not from
`.env` on disk. That is the single most common setup failure: launch with
`set -a; . ./.env; set +a; claude` or the managed server starts credential-less.

### Proving it works

```bash
npm run smoke        # real MCP handshake: server version, tool counts
```

It completes an `initialize` and `tools/list` against the server and checks all
seven documentation tools are present. With `N8N_API_URL` exported it also
asserts the 18 `n8n_*` instance tools appeared, which is the fastest way to
confirm the credentials actually reached the server process.

Install paths (local pinned, npx fallback, air-gapped, Docker, from source),
the full tool inventory, and how this coexists with n8n's own instance-level
MCP: [docs/03-MCP-SERVERS.md](docs/03-MCP-SERVERS.md).

## Toolkit

`scripts/` holds the deterministic checks. Node built-ins only: no packages,
nothing for a security team to approve, and it runs on Windows. These are ground
truth when the model and reality disagree.

| Command | Does |
|---|---|
| `./scripts/doctor.sh [env]` | Environment, reachability, API capability, repo state. Run it first |
| `./scripts/health-check.sh [hours]` | Instance up, workflows active, recent failure count |
| `./scripts/drift-check.sh [env]` | Whether `workflows/` and the live instance agree. Exit 1 on drift |
| `./scripts/export-all.sh [env]` | Snapshot every workflow. The rollback point |
| `./scripts/validate.sh <file>` | Offline structural checks on workflow JSON |
| `./scripts/verify-setup.sh` | Preflight over this whole clone, including a server handshake |
| `npm run smoke` | Real MCP handshake against n8n-mcp: version and tool counts |
| `./scripts/vendor-mcp.sh` | Pack n8n-mcp for an air-gapped install |

**`drift-check` is the one that earns its keep.** "Workflow JSON in git is the
source of truth, the canvas is a view" is an assertion until something verifies
it. It ignores canvas positions, ids, timestamps, pinned data, and sticky notes,
and reports on parameters, connections, credentials, `typeVersion`s, disabled
nodes, and active state. A moved node is not drift; a changed parameter is.

A snapshot taken while the repo and the instance disagreed is not a rollback
point. That is why the order is drift-check, then export, then change.

```bash
node --test tests/tools.test.mjs tests/instance.test.mjs   # 44 tests
```

`instance.test.mjs` runs the real HTTP paths against a fake n8n API server, so
the instance-touching tools are covered offline with no instance involved.

## Hooks

Upstream ships its skills as a plugin whose hooks nudge you at the moment of
decision. This repo vendors the skills instead, so it carries its own small
hook layer to keep that behavior. Both fail open: an error means no reminder,
never a blocked call.

- **SessionStart** injects the harness contract, and names the instance the
  managed server is pointed at, so the rules are loaded from turn one instead
  of depending on a skill description matching your phrasing.
- **PreToolUse** on instance-mutating tools reminds you to read `connections`
  back after a write, warns that activation caches the trigger registration,
  and flags a credential write as needing the target confirmed first.

Disable them by removing the `hooks` block from `.claude/settings.json`.

## Documentation

| Doc | Read it when |
|---|---|
| [01-QUICKSTART.md](docs/01-QUICKSTART.md) | You want to be building in fifteen minutes |
| [02-SETUP.md](docs/02-SETUP.md) | Full setup, both servers, verification |
| [03-MCP-SERVERS.md](docs/03-MCP-SERVERS.md) | What each server serves, tool inventory, official n8n MCP |
| [04-SKILLS.md](docs/04-SKILLS.md) | Which skill owns a decision, and how routing works |
| [05-BUILD-LOOP.md](docs/05-BUILD-LOOP.md) | The build sequence, in order, with the checks |
| [06-TOOLKIT.md](docs/06-TOOLKIT.md) | Every script, its flags, and its exit codes |
| [07-PROMPT-RECIPES.md](docs/07-PROMPT-RECIPES.md) | Prompts that work, and why the vague ones do not |
| [08-SECURITY.md](docs/08-SECURITY.md) | Credentials, data boundaries, what never enters the repo |
| [09-TROUBLESHOOTING.md](docs/09-TROUBLESHOOTING.md) | It succeeded but nothing happened |
| [10-MAINTENANCE.md](docs/10-MAINTENANCE.md) | Refreshing skills, bumping the pinned server, the plugin path |

## Requirements

- Node 20+ and npm (the toolkit and both MCP servers need it)
- Git
- Claude Code
- An n8n instance with the public API enabled, and an API key. Dev, not prod.
- ~170 MB of disk for `node_modules`, most of it n8n-mcp's node database.
  `node_modules/` is gitignored; only the lockfile is committed.

No registry access? `./scripts/vendor-mcp.sh` packs n8n-mcp and its
dependencies for an offline `npm ci`. See
[docs/10-MAINTENANCE.md](docs/10-MAINTENANCE.md).

The `.sh` wrappers need bash; on Windows that means Git Bash. The `.mjs` tools
run natively under PowerShell, so nothing is bash-only.

## Licence and credit

This harness is MIT ([LICENSE](LICENSE)). The two components that do the real
work are both MIT-licensed and both by **Romuald Członkowski**:

- **[n8n-mcp](https://github.com/czlonkowski/n8n-mcp)** — the server behind every
  schema lookup and validation call in this repo
- **[n8n-skills](https://github.com/czlonkowski/n8n-skills)** — fifteen of the
  twenty skills

If you depend on them, consider [sponsoring](https://github.com/sponsors/czlonkowski).
Full credit in [ATTRIBUTION.md](ATTRIBUTION.md), full licence texts in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

Not an official n8n product, and no warranty from n8n GmbH. Where n8n's own
supported tooling overlaps, it takes priority; see
[docs/03-MCP-SERVERS.md](docs/03-MCP-SERVERS.md).
