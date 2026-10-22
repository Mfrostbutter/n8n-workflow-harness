# MCP servers

## n8n-mcp is the engine

**Upstream: https://github.com/czlonkowski/n8n-mcp** (MIT, Romuald Członkowski)

Every correct node parameter, every real validation result, and every template
in this harness comes from `n8n-mcp`. It is not a convenience: it is the
component that replaces a model's stale training data with the actual schema for
the n8n version in front of you.

What ships inside the package:

- 3,100+ node schemas (core and community), 99% property coverage
- real validators for a single node and for a whole workflow
- 2,700+ workflow templates with searchable metadata
- a prebuilt SQLite database (`data/nodes.db`, ~94 MB) holding all of it

That database is why the install is ~100 MB and why it works with no network
once installed.

## Pinned, not downloaded on demand

```json
"dependencies": { "n8n-mcp": "2.94.3" }
```

`package.json` pins it, `package-lock.json` commits the resolved URL and the
`sha512` integrity hash, and `npm ci` reproduces the exact install anywhere.
`./setup.sh` runs that for you.

**Why not `npx -y n8n-mcp`?** Because it resolves to whatever is newest when the
server spawns. Two engineers on the same commit would get different tool
surfaces, a reported bug would be unreproducible, and a security review of "we
run n8n-mcp" would mean nothing. Pinning makes the version a reviewed change,
like any other dependency.

`scripts/mcp-server.mjs` is the launcher `.mcp.json` calls. It resolves the
package relative to its own location, so the working directory the client uses
does not matter, and if `npm ci` was skipped it says so in plain language
instead of failing with `ENOENT`.

## Three servers

Two are `n8n-mcp`, which changes behaviour depending on whether it can see
instance credentials, so it is registered twice. The third is the instance's
own MCP server, which runs nothing locally. That gives you a half that cannot
possibly touch an instance and a half that can, with no ambiguity about which
you are calling.

| Server | Credentials | Tools | Reaches an instance | Use for |
|---|---|---|---|---|
| `n8n-docs` | none | 7 | No | Node schemas, validation, templates |
| `n8n` | `N8N_API_URL`, `N8N_API_KEY` | 28 | **Yes** | Workflow CRUD, executions, credentials, folders, data tables, audit |
| `n8n-official` | `N8N_API_URL`, `N8N_MCP_ACCESS_TOKEN` | varies by n8n version | **Yes** | Workflow SDK build loop, version history and diffs, publish, Agents, data tables |

**There is no `n8n-docs-mcp` package.** If you went looking for one on npm you
would not find it. "Docs mode" is `n8n-mcp` started without an API URL. That is
worth knowing: the two n8n-mcp servers are always the same version, so the pin moves
both together.

Counts above are measured, not quoted: `npm run smoke` completes a real
handshake and prints them. Note the server's own `tools_documentation` says
"24 tools" because it does not count `tools_documentation` itself in its
categories; the wire protocol exposes 7 without credentials and 28 with.

## Tool inventory

**7 tools without credentials, 28 with** (the 7 plus 21 instance tools).
`tools_documentation` is the best first call in a session on an unfamiliar n8n
version.

### `n8n-docs` (no credentials)

| Tool | Does |
|---|---|
| `search_nodes` | Full-text node search. Supports OR, AND, FUZZY |
| `get_node` | The workhorse. `detail: minimal/standard/full`, plus `mode: docs / search_properties / versions / compare / breaking / migrations` |
| `validate_node` | One node's config. `mode: minimal` for required fields, full for everything |
| `validate_workflow` | Whole workflow: nodes, connections, expressions |
| `search_templates` | `searchMode: keyword / by_nodes / by_task / by_metadata / patterns` over 2,700+ templates |
| `get_template` | Complete workflow JSON by id |
| `tools_documentation` | The server's own reference, and per-tool docs at `depth: full` |

**Start with `detail: 'standard'`.** It is 1–2 KB and shows the required
fields. `detail: 'full'` can exceed 100 KB and will crowd out your context for
no gain. Reach for it only when standard is genuinely insufficient.

For Code nodes, call `tools_documentation({topic: "javascript_code_node_guide"})`
(or `python_code_node_guide`) before writing anything.

### `n8n` (needs credentials)

| Tool | Does |
|---|---|
| `n8n_health_check` | API connectivity. First call when something looks wrong |
| `n8n_list_workflows` | List with filters |
| `n8n_get_workflow` | Read one back. `mode: full / details / active / structure / minimal` |
| `n8n_create_workflow` | Create |
| `n8n_update_partial_workflow` | Incremental diff update. Prefer this |
| `n8n_update_full_workflow` | Whole-workflow replacement |
| `n8n_delete_workflow` | Delete. Denied by the guard and by `.claude/settings.json`; archive instead |
| `n8n_validate_workflow` | Validate by id, against the deployed copy |
| `n8n_autofix_workflow` | Auto-fix common issues. Read the diff before trusting it |
| `n8n_test_workflow` | Trigger a run: webhook, form, chat, execute |
| `n8n_executions` | `action: get / list / delete` |
| `n8n_workflow_versions` | Version history and rollback |
| `n8n_deploy_template` | Deploy a template straight onto the instance |
| `n8n_manage_credentials` | `action: list / get / create / update / delete / getSchema` |
| `n8n_manage_folders` | `action: create / list / get / rename / move / delete` (n8n 2.19+) |
| `n8n_manage_datatable` | Data tables and rows |
| `n8n_evaluations` | Evaluation test runs (n8n 2.30+, run/cancel on 2.32+) |
| `n8n_audit_instance` | Security audit of the instance |
| `n8n_list_catalog` | Projects, tags, variables, users on the instance |
| `n8n_manage_agents` | n8n Agents: `action: list / get / create / update / delete / publish` |
| `n8n_explore_node_resources` | Live resource lookups a node offers (sheets, channels, tables) with real credentials |

Several of these are version-gated. `n8n_health_check` reports the version; if a
tool 404s, check that before assuming it is broken.

**Private instance addresses.** n8n-mcp validates `N8N_API_URL` against an
SSRF guard before every call. In its default `strict` mode that refuses
`localhost` and RFC1918 addresses, which is where most dev instances live, and
every `n8n_*` tool then answers `SSRF protection: Private IP addresses not
allowed` (`moderate` still blocks private IPs). `scripts/mcp-server.mjs` runs
the server with `WEBHOOK_SECURITY_MODE=permissive` unless the environment sets
a value, and `.mcp.json` passes the variable through, so a LAN or loopback
instance works out of the box. The guard also covers the webhook URLs
`n8n_test_workflow` calls. Set the variable to `strict` yourself if the
instance is public and you want the guard back; `doctor` prints the mode in
force and fails when it would block the configured URL.

### Draft versus published

`n8n_get_workflow` distinguishes `mode: 'full'` (the **draft** graph) from
`mode: 'active'` (the **published** graph that actually runs). On instances with
that distinction, editing the draft and reading it back proves nothing about
what executes. If a change validates and the running behaviour does not move,
read `mode: 'active'` and compare. See
[09-TROUBLESHOOTING.md](09-TROUBLESHOOTING.md) and the `n8n-gotchas` skill.

## The environment expansion trap

```json
"env": { "N8N_API_URL": "${N8N_API_URL:-}" }
```

Claude Code expands that from **its own process environment** when it spawns the
server. It does not read `.env`. So:

```bash
set -a; . ./.env; set +a; claude     # correct
claude                              # managed server starts credential-less
```

The failure mode is quiet: `n8n-docs` works fine, every `n8n_*` call fails on
auth, and the error text does not mention the environment. If that is what you
are seeing, this is why.

`:-` in `${N8N_API_URL:-}` keeps the server from failing to start when the
variable is absent, so docs work regardless.

## Install paths

Five ways to get the server, in order of preference.

### 1. Pinned local install (default)

```bash
npm ci
npm run smoke
```

Reproducible, auditable, offline after the first install. This is what
`.mcp.json` expects.

### 2. Air-gapped

On a machine with registry access:

```bash
./scripts/vendor-mcp.sh          # writes vendor/npm-cache and the tarball
```

Move `vendor/` to the target machine, then:

```bash
npm ci --offline --cache vendor/npm-cache
```

`vendor/` is gitignored by default because it is large. Commit it deliberately
if air-gapped delivery is the point of your copy.

### 3. npx fallback

If you cannot run `npm ci` at all:

```bash
cp .mcp.npx.json .mcp.json
```

Still version-qualified (`n8n-mcp@2.94.3`), but no lockfile and no integrity
hash. Fetches from the registry on first run.

### 4. Docker

Upstream publishes `ghcr.io/czlonkowski/n8n-mcp`. Replace `command` and `args`
in `.mcp.json` with a `docker run -i --rm` invocation passing the same
environment variables. Pulling the image needs registry access too, so this
helps with a Node-version constraint rather than an offline one.

### 5. From source

```bash
git clone https://github.com/czlonkowski/n8n-mcp.git
cd n8n-mcp && npm install && npm run build
```

Then point `.mcp.json` at the built `dist/mcp/stdio-wrapper.js`. Only worth it
if you are modifying the server; note it builds the node database as part of
setup. Follow upstream's own instructions, not these.

## Verifying the servers

```bash
npm run smoke                              # no credentials: expect 7 tools
set -a; . ./.env; set +a; npm run smoke    # with credentials: expect 28
```

The smoke test completes a real `initialize` and `tools/list`, so a pass means
the server genuinely started and answered, not merely that a file exists.

Inside Claude Code, `/mcp` lists servers, connection state, and tool counts.
Then:

```
tools_documentation()                     -> docs mode answers
search_nodes({query: "webhook"})          -> docs mode answers
get_node({nodeType: "nodes-base.webhook", detail: "standard"})
n8n_health_check()                        -> managed mode answers, names the version
n8n_list_workflows({limit: 5})            -> managed mode reads the instance
```

Docs answering while managed fails means credentials, not configuration.

For `n8n-official`, `/mcp` shows the connection state; the first call is
`get_instance_context`, which names the instance, version and projects. A 401
means the access token (Settings → Instance-level MCP, generated per user)
is missing or belongs to another instance.

## Scoping and approval

All three servers are declared in the project `.mcp.json`, so they exist only when
Claude Code runs in this directory, and Claude Code asks you to approve them on
first use. `.claude/settings.json` lists them under `enabledMcpjsonServers`.

To work docs-only for a while — reviewing JSON, no instance access — remove
`"n8n"` from that list, or unset `N8N_API_URL` before launching.

The seven read-only docs tools are pre-allowed in `.claude/settings.json`. Every
instance-mutating tool deliberately is not, so you see a prompt before a write.

## Official versus community: which server for what

The official instance MCP server (GA since n8n 2.31, `Settings → Instance-level
MCP`) and `n8n-mcp` overlap on workflow reads and writes. They do not overlap on
what matters, so the harness carries both and routes by task:

| Task | Server | Why |
|---|---|---|
| Node schemas, community nodes, templates, validation profiles | `n8n-docs` | Offline database of 3,100+ nodes; the official server only knows nodes installed on the instance |
| Credential CRUD, folders, executions by filter, instance audit | `n8n` | The official server exposes none of these |
| Building a workflow from code, version history and diffs, publish, restore a version | `n8n-official` | Owns the Workflow SDK loop and the version store; writes land as a draft you then publish |
| n8n Agents (the first-class artifact), data tables | `n8n-official` | Native; `n8n_manage_agents` on the community server is a thin public-API wrapper |
| Health, version, "is the key accepted" | `n8n` (`n8n_health_check`) or `doctor.sh` | Cheapest signal |

The official server tracks the product and is the supported path where both
work. The community server is for what the product does not expose. Neither
reaches prod from a build session; the promotion path does
([12-ENTERPRISE.md](12-ENTERPRISE.md)).

**Official skills plugin** (`n8n-io/skills`) names its MCP server `n8n-mcp`,
which collides with nothing here but will with a user-level server of that
name. It overlaps with the vendored skills; if you install both, do the dedupe
pass in [04-SKILLS.md](04-SKILLS.md#deduping-against-the-official-n8n-skills).

## Upstream

`n8n-mcp` is third-party MIT software that this harness depends on completely.
Worth knowing where to go:

- Repository and issues: https://github.com/czlonkowski/n8n-mcp
- The skills pack: https://github.com/czlonkowski/n8n-skills
- Sponsor: https://github.com/sponsors/czlonkowski

Upstream also runs a hosted option at `dashboard.n8n-mcp.com` with a free tier,
which is useful for a quick trial but not what this harness is built around: a
hosted server means your workflow JSON and node queries leave your network,
which is usually the wrong trade for enterprise delivery.
