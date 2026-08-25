# Quickstart

Fifteen minutes from clone to a verified build loop. You need Node 20+, git,
Claude Code, and an n8n **dev** instance with the public API enabled.

## 1. Clone and wire up

```bash
git clone <repo-url> n8n-workflow-harness
cd n8n-workflow-harness
./setup.sh
```

Windows: `.\setup.ps1`. This sets execute bits, **installs the pinned
`n8n-mcp` via `npm ci`**, creates `.env` from the template, runs `git init` if
needed, and finishes with a preflight.

The n8n-mcp install is ~100 MB and takes a minute: it carries a prebuilt
database of every n8n node, which is what makes the schemas and validation
correct rather than guessed. No registry access? See
[10-MAINTENANCE.md](10-MAINTENANCE.md).

## 2. Get an n8n API key

In n8n: **Settings → n8n API → Create an API key**. Copy it.

If that menu is missing, the public API is disabled on the instance. Enable it
(`N8N_PUBLIC_API_DISABLED=false`) or ask whoever owns the instance. Without it
the managed MCP server and the whole toolkit cannot work.

## 3. Fill `.env`

```bash
N8N_API_URL=https://n8n-dev.internal.example.com
N8N_API_KEY=<the key>
```

No trailing slash on the URL. Point at dev. `.env` is gitignored; keep it that
way.

## 4. Launch with the environment loaded

```bash
set -a; . ./.env; set +a
claude
```

**This step is the one people get wrong.** `.mcp.json` expands
`${N8N_API_URL}` from the process environment, not from `.env` on disk. Start
Claude Code without exporting first and the managed server comes up with no
credentials, `n8n_*` tools fail on auth, and nothing explains why.

Approve both MCP servers when Claude Code prompts. Check with `/mcp`.

## 5. Verify

Paste [../AI_SETUP_PROMPT.md](../AI_SETUP_PROMPT.md) into the session. Claude
checks prerequisites, both servers, and instance reachability, then builds and
deletes a disposable probe workflow to prove the loop works end to end.

By hand instead:

```bash
npm run smoke                # the engine: server starts, 7 docs tools present
./scripts/verify-setup.sh    # config, n8n-mcp, skills, hooks, toolkit
./scripts/doctor.sh          # online: reachability, API capability, repo state
```

With credentials exported, `npm run smoke` should report **25** tools, not 7.
Seven means the environment did not reach the server process, which is step 4.

## 6. Snapshot before you change anything

```bash
./scripts/export-all.sh
git add -A && git commit -m "baseline: instance state before any change"
```

This is your rollback point. It is only valid if `drift-check` was clean when
you took it, which on a fresh clone it trivially is.

## 7. Build something

Ask in plain language, and name the constraints:

> Build a webhook that takes a JSON order, validates that `orderId` and
> `email` are present, writes a row to Postgres, and returns 400 with the
> missing-field list if validation fails. Use the credential named
> `pg-dev-orders`. Do not activate it.

Claude will route through the skills, pull live node schemas, validate, and read
the connections back. Watch that it does: if it skips validation or activates
without asking, say so.

## Next

- [05-BUILD-LOOP.md](05-BUILD-LOOP.md) — the sequence, and why each check exists
- [07-PROMPT-RECIPES.md](07-PROMPT-RECIPES.md) — prompts that produce good work
- [09-TROUBLESHOOTING.md](09-TROUBLESHOOTING.md) — when it succeeds and does nothing
