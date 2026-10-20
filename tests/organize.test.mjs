// Contract tests for scripts/organize.mjs and the placement checks in
// lint-workflow.mjs. A fake public API stands in: projects, folders, tags,
// credentials, data tables and the transfer endpoints. No instance involved.
// Run: node --test tests/organize.test.mjs
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

const PROJECT = { id: 'projAcme', name: 'Acme Corp', type: 'team' };
const PERSONAL = { id: 'projMe', name: 'Me <me@example.com>', type: 'personal' };

const freshState = () => ({
  projects: [PERSONAL, PROJECT],
  creds: [
    { id: 'credA', name: 'Acme API', type: 'httpHeaderAuth', shared: [{ id: 'projAcme', name: 'Acme Corp', role: 'credential:owner' }] },
    { id: 'credP', name: 'My Postgres', type: 'postgres', shared: [{ id: 'projMe', name: 'Me', role: 'credential:owner' }] },
    { id: 'credS', name: 'Solo key', type: 'httpHeaderAuth', shared: [{ id: 'projMe', name: 'Me', role: 'credential:owner' }] },
  ],
  folders: { projAcme: [], projMe: [] },
  tags: [],
  tables: [
    { id: 'dtAcme', name: 'orders', projectId: 'projAcme', columns: [{ name: 'id', type: 'string', index: 0 }] },
    { id: 'dtMine', name: 'scratch', projectId: 'projMe', columns: [{ name: 'id', type: 'string', index: 0 }, { name: 'note', type: 'string', index: 1 }] },
  ],
  rows: { dtMine: [{ id: '1', note: 'a' }, { id: '2', note: 'b' }] },
  workflows: [
    {
      id: 'wfOther', name: 'Other personal workflow', active: false, versionId: 'v1', activeVersionId: null,
      nodes: [{ name: 'Pg', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [0, 0], parameters: {}, credentials: { postgres: { id: 'credP', name: 'My Postgres' } } }],
      connections: {}, settings: {}, tags: [], shared: [{ role: 'workflow:owner', projectId: 'projMe' }],
    },
    {
      id: 'wfA', name: 'Acme order intake', active: true, versionId: 'v1', activeVersionId: 'v1',
      nodes: [
        { name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: { path: 'x' } },
        { name: 'Call', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [208, 0], parameters: {}, credentials: { httpHeaderAuth: { id: 'credA', name: 'Acme API' } } },
      ],
      connections: { Webhook: { main: [[{ node: 'Call', type: 'main', index: 0 }]] } },
      settings: { executionOrder: 'v1' }, tags: [], shared: [{ role: 'workflow:owner', projectId: 'projMe' }],
    },
  ],
});

// The JSON a repo holds for wfA, with its placement.
const WF = () => ({
  ...freshState().workflows[1],
  tags: ['acme', 'order-intake'],
  project: 'Acme Corp',
  folder: 'Order intake/API',
});

let server, base, kit, state, calls;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/^\/api\/v1/, '');
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (code, out) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(out === undefined ? '' : JSON.stringify(out)); };
      calls.push(`${req.method} ${p}`);
      if (req.headers['x-n8n-api-key'] !== 'test-key') return send(401, { message: 'unauthorized' });
      const list = (data) => send(200, { data, nextCursor: null });
      let m;
      if (p === '/projects' && req.method === 'GET') return list(state.projects);
      if (p === '/projects' && req.method === 'POST') { state.projects.push({ id: `proj${state.projects.length}`, name: body.name, type: 'team' }); state.folders[`proj${state.projects.length - 1}`] = []; return send(201); }
      if (p === '/credentials' && req.method === 'GET') return list(state.creds);
      if ((m = p.match(/^\/credentials\/([^/]+)\/transfer$/))) {
        const c = state.creds.find((x) => x.id === m[1]);
        const dest = state.projects.find((x) => x.id === body.destinationProjectId);
        c.shared = [{ id: dest.id, name: dest.name, role: 'credential:owner' }];
        return send(204);
      }
      if ((m = p.match(/^\/projects\/([^/]+)\/folders$/))) {
        const fl = state.folders[m[1]];
        if (!fl) return send(404, { message: 'no such project' });
        if (req.method === 'POST') { const f = { id: `f${fl.length + 1}`, name: body.name, parentFolderId: body.parentFolderId ?? null }; fl.push(f); return send(201, f); }
        return send(200, { count: fl.length, data: fl });
      }
      if ((m = p.match(/^\/projects\/([^/]+)\/folders\/([^/]+)$/))) {
        return send(200, { id: m[2], totalWorkflows: state.workflows.filter((w) => w.parentFolderId === m[2]).length });
      }
      if (p === '/tags' && req.method === 'GET') return list(state.tags);
      if (p === '/tags' && req.method === 'POST') { const t = { id: `t${state.tags.length + 1}`, name: body.name }; state.tags.push(t); return send(201, t); }
      if (p === '/workflows' && req.method === 'GET') return list(state.workflows);
      if ((m = p.match(/^\/workflows\/([^/]+)\/transfer$/))) {
        const w = state.workflows.find((x) => x.id === m[1]);
        w.shared = [{ role: 'workflow:owner', projectId: body.destinationProjectId }];
        return send(204);
      }
      if ((m = p.match(/^\/workflows\/([^/]+)\/tags$/))) {
        const w = state.workflows.find((x) => x.id === m[1]);
        w.tags = body.map((x) => state.tags.find((t) => t.id === x.id));
        return send(200, w.tags);
      }
      if ((m = p.match(/^\/workflows\/([^/]+)$/))) {
        const w = state.workflows.find((x) => x.id === m[1]);
        if (!w) return send(404, { message: 'not found' });
        if (req.method === 'PUT') { Object.assign(w, { nodes: body.nodes, connections: body.connections, settings: body.settings, parentFolderId: body.parentFolderId, versionId: `v${Date.now()}` }); return send(200, w); }
        return send(200, w);
      }
      if (p === '/data-tables' && req.method === 'GET') return list(state.tables);
      if (p === '/data-tables' && req.method === 'POST') { const t = { id: `dt${state.tables.length + 1}`, name: body.name, projectId: body.projectId, columns: body.columns.map((c, i) => ({ ...c, index: i })) }; state.tables.push(t); state.rows[t.id] = []; return send(201, t); }
      if ((m = p.match(/^\/data-tables\/([^/]+)\/rows$/))) {
        if (req.method === 'POST') { state.rows[m[1]].push(...body.data); return send(201, { count: body.data.length }); }
        return list(state.rows[m[1]] ?? []);
      }
      if ((m = p.match(/^\/data-tables\/([^/]+)$/))) {
        const t = state.tables.find((x) => x.id === m[1]);
        if (req.method === 'PATCH') { t.name = body.name; return send(200, t); }
        return send(200, t);
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
  for (const f of ['lib.mjs', 'organize.mjs', 'lint-workflow.mjs']) writeFileSync(join(kit, 'scripts', f), readFileSync(join(TOOLS, f)));
  state = freshState();
  calls = [];
});

async function run(tool, args = [], env = {}) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [join(kit, 'scripts', tool), ...args], {
      encoding: 'utf8', env: { ...process.env, N8N_API_URL: base, N8N_API_KEY: 'test-key', ...env },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.code, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

const writeWf = (wf, name = 'acme-order-intake.json') => {
  const f = join(kit, 'workflows', 'dev', name);
  writeFileSync(f, JSON.stringify(wf, null, 2));
  return f;
};
const live = (id) => state.workflows.find((w) => w.id === id);

// ------------------------------------------------------------ lint placement

test('lint --require-placement errors on a missing project or folder', async () => {
  const f = writeWf(WF());
  let r = await run('lint-workflow.mjs', [f, '--require-tags', '--require-placement']);
  assert.equal(r.code, 0, r.out);
  const { project, ...noProject } = WF();
  r = await run('lint-workflow.mjs', [writeWf(noProject), '--require-placement']);
  assert.equal(r.code, 1);
  assert.match(r.out, /no "project"/);
  r = await run('lint-workflow.mjs', [writeWf({ ...WF(), folder: '' }), '--require-placement']);
  assert.equal(r.code, 1);
  assert.match(r.out, /no "folder"/);
  // without the flag the same files only warn
  r = await run('lint-workflow.mjs', [writeWf(noProject)]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no "project"/);
});

// ------------------------------------------------------------------- place

test('place --dry-run plans the folder path and writes nothing', async () => {
  const r = await run('organize.mjs', ['place', writeWf(WF()), '--dry-run']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /project Acme Corp {2}\(transferred\)/);
  assert.match(r.out, /folder {2}Order intake\/API {2}\(created Order intake, API\)/);
  assert.match(r.out, /Dry run\. Nothing written\./);
  assert.equal(state.folders.projAcme.length, 0);
  assert.ok(!calls.some((c) => /^(PUT|POST|PATCH)/.test(c)), calls.join('\n'));
});

test('place refuses a missing or unknown project and a missing folder', async () => {
  const { project, ...noProject } = WF();
  let r = await run('organize.mjs', ['place', writeWf(noProject), '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.out, /no "project"/);
  r = await run('organize.mjs', ['place', writeWf({ ...WF(), project: 'Nope' }), '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.out, /project "Nope" does not exist/);
  assert.match(r.out, /organize\.sh project "Nope" dev/);
  r = await run('organize.mjs', ['place', writeWf({ ...WF(), folder: '' }), '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.out, /no "folder"/);
});

test('place stops on a credential another workflow outside the batch still uses', async () => {
  const wf = WF();
  wf.nodes[1].credentials = { postgres: { id: 'credP', name: 'My Postgres' } };
  const r = await run('organize.mjs', ['place', writeWf(wf), '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.out, /cannot take 'My Postgres'/);
  assert.match(r.out, /Other personal workflow/);
  assert.match(r.out, /organize\.sh credentials/);
  assert.equal(state.creds[1].shared[0].id, 'projMe');
});

test('place moves a credential only this batch uses, then transfers, files and tags', async () => {
  const wf = WF();
  wf.nodes[1].credentials = { httpHeaderAuth: { id: 'credS', name: 'Solo key' } };
  live('wfA').nodes[1].credentials = wf.nodes[1].credentials;
  let r = await run('organize.mjs', ['place', writeWf(wf), '--dry-run']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /credential 'Solo key' would move into 'Acme Corp'/);

  r = await run('organize.mjs', ['place', writeWf(wf)]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /credential 'Solo key' moved into 'Acme Corp'/);
  assert.equal(state.creds[2].shared[0].id, 'projAcme');
  assert.equal(live('wfA').shared[0].projectId, 'projAcme');
  assert.equal(live('wfA').parentFolderId, 'f2');
  assert.deepEqual(state.folders.projAcme.map((f) => [f.name, f.parentFolderId]), [['Order intake', null], ['API', 'f1']]);
  assert.deepEqual(live('wfA').tags.map((t) => t.name), ['acme', 'order-intake']);
  assert.match(r.out, /verify {2}folder holds 1 workflow\(s\); live tags \[acme, order-intake\]/);
  // the folder PUT made a new version on an active workflow: the draft warning fires
  assert.match(r.out, /WARNING an unpublished draft is live/);
  // order: transfer before the folder PUT, tags after
  const seq = calls.filter((c) => /^PUT \/workflows\/wfA/.test(c));
  assert.deepEqual(seq, ['PUT /workflows/wfA/transfer', 'PUT /workflows/wfA', 'PUT /workflows/wfA/tags']);
});

test('place is idempotent: a second run creates nothing and transfers nothing', async () => {
  await run('organize.mjs', ['place', writeWf(WF())]);
  calls = [];
  const r = await run('organize.mjs', ['place', writeWf(WF())]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\(transferred\)|\(created/);
  assert.ok(!calls.includes('PUT /workflows/wfA/transfer'));
  assert.ok(!calls.some((c) => c.startsWith('POST /projects/projAcme/folders')));
});

test('place stops on a data table in another project and names the copy command', async () => {
  const wf = WF();
  wf.nodes.push({ name: 'Rows', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [416, 0], parameters: { operation: 'get', dataTableId: { __rl: true, mode: 'id', value: 'dtMine' } } });
  let r = await run('organize.mjs', ['place', writeWf(wf), '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.out, /data table 'scratch' \(dtMine\) lives in project projMe/);
  assert.match(r.out, /organize\.sh tables/);
  wf.nodes[2].parameters.dataTableId.value = 'dtAcme';
  r = await run('organize.mjs', ['place', writeWf(wf), '--dry-run']);
  assert.equal(r.code, 0, r.out);
  // an expression-bound table id is not checked
  wf.nodes[2].parameters.dataTableId.value = '={{ $json.t }}';
  r = await run('organize.mjs', ['place', writeWf(wf), '--dry-run']);
  assert.equal(r.code, 0, r.out);
});

test('place skips a file with no id and says what to do', async () => {
  const { id, ...noId } = WF();
  const r = await run('organize.mjs', ['place', writeWf(noId), '--dry-run']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no id in the JSON/);
});

// ------------------------------------------------------------------- audit

test('audit lists untagged and personal-project workflows and scope violations', async () => {
  let r = await run('organize.mjs', ['audit']);
  assert.equal(r.code, 1);
  assert.match(r.out, /projects 2 \(1 team\) {2}workflows 2 {2}credentials 3 {2}data tables 2/);
  assert.match(r.out, /\[team {4}\] Acme Corp: 0 workflows, 0 folders, 1 credentials, 1 data tables/);
  assert.match(r.out, /untagged workflows: 2/);
  assert.match(r.out, /workflows left in a personal project: 2/);
  assert.match(r.out, /RESULT: findings/);
  // a team workflow bound to a personal credential is a scope violation
  live('wfA').shared = [{ role: 'workflow:owner', projectId: 'projAcme' }];
  live('wfA').nodes[1].credentials = { postgres: { id: 'credP', name: 'My Postgres' } };
  r = await run('organize.mjs', ['audit']);
  assert.match(r.out, /credential scope violations: 1\n {2}Acme order intake in 'Acme Corp': 'My Postgres' \(credP\): owned by Me/);
});

test('audit is clean when everything is placed', async () => {
  state.workflows = [{ ...live('wfA'), tags: [{ id: 't1', name: 'acme' }], shared: [{ role: 'workflow:owner', projectId: 'projAcme' }] }];
  const r = await run('organize.mjs', ['audit']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /RESULT: ok/);
});

// ------------------------------------------------------------- credentials

test('credentials refuses a move that strands another workflow, unless forced', async () => {
  let r = await run('organize.mjs', ['credentials', 'My Postgres', '--to', 'Acme Corp']);
  assert.equal(r.code, 1);
  assert.match(r.out, /used by 1 workflow\(s\) outside 'Acme Corp': Other personal workflow/);
  assert.equal(state.creds[1].shared[0].id, 'projMe');
  r = await run('organize.mjs', ['credentials', 'My Postgres', '--to', 'Acme Corp', '--force']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /moved \(forced; 1 outside users lost access\)/);
  assert.equal(state.creds[1].shared[0].id, 'projAcme');
  r = await run('organize.mjs', ['credentials', 'Acme API', 'Nope', '--to', 'Acme Corp']);
  assert.equal(r.code, 1);
  assert.match(r.out, /Acme API \(credA\): already in 'Acme Corp'/);
  assert.match(r.out, /Nope: not found/);
});

test('credentials and tables refuse a personal destination', async () => {
  let r = await run('organize.mjs', ['credentials', 'Solo key', '--to', 'personal']);
  assert.equal(r.code, 1);
  assert.match(r.out, /cannot address a personal one/);
  r = await run('organize.mjs', ['tables', 'scratch', '--to', 'personal']);
  assert.equal(r.code, 1);
});

// ------------------------------------------------------------------ tables

test('tables copies schema and rows into the project, archives the original, prints the id map', async () => {
  const r = await run('organize.mjs', ['tables', 'scratch', '--to', 'Acme Corp']);
  assert.equal(r.code, 0, r.out);
  const copy = state.tables.find((t) => t.name === 'scratch' && t.projectId === 'projAcme');
  assert.ok(copy, 'copy exists in the project');
  assert.deepEqual(copy.columns.map((c) => c.name), ['id', 'note']);
  assert.deepEqual(state.rows[copy.id], [{ id: '1', note: 'a' }, { id: '2', note: 'b' }]);
  assert.match(state.tables.find((t) => t.id === 'dtMine').name, /^zz-archived-\d{4}-\d{2}-\d{2}-scratch$/);
  assert.match(r.out, /scratch: dtMine -> dt3 \(2 rows copied/);
  assert.match(r.out, /"dtMine": "dt3"/);
});

test('tables --no-rows copies the schema only', async () => {
  const r = await run('organize.mjs', ['tables', 'dtMine', '--to', 'Acme Corp', '--no-rows']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(state.rows.dt3, []);
});

// ----------------------------------------------------------------- project

test('project creates a team project once', async () => {
  let r = await run('organize.mjs', ['project', 'New Team']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /project 'New Team' proj2 created/);
  r = await run('organize.mjs', ['project', 'New Team']);
  assert.match(r.out, /exists/);
  assert.equal(state.projects.filter((p) => p.name === 'New Team').length, 1);
});

// --------------------------------------------------------- target resolution

test('a named environment never falls back to the bare pair', async () => {
  const r = await run('organize.mjs', ['audit', 'prod']);
  assert.equal(r.code, 2);
  assert.match(r.out, /environment "prod" is not configured: set N8N_API_URL_PROD and N8N_API_KEY_PROD/);
  assert.equal(calls.length, 0);
});
