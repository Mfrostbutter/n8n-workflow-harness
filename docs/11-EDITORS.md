# Editors and agents

The harness is not Claude Code only. The engine (`n8n-mcp` plus the instance's
own MCP server) is standard MCP, so it works in any MCP-capable client. What
varies is how much of the guidance and enforcement layer each one picks up.

## Support matrix

| | Claude Code | Codex | Cursor | VS Code + Copilot | Devin | Junie / Gemini / Zed |
|---|---|---|---|---|---|---|
| MCP servers (schemas, validation, instance, official) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Toolkit (`doctor`, `drift-check`, `lint-workflow`, …) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Contract auto-loaded | `CLAUDE.md` (`@AGENTS.md`) | `AGENTS.md` | `AGENTS.md` | `AGENTS.md` | `AGENTS.md` | `AGENTS.md`, `.aiassistant/rules/` |
| 23 skills discovered | `.claude/skills/` (links) | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` | read on demand |
| Pre-tool guard (deny deletes, ask on prod) | ✅ ask | ✅ ask | ✅ deny | ✅ deny | ✅ deny | ❌ |
| Session-start contract injection | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

One contract, `AGENTS.md`, read natively by every tool in the table. One MCP
source, `.mcp.json`, fanned out per tool by `npm run gen:agents`. One guard,
`scripts/guard-pre-tool.mjs`, wired into every tool that runs pre-tool hooks.

The guard can only *ask* where the tool supports it (Claude Code, Codex). Cursor,
Copilot and Devin get a deny with the reason and a note to run the step from a
terminal. Hook payload shapes for those three follow the vendors' documentation
as of 2026-10-19 and are not covered by the test suite; the Claude Code shape is.

## Generated files

Edit the source, run the generator, commit both.

| Source | Generated | Read by |
|---|---|---|
| `AGENTS.md` | `CLAUDE.md` (only if absent), `.aiassistant/rules/engagement.md` | Claude Code, Junie |
| `.mcp.json` | `.vscode/mcp.json`, `.cursor/mcp.json`, `.codex/config.toml` | VS Code, Cursor, Codex |
| `.agents/skills/` | `.claude/skills/` (symlinks; `--copy` on Windows) | Claude Code |

```bash
npm run gen:agents        # regenerate
npm run check:agents      # exit 1 if stale; verify-setup runs it
```

`.vscode/mcp.json` uses the `servers` key and an `inputs` block, so VS Code
prompts for the key and stores it itself. `.cursor/mcp.json` uses `${env:VAR}`.
`.codex/config.toml` does no variable expansion, so it lists the variables under
`env_vars` and the bearer token under `bearer_token_env_var`; export `.env`
before launching Codex. All three expand from the process environment, never
from disk.

## Claude Code

`setup.sh` does everything. `CLAUDE.md` is `@AGENTS.md` plus a short
Claude-only section. Hooks: session contract injection, the pre-write reminder,
and the guard. `.claude/settings.local.json` is gitignored for personal
overrides. Enterprise-managed settings: [12-ENTERPRISE.md](12-ENTERPRISE.md).

## Codex

Reads `AGENTS.md` and `.agents/skills/` natively. `.codex/config.toml` carries
the three servers; `.codex/hooks.json` wires the guard. Export `.env` first:

```bash
set -a; . ./.env; set +a; codex
```

## Cursor

Reads `AGENTS.md` and `.agents/skills/`. `.cursor/mcp.json` carries the
servers; enable them under **Settings → MCP**. `.cursor/hooks.json` wires the
guard on `beforeShellExecution` and `beforeMCPExecution`.

## VS Code with GitHub Copilot

Open the folder, `npm ci`, switch Copilot Chat to **Agent** mode, start the
servers from `.vscode/mcp.json` (**MCP: List Servers**). VS Code prompts for the
URL, key and access token on first use. Copilot reads `AGENTS.md` and
`.agents/skills/`; `.github/hooks/n8n-guard.json` wires the guard.

Lower Copilot tiers skip reasoning steps, which shows up as skipped validation.
Ask for the `connections` object every time.

## Devin Desktop

Reads `AGENTS.md` and `.agents/skills/`. `.devin/hooks.json` wires the guard
on command and MCP tool use. MCP servers are configured in Devin's own settings;
paste the `n8n-docs` block from `.mcp.json` with an absolute path to
`scripts/mcp-server.mjs`.

## Junie, Gemini CLI, Zed, other MCP clients

All read `AGENTS.md`. Junie also reads `.aiassistant/rules/`. Point the MCP
client at:

```
command: node
args:    <clone>/scripts/mcp-server.mjs
env:     MCP_MODE=stdio, LOG_LEVEL=error, DISABLE_CONSOLE_OUTPUT=true,
         N8N_MCP_TELEMETRY_DISABLED=true
         (+ N8N_API_URL and N8N_API_KEY for instance access)
```

and at `${N8N_API_URL}/mcp-server/http` with the bearer token for the official
server. Skills are plain markdown under `.agents/skills/`; name the file in the
prompt:

> Before configuring the Set node, read `.agents/skills/n8n-node-configuration/SKILL.md`
> and call `get_node`. Show me the `typeVersion` it reports.

## What does not port

Session-start injection is Claude Code only. Everywhere else the agent has the
contract and the skills index but is not prompted at the moment of the action.
Compensate with the deterministic layer, which is identical in every editor:

```bash
./scripts/drift-check.sh dev            # exit 1 on drift
./scripts/validate.sh <file>            # structure
./scripts/lint-workflow.sh workflows/dev  # promotion readiness
```
