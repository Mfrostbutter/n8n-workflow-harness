# AI setup prompt

Copy everything in the fenced block below and paste it as your first message to
an agent working **inside this repository**. It will check prerequisites, wire up
the harness, verify it against your instance, and stop to ask you for anything it
cannot safely guess.

Works in Claude Code, VS Code with Copilot (Agent mode), Cursor, Windsurf, Codex,
or any MCP-capable client. Outside Claude Code, read `AGENTS.md` first if the
agent has not already loaded it — see [docs/11-EDITORS.md](docs/11-EDITORS.md).

Prefer to do it yourself? Run `./setup.sh` and follow
[docs/02-SETUP.md](docs/02-SETUP.md). The two paths are equivalent.

---

```text
You are setting up this n8n workflow harness for me. Read CLAUDE.md first (or
AGENTS.md if you are not Claude Code - same contract), then work through the
phases below in order. Do not skip a phase, and do not run
ahead to workflow building: this session is setup and verification only.

Rules for this session:
- Never write, print, or echo the contents of .env, an API key, or any
  credential value. Refer to them by name only.
- Do not create, modify, activate, or delete any workflow on any instance
  during setup, except the single disposable probe workflow in Phase 5, which
  you delete before finishing.
- Never target a production instance. If the URL I give you looks like prod,
  stop and ask me to confirm before using it.
- If a command fails, show me the actual error output. Do not guess at a cause
  or paper over it.

PHASE 1 - Environment and the engine
This harness is built around n8n-mcp (https://github.com/czlonkowski/n8n-mcp),
pinned in package.json. It is what supplies real node schemas, validators, and
templates instead of your training data, so nothing else matters until it runs.

First confirm it is installed and matches the pin. If node_modules/n8n-mcp is
absent, run `npm ci` (it is ~100 MB because it carries a prebuilt node
database; if vendor/npm-cache exists, use `npm ci --offline --cache
vendor/npm-cache`).

Then run `npm run smoke` and show me the output. Expect 7 tools with no
credentials. If it fails, stop and show me the error: everything downstream
depends on this.

Then run ./scripts/verify-setup.sh and show me the result. It checks Node, git,
the MCP config, the n8n-mcp pin and its node database, the 20 skills, the hooks,
and the toolkit. Fix anything it flags that is fixable without my input (missing
executable bits, missing .env copied from .env.example, git init). Report
anything that needs a decision from me instead of deciding for me.

PHASE 2 - Credentials
Check whether .env exists and whether N8N_API_URL and N8N_API_KEY are exported
in this shell. Do not read the key's value.
- If .env is missing, copy .env.example to .env and tell me to fill it.
- If .env exists but the variables are not exported in the environment, tell me
  this session cannot reach the instance and give me the exact relaunch command:
      set -a; . ./.env; set +a; claude
  Explain why: .mcp.json expands ${N8N_API_URL} from the process environment,
  not from .env on disk, so the MCP server starts credential-less otherwise.
- Then STOP and wait for me. Do not continue to Phase 3 without credentials.

PHASE 3 - MCP servers
Re-run `npm run smoke` now that credentials are exported. It must report 25
tools (7 documentation plus 18 instance). If it still reports 7, the environment
did not reach the server process: tell me, and do not proceed.

Then confirm both servers from .mcp.json are connected. Two servers, one
package, both running the pinned n8n-mcp via scripts/mcp-server.mjs:
- n8n-docs: node schemas, validation, templates. No instance credentials.
- n8n: workflow CRUD and executions against N8N_API_URL. Touches a real
  instance.
Verify docs mode by calling tools_documentation, then search_nodes for
"webhook", then get_node on the Webhook node. Verify managed mode with
n8n_health_check and n8n_list_workflows.
If a server is missing, tell me how to enable it for the editor I am actually
using, and show me what you see:
- Claude Code: approve the project .mcp.json when prompted; check /mcp
- VS Code + Copilot: MCP: List Servers, and be in Agent mode, not Ask
- Cursor: Settings > MCP
- Windsurf / Codex: MCP config is global and needs an absolute path to
  scripts/mcp-server.mjs (see docs/11-EDITORS.md)
If only n8n-docs works, say so plainly rather than proceeding as if both do.

PHASE 4 - Instance reality check
Run ./scripts/doctor.sh and show me the output. Then tell me, explicitly:
- which URL the managed server is pointed at
- whether the public API is enabled and the key is accepted
- the n8n version, and whether the pinned n8n-mcp@2.73.0 is a good match for it
  (call tools_documentation to see which n8n version the server is tested
  against, and flag a large gap: it means schemas may be stale and the pin
  should be bumped)
- whether workflows/ has any exported workflows yet
If the instance already has workflows, run ./scripts/export-all.sh and tell me
to commit the result before we change anything. That snapshot is the only
rollback point, and it is only valid while drift-check is clean.

PHASE 5 - Prove the loop end to end
Only against the dev instance from Phase 4. Confirm with me first that the
target is disposable.
Build the smallest possible real workflow, in this order, and show me the
result of each step:
  1. search_templates for something close, to demonstrate templates-first.
  2. get_node for each node you use, before setting any parameter.
  3. Construct a two-node workflow: a Manual Trigger into a Set node that
     outputs one static field. Nothing that reaches the network.
  4. validate_workflow on the JSON. Fix anything it reports.
  5. n8n_create_workflow, named exactly "zz-harness-probe-DELETE-ME".
  6. n8n_get_workflow and read back the connections object. Confirm out loud
     that the trigger is actually wired to the Set node. Validation passing is
     not proof of correct wiring.
  7. Execute it and read the execution data back. A 200 is not proof; the
     execution output is.
  8. Delete it, and confirm the deletion by listing workflows.
If any step fails, stop there and show me the error. A half-working loop that
you report as working is worse than a clean failure.

PHASE 6 - Report
Give me a short status table: prerequisites, n8n-mcp install and version, skills,
hooks (Claude Code only), docs MCP, managed MCP, instance reachability,
end-to-end loop. Mark each pass or fail. Name which editor you are running in,
and if it is not Claude Code, note that the skills do not auto-load and I should
name the SKILL.md file in prompts. Then list,
in priority order, anything I still need to do myself, and name the doc under
docs/ that covers each one. Do not pad the report. If everything passed, say so
in one line.
```

---

## What the prompt deliberately does not do

- **It does not touch production.** It refuses a prod-looking URL without
  confirmation, and the only workflow it creates is named for deletion.
- **It does not read your key.** Credential values are referred to by name.
- **It stops when it is blocked** rather than proceeding on a guess, because a
  setup reported as working when it is not costs more than a clear failure.
- **It does not build your real workflows.** Start a new session for that, so
  setup output is not competing for context with the build.
- **It does not assume Claude Code.** Outside Claude Code the skills do not load
  by themselves, so the report says so rather than letting you assume otherwise.
