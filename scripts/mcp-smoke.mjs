// Starts the pinned n8n-mcp server and completes a real MCP handshake, then
// reports the tools it exposes. Proves the engine works before you rely on it.
//
// Usage: node scripts/mcp-smoke.mjs
//
// Exit 0 pass, 1 the server started but answered wrong, 2 it could not start.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(HERE, 'mcp-server.mjs');
const TIMEOUT_MS = 60000;
const hasCreds = Boolean(process.env.N8N_API_URL);

const child = spawn(process.execPath, [LAUNCHER], {
  env: {
    ...process.env,
    MCP_MODE: 'stdio',
    LOG_LEVEL: 'error',
    DISABLE_CONSOLE_OUTPUT: 'true',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });
child.on('error', (e) => finish(2, `cannot spawn the server: ${e.message}`));
child.on('exit', (code) => {
  if (!settled) finish(2, `server exited early (code ${code})\n${stderr.trim()}`);
});

const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
let settled = false;
const timer = setTimeout(
  () => finish(2, `no response within ${TIMEOUT_MS / 1000}s\n${stderr.trim()}`),
  TIMEOUT_MS,
);

function finish(code, msg) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  if (msg) console[code === 0 ? 'log' : 'error'](msg);
  child.kill();
  process.exit(code);
}

let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }

    if (m.id === 1) {
      const info = m.result?.serverInfo;
      if (!info) return finish(1, 'initialize returned no serverInfo');
      console.log(`server:   ${info.name} ${info.version}`);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    }

    if (m.id === 2) {
      const names = (m.result?.tools ?? []).map((t) => t.name);
      const docs = names.filter((n) => !n.startsWith('n8n_'));
      const inst = names.filter((n) => n.startsWith('n8n_'));
      console.log(`tools:    ${names.length} (${docs.length} docs, ${inst.length} instance)`);

      // The tools the build loop actually depends on.
      const required = ['search_nodes', 'get_node', 'validate_node', 'validate_workflow',
                        'search_templates', 'get_template', 'tools_documentation'];
      const missing = required.filter((r) => !names.includes(r));
      if (missing.length) return finish(1, `missing required docs tools: ${missing.join(', ')}`);
      console.log('docs:     all 7 schema/validation/template tools present');

      if (hasCreds) {
        if (!inst.length) {
          return finish(1,
            'N8N_API_URL is set but no n8n_* tools appeared. The server did not\n' +
            'see the credentials: launch Claude Code with the environment exported.');
        }
        console.log(`instance: ${inst.length} n8n_* tools present (target ${process.env.N8N_API_URL})`);
      } else {
        console.log('instance: none, as expected with no N8N_API_URL (docs mode)');
      }

      console.log('\nRESULT: ok');
      return finish(0);
    }
  }
});

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'harness-smoke', version: '1.0.0' },
  },
});
