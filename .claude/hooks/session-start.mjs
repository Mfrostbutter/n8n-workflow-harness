// SessionStart: inject the harness contract so the rules are loaded from turn
// one instead of depending on a skill description matching the prompt.
// Fails open: any error means no context, never a broken session.
// Registered as `node .claude/hooks/session-start.mjs` (cwd is the project).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const ctx = join(dirname(fileURLToPath(import.meta.url)), 'session-context.md');
  const target = process.env.N8N_API_URL || 'not set (docs mode only: the managed n8n server cannot reach an instance)';
  const text = readFileSync(ctx, 'utf8').split('{{TARGET}}').join(target);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
  }));
} catch { /* fail open */ }
