# Editors and agents

The harness is not Claude Code only. The part that makes builds correct —
**n8n-mcp** — is a standard MCP server, so it works in any MCP-capable editor.
What varies is how much of the *guidance* layer each one picks up.

## Support matrix

| | Claude Code | VS Code + Copilot | Cursor | Windsurf | Codex CLI | Other MCP clients |
|---|---|---|---|---|---|---|
| n8n-mcp servers (schemas, validation, templates) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Instance tools (workflow CRUD, executions) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Toolkit (`doctor`, `drift-check`, …) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Contract auto-loaded | `CLAUDE.md` | `.github/copilot-instructions.md` | `.cursor/rules/` | `.windsurf/rules/` | `AGENTS.md` | manual |
| 20 skills load on their own | ✅ | ❌ read on demand | ❌ read on demand | ❌ read on demand | ❌ read on demand | ❌ |
| Hook enforcement layer | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Tool permission allowlist | ✅ | partial | partial | partial | partial | varies |

**Everything needed to build a correct workflow works everywhere.** The two
things you lose outside Claude Code are automatic skill loading and the hooks.
Both are guidance, not capability: the schemas, validators, and templates are
identical, because they come from the same pinned server.

## Config files, already in the repo

| Editor | File | Notes |
|---|---|---|
| Claude Code | `.mcp.json` | `mcpServers`; reads `${N8N_API_URL}` from the process environment |
| VS Code | `.vscode/mcp.json` | `servers` key, `type: stdio`, prompts for the key via `inputs` |
| Cursor | `.cursor/mcp.json` | `mcpServers`, same shape as Claude Code |
| Windsurf | configured in the UI | see below; Windsurf keeps MCP config globally |
| Codex CLI | `~/.codex/config.toml` | global, not per-project; see below |

Note the key differs: **VS Code uses `servers`, everything else uses
`mcpServers`.** Getting that wrong produces a config the editor silently
ignores, which is why `verify-setup.sh` checks both files for the right key.

## VS Code with GitHub Copilot

Already wired. Open the folder and:

1. `npm ci` — installs the pinned n8n-mcp.
2. Open Copilot Chat and switch to **Agent** mode. Ask mode cannot call tools.
3. The servers appear from `.vscode/mcp.json`. Start them (a "Start" affordance
   appears in the file, or run **MCP: List Servers**).
4. VS Code prompts for the instance URL and API key on first use, via the
   `inputs` block. It stores them itself, so nothing goes in the repo.

Leave the URL blank to run documentation-only: schemas, validation, and
templates with no ability to touch an instance.

`.github/copilot-instructions.md` is picked up automatically and carries the
contract plus the skills index.

**Worth knowing:** on lower Copilot tiers the model may not do extended
reasoning, which shows up as skipped validation steps. Upstream suggests pairing
n8n-mcp with the Sequential Thinking MCP server to compensate. Be more explicit
in prompts here than you would need to be in Claude Code — ask for the
`connections` object every time.

## Cursor

Already wired.

1. `npm ci`.
2. Cursor picks up `.cursor/mcp.json`. Enable the servers under
   **Settings → MCP**.
3. `.cursor/rules/n8n-harness.mdc` is `alwaysApply: true`, so the contract loads
   in every request in this project.

`.cursor/mcp.json` uses `${N8N_API_URL}`, so launch Cursor from a shell with the
environment exported, or replace the placeholders with literal values — in which
case **do not commit that file**, since it would then hold your key.

Cursor also reads `AGENTS.md`.

## Windsurf

Windsurf keeps MCP config globally rather than per project:

1. **Settings → Windsurf Settings → MCP Servers → Manage Plugins → View Raw
   Config**.
2. Paste the contents of `.cursor/mcp.json` (same `mcpServers` shape), replacing
   the relative `scripts/mcp-server.mjs` with an **absolute path** to this
   clone. A global config has no project-relative working directory.

`.windsurf/rules/n8n-harness.md` is `trigger: always_on` and loads the contract
per project.

## Codex CLI

Global config at `~/.codex/config.toml`:

```toml
[mcp_servers.n8n_docs]
command = "node"
args = ["/absolute/path/to/n8n-workflow-harness/scripts/mcp-server.mjs"]
env = { "MCP_MODE" = "stdio", "LOG_LEVEL" = "error", "DISABLE_CONSOLE_OUTPUT" = "true" }

[mcp_servers.n8n]
command = "node"
args = ["/absolute/path/to/n8n-workflow-harness/scripts/mcp-server.mjs"]
env = { "MCP_MODE" = "stdio", "LOG_LEVEL" = "error", "DISABLE_CONSOLE_OUTPUT" = "true", "N8N_API_URL" = "https://n8n-dev.example.com", "N8N_API_KEY" = "your-key" }
```

Absolute paths, because the config is global. Note this file holds the key in
plaintext, so protect it (`chmod 600`) and prefer the per-project editors if
that is a concern. `/mcp` in the Codex CLI shows server status.

Codex reads `AGENTS.md` automatically.

## Any other MCP client

Zed, Continue, JetBrains AI, Gemini CLI, and others: point them at

```
command: node
args:    <clone>/scripts/mcp-server.mjs
env:     MCP_MODE=stdio, LOG_LEVEL=error, DISABLE_CONSOLE_OUTPUT=true
         (+ N8N_API_URL and N8N_API_KEY for instance access)
```

The launcher resolves n8n-mcp relative to its own location, so an absolute path
to it works from any working directory. Confirm with:

```bash
npm run smoke        # 7 tools bare, 25 with credentials
```

If your client reads `AGENTS.md`, the contract comes along for free. If not,
paste `AGENTS.md` into its system prompt or rules file.

## Making the skills work outside Claude Code

Only Claude Code loads `.claude/skills/` automatically. Everywhere else they are
still useful, just not automatic — they are plain markdown in the repo, and the
generated instruction files carry an index of all twenty with their file paths
and what each one owns.

So the degradation is: the agent is *told the skills exist, what each covers,
and where to read it*. That works, but it is opt-in on the agent's part, so
prompt for it explicitly:

> Before configuring the Set node, read `.claude/skills/n8n-node-configuration/SKILL.md`
> and call `get_node`. Show me the `typeVersion` it reports.

Being explicit about which file to read is the single biggest quality lever
outside Claude Code. `docs/07-PROMPT-RECIPES.md` applies to every editor; just
name the skill file rather than expecting it to load.

## Keeping the instruction files in sync

Four editors want the same rules in four formats. Rather than maintain four
copies, they are **generated from one source**:

```bash
npm run gen:editors      # regenerate all four
npm run check:editors    # exit 1 if any is stale
```

Source: `CLAUDE.md` (the contract) plus the frontmatter of every installed
skill (the routing index). Each generated file says so at the top.

**Edit `CLAUDE.md`, then regenerate.** Editing a generated file directly means
your change is lost on the next run and the editors disagree with each other in
the meantime. `verify-setup.sh` fails if they are out of sync, and
`check:editors` belongs in CI or a pre-commit hook.

Adding or removing a skill changes the index, so regenerate after
`./scripts/refresh-skills.sh` too.

## What you cannot port

The hooks in `.claude/hooks/` are Claude Code only. There is no equivalent in
Copilot, Cursor, or Windsurf, so outside Claude Code nothing reminds the agent
to read `connections` back after a write, or warns before a credential write.

The rules are still in the generated instruction files, so the agent has been
told. It just is not prompted at the moment of the action. Compensate with the
deterministic layer, which works identically everywhere:

```bash
./scripts/drift-check.sh dev      # exit 1 on drift
./scripts/validate.sh <file>      # offline structural check
```

That is the reason the toolkit has no dependencies and no AI in it: it is the
part that does not care which editor you used.
