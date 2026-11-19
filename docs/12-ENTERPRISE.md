# Enterprise delivery

What changes when this harness runs inside a regulated organisation with
several environments, a security team, and more than one person on the repo.

## Environments and the promotion path

`workflows/<env>/` holds one directory per environment. Build sessions point at
dev only. Nothing reaches staging or prod from an agent session; it goes through
one of three paths, in order of preference:

| Path | Needs | Skill |
|---|---|---|
| n8n Promotions (`npx n8n-cli promotion-environment ...`) | n8n ≥ 2.40, licensed, a Git provider registered on the instance | `n8n-promotion-pipeline` |
| Environments / source control (`npx n8n-cli source-control pull` on the target) | Enterprise license, one branch per environment | `n8n-enterprise-delivery` |
| Export, lint, deploy (`export-all`, `lint-workflow`, `./scripts/deploy.sh <file> prod --confirm`) | Public API on both instances | `n8n-promotion-pipeline` |

Every path has the same gate: `lint-workflow` clean on the files being promoted,
a committed export of the target taken while `drift-check` was clean, and a
read-back on the target afterwards. The guard asks before any of the three
commands that write to a non-dev environment.

`lint-workflow` prints the credentials and variables a workflow references.
That list is the handover to whoever owns the target instance: every name must
exist there before the promotion, with the same credential type.

### Community edition

A community edition instance (no license key) has none of the first two paths:
no promotions module, no source-control environments, and the public API
answers 403 on `/projects` (team projects are licensed; `n8n-cli project list`
fails with a license error) and 403 or 404 on every folder route
(`feat:folders`). What remains is the third path, which the harness ships:

- One `workflows/<env>/` directory per instance, exported with `export-all`.
- `./scripts/deploy.sh <file> dev` for the build instance;
  `./scripts/deploy.sh <file> prod --confirm` for a second instance, with its
  own `N8N_API_URL_PROD` pair in `.env`. Validate and lint run first; the
  workflow is created or updated by name, tagged, read back and compared with
  the file. Nothing is activated: publish after a run on the target.
- Placement is tags only. `organize place` and `deploy` learn once per instance
  that folders are unavailable and say so once; set
  `N8N_PLACEMENT_FOLDERS=skip` in that instance's `.env` to accept tags-only
  placement there. Without it they stop and name the decision, so a licensed
  target never silently loses its folder.

The `project` key stays `personal` on community edition. Credentials and
variables still travel by name: the `lint-workflow` manifest is the list to
recreate on the second instance before the first deploy.

## Source control

Workflow JSON is the source of truth, so the repository is the audit trail:

- `.gitattributes` and the textconv make `git diff` on `workflows/` show node
  and connection changes, not canvas moves.
- `.github/workflows/n8n-checks.yml` and `.gitlab-ci.yml` run validate and lint
  on every push and drift on a schedule. Keep the one that matches your git
  host. Drift needs `N8N_API_URL` and `N8N_API_KEY` as CI secrets for a
  read-only key.
- Branch protection on `main` with the checks required turns "the repo is the
  source of truth" from a claim into a control.

## Managed settings for Claude Code

`docs/managed-settings.example.json` is a starting point for the
organisation-wide policy file (`/Library/Application Support/ClaudeCode/managed-settings.json`
on macOS, `/etc/claude-code/managed-settings.json` on Linux, the
`ProgramData\ClaudeCode` path on Windows). It denies the delete tools at the
policy level, where a user cannot override them, and limits the MCP servers a
project may enable to the three this harness declares. Project settings in
`.claude/settings.json` sit under it.

For Codex, Cursor and Copilot the equivalent is the hook configs in the repo
plus whatever central MCP allow-listing the vendor offers; the guard is the
common layer.

## Secrets

- `.env` is gitignored and `verify-setup` fails if it is tracked.
- All MCP configs expand variables from the process environment. Load them from
  a secret manager into the shell (`infisical run --`, `op run --`, `doppler run --`)
  rather than from a file on disk where you can.
- `N8N_MCP_ACCESS_TOKEN` is per user, scoped to the project the instance
  administrator grants. Treat it like an API key.
- Credentials on each instance come from the secret manager by name:
  `deploy/secret-map.<env>.json` per environment, `./scripts/secret-map.sh
  sync` run by whoever holds that environment's key, `verify` before a
  hand-over. Where the instance is licensed, prefer external secrets
  (`$secrets`) so rotation never touches n8n.
- A key or token that lands in chat, a log, or a commit is compromised. Rotate
  it the same day.

## Telemetry and egress

`n8n-mcp` sends anonymous telemetry unless `N8N_MCP_TELEMETRY_DISABLED=true`,
which every config in this repo sets. The node database ships inside the
package, so after `npm ci` the docs server makes no network calls. For a network
that blocks npm, [10-MAINTENANCE.md](10-MAINTENANCE.md) has the vendored-cache
and internal-registry paths. The instance servers reach only the URL in `.env`.

## Audit

- `npx n8n-cli audit` runs the instance security audit (credentials unused,
  nodes risky, instance settings).
- `n8n_audit_instance` on the `n8n` MCP server does the same from a session.
- `./scripts/node-inventory.sh workflows/prod` lists every node type and
  typeVersion in use, which is the input to an upgrade plan (`n8n-upgrade-plan`)
  and to an approved-node review.
- `./scripts/organize.sh audit <env>` lists every project with its workflow,
  folder, credential and data table counts, the untagged workflows, the ones
  still in a personal project, and every credential or data table a workflow
  binds that its project cannot reach. `RESULT: ok` is the bar before a
  hand-over.

## Hand-over checklist

- [ ] `./scripts/verify-setup.sh` clean on a fresh clone by someone who did not build it
- [ ] `npm run smoke` shows 7 tools bare and 28 with credentials
- [ ] CI green on `main`, drift job scheduled, branch protection on
- [ ] Promotion path chosen, documented in `AGENTS.md`, and exercised once end to end
- [ ] Credentials and variables on staging and prod match the `lint-workflow` manifest
- [ ] `./scripts/organize.sh audit` prints `RESULT: ok` on every environment
- [ ] `./scripts/secret-map.sh verify` prints `RESULT: ok` on every environment, and the maps are committed
- [ ] Managed settings deployed, or the hook configs confirmed on every editor in use
- [ ] `ATTRIBUTION.md` and `THIRD_PARTY_LICENSES.md` kept in the hand-over copy
