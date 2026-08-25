# Setup

The full path, with the reasoning. For the fast version see
[01-QUICKSTART.md](01-QUICKSTART.md); to hand it to Claude, use
[../AI_SETUP_PROMPT.md](../AI_SETUP_PROMPT.md).

## 0. Prerequisites

| Need | Why | Check |
|---|---|---|
| Node 20+ | Both MCP servers and the whole toolkit | `node --version` |
| Git | Rollback. Without it there is no undo | `git --version` |
| Claude Code | The harness itself | `claude --version` |
| n8n instance, public API on | Anything that touches a workflow | Settings → n8n API |
| An API key | Same | Settings → n8n API → Create |

Node ships `npx`, which is how both MCP servers start. If your network blocks
the npm registry, see [10-MAINTENANCE.md](10-MAINTENANCE.md) for the offline and
Docker options.

## 1. Clone and run setup

```bash
git clone <repo-url> n8n-workflow-harness
cd n8n-workflow-harness
./setup.sh --dry-run   # see what it will do
./setup.sh
```

Windows: `.\setup.ps1 -DryRun`, then `.\setup.ps1`.

It sets execute bits on `scripts/` and `.claude/hooks/`, copies `.env.example`
to `.env` if absent, runs `git init` if this is not already a repo, and ends
with `./scripts/verify-setup.sh`.

It does **not** write credentials and does **not** contact an instance.

`--global-skills` additionally copies the twenty skills into
`~/.claude/skills/` so they load in every project, backing up anything it
replaces. You do not need this to use the harness: skills in
`.claude/skills/` already load whenever Claude Code runs in this directory.
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

## 4. Verify offline

```bash
./scripts/verify-setup.sh
```

Checks Node version, git, `.mcp.json` shape (including that `n8n-docs` carries
no credentials), all twenty skills and their `SKILL.md` files, both hooks
executing cleanly, every toolkit script parsing, and whether `.env` is exported
or accidentally tracked. Exit 0 and `RESULT: ok`, or exit 1 and `RESULT: BLOCKED`.

No instance needed. Run it any time something feels wrong.

## 5. Verify against the instance

```bash
./scripts/doctor.sh
```

Reports environment, whether the URL resolves and the key is accepted, whether
the public API is enabled, the n8n version, whether `workflows/` has exports
yet, and repo state. It warns if the active target equals `N8N_API_URL_PROD`.

Then confirm the MCP surface from inside Claude Code:

- Docs mode: `tools_documentation`, then `search_nodes` for `webhook`, then
  `get_node` on the Webhook node. All must answer with no credentials.
- Managed mode: `n8n_health_check`, then `n8n_list_workflows`.

If docs mode answers and managed mode fails on auth, go back to step 3.

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
7. Delete it, and confirm the deletion

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
