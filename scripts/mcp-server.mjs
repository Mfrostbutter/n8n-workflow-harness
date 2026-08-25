// Launches the n8n-mcp server that this repo pins in package.json.
//
// Resolves the package relative to THIS file rather than the working
// directory, so the server starts the same way whichever client spawns it.
// Runs it in-process so stdio passes straight through to the MCP client.
//
// Usage (from .mcp.json): node scripts/mcp-server.mjs
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const REL = join('n8n-mcp', 'dist', 'mcp', 'stdio-wrapper.js');

function resolveEntry() {
  // Normal install: <repo>/node_modules/n8n-mcp/...
  const local = join(ROOT, 'node_modules', REL);
  if (existsSync(local)) return local;
  // Hoisted or workspace install: let Node's resolver find it.
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve('n8n-mcp/package.json');
    const hoisted = join(dirname(pkg), 'dist', 'mcp', 'stdio-wrapper.js');
    if (existsSync(hoisted)) return hoisted;
  } catch { /* not resolvable */ }
  return null;
}

const entry = resolveEntry();
if (!entry) {
  // stderr, never stdout: stdout is the MCP transport.
  process.stderr.write(
    [
      'n8n-mcp is not installed.',
      '',
      'This harness pins it in package.json. Install it:',
      '',
      '    npm ci        # or: npm install',
      '',
      `Looked in: ${join(ROOT, 'node_modules', REL)}`,
      'Offline or behind a proxy? See docs/10-MAINTENANCE.md.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

await import(pathToFileURL(entry).href);
