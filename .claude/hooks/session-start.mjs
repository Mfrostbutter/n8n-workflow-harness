// SessionStart: inject the harness contract so the rules are loaded from turn
// one instead of depending on a skill description matching the prompt.
// Fails open: any error means no context, never a broken session.
// Registered as `node .claude/hooks/session-start.mjs` (cwd is the project) in
// .claude/settings.json (SessionStart) and .github/hooks/n8n-guard.json
// (sessionStart): Copilot takes a top-level additionalContext, Claude Code the
// hookSpecificOutput envelope. The payload shape picks the answer.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const ctx = join(dirname(fileURLToPath(import.meta.url)), 'session-context.md');
  const target = process.env.N8N_API_URL || 'not set (docs mode only: the managed n8n server cannot reach an instance)';
  const text = readFileSync(ctx, 'utf8').split('{{TARGET}}').join(target);
  let copilot = false;
  try { const p = JSON.parse(readFileSync(0, 'utf8') || '{}'); copilot = p.sessionId !== undefined && p.session_id === undefined; } catch { /* Claude shape */ }
  process.stdout.write(JSON.stringify(copilot
    ? { additionalContext: text }
    : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
} catch { /* fail open */ }
