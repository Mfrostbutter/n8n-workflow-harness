# Troubleshooting

Ordered by how often each one actually bites.

## The n8n-mcp servers fail to start

Almost always: `npm ci` was never run, so the pinned n8n-mcp is not installed.

```bash
npm ci
npm run smoke
```

`scripts/mcp-server.mjs` prints the path it looked in, so run it directly to see
the message Claude Code may be swallowing:

```bash
node scripts/mcp-server.mjs      # prints an install hint and exits 1 if missing
```

Registry blocked? See [10-MAINTENANCE.md](10-MAINTENANCE.md) for the `vendor/`
offline path.

## `npm run smoke` reports 7 tools when you expected 25

The server started but never saw the credentials. 7 tools is docs mode. Export
the environment before launching:

```bash
set -a; . ./.env; set +a
npm run smoke                    # now expect 25
```

Same root cause as the next entry.

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

- Check they are present: `ls .agents/skills` should show 25, `ls .claude/skills`
  the same (links; `npm run gen:agents` recreates them), and
  `./scripts/verify-setup.sh` confirms each has a `SKILL.md`.
- Windows: if `.claude\skills\n8n-agents` is a 31-byte text file instead of a
  directory, git checked the symlinks out as text (`core.symlinks=false`, the
  default) and Claude Code sees no skills at all. `setup.ps1` runs
  `node scripts\gen-agent-configs.mjs --copy`, which replaces the stubs with
  copies and marks them `skip-worktree` so they never show up in `git status`.
  Run it again after a pull that changes a skill. See
  [11-EDITORS.md](11-EDITORS.md#windows).
- Claude Code must be running **in this directory**. Project skills do not load
  from elsewhere. Alternatively `./setup.sh --global-skills`.
- Ask explicitly: "Load `using-n8n-mcp-skills` and tell me which skill owns
  this." Description matching is not guaranteed to fire.
- If the `SessionStart` hook is not injecting the contract, see below.

## Hooks are not firing

Hooks fail open on purpose, so a broken hook is silent. Test them directly:

```bash
echo '{}' | node .claude/hooks/session-start.mjs
echo '{"tool_name":"mcp__n8n__n8n_create_workflow","tool_input":{}}' | node .claude/hooks/pre-n8n-write.mjs
```

Each should print JSON and exit 0 on every platform; the hooks are Node, not
bash. Nothing printed means Node is missing or a path is wrong.

If they work standalone but not in session:

- `.claude/settings.json` must be valid JSON. **A malformed settings file
  silently disables every setting in it**, permissions included. Check with
  `node -e 'JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"))'`.
- The hook commands are repo-relative (`node .claude/hooks/session-start.mjs`)
  and run with the project as the working directory. Do not reintroduce
  `$CLAUDE_PROJECT_DIR`: only Claude Code sets it, and VS Code loads this file
  too (see [11-EDITORS.md](11-EDITORS.md#vs-code-with-github-copilot)).
- Claude Code only watches directories that had a settings file at session
  start. Open `/hooks` once to reload, or restart.

## `n8n_*` tools answer `SSRF protection: Private IP addresses not allowed`

The managed `n8n` server (n8n-mcp) resolves `N8N_API_URL` before every call
and, in its default `strict` mode, refuses loopback and RFC1918 addresses. An
on-prem dev instance is exactly that, and the error arrives as a normal tool
result, so the agent sees "failed" with no cause while `doctor` and
`drift-check` (which do not run that check) say the instance is fine.

`scripts/mcp-server.mjs` sets `WEBHOOK_SECURITY_MODE=permissive` unless the
environment already has a value, and `.mcp.json` passes the variable through.
If you see this error anyway, something set the variable to `strict` or
`moderate` (`moderate` still blocks private IPs), or the server is not being
launched through `scripts/mcp-server.mjs`. `doctor` prints the mode in force
and fails when it would block the configured URL.

## Behind a corporate proxy or TLS inspection

Two different HTTP stacks are in play. The MCP server uses axios, which follows
`HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` on its own. The toolkit
(`doctor`, `drift-check`, `export-all`, ...) uses Node's built-in `fetch`,
which ignores those variables until `NODE_USE_ENV_PROXY=1` is set
(Node 22.21+ / 24.5+). So one half can work while the other reports
"unreachable".

TLS inspection replaces the instance certificate with one signed by the
corporate CA. Node does not trust it, the request fails with
`DEPTH_ZERO_SELF_SIGNED_CERT` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, and both
stacks are affected.

```bash
export NODE_USE_ENV_PROXY=1                    # fetch honours HTTPS_PROXY / NO_PROXY
export NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem  # the CA bundle, PEM, from your IT team
```

PowerShell: `$env:NODE_USE_ENV_PROXY='1'; $env:NODE_EXTRA_CA_CERTS='C:\path\corp-ca.pem'`.

Never `NODE_TLS_REJECT_UNAUTHORIZED=0`. It disables certificate checks for the
whole process, Node prints a warning, and `doctor` fails on it.

`doctor` reports which proxy and CA variables are set (names and lengths
only), notes a proxy variable that `fetch` is ignoring, and on an unreachable
instance prints the underlying code (`ECONNREFUSED`, `ENOTFOUND`,
`DEPTH_ZERO_SELF_SIGNED_CERT`) with the matching fix instead of a bare
`fetch failed`.

## `npm ci` fails on `isolated-vm` (`node-gyp`, "could not find a version of Visual Studio")

`isolated-vm`, a native module pulled in through `@n8n/expression-runtime`, ships prebuilt
binaries for Node 24 (`darwin-arm64`, `linux-x64`, `linux-arm64`,
`win32-x64`). On Node 20 or 22 npm compiles it instead, which on Windows
needs Visual Studio Build Tools with the C++ workload and Python, and on
macOS or Linux a C++ toolchain. Install Node 24 and run `npm ci` again; the
install then takes seconds. CI runs the suite on Node 24 for the same reason.

## The agent ignored a rule in a skill

A skill is advice the model chose to read, or did not. Two deterministic
answers, both in the harness:

- The guard's skill gate refuses a workflow write that carries a Code, Code
  Tool or AI Agent node until the owning skill was loaded in the session
  (`Load the n8n-code-javascript skill first ...`). On Claude Code, Codex and
  Copilot that turns "should have read it" into "cannot write without it".
- A rule you need every time belongs in the lint, not only in the skill.
  `lint-workflow --require-code-comment` fails any Code node whose code does
  not open with a comment; add your own checks next to it. Promotion already
  runs the lint, so a convention written there holds regardless of which
  model or editor built the workflow.

Reported as issue #6 (Copilot on Windows wrote a Code node without the
comment header the team had added to `n8n-code-javascript`).

## VS Code with Copilot

Checked on VS Code 1.143 with Copilot Chat 0.71 (2026-10-25). Four things look
like harness failures and are not.

- **Every MCP server shows Error before you have sent a message.** The
  session runtime that starts servers does not exist yet; the detail reads
  "Cannot start an MCP server before the session runtime has been created.
  Send a message first." Send `hello`, then start or use the servers.
- **`Request session.mcp.listConfigured failed ... Invalid url`** on the
  first message. Copilot validates every `url` in `.mcp.json` as written, no
  variable expansion, and one bad entry disables every server. That is why
  `n8n-official` lives in `.mcp.official.json` and is added by hand
  ([03-MCP-SERVERS.md](03-MCP-SERVERS.md#registering-n8n-official)). If you
  see this, something put a `${...}` URL back into `.mcp.json`.
- **"Not supported by Copilot: Input and command variables are not supported
  by the Copilot harness."** `${input:...}` prompts are refused, which is why
  the harness no longer ships a `.vscode/mcp.json`. VS Code reads `.mcp.json`
  and expands `${VAR}` from its environment, so launch it from a shell that
  has `.env` exported (the Windows snippet in [11-EDITORS.md](11-EDITORS.md#windows)
  ends with `code .`). A clone from before 2026-10-25 may still carry a
  `.vscode/mcp.json`; delete it, or VS Code loads every server twice.
- **"The model only supports 128 tools, N tools were not provided."** The
  same servers are loaded twice (an old `.vscode/mcp.json` next to
  `.mcp.json`), or too many servers are on. Disable the duplicates under
  Extensions → MCP Servers (gear → Disable (Workspace)), or trim the tool
  picker in the chat input.

If a delete went through in Copilot, check which guard copy ran: Copilot
names MCP tools `<server>-<tool>` (`n8n-n8n_delete_workflow`) and the guard
before 2026-10-25 only matched `__` separators. `npm test` covers the current
shapes; `tests/guard.test.mjs` is the reference.

## Windows

Git for Windows, Node 24, PowerShell: `.\setup.ps1`. The `.mjs` tools and the
hooks run natively; only the `.sh` wrappers need Git Bash. The two things that
differ from macOS and Linux are the skill symlinks (above) and the proxy
variables (above). The full list is in [11-EDITORS.md](11-EDITORS.md#windows).

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

## MCP server still will not start

- Confirm it is installed and matches the pin: `./scripts/verify-setup.sh`.
- Run the launcher directly: `node scripts/mcp-server.mjs`. It prints the path
  it searched.
- Node must be 20+. `node --version`.
- A partial install (interrupted `npm ci`) can leave the package without its
  node database. `verify-setup` checks for `data/nodes.db` specifically;
  reinstall with `npm ci` if it is missing.
- `/mcp` inside Claude Code shows connection state and errors.
- `claude --debug` prints MCP startup and hook execution logs.
- Last resort, if you cannot run `npm ci` at all:
  `cp .mcp.npx.json .mcp.json` to fetch from the registry instead.

## An instance call returns NOT_FOUND for something that exists

On an account reaching several instances, `NOT_FOUND` usually means the wrong
instance, not a deletion. Load `n8n-multi-instance`, confirm the current target,
and re-check. Verify the target **before** any credential write.

## Getting more detail

```bash
npm run smoke                   # the engine: does the server answer at all
claude --debug                  # MCP startup, hook execution
./scripts/doctor.sh             # environment, reachability, repo state
./scripts/verify-setup.sh       # config, n8n-mcp, skills, hooks, toolkit
./scripts/health-check.sh 24    # instance-wide failure count
```

`n8n_health_check` reports the n8n version. Several managed tools are
version-gated, so a 404 on one tool may be a version issue, not a fault.
