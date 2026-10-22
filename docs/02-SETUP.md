# Setup

The full path, with the reasoning. For the fast version see
[01-QUICKSTART.md](01-QUICKSTART.md); to hand it to Claude, use
[../AI_SETUP_PROMPT.md](../AI_SETUP_PROMPT.md).

## 0. Prerequisites

| Need | Why | Check |
|---|---|---|
| Node 20+ and npm (24 recommended, required on Windows without build tools) | The n8n-mcp servers, the CLI and the whole toolkit. `isolated-vm` (via `@n8n/expression-runtime`) ships prebuilt binaries for Node 24; on older lines `npm ci` compiles it and needs a C++ toolchain | `node --version` |
| Git | Rollback. Without it there is no undo | `git --version` |
| Claude Code | The harness itself | `claude --version` |
| n8n instance, public API on | Anything that touches a workflow | Settings → n8n API |
| An API key | Same | Settings → n8n API → Create |

You also need ~170 MB of disk for `node_modules`, most of it n8n-mcp's prebuilt
node database. If your network blocks the npm registry, see
[10-MAINTENANCE.md](10-MAINTENANCE.md) for the offline path.

## 1. Clone and run setup

```bash
git clone <repo-url> n8n-workflow-harness
cd n8n-workflow-harness
./setup.sh --dry-run   # see what it will do
./setup.sh
```

Windows: `.\setup.ps1 -DryRun`, then `.\setup.ps1`. It does the same work
natively, and additionally replaces the committed skill symlinks (which a
default Windows checkout turns into text files) with copies that git ignores.
Details and the `core.symlinks` alternative: [11-EDITORS.md](11-EDITORS.md#windows).

It sets execute bits on `scripts/`, **installs the pinned `n8n-mcp` via
`npm ci`**, copies `.env.example` to `.env` if absent, runs `git init` if this
is not already a repo, generates the per-editor configs and skill links, and
ends with `./scripts/verify-setup.sh`.

The n8n-mcp install is the slow part (~100 MB, because it carries the node
database that makes validation accurate). If `vendor/npm-cache` exists it
installs offline from there instead.

It does **not** write credentials and does **not** contact an instance.

`--global-skills` additionally copies the twenty-five skills into
`~/.claude/skills/` so they load in every project, backing up anything it
replaces. You do not need this to use the harness: skills in
`.agents/skills/` (linked into `.claude/skills/`) already load whenever Claude
Code runs in this directory.
Prefer project scope unless you specifically want n8n skills everywhere.

## 2. Credentials

Fill `.env`:

```bash
N8N_API_URL=https://n8n-dev.internal.example.com
N8N_API_KEY=<key from Settings -> n8n API>
```

No trailing slash. Point at **dev**. The file is gitignored; `verify-setup.sh`
fails loudly if it ever becomes tracked.

`.env` also holds optional per-environment pairs (`N8N_API_URL_DEV`,
`_STAGING`, `_PROD`). The toolkit reads those directly, so
`./scripts/doctor.sh staging` works without editing the active pair. `_PROD` is
blank by default on purpose.

Behind Cloudflare Access, uncomment `N8N_CF_CLIENT_ID` and
`N8N_CF_CLIENT_SECRET`; `n8n-mcp` sends them as `CF-Access-Client-*` headers.

## 3. Launch with the environment exported

```bash
set -a; . ./.env; set +a
claude
```

PowerShell:

```powershell
Get-Content .env | Where-Object { $_ -match '^\s*[A-Z]' } | ForEach-Object {
  $k,$v = $_ -split '=',2
  [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim())
}
claude
```

**Why this matters.** `.mcp.json` contains `"N8N_API_URL": "${N8N_API_URL}"`.
Claude Code expands that from its own process environment when it spawns the
server. Sourcing `.env` after launch, or not at all, produces a managed server
with no credentials: docs tools work, every `n8n_*` tool fails on auth, and the
error does not say why. This is the most common setup failure.

Claude Code prompts to approve project MCP servers on first use. Approve both.
`/mcp` shows their status and tool counts.

### Behind a corporate proxy

Export these alongside `.env` before launching, in every editor:

```bash
export NODE_USE_ENV_PROXY=1                      # Node's fetch follows HTTPS_PROXY / NO_PROXY
export NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem    # CA bundle if TLS is inspected
```

The MCP server follows the proxy variables on its own; the toolkit needs the
first line, and both need the second when the instance certificate is
re-signed on the way. Not `NODE_TLS_REJECT_UNAUTHORIZED=0`. The full picture
is in [09-TROUBLESHOOTING.md](09-TROUBLESHOOTING.md#behind-a-corporate-proxy-or-tls-inspection).

### Private instance addresses

A dev instance on `localhost` or a LAN address is the normal case, and n8n-mcp
would refuse it in its default SSRF mode. `scripts/mcp-server.mjs` runs the
managed server with `WEBHOOK_SECURITY_MODE=permissive` unless you set the
variable yourself; `doctor` tells you which mode is in force.

## 4. Verify offline

```bash
./scripts/verify-setup.sh
```

Checks Node version, git, `.mcp.json` shape (including that `n8n-docs` carries
no credentials), all twenty-five skills and their `SKILL.md` files, the
generated agent configs, the hooks executing cleanly, every toolkit script parsing, and whether `.env` is exported
or accidentally tracked. Exit 0 and `RESULT: ok`, or exit 1 and `RESULT: BLOCKED`.

No instance needed. Run it any time something feels wrong. It includes a real
MCP handshake against n8n-mcp, so a pass means the server actually started and
answered.

To check just the engine:

```bash
npm run smoke        # expect 7 tools with no credentials
```

## 5. Verify against the instance

```bash
./scripts/doctor.sh
```

Reports environment (including which proxy and CA variables are set, names
only), the SSRF mode the managed server will run in, whether the URL resolves
and the key is accepted, whether the public API is enabled, whether
`workflows/` has exports yet, and repo state. It warns if the active target
equals `N8N_API_URL_PROD`. An unreachable instance is reported with the
underlying error code and the matching fix.

Then confirm the MCP surface from inside Claude Code:

- Docs mode: `tools_documentation`, then `search_nodes` for `webhook`, then
  `get_node` on the Webhook node. All must answer with no credentials.
- Managed mode: `n8n_health_check`, then `n8n_list_workflows`.

If docs mode answers and managed mode fails on auth, go back to step 3. The
fastest confirmation that credentials reached the server process:

```bash
set -a; . ./.env; set +a; npm run smoke     # expect 28 tools, not 7
```

7 tools with `N8N_API_URL` set means the environment did not reach the server.

## 6. Baseline snapshot

```bash
./scripts/drift-check.sh      # on a fresh clone, nothing to compare yet
./scripts/export-all.sh
git add -A && git commit -m "baseline: instance state before any change"
```

Do this **before** the first change, not after. A snapshot taken while the repo
and the instance already disagreed is not a rollback point.

## 7. Prove the loop end to end

Against a scratch or dev instance, never a customer's prod:

1. `search_templates` for something close to the goal
2. `get_node` for each node's parameter schema
3. Build a two-node workflow and `validate_workflow`
4. `n8n_create_workflow`
5. `n8n_get_workflow` and inspect `connections`
6. Execute it, read the execution back
7. Archive it: deactivate, rename with an `ARCHIVED-` prefix, confirm by
   listing workflows. The guard denies delete calls; remove it from the UI
   later if you want it gone.

`examples/hello-set.json` is a minimal workflow that passes both the offline
validator and `validate_workflow`, if you want a known-good starting point.

Step 4 failing on auth means the environment did not reach the MCP process:
step 3.

## 8. Optional: n8n's own tooling

n8n ships an instance-level MCP server (**Settings → Instance-level MCP**) and
an official skills plugin (`n8n-io/skills`). Both are supported paths and take
priority where they overlap with this harness. If you install the official
skills alongside these, do the dedupe pass in
[04-SKILLS.md](04-SKILLS.md#deduping-against-the-official-n8n-skills) first: two
skills firing on the same trigger is worse than either alone.
