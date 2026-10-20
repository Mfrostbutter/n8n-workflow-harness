// Contract tests for scripts/secret-map.mjs. A fake public API and a fake
// `infisical` binary on PATH stand in; no instance and no secret manager. Every
// run also asserts that no resolved value reached the tool's output.
// Run: node --test tests/secret-map.test.mjs
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOOLS = join(ROOT, 'scripts');

const PROJECT = { id: 'projAcme', name: 'Acme Corp', type: 'team' };
const PERSONAL = { id: 'projMe', name: 'Me <me@example.com>', type: 'personal' };
// Fixture values are plain words on purpose: the test proves they never reach
// output, and a token-shaped literal would trip a secret scanner.
const VALUES = { ACME_API_TOKEN: 'fixture-value-alpha', PG_ACME_PASSWORD: 'fixture-value-bravo' };
const SCHEMAS = {
  httpHeaderAuth: { properties: { name: {}, value: {}, useCustomAuth: {} }, required: [] },
  postgres: { properties: { host: {}, port: {}, database: {}, user: {}, password: {}, ssl: {} }, required: [] },
};
const MAP = {
  _secrets: { provider: 'infisical', env: 'dev', path: '/' },
  'Acme API (dev)': { type: 'httpHeaderAuth', project: 'Acme Corp', data: { name: 'Authorization', value: 'secret:ACME_API_TOKEN' } },
  'Lab Postgres (acme)': { type: 'postgres', project: 'Acme Corp', data: { host: 'env:PG_HOST', port: 5432, database: 'acme', user: 'acme', password: 'secret:PG_ACME_PASSWORD', ssl: 'disable' } },
};
const FAKE_INFISICAL = `#!/usr/bin/env node
const fs = require('node:fs');
const VALUES = JSON.parse(fs.readFileSync(__filename + '.values', 'utf8'));
const a = process.argv.slice(2);
if (a[0] === 'secrets' && a.includes('--output')) {
  console.log(JSON.stringify({ secrets: Object.entries(VALUES).map(([k, v]) => ({ secretKey: k, secretValue: v, secretPath: '/' })) }));
} else if (a[0] === 'secrets' && a[1] === 'get') {
  const v = VALUES[a[2]];
  if (v === undefined) { process.stderr.write('secret not found\\n'); process.exit(1); }
  console.log(v);
} else process.exit(2);
`;

const freshState = () => ({
  creds: [{ id: 'credOld', name: 'Legacy key', type: 'httpHeaderAuth', shared: [{ id: 'projMe', name: 'Me', role: 'credential:owner' }] }],
  posts: [],
  workflows: [{
    id: 'wfLegacy', name: 'Legacy caller',
    nodes: [{ name: 'Call', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 0], parameters: {}, credentials: { httpHeaderAuth: { id: 'credOld', name: 'Legacy key' } } }],
    connections: {}, settings: {}, tags: [], shared: [{ role: 'workflow:owner', projectId: 'projMe' }],
  }],
});

let server, base, kit, bin, state;

before(async () => {
  server = createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers['x-n8n-api-key'] !== 'test-key') return send(401, { message: 'unauthorized' });
      const list = (data) => send(200, { data, nextCursor: null });
      let m;
      if (p === '/projects') return list([PERSONAL, PROJECT]);
      if (p === '/credentials' && req.method === 'GET') return list(state.creds);
      if (p === '/credentials' && req.method === 'POST') {
        state.posts.push(body);
        const id = `cred${state.creds.length + 1}`;
        const owner = body.projectId === 'projAcme' ? { id: 'projAcme', name: 'Acme Corp', role: 'credential:owner' } : { id: 'projMe', name: 'Me', role: 'credential:owner' };
        state.creds.push({ id, name: body.name, type: body.type, shared: [owner] });
        return send(201, { id, name: body.name, type: body.type });
      }
      if ((m = p.match(/^\/credentials\/schema\/(.+)$/))) return SCHEMAS[m[1]] ? send(200, SCHEMAS[m[1]]) : send(404, { message: 'unknown type' });
      if (p === '/workflows') return list(state.workflows);
      send(404, { message: 'not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  bin = mkdtempSync(join(tmpdir(), 'fake-bin-'));
  writeFileSync(join(bin, 'infisical'), FAKE_INFISICAL);
  chmodSync(join(bin, 'infisical'), 0o755);
  writeFileSync(join(bin, 'infisical.values'), JSON.stringify(VALUES));
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
  rmSync(kit, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

beforeEach(() => {
  if (kit) rmSync(kit, { recursive: true, force: true });
  kit = mkdtempSync(join(tmpdir(), 'kit-'));
  mkdirSync(join(kit, 'scripts'), { recursive: true });
  mkdirSync(join(kit, 'deploy'), { recursive: true });
  for (const f of ['lib.mjs', 'organize.mjs', 'secret-map.mjs']) writeFileSync(join(kit, 'scripts', f), readFileSync(join(TOOLS, f)));
  state = freshState();
});

const writeMap = (m, env = 'dev') => writeFileSync(join(kit, 'deploy', `secret-map.${env}.json`), JSON.stringify(m, null, 2));
const ids = (env = 'dev') => (existsSync(join(kit, 'deploy', `creds.${env}.json`)) ? JSON.parse(readFileSync(join(kit, 'deploy', `creds.${env}.json`), 'utf8')) : null);

async function run(args, extra = {}) {
  const env = { ...process.env, N8N_API_URL_DEV: base, N8N_API_KEY_DEV: 'test-key', PATH: `${bin}:${process.env.PATH}`, PG_HOST: 'pg.lab.internal', ...extra };
  delete env.N8N_API_URL; delete env.N8N_API_KEY;
  for (const k of Object.keys(VALUES)) if (!(k in extra)) delete env[k];
  let r;
  try {
    const { stdout } = await execFileAsync(process.execPath, [join(kit, 'scripts', 'secret-map.mjs'), ...args], { encoding: 'utf8', env, cwd: kit });
    r = { code: 0, out: stdout };
  } catch (e) {
    r = { code: e.code, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
  for (const v of Object.values(VALUES)) assert.ok(!r.out.includes(v), `a secret value reached the output of: ${args.join(' ')}`);
  return r;
}

test('map validation', async () => {
  writeMap({ Broken: { data: { x: 'y' } } });
  let r = await run(['check']);
  assert.equal(r.code, 1); assert.match(r.out, /'Broken': needs "type"/);
  writeMap({ Broken: { type: 'httpHeaderAuth', data: { value: 'secret:' } } });
  r = await run(['check']);
  assert.equal(r.code, 1); assert.match(r.out, /empty reference/);
  r = await run(['check', 'staging']);
  assert.equal(r.code, 2); assert.match(r.out, /no secret map for staging/);
});

test('check lists secrets by name and compares data keys with the target schema', async () => {
  writeMap(MAP);
  let r = await run(['check']);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /2 secret\(s\) listed/); assert.match(r.out, /RESULT: ok/);
  const bad = structuredClone(MAP);
  bad['Acme API (dev)'].data.value = 'secret:NOT_THERE';
  bad['Acme API (dev)'].data.bogus = 'x';
  bad.Odd = { type: 'noSuchType', data: { a: 'b' } };
  writeMap(bad);
  r = await run(['check']);
  assert.equal(r.code, 1);
  assert.match(r.out, /secret NOT_THERE not found/); assert.match(r.out, /keys not in the httpHeaderAuth schema: bogus/);
  assert.match(r.out, /no schema on the target/); assert.match(r.out, /RESULT: findings/);
});

test('sync creates what is missing in its project and records ids; verify agrees', async () => {
  writeMap(MAP);
  let r = await run(['verify']);
  assert.equal(r.code, 1);
  assert.match(r.out, /'Acme API \(dev\)' \(httpHeaderAuth\) is not on the target/);
  assert.match(r.out, /in use by all 1 workflows on the target but not in the map: 1/);
  assert.match(r.out, /'Legacy key' \(credOld\) used by Legacy caller/);

  r = await run(['sync', '--dry-run']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /would create httpHeaderAuth in 'Acme Corp' \(value<-secret:ACME_API_TOKEN\)/);
  assert.match(r.out, /Dry run/); assert.equal(state.posts.length, 0); assert.equal(ids(), null);

  r = await run(['sync']);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /2 created/);
  const api = state.posts.find((p) => p.name === 'Acme API (dev)');
  assert.equal(api.projectId, 'projAcme'); assert.deepEqual(api.data, { name: 'Authorization', value: VALUES.ACME_API_TOKEN });
  const pg = state.posts.find((p) => p.name === 'Lab Postgres (acme)');
  assert.equal(pg.data.host, 'pg.lab.internal'); assert.equal(pg.data.password, VALUES.PG_ACME_PASSWORD); assert.equal(pg.data.port, 5432);
  assert.deepEqual(ids(), { 'Acme API (dev)': 'cred2', 'Lab Postgres (acme)': 'cred3' });

  r = await run(['sync']);
  assert.equal(r.code, 0); assert.match(r.out, /0 created/); assert.match(r.out, /exists \(cred2\)/); assert.equal(state.posts.length, 2);

  // the legacy credential is an unmapped finding; scoped to this repo's deploys it is clean
  r = await run(['verify']);
  assert.equal(r.code, 1); assert.match(r.out, /1 credential\(s\) in use trace to no secret/);
  writeFileSync(join(kit, 'deploy', 'workflows.dev.json'), JSON.stringify({ 'Something else': 'wfElse' }));
  r = await run(['verify']);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /in use by this repo's 1 workflow\(s\) but not in the map: 0/); assert.match(r.out, /RESULT: ok/);
  unlinkSync(join(kit, 'deploy', 'workflows.dev.json'));

  // --only limits the batch; the environment wins over the provider
  state.creds = state.creds.filter((c) => c.name !== 'Acme API (dev)');
  r = await run(['sync', '--only', 'Lab Postgres (acme)']);
  assert.equal(r.code, 0); assert.doesNotMatch(r.out, /Acme API/); assert.equal(state.posts.length, 2);
  r = await run(['sync'], { ACME_API_TOKEN: 'from-env-value' });
  assert.equal(r.code, 0); assert.equal(state.posts.at(-1).data.value, 'from-env-value');
});

test('an unresolved reference stops the sync and names the reference, not a value', async () => {
  const m = structuredClone(MAP);
  m['Acme API (dev)'].data.value = 'secret:MISSING_ONE';
  writeMap(m);
  const r = await run(['sync']);
  assert.equal(r.code, 1); assert.match(r.out, /unresolved value <- secret:MISSING_ONE/); assert.match(r.out, /infisical run/);
  assert.equal(state.posts.length, 0);
});

test('rotate creates a replacement, moves the ledger id, lists bound workflows', async () => {
  writeMap(MAP);
  await run(['sync']);
  state.workflows.push({ id: 'wfA', name: 'Acme order intake', nodes: [{ name: 'Call', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 0], parameters: {}, credentials: { httpHeaderAuth: { id: 'cred2', name: 'Acme API (dev)' } } }], connections: {}, settings: {}, tags: [], shared: [{ role: 'workflow:owner', projectId: 'projAcme' }] });
  const r = await run(['rotate', 'Acme API (dev)', 'Nope']);
  assert.equal(r.code, 1);
  assert.match(r.out, /replacement cred4 created in 'Acme Corp'; previous cred2 still bound by 1 workflow\(s\): Acme order intake/);
  assert.match(r.out, /Nope: not in the secret map/);
  assert.equal(ids()['Acme API (dev)'], 'cred4');
  const v = await run(['verify']);
  assert.equal(v.code, 1); assert.match(v.out, /'Acme API \(dev\)' exists 2 times/);
});

test('ids refreshes the ledger from the target by name', async () => {
  writeMap(MAP);
  await run(['sync']);
  unlinkSync(join(kit, 'deploy', 'creds.dev.json'));
  let r = await run(['verify']);
  assert.equal(r.code, 1); assert.match(r.out, /no id in deploy\/creds\.dev\.json/);
  r = await run(['ids']);
  assert.equal(r.code, 0); assert.deepEqual(ids(), { 'Acme API (dev)': 'cred2', 'Lab Postgres (acme)': 'cred3' });
});

test('a named environment never falls back to the bare pair', async () => {
  writeMap(MAP, 'prod');
  const r = await run(['sync', 'prod']);
  assert.equal(r.code, 2); assert.match(r.out, /N8N_API_URL_PROD/); assert.equal(state.posts.length, 0);
});
