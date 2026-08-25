# Troubleshooting

Ordered by how often each one actually bites.

## `n8n_*` tools fail on auth, but docs tools work

**Cause:** the environment did not reach the MCP process. `.mcp.json` expands
`${N8N_API_URL}` from Claude Code's process environment, not from `.env`.

```bash
# Wrong: .env exists but was never exported
claude

# Right
set -a; . ./.env; set +a; claude
```

Confirm from outside: `echo "$N8N_API_URL"` in the shell you launched from. If it
is empty, that is the bug. Restart Claude Code after exporting; the server's
environment is fixed at spawn.

## A workflow "succeeded" and did nothing

Load `n8n-gotchas`. Then, in order:

1. **Draft versus published.** `n8n_get_workflow` with `mode: 'full'` is the
   draft; `mode: 'active'` is the graph that runs. Compare them.
2. **Edited after activation.** Activation caches the trigger registration. An
   edit afterwards may not reach the running trigger. Deactivate, then
   reactivate.
3. **Error outputs unwired.** A configured-but-unconnected error output makes
   failures vanish silently. Read `connections`.
4. **The last node returns nothing.** A Code node with no `return`, or a filter
   that matched nothing, is a successful execution with no output.
5. **Webhook body nesting.** The payload is at `$json.body`, not `$json`. An
   expression reading the wrong level yields undefined, not an error.

Read the actual execution (`n8n_executions({action: "get", id})`) before
theorising.

## Validation passes, the workflow is wrong

Expected. `validate_workflow` proves the JSON is well-formed. It does not catch
a dropped wire, a Merge input off by one, an unwired error output, or a
connection to the wrong output index of an IF/Switch.

Read the `connections` object after every write. This is step 5 of
[05-BUILD-LOOP.md](05-BUILD-LOOP.md) and the most-skipped step in the loop.

## Claude is not using the skills

Symptoms: invented `typeVersion`s, no `get_node` call before configuring, an
expression reading `$json` for webhook data.

- Check they are present: `ls .claude/skills` should show 20, and
  `./scripts/verify-setup.sh` confirms each has a `SKILL.md`.
- Claude Code must be running **in this directory**. Project skills do not load
  from elsewhere. Alternatively `./setup.sh --global-skills`.
- Ask explicitly: "Load `using-n8n-mcp-skills` and tell me which skill owns
  this." Description matching is not guaranteed to fire.
- If the `SessionStart` hook is not injecting the contract, see below.

## Hooks are not firing

Hooks fail open on purpose, so a broken hook is silent. Test them directly:

```bash
echo '{}' | ./.claude/hooks/session-start.sh
echo '{"tool_name":"mcp__n8n__n8n_create_workflow","tool_input":{}}' | ./.claude/hooks/pre-n8n-write.sh
```

Each should print JSON and exit 0. Nothing printed means Node is missing or a
path is wrong.

If they work standalone but not in session:

- `.claude/settings.json` must be valid JSON. **A malformed settings file
  silently disables every setting in it**, permissions included. Check with
  `node -e 'JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"))'`.
- Not executable: `chmod +x .claude/hooks/*.sh`.
- Claude Code only watches directories that had a settings file at session
  start. Open `/hooks` once to reload, or restart.

## `Settings → n8n API` is missing

The public API is disabled on that instance
(`N8N_PUBLIC_API_DISABLED=true`, or disabled by the operator). Without it, the
managed server and the entire toolkit cannot function. There is no workaround
from this side; it has to be enabled on the instance.

## `drift-check` reports drift you did not cause

Usually real: someone edited on the canvas, or a promotion happened outside the
repo. Before assuming a false positive, check `n8n_workflow_versions` for who
changed what.

It deliberately ignores canvas positions, ids, timestamps, pinned data, and
sticky notes, so a moved node is never drift. If it is flagging a parameter, a
parameter changed.

Resolve by deciding which side is authoritative, then either re-export
(`export-all` + commit) or redeploy from the repo. Do not just re-export to
silence it: that adopts an unreviewed change as your baseline.

## `export-all`: "no workflows returned"

Either the instance genuinely has none, the URL is wrong, the key is rejected,
or the public API is off. `./scripts/doctor.sh` distinguishes these.

## `node --test tests/` fails with MODULE_NOT_FOUND

Pass explicit files:

```bash
node --test tests/tools.test.mjs tests/instance.test.mjs
```

Current Node resolves a bare directory as a module.

## MCP server will not start

- `npx` needs the npm registry on first run. Blocked network:
  [10-MAINTENANCE.md](10-MAINTENANCE.md).
- Node must be 20+. `node --version`.
- `/mcp` inside Claude Code shows connection state and errors.
- `claude --debug` prints MCP startup and hook execution logs.

## An instance call returns NOT_FOUND for something that exists

On an account reaching several instances, `NOT_FOUND` usually means the wrong
instance, not a deletion. Load `n8n-multi-instance`, confirm the current target,
and re-check. Verify the target **before** any credential write.

## Getting more detail

```bash
claude --debug                  # MCP startup, hook execution
./scripts/doctor.sh             # environment, reachability, repo state
./scripts/verify-setup.sh       # offline: config, skills, hooks, toolkit
./scripts/health-check.sh 24    # instance-wide failure count
```

`n8n_health_check` reports the n8n version. Several managed tools are
version-gated, so a 404 on one tool may be a version issue, not a fault.
