# n8n workflow harness

A coding-agent harness for building and promoting n8n workflows: twenty-five
n8n skills, **[n8n-mcp](https://github.com/czlonkowski/n8n-mcp)** pinned as a
real dependency next to n8n's own instance MCP server, the official `@n8n/cli`
for promotions, a deterministic toolkit, and the discipline that keeps a
generated workflow from failing quietly in production.

Clone it, point it at a dev instance, and build. Everything is project-scoped,
so it runs without touching your global editor configuration.

**Works in Claude Code, Codex, Cursor, VS Code with GitHub Copilot, Devin,
JetBrains Junie, and any other MCP-capable client.** One contract (`AGENTS.md`),
one MCP source (`.mcp.json`) fanned out per tool, one pre-tool guard. See
[docs/11-EDITORS.md](docs/11-EDITORS.md) for what differs per tool.

```bash
git clone <repo-url> n8n-workflow-harness
cd n8n-workflow-harness
./setup.sh                      # Windows: .\setup.ps1 - installs n8n-mcp
cp .env.example .env            # fill in your dev instance URL and API key
set -a; . ./.env; set +a        # every MCP config reads the process environment
claude                          # or codex, cursor, code .
```

Then paste [AI_SETUP_PROMPT.md](AI_SETUP_PROMPT.md) into that session and the
agent will verify the whole loop end to end, including a disposable probe
workflow it archives afterwards (the guard denies deletes; remove it from the
UI). Prefer to drive it yourself: [docs/02-SETUP.md](docs/02-SETUP.md).

New here? [docs/01-QUICKSTART.md](docs/01-QUICKSTART.md) is the fifteen-minute path.

## Why this exists

An LLM writing n8n workflows from training data alone gets the shape right and
the details wrong: a `typeVersion` that no longer exists, a webhook body read
from `$json` instead of `$json.body`, a Code node returning the wrong envelope,
an error output that was never wired. Those workflows validate. Some of them
even deploy. They fail later, quietly, in the customer's tenant.

This harness closes that gap three ways:

1. **Live schemas instead of recall.** `n8n-mcp` serves real node schemas,
   validators, and 2,700+ templates from a prebuilt database of 3,100+ nodes,
   and the instance's own MCP server owns the build loop, version history and
   publish. The harness pins the package and verifies both rather than hoping
   npm resolves it.
2. **Skills that fire before the mistake.** Twenty-five skills carry the rules for
   expressions, node configuration, Code nodes, AI agents, error handling, and
   the field-discovered traps that look like success.
3. **Verification that does not trust the model.** A Node-only toolkit that
   checks whether the repo and the live instance actually agree, lints a
   workflow before it moves environments, and a guard that denies deletes and
   asks before any write to staging or prod, in every editor that runs hooks.

## Layout

```
AGENTS.md                   the operating contract, read by every agent
CLAUDE.md                   @AGENTS.md plus Claude Code specifics
AI_SETUP_PROMPT.md          paste-in prompt that sets up and verifies the harness
setup.sh / setup.ps1        one-time wiring for a fresh clone
package.json                pins n8n-mcp, @n8n/cli, @n8n/workflow-sdk; package-lock.json locks them
.mcp.json                   the three MCP servers (source of the per-tool configs)
.vscode/mcp.json            VS Code + Copilot                             generated
.cursor/mcp.json            Cursor                                        generated
.codex/config.toml          Codex                                         generated
.aiassistant/rules/         JetBrains Junie                               generated
.mcp.npx.json               fallback config if you cannot run npm ci
.env.example                instance URL, API key, MCP access token template
.gitattributes              git diff on workflows/ shows behavior, not canvas moves
.github/workflows/          CI: validate and lint on push, drift on a schedule (.gitlab-ci.yml too)
.agents/skills/             25 skills, read by Codex, Cursor, Copilot, Devin, Junie
.claude/
  settings.json             permissions, hooks, the guard
  skills/                   links into .agents/skills/                    generated
  hooks/                    session contract injection, pre-write reminder
.codex/ .cursor/ .github/hooks/ .devin/   guard hook configs per tool
scripts/                    the deterministic toolkit (Node built-ins only)
  guard-pre-tool.mjs        deny deletes, ask before prod writes; one script for every tool
  lint-workflow.mjs         promotion lint and the credentials/variables manifest
  wf-diff.mjs               semantic diff of two workflow files
  wf-textconv.mjs           the git textconv
  node-inventory.mjs        node types and typeVersions in use
  organize.mjs              projects, folders, tags, credential and data table scope
  secret-map.mjs            credentials from the secret manager by name, scrubbed output
  gen-agent-configs.mjs     fan AGENTS.md, .mcp.json and the skills out per tool
  mcp-server.mjs            launches the pinned n8n-mcp, cwd-independent
  mcp-smoke.mjs             real MCP handshake against the server
  vendor-mcp.sh             pack n8n-mcp for an air-gapped install
  refresh-skills.sh         re-vendor the 15 upstream skills
  verify-setup.sh           preflight over the whole clone
workflows/{dev,staging,prod}/   workflow JSON: the source of truth
deploy/                     secret-map.<env>.json (committed) and creds.<env>.json (ids, gitignored)
examples/hello-set.json     minimal validated workflow
docs/                       full documentation, see the index below
tests/                      toolkit, instance and guard tests
```

## The rules that matter

Eight rules earn their place by preventing a class of workflow that looks correct
and breaks in production. They are in [AGENTS.md](AGENTS.md), so every agent loads
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
| Export before you change, drift-check before you trust | A snapshot taken while repo and instance disagreed is not a rollback point |
| Archive, do not delete | The guard denies deletes and names the alternative |

Working order for any change:

```
drift-check → export-all + commit → change on dev → validate →
get_workflow and read connections → execute → verify → lint-workflow →
promote through the agreed path → verify again on the target
```

## Skills

Twenty-five skills in `.agents/skills/`, discovered by Codex, Cursor, Copilot,
Devin and Junie, and linked into `.claude/skills/` for Claude Code. `using-n8n-mcp-skills` is the router: it fires first and
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
| `n8n-promotion-pipeline` | n8n Promotions over `@n8n/cli`: providers, connections, reviewed-commit apply, exit codes |
| `n8n-workflow-as-code` | `@n8n/workflow-sdk`: JSON to code and back, validate, Mermaid |
| `n8n-upgrade-plan` | Node inventory, typeVersion gaps, the plan for an instance upgrade |
| `n8n-project-organization` | Projects, folders, tags and credential ownership: the placement in the JSON, `organize.sh`, credentials and data tables following a workflow |
| `n8n-credential-mapping` | Which secret feeds which credential per environment: the committed secret map, `secret-map.sh` creating credentials from Infisical without a value reaching the terminal, the id ledger, rotation, verify |
| `n8n-self-hosting` | Deploying n8n itself: Docker Compose, Caddy, queue mode |
| `n8n-node-dev` | Custom node packaging, the every-worker rule, air-gapped install |

Fifteen are vendored from the upstream `n8n-skills` pack; ten are original to
this harness. See [ATTRIBUTION.md](ATTRIBUTION.md) and
[docs/04-SKILLS.md](docs/04-SKILLS.md).

## The engine: n8n-mcp and the official instance MCP

Node schemas, validators and templates come from
**[n8n-mcp](https://github.com/czlonkowski/n8n-mcp)** by Romuald Członkowski
(MIT): 3,100+ node schemas including community nodes, real validators, and
2,700+ workflow templates, served from a prebuilt database that ships inside
the package. The build loop, version history and diffs, publish, Agents and
data tables come from the instance's own MCP server (`/mcp-server/http`, GA
since n8n 2.31). Both, routed by task; the table is in
[docs/03-MCP-SERVERS.md](docs/03-MCP-SERVERS.md).

Without it, an LLM writes plausible n8n JSON. With it, it writes JSON that
matches your instance.

So this harness treats it as a **pinned dependency, not a runtime download**:

```json
"dependencies": { "@n8n/cli": "0.22.0", "@n8n/workflow-sdk": "0.36.5", "n8n-mcp": "2.94.3" }
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

### Three servers

`n8n-mcp` changes behaviour depending on whether it can see instance
credentials, so it is registered twice; the third server is the instance's own.
Verified tool counts:

| Server | Credentials | Tools | Serves | Risk |
|---|---|---|---|---|
| `n8n-docs` | none | 7 | Node schemas, validators, templates | Safe anywhere. Cannot reach an instance |
| `n8n` | `N8N_API_URL` + `N8N_API_KEY` | 28 (7 + 21) | Workflow CRUD, executions, credentials, folders, data tables, audit | Writes to a real instance |
| `n8n-official` | `N8N_API_URL` + `N8N_MCP_ACCESS_TOKEN` | varies by n8n version | Workflow SDK build loop, versions and diffs, publish, Agents, data tables | Writes to a real instance |

There is no separate `n8n-docs-mcp` package on npm. "Docs mode" is this same
package started without an API URL, which is what makes it safe to leave on.

Every MCP config expands `${N8N_API_URL}` from the **process environment**, not
from `.env` on disk. That is the single most common setup failure: launch with
`set -a; . ./.env; set +a; claude` (or your editor) or the instance servers
start credential-less.

### Proving it works

```bash
npm run smoke        # real MCP handshake: server version, tool counts
```

It completes an `initialize` and `tools/list` against the server and checks all
seven documentation tools are present. With `N8N_API_URL` exported it also
asserts the 21 `n8n_*` instance tools appeared, which is the fastest way to
confirm the credentials actually reached the server process.

Install paths (local pinned, npx fallback, air-gapped, Docker, from source),
the full tool inventory, and which server owns which task:
[docs/03-MCP-SERVERS.md](docs/03-MCP-SERVERS.md).

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
| `./scripts/lint-workflow.sh <file or dir>` | Promotion lint: environment literals, nameless credentials, `$env`, tags, error workflow. Prints the credentials and variables the target needs |
| `./scripts/wf-diff.sh <a> <b>` | What changed between two workflow files, ignoring canvas moves. `git diff` shows the same view |
| `./scripts/node-inventory.sh <dir>` | Node types and typeVersions in use, the input to an upgrade plan |
| `./scripts/organize.sh audit\|place\|credentials\|tables\|project` | What sits where on the instance, and fixing it: places a workflow in its project and folder with its tags, moves the credentials that go with it, copies data tables |
| `./scripts/secret-map.sh check\|sync\|rotate\|verify\|ids` | Credentials from the secret manager by name. Creates what the committed map names, in its project, with values that never reach the terminal; finds credentials in use that trace to nothing |
| `./scripts/gen-agent-configs.sh [--check]` | Regenerate the per-tool configs from `AGENTS.md`, `.mcp.json` and the skills |
| `npx n8n-cli ...` | The official client CLI: promotions, packages, source control, audit |
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
npm test        # toolkit, instance and guard tests
```

`instance.test.mjs` runs the real HTTP paths against a fake n8n API server, so
the instance-touching tools are covered offline with no instance involved.
`guard.test.mjs` is the hook contract.

## Hooks

Upstream ships its skills as a plugin whose hooks nudge you at the moment of
decision. This repo vendors the skills instead, so it carries its own small
hook layer to keep that behavior. The two reminder hooks fail open: an error
means no reminder, never a blocked call.

- **SessionStart** injects the harness contract, and names the instance the
  managed server is pointed at, so the rules are loaded from turn one instead
  of depending on a skill description matching your phrasing.
- **PreToolUse** on instance-mutating tools reminds you to read `connections`
  back after a write, warns that activation caches the trigger registration,
  and flags a credential write as needing the target confirmed first.
- **The guard** (`scripts/guard-pre-tool.mjs`) denies delete tools and delete
  commands and names the archive alternative; asks before a deploy or promotion
  to staging or prod, a `source-control pull`, a CLI activate, or any workflow
  write while the session points at the prod URL. Same script in Claude Code,
  Codex, Cursor, Copilot and Devin. Tested in the Claude Code payload shape.

The reminders can be disabled by removing them from the `hooks` block in
`.claude/settings.json`. Keep the guard; for an organisation-wide version that
a user cannot edit, see `docs/managed-settings.example.json`.

## Editors and agents

| | Claude Code | Codex | Cursor | VS Code + Copilot | Devin | Junie / Gemini |
|---|---|---|---|---|---|---|
| Three MCP servers | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Toolkit | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Contract (`AGENTS.md`) auto-loaded | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 25 skills discovered | ✅ | ✅ | ✅ | ✅ | ✅ | read on demand |
| Pre-tool guard | ask | ask | deny | deny | deny | ❌ |
| Session-start injection | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

One contract, one MCP source, one guard. `AGENTS.md` is read natively by every
tool in the table; `.mcp.json` is fanned out per tool; `scripts/guard-pre-tool.mjs`
is wired into every tool that runs pre-tool hooks.

```bash
npm run gen:agents      # regenerate the per-tool configs from AGENTS.md, .mcp.json, .agents/skills/
npm run check:agents    # exit 1 if any is stale
```

Per-tool setup and what each one cannot do: [docs/11-EDITORS.md](docs/11-EDITORS.md).
Promotion paths, managed settings, CI and hand-over: [docs/12-ENTERPRISE.md](docs/12-ENTERPRISE.md).

## Documentation

| Doc | Read it when |
|---|---|
| [01-QUICKSTART.md](docs/01-QUICKSTART.md) | You want to be building in fifteen minutes |
| [02-SETUP.md](docs/02-SETUP.md) | Full setup, the three servers, verification |
| [03-MCP-SERVERS.md](docs/03-MCP-SERVERS.md) | What each server serves, tool inventory, official n8n MCP |
| [04-SKILLS.md](docs/04-SKILLS.md) | Which skill owns a decision, and how routing works |
| [05-BUILD-LOOP.md](docs/05-BUILD-LOOP.md) | The build sequence, in order, with the checks |
| [06-TOOLKIT.md](docs/06-TOOLKIT.md) | Every script, its flags, and its exit codes |
| [07-PROMPT-RECIPES.md](docs/07-PROMPT-RECIPES.md) | Prompts that work, and why the vague ones do not |
| [08-SECURITY.md](docs/08-SECURITY.md) | Credentials, data boundaries, what never enters the repo |
| [09-TROUBLESHOOTING.md](docs/09-TROUBLESHOOTING.md) | It succeeded but nothing happened |
| [10-MAINTENANCE.md](docs/10-MAINTENANCE.md) | Refreshing skills, bumping the pinned server, the plugin path |
| [11-EDITORS.md](docs/11-EDITORS.md) | Claude Code, Codex, Cursor, Copilot, Devin, Junie, and other MCP clients |
| [12-ENTERPRISE.md](docs/12-ENTERPRISE.md) | Promotion paths, source control, managed settings, secrets, audit, hand-over |

## Requirements

- Node 20+ and npm (the toolkit, the CLI and the two n8n-mcp servers need it)
- Git
- An MCP-capable agent: Claude Code, Codex, Cursor, VS Code with Copilot (Agent
  mode), Devin, JetBrains Junie, or another MCP client
- An n8n instance with the public API enabled, and an API key. Dev, not prod.
  An instance-level MCP access token for the official server (optional).
  Promotions need n8n 2.40+ and a license.
- ~170 MB of disk for `node_modules`, most of it n8n-mcp's node database.
  `node_modules/` is gitignored; only the lockfile is committed.

No registry access? `./scripts/vendor-mcp.sh` packs n8n-mcp and its
dependencies for an offline `npm ci`. See
[docs/10-MAINTENANCE.md](docs/10-MAINTENANCE.md).

The `.sh` wrappers need bash; on Windows that means Git Bash. The `.mjs` tools
run natively under PowerShell, so nothing is bash-only.

## Licence and credit

This harness is MIT ([LICENSE](LICENSE)). Two of the components that do the
real work are MIT-licensed and both by **Romuald Członkowski**:

- **[n8n-mcp](https://github.com/czlonkowski/n8n-mcp)**, the server behind every
  schema lookup and validation call in this repo
- **[n8n-skills](https://github.com/czlonkowski/n8n-skills)**, fifteen of the
  twenty-five skills

`@n8n/cli` and `@n8n/workflow-sdk` are n8n GmbH packages under the Sustainable
Use License, pinned as dependencies and not redistributed here.

If you depend on them, consider [sponsoring](https://github.com/sponsors/czlonkowski).
Full credit in [ATTRIBUTION.md](ATTRIBUTION.md), full licence texts in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

Not an official n8n product, and no warranty from n8n GmbH. Where n8n's own
supported tooling overlaps, it takes priority; see
[docs/03-MCP-SERVERS.md](docs/03-MCP-SERVERS.md).
