// Integration tests for the tools that talk to an n8n instance. A fake API
// server stands in, so these run offline and touch no real instance.
// Run: node --test tests/instance.test.mjs
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOOLS = join(ROOT, 'scripts');

// --- the workflow the fake instance serves
const liveWorkflow = () => ({
  id: 'wf1',
  name: 'Order Intake',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  nodes: [
    { id: 'n1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: { path: 'orders' }, webhookId: 'abc' },
    { id: 'n2', name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [200, 0], parameters: { mode: 'manual' } },
  ],
  connections: { Webhook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
  settings: { executionOrder: 'v1' },
  tags: [],
});

let server, base, kit, state;

before(async () => {
  state = { workflows: [liveWorkflow()], failures: 0, authOk: true };

  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!state.authOk || req.headers['x-n8n-api-key'] !== 'test-key') return send(401, { message: 'unauthorized' });

    const m = url.pathname.match(/^\/api\/v1\/workflows\/(.+)$/);
    if (m) {
      const wf = state.workflows.find((w) => w.id === m[1]);
      return wf ? send(200, wf) : send(404, { message: 'not found' });
    }
    if (url.pathname === '/api/v1/workflows') {
      return send(200, { data: state.workflows.map(({ id, name, active }) => ({ id, name, active })), nextCursor: null });
    }
    if (url.pathname === '/api/v1/executions') {
      const data = Array.from({ length: state.failures }, (_, i) => ({
        id: `e${i}`, status: 'error', startedAt: new Date().toISOString(),
        workflowId: 'wf1', workflowData: { name: 'Order Intake' },
      }));
      return send(200, { data, nextCursor: null });
    }
    if (url.pathname.startsWith('/api/v1/credentials/schema/')) return send(200, {});
    send(404, { message: 'not found' });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  // fetch keeps sockets alive, so close connections too or the runner hangs.
  server?.closeAllConnections?.();
  server?.close();
  rmSync(kit, { recursive: true, force: true });
});

beforeEach(() => {
  // Fresh working directory with the toolkit in scripts/, per test.
  if (kit) rmSync(kit, { recursive: true, force: true });
  kit = mkdtempSync(join(tmpdir(), 'kit-'));
  mkdirSync(join(kit, 'scripts'), { recursive: true });
  mkdirSync(join(kit, 'workflows', 'dev'), { recursive: true });
  for (const f of ['lib.mjs', 'health-check.mjs', 'export-all.mjs', 'drift-check.mjs', 'doctor.mjs', 'validate.mjs']) {
    writeFileSync(join(kit, 'scripts', f), readFileSync(join(TOOLS, f)));
  }
  state.workflows = [liveWorkflow()];
  state.failures = 0;
  state.authOk = true;
});

/**
 * Runs a tool inside the temp kit against the fake instance.
 * Async on purpose: the fake server runs in THIS process, so a synchronous
 * spawn would block the event loop and the server could never answer.
 */
async function run(tool, args = []) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [join(kit, 'scripts', tool), ...args], {
      encoding: 'utf8',
      env: { ...process.env, N8N_API_URL: base, N8N_API_KEY: 'test-key' },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.code, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

const exported = () => readdirSync(join(kit, 'workflows', 'dev')).filter((f) => f.endsWith('.json'));
const editExport = (fn) => {
  const f = join(kit, 'workflows', 'dev', exported()[0]);
  const wf = JSON.parse(readFileSync(f, 'utf8'));
  fn(wf);
  writeFileSync(f, JSON.stringify(wf, null, 2));
};

// ---------------------------------------------------------------- export-all

test('export-all writes one file per workflow', async () => {
  const r = await run('export-all.mjs', ['dev']);
  assert.equal(r.code, 0);
  assert.deepEqual(exported(), ['order-intake.json']);
  assert.match(r.out, /exported 1 workflows/);
});

test('export-all output round-trips through validate', async () => {
  await run('export-all.mjs', ['dev']);
  const r = await run('validate.mjs', [join(kit, 'workflows', 'dev', 'order-intake.json')]);
  assert.equal(r.code, 0, r.out);
});

// ---------------------------------------------------------------- drift-check

test('drift-check reports in sync straight after an export', async () => {
  await run('export-all.mjs', ['dev']);
  const r = await run('drift-check.mjs', ['dev']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /RESULT: in sync/);
});

test('drift-check ignores a node moved on the canvas', async () => {
  await run('export-all.mjs', ['dev']);
  state.workflows[0].nodes[0].position = [999, 999];
  const r = await run('drift-check.mjs', ['dev']);
  assert.equal(r.code, 0, 'moving a node is not a behavior change');
});

test('drift-check DETECTS a parameter changed on the instance', async () => {
  await run('export-all.mjs', ['dev']);
  state.workflows[0].nodes[0].parameters.path = 'orders-v2';
  const r = await run('drift-check.mjs', ['dev']);
  assert.equal(r.code, 1);
  assert.match(r.out, /RESULT: DRIFT/);
  assert.match(r.out, /parameters differ: Webhook/);
});

test('drift-check DETECTS a workflow that exists only on the instance', async () => {
  await run('export-all.mjs', ['dev']);
  state.workflows.push({ ...liveWorkflow(), id: 'wf2', name: 'Undocumented' });
  const r = await run('drift-check.mjs', ['dev']);
  assert.equal(r.code, 1);
  assert.match(r.out, /ONLY ON INSTANCE/);
  assert.match(r.out, /Undocumented/);
});

test('drift-check DETECTS a workflow that exists only in the repo', async () => {
  await run('export-all.mjs', ['dev']);
  state.workflows = [];
  const r = await run('drift-check.mjs', ['dev']);
  assert.equal(r.code, 1);
  assert.match(r.out, /ONLY IN REPO/);
});

test('drift-check DETECTS an active-state mismatch', async () => {
  await run('export-all.mjs', ['dev']);
  state.workflows[0].active = false;
  const r = await run('drift-check.mjs', ['dev']);
  assert.equal(r.code, 1);
  assert.match(r.out, /ACTIVE STATE MISMATCH/);
  assert.match(r.out, /repo says active, instance says inactive/);
});

test('drift-check DETECTS a node added on the instance', async () => {
  await run('export-all.mjs', ['dev']);
  state.workflows[0].nodes.push({ id: 'n3', name: 'Extra', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [400, 0], parameters: {} });
  const r = await run('drift-check.mjs', ['dev']);
  assert.equal(r.code, 1);
  assert.match(r.out, /node only on instance: Extra/);
});

test('drift-check DETECTS a change made in the repo but never deployed', async () => {
  await run('export-all.mjs', ['dev']);
  editExport((wf) => { wf.nodes.find((n) => n.name === 'Set').parameters.mode = 'expression'; });
  const r = await run('drift-check.mjs', ['dev']);
  assert.equal(r.code, 1);
  assert.match(r.out, /parameters differ: Set/);
});

test('drift-check fails clearly when the repo has no export yet', async () => {
  const r = await run('drift-check.mjs', ['prod']);
  assert.equal(r.code, 2);
  assert.match(r.out, /no workflows\/prod\/ directory/);
});

// ---------------------------------------------------------------- health-check

test('health-check reports healthy with no failures', async () => {
  const r = await run('health-check.mjs');
  assert.equal(r.code, 0);
  assert.match(r.out, /reachable:\s+yes/);
  assert.match(r.out, /workflows:\s+1 total, 1 active/);
  assert.match(r.out, /RESULT: healthy/);
});

test('health-check surfaces recent failures by workflow', async () => {
  state.failures = 3;
  const r = await run('health-check.mjs');
  assert.match(r.out, /failures:\s+3/);
  assert.match(r.out, /3x\s+Order Intake/);
  assert.match(r.out, /RESULT: 3 failures/);
});

test('health-check lists inactive workflows', async () => {
  state.workflows[0].active = false;
  const r = await run('health-check.mjs');
  assert.match(r.out, /inactive workflows/);
  assert.match(r.out, /Order Intake/);
});

test('health-check names the encryption key when auth fails', async () => {
  state.authOk = false;
  const r = await run('health-check.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /API key was rejected/);
  assert.match(r.out, /encryption key/, 'the most likely cause must be named');
});

// ---------------------------------------------------------------- doctor

test('doctor passes against a healthy instance', async () => {
  await run('export-all.mjs', ['dev']);
  execFileSync('git', ['init', '-q'], { cwd: kit });
  writeFileSync(join(kit, '.gitignore'), '.env\n');
  writeFileSync(join(kit, '.env'), `N8N_API_URL=${base}\nN8N_API_KEY=test-key\n`);
  const r = await run('doctor.mjs', ['dev']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /RESULT: ok/);
});

test('doctor reports a rejected key rather than crashing', async () => {
  writeFileSync(join(kit, '.env'), `N8N_API_URL=${base}\nN8N_API_KEY=test-key\n`);
  state.authOk = false;
  const r = await run('doctor.mjs', ['dev']);
  assert.equal(r.code, 1);
  assert.match(r.out, /API key rejected/);
});

test('doctor warns when the active target is production', async () => {
  writeFileSync(join(kit, '.env'),
    `N8N_API_URL=${base}\nN8N_API_KEY=test-key\nN8N_API_URL_PROD=${base}\n`);
  const r = await run('doctor.mjs', ['dev']);
  assert.match(r.out, /ACTIVE target is production/);
});
