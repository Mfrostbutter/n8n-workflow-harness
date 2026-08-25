# Changelog

## 2026-08-25

Initial release.

- 20 n8n skills, project-scoped in `.claude/skills/`: 15 vendored from
  `czlonkowski/n8n-skills`, 5 original to this harness.
- Both MCP servers wired in `.mcp.json`, pinned to `n8n-mcp@2.73.0`:
  `n8n-docs` (no credentials) and `n8n` (managed, instance access).
- `CLAUDE.md` operating contract, loaded automatically.
- `AI_SETUP_PROMPT.md`: paste-in prompt that sets up and verifies the harness
  end to end, including a disposable probe workflow.
- Hook layer replacing the upstream plugin's enforcement: `SessionStart`
  contract injection and `PreToolUse` reminders on instance-mutating tools.
  Both fail open.
- Toolkit (`doctor`, `health-check`, `drift-check`, `export-all`, `validate`),
  Node built-ins only, plus `verify-setup` (offline preflight) and
  `refresh-skills` (re-vendor from upstream).
- 44 tests, including integration tests against a fake n8n API server.
- Ten documentation files under `docs/`.
- `setup.sh` and `setup.ps1` for a fresh clone.

Fixed while assembling, in the inherited toolkit: `export-all` wrote a `staging`
export into `workflows/dev/` while logging `workflows/staging/`, so a staging
export followed by `drift-check staging` failed on a missing directory.
