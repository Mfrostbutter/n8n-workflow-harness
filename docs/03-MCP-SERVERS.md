# MCP servers

## Two servers, one package

`.mcp.json` registers `n8n-mcp` twice. The package changes behaviour based on
whether it can see instance credentials, so registering it twice gives you a
safe half and a privileged half that are impossible to confuse.

| Server | Credentials | Reaches an instance | Use for |
|---|---|---|---|
| `n8n-docs` | none | No | Node schemas, validation, templates |
| `n8n` | `N8N_API_URL`, `N8N_API_KEY` | **Yes** | Workflow CRUD, executions, credentials, audit |

**There is no `n8n-docs-mcp` package.** If you went looking for one on npm you
would not find it. "Docs mode" is `n8n-mcp` started without an API URL. That is
worth knowing because it means the two servers are always the same version, and
bumping the pin in [10-MAINTENANCE.md](10-MAINTENANCE.md) moves both together.

Pinned to `n8n-mcp@2.73.0` for reproducibility. Unpinned `npx -y n8n-mcp` would
silently change under you between sessions, which is exactly the drift the
harness exists to prevent.

## Tool inventory

The server reports **24 tools**: 6 available without credentials, 18 that need
them. `tools_documentation` is exposed as well and is the best first call in a
session on an unfamiliar n8n version.

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
| `n8n_delete_workflow` | Delete |
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

Several of these are version-gated. `n8n_health_check` reports the version; if a
tool 404s, check that before assuming it is broken.

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

## Verifying both servers

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

## Scoping and approval

Both servers are declared in the project `.mcp.json`, so they exist only when
Claude Code runs in this directory, and Claude Code asks you to approve them on
first use. `.claude/settings.json` lists them under `enabledMcpjsonServers`.

To work docs-only for a while — reviewing JSON, no instance access — remove
`"n8n"` from that list, or unset `N8N_API_URL` before launching.

The seven read-only docs tools are pre-allowed in `.claude/settings.json`. Every
instance-mutating tool deliberately is not, so you see a prompt before a write.

## Coexisting with n8n's official tooling

n8n ships its own, and it is the supported path:

1. **Instance-level MCP** (Settings → Instance-level MCP) exposes selected
   workflows from the instance itself, with a credential the instance issues.
   That is the right front door for a customer-owned instance, especially where
   an outbound API key is not acceptable. It is complementary: it exposes
   *workflows as tools*, where the managed server here does *workflow CRUD*.
2. **Official skills plugin** (`n8n-io/skills`) overlaps with the vendored
   skills here. If you install both, do the dedupe pass in
   [04-SKILLS.md](04-SKILLS.md#deduping-against-the-official-n8n-skills).

Where they overlap, prefer the official tooling: it tracks the product. This
harness is for what it does not cover yet.

## Networks that block npm

`npx` fetches the package on first run. If the registry is unreachable, see
[10-MAINTENANCE.md](10-MAINTENANCE.md) for pre-seeding the npm cache, pointing
at an internal registry, or the upstream Docker image.
