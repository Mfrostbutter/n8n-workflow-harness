@AGENTS.md

## Claude Code only

- Skills load from `.claude/skills/`, which `npm run gen:agents` links from
  `.agents/skills/` (`--copy` on Windows). Twenty-four skills; the router is
  `using-n8n-mcp-skills`.
- Hooks and permissions live in `.claude/settings.json`: the session contract
  is injected at start, instance-mutating `n8n_*` calls get a reminder, and
  `scripts/guard-pre-tool.mjs` denies deletes and asks before production
  writes. Personal overrides go in `.claude/settings.local.json` (gitignored).
- `/mcp` lists the three servers and their tool counts.
