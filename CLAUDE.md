@AGENTS.md

## Claude Code only

- Skills load from `.claude/skills/`, which `npm run gen:agents` generates from
  `.agents/skills/` (links; copies on Windows, hidden from git). Twenty-five
  skills; the router is `using-n8n-mcp-skills`.
- Hooks and permissions live in `.claude/settings.json`: the session contract
  is injected at start, instance-mutating `n8n_*` calls get a reminder, and
  `scripts/guard-pre-tool.mjs` denies deletes and asks before production
  writes. The hooks are Node scripts under `.claude/hooks/`, repo-relative,
  no bash. Personal overrides go in `.claude/settings.local.json` (gitignored).
- `/mcp` lists the three servers and their tool counts.
