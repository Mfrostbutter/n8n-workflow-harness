// Contract tests for scripts/deploy.mjs against a fake public API: gates
// before any write, create when the name is new, update by name or id,
// placement, read-back verify, --confirm outside dev, --dry-run writes nothing.
// Run: node --test tests/deploy.test.mjs
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOOLS = join(ROOT, 'scripts');

const WF = () => ({
  name: 'Order intake',
  nodes: [
    { name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: { path: 'orders' } },
    { name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [208, 0], parameters: { mode: 'manual' } },
  ],
  connections: { Webhook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
  settings: { executionOrder: 'v1' },
  tags: ['acme'],
  project: 'personal',
  folder: 'Order intake',
});

let server, base, kit, state, calls;

before(async () => {
  server = createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (code, out) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(out === undefined ? '' : JSON.stringify(out)); };
      const list = (data) => send(200, { data, nextCursor: null });
      calls.push(`${req.method} ${p}`);
      if (req.headers['x-n8n-api-key'] !== 'test-key') return send(401, { message: 'unauthorized' });
      let m;
      if (p === '/projects') return list([{ id: 'projMe', name: 'Me', type: 'personal' }]);
      if ((m = p.match(/^\/projects\/([^/]+)\/folders$/))) {
        if (req.method === 'POST') { const f = { id: `f${state.folders.length + 1}`, name: body.name, parentFolderId: body.parentFolderId ?? null }; state.folders.push(f); return send(201, f); }
        return send(200, { count: state.folders.length, data: state.folders });
      }
      if ((m = p.match(/^\/projects\/[^/]+\/folders\/([^/]+)$/))) return send(200, { id: m[1], totalWorkflows: state.workflows.filter((w) => w.parentFolderId === m[1]).length });
      if (p === '/credentials') return list([]);
      if (p === '/tags' && req.method === 'GET') return list(state.tags);
      if (p === '/tags' && req.method === 'POST') { const t = { id: `t${state.tags.length + 1}`, name: body.name }; state.tags.push(t); return send(201, t); }
      if (p === '/workflows' && req.method === 'GET') return list(state.workflows);
      if (p === '/workflows' && req.method === 'POST') {
        const w = { id: `wf${state.workflows.length + 1}`, ...body, active: false, tags: [], shared: [{ role: 'workflow:owner', projectId: 'projMe' }] };
        state.workflows.push(w);
        return send(200, w);
      }
      if ((m = p.match(/^\/workflows\/([^/]+)\/tags$/))) {
        const w = state.workflows.find((x) => x.id === m[1]);
        w.tags = body.map((x) => state.tags.find((t) => t.id === x.id));
        return send(200, w.tags);
      }
      if ((m = p.match(/^\/workflows\/([^/]+)$/))) {
        const w = state.workflows.find((x) => x.id === m[1]);
        if (!w) return send(404, { message: 'not found' });
        if (req.method === 'PUT') {
          // state.dropWires simulates an instance that stores the nodes but loses the connections.
          Object.assign(w, { name: body.name, nodes: body.nodes, connections: state.dropWires ? {} : body.connections, settings: body.settings, parentFolderId: body.parentFolderId, versionId: `v${Date.now()}` });
          return send(200, w);
        }
        return send(200, w);
      }
      send(404, { message: `no route ${req.method} ${p}` });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
  rmSync(kit, { recursive: true, force: true });
});

beforeEach(() => {
  if (kit) rmSync(kit, { recursive: true, force: true });
  kit = mkdtempSync(join(tmpdir(), 'kit-'));
  mkdirSync(join(kit, 'scripts'), { recursive: true });
  mkdirSync(join(kit, 'workflows', 'dev'), { recursive: true });
  for (const f of ['lib.mjs', 'organize.mjs', 'lint-workflow.mjs', 'validate.mjs', 'deploy.mjs']) writeFileSync(join(kit, 'scripts', f), readFileSync(join(TOOLS, f)));
  state = { workflows: [], folders: [], tags: [], dropWires: false };
  calls = [];
});

async function run(args, env = {}) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [join(kit, 'scripts', 'deploy.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, N8N_API_URL: base, N8N_API_KEY: 'test-key', N8N_API_URL_PROD: '', N8N_API_KEY_PROD: '', N8N_HARNESS_CACHE_DIR: join(kit, 'cache'), ...env },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.code, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

const writeWf = (wf, name = 'order-intake.json') => {
  const f = join(kit, 'workflows', 'dev', name);
  writeFileSync(f, JSON.stringify(wf, null, 2));
  return f;
};
const writes = () => calls.filter((c) => /^(POST|PUT|PATCH)/.test(c));

test('creates a workflow the instance does not have, places it, verifies it, and writes the id into the file', async () => {
  const f = writeWf(WF());
  const r = await run([f]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /validate ok/);
  assert.match(r.out, /lint {5}ok/);
  assert.match(r.out, /create {3}"Order intake"/);
  assert.match(r.out, /created {2}wf1 \(id written into/);
  assert.match(r.out, /folder {2}Order intake {2}\(created Order intake\)/);
  assert.match(r.out, /verify {3}2 nodes, connections and settings match the file, tags \[acme\]/);
  assert.match(r.out, /Not activated/);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).id, 'wf1');
  assert.deepEqual(state.workflows[0].tags.map((t) => t.name), ['acme']);
  assert.equal(state.workflows[0].parentFolderId, 'f1');
});

test('updates by id when the file carries one, and by name when it does not', async () => {
  state.workflows.push({ id: 'wf9', ...WF(), tags: [], shared: [{ role: 'workflow:owner', projectId: 'projMe' }] });
  const byName = await run([writeWf(WF())]);
  assert.equal(byName.code, 0, byName.out);
  assert.match(byName.out, /update {3}wf9 "Order intake"/);
  assert.ok(!calls.includes('POST /workflows'), calls.join('\n'));

  state.workflows[0].name = 'Renamed on the instance';
  calls = [];
  const byId = await run([writeWf({ id: 'wf9', ...WF() })]);
  assert.equal(byId.code, 0, byId.out);
  assert.match(byId.out, /update {3}wf9/);
  assert.equal(state.workflows[0].name, 'Order intake');
  assert.ok(!calls.includes('POST /workflows'), calls.join('\n'));
});

test('the lint gate stops a file without tags before anything is written', async () => {
  const { tags, ...untagged } = WF();
  const r = await run([writeWf(untagged)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /lint {5}FAILED/);
  assert.match(r.out, /no tags/);
  assert.match(r.out, /nothing was written/);
  assert.deepEqual(calls, []);
});

test('the validate gate stops a broken file', async () => {
  const wf = WF();
  wf.connections.Webhook.main[0][0].node = 'Missing';
  const r = await run([writeWf(wf)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /validate FAILED/);
  assert.match(r.out, /connection target does not exist/);
  assert.deepEqual(calls, []);
});

test('verify fails when the instance did not store the connections', async () => {
  state.dropWires = true;
  const r = await run([writeWf(WF())]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /VERIFY FAILED on wf1: connections differ/);
});

test('a non-dev environment needs its own pair and --confirm', async () => {
  const f = writeWf(WF());
  let r = await run([f, 'prod']);
  assert.equal(r.code, 2);
  assert.match(r.out, /environment "prod" is not configured/);
  r = await run([f, 'prod'], { N8N_API_URL_PROD: base, N8N_API_KEY_PROD: 'test-key' });
  assert.equal(r.code, 2);
  assert.match(r.out, /needs --confirm/);
  assert.deepEqual(calls, []);
  r = await run([f, 'prod', '--confirm'], { N8N_API_URL_PROD: base, N8N_API_KEY_PROD: 'test-key' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /deployed wf1/);
});

test('--dry-run runs the gates, prints the plan, and writes nothing', async () => {
  const f = writeWf(WF());
  const r = await run([f, '--dry-run']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /create {3}"Order intake"/);
  assert.match(r.out, /place {4}project personal, folder Order intake, tags \[acme\] \(after the create\)/);
  assert.match(r.out, /Dry run\. Nothing written\./);
  assert.deepEqual(writes(), []);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).id, undefined);
});

test('two live workflows with the file name is a stop, not a guess', async () => {
  for (const id of ['wfA', 'wfB']) state.workflows.push({ id, ...WF(), tags: [], shared: [] });
  const r = await run([writeWf(WF())]);
  assert.equal(r.code, 1);
  assert.match(r.out, /2 live workflows are named "Order intake" \(wfA, wfB\)/);
  assert.deepEqual(writes(), []);
});
