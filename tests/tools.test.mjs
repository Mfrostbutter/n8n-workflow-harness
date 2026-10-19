// Tests for the shared tools. Node's built-in runner, no dependencies.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VALIDATE = join(ROOT, 'scripts', 'validate.mjs');

// pathToFileURL, not a bare path: a Windows absolute path is not a valid ESM specifier.
const { normalize, slugify, sortKeys } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib.mjs')).href);

let tmp;
test.before(() => { tmp = mkdtempSync(join(tmpdir(), 'harness-test-')); });
test.after(() => { rmSync(tmp, { recursive: true, force: true }); });

/** Runs validate.mjs on a workflow object. Returns {code, out}. */
function validate(wf, name = 'wf') {
  const f = join(tmp, `${name}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, typeof wf === 'string' ? wf : JSON.stringify(wf));
  try {
    const out = execFileSync(process.execPath, [VALIDATE, f], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

const goodWorkflow = {
  name: 'Good',
  nodes: [
    { name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: { path: 'x' } },
    { name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [200, 0], parameters: {} },
  ],
  connections: { Webhook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
  settings: {},
};

// ---------------------------------------------------------------- validate

test('accepts a well-formed workflow', () => {
  const r = validate(goodWorkflow);
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: ok/);
});

test('rejects malformed JSON without throwing', () => {
  const r = validate('{ not json', 'broken');
  assert.equal(r.code, 1);
  assert.match(r.out, /not valid JSON/);
});

test('catches a duplicate node name', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes[1].name = 'Webhook';
  const r = validate(wf);
  assert.equal(r.code, 1);
  assert.match(r.out, /duplicate node name: Webhook/);
});

test('catches a connection to a node that does not exist', () => {
  const wf = structuredClone(goodWorkflow);
  wf.connections.Webhook.main[0][0].node = 'Ghost';
  const r = validate(wf);
  assert.equal(r.code, 1);
  assert.match(r.out, /connection target does not exist: Ghost/);
});

test('catches a workflow with no trigger', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes[0].type = 'n8n-nodes-base.set';
  const r = validate(wf);
  assert.equal(r.code, 1);
  assert.match(r.out, /no trigger node/);
});

test('catches a missing typeVersion', () => {
  const wf = structuredClone(goodWorkflow);
  delete wf.nodes[1].typeVersion;
  const r = validate(wf);
  assert.equal(r.code, 1);
  assert.match(r.out, /missing typeVersion: Set/);
});

test('catches a placeholder credential id', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes[1].credentials = { httpHeaderAuth: { id: 'REPLACE_ME', name: 'x' } };
  const r = validate(wf);
  assert.equal(r.code, 1);
  assert.match(r.out, /placeholder credential id/);
});

test('accepts a real credential id', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes[1].credentials = { httpHeaderAuth: { id: '0eTpRd1XpibmE8k6', name: 'x' } };
  assert.equal(validate(wf).code, 0);
});

test('catches a hardcoded secret in parameters', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes[1].parameters = { apiKey: 'aVeryLongLookingSecretValue123456' };
  const r = validate(wf);
  assert.equal(r.code, 1);
  assert.match(r.out, /hardcoded secret/);
});

test('does not flag a credential referenced by expression', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes[1].parameters = { token: '={{ $credentials.token }}' };
  assert.equal(validate(wf).code, 0, 'an expression reference is not a hardcoded secret');
});

test('warns but does not fail on a responseNode webhook with no error path', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes[0].parameters.responseMode = 'responseNode';
  const r = validate(wf);
  assert.equal(r.code, 0, 'this is a warning, not an error');
  assert.match(r.out, /WARN.*no error path/);
});

test('does not warn when the webhook error path is set', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes[0].parameters.responseMode = 'responseNode';
  wf.nodes[0].onError = 'continueRegularOutput';
  assert.doesNotMatch(validate(wf).out, /no error path/);
});

test('warns on an object literal inside an expression', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes[1].parameters = { jsonBody: '={{ JSON.stringify({ a: 1 }) }}' };
  assert.match(validate(wf).out, /object literal inside/);
});

test('does not flag an ordinary expression', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes[1].parameters = { value: '={{ $json.email }}' };
  assert.doesNotMatch(validate(wf).out, /object literal/);
});

test('does not flag a disconnected sticky note', () => {
  const wf = structuredClone(goodWorkflow);
  wf.nodes.push({ name: 'Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, 300], parameters: { content: 'hi' } });
  const r = validate(wf);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /Note.*not connected/);
});

// ---------------------------------------------------------------- normalize

test('normalize ignores canvas position', () => {
  const a = structuredClone(goodWorkflow);
  const b = structuredClone(goodWorkflow);
  b.nodes[0].position = [999, 999];
  assert.deepEqual(normalize(a), normalize(b), 'moving a node is not a behavior change');
});

test('normalize ignores ids, timestamps, and pinned data', () => {
  const a = structuredClone(goodWorkflow);
  const b = structuredClone(goodWorkflow);
  b.id = 'abc123';
  b.createdAt = '2026-01-01T00:00:00Z';
  b.pinData = { Webhook: [{ json: { test: true } }] };
  b.nodes[0].id = 'uuid-here';
  b.nodes[0].webhookId = 'other-uuid';
  assert.deepEqual(normalize(a), normalize(b));
});

test('normalize ignores node order', () => {
  const a = structuredClone(goodWorkflow);
  const b = structuredClone(goodWorkflow);
  b.nodes.reverse();
  assert.deepEqual(normalize(a), normalize(b));
});

test('normalize ignores sticky notes', () => {
  const a = structuredClone(goodWorkflow);
  const b = structuredClone(goodWorkflow);
  b.nodes.push({ name: 'Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, parameters: { content: 'x' } });
  assert.deepEqual(normalize(a), normalize(b), 'documentation is not behavior');
});

test('normalize DETECTS a parameter change', () => {
  const a = structuredClone(goodWorkflow);
  const b = structuredClone(goodWorkflow);
  b.nodes[0].parameters.path = 'changed';
  assert.notDeepEqual(normalize(a), normalize(b));
});

test('normalize DETECTS a typeVersion change', () => {
  const a = structuredClone(goodWorkflow);
  const b = structuredClone(goodWorkflow);
  b.nodes[1].typeVersion = 3.5;
  assert.notDeepEqual(normalize(a), normalize(b));
});

test('normalize DETECTS a rewired connection', () => {
  const a = structuredClone(goodWorkflow);
  const b = structuredClone(goodWorkflow);
  b.connections = {};
  assert.notDeepEqual(normalize(a), normalize(b));
});

test('normalize DETECTS a credential change', () => {
  const a = structuredClone(goodWorkflow);
  const b = structuredClone(goodWorkflow);
  b.nodes[1].credentials = { httpHeaderAuth: { id: 'x', name: 'y' } };
  assert.notDeepEqual(normalize(a), normalize(b));
});

test('normalize DETECTS a disabled node', () => {
  const a = structuredClone(goodWorkflow);
  const b = structuredClone(goodWorkflow);
  b.nodes[1].disabled = true;
  assert.notDeepEqual(normalize(a), normalize(b), 'a disabled node changes behavior');
});

// ---------------------------------------------------------------- helpers

test('slugify produces safe filenames', () => {
  assert.equal(slugify('Order Intake (v2)'), 'order-intake-v2');
  assert.equal(slugify('  Trim  Me  '), 'trim-me');
  assert.equal(slugify('!!!'), 'workflow', 'never returns an empty filename');
});

test('sortKeys is stable regardless of insertion order', () => {
  assert.equal(JSON.stringify(sortKeys({ b: 1, a: { d: 2, c: 3 } })),
               JSON.stringify(sortKeys({ a: { c: 3, d: 2 }, b: 1 })));
});

// ---------------------------------------------------------------- lint-workflow

const LINT = join(ROOT, 'scripts', 'lint-workflow.mjs');
const WFDIFF = join(ROOT, 'scripts', 'wf-diff.mjs');
const TEXTCONV = join(ROOT, 'scripts', 'wf-textconv.mjs');

function run(script, wfs, extra = []) {
  const paths = wfs.map((wf, i) => {
    const f = join(tmp, `lint-${i}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, typeof wf === 'string' ? wf : JSON.stringify(wf));
    return f;
  });
  try {
    const out = execFileSync(process.execPath, [script, ...paths, ...extra], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

const portable = {
  ...goodWorkflow,
  tags: ['acme'],
  settings: { errorWorkflow: 'err-1' },
  nodes: [
    ...goodWorkflow.nodes,
    { name: 'Call', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400, 0],
      parameters: { url: '={{ $vars.API_BASE }}/orders' }, credentials: { httpHeaderAuth: { id: '1', name: 'Orders API' } } },
  ],
};

test('lint passes a portable workflow and prints its manifest', () => {
  const r = run(LINT, [portable], ['--strict']);
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: ok/);
  assert.match(r.out, /credentials the target needs: Orders API \(httpHeaderAuth\)/);
  assert.match(r.out, /variables the target needs: API_BASE/);
});

test('lint blocks a localhost literal', () => {
  const wf = structuredClone(portable);
  wf.nodes[2].parameters.url = 'http://localhost:5678/webhook/x';
  const r = run(LINT, [wf]);
  assert.equal(r.code, 1);
  assert.match(r.out, /hardcodes a local or private host "localhost"/);
});

test('lint blocks a private IP and an environment-labelled host', () => {
  const wf = structuredClone(portable);
  wf.nodes[2].parameters.url = 'https://10.0.0.5/api';
  const r1 = run(LINT, [wf]);
  assert.equal(r1.code, 1);
  assert.match(r1.out, /private host "10\.0\.0\.5"/);
  wf.nodes[2].parameters.url = 'https://api-dev.example.com/orders';
  const r2 = run(LINT, [wf]);
  assert.equal(r2.code, 1);
  assert.match(r2.out, /environment-labelled host "api-dev\.example\.com"/);
});

test('lint allows a listed host and a public API host', () => {
  const wf = structuredClone(portable);
  wf.nodes[2].parameters.url = 'https://api-dev.example.com/orders';
  assert.equal(run(LINT, [wf], ['--allow-host', 'api-dev.example.com']).code, 0);
  wf.nodes[2].parameters.url = 'https://api.openai.com/v1/models';
  assert.equal(run(LINT, [wf]).code, 0);
});

test('lint blocks a credential without a name', () => {
  const wf = structuredClone(portable);
  delete wf.nodes[2].credentials.httpHeaderAuth.name;
  const r = run(LINT, [wf]);
  assert.equal(r.code, 1);
  assert.match(r.out, /has no name/);
});

test('lint warns on tags, error workflow, $env, disabled nodes, and pinData; --strict blocks', () => {
  const wf = structuredClone(portable);
  delete wf.tags; wf.settings = {};
  wf.nodes[1].disabled = true;
  wf.nodes[2].parameters.url = '={{ $env.API_BASE }}/orders';
  wf.pinData = { Webhook: [{ json: {} }] };
  const r = run(LINT, [wf]);
  assert.equal(r.code, 0);
  for (const m of [/no tags/, /errorWorkflow is not set/, /reads \$env/, /node is disabled: Set/, /pinData present/]) assert.match(r.out, m);
  assert.equal(run(LINT, [wf], ['--strict']).code, 1);
  assert.equal(run(LINT, [wf], ['--require-tags']).code, 1);
});

test('lint flags a sub-workflow reference by bare id and a token-shaped literal', () => {
  const wf = structuredClone(portable);
  wf.nodes.push({ name: 'Sub', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [600, 0],
    parameters: { workflowId: { __rl: true, mode: 'id', value: 'abc123' } } });
  const r = run(LINT, [wf]);
  assert.match(r.out, /references workflow id abc123 with no cached name/);
  wf.nodes[2].parameters.headers = 'sk-abcdefghijklmnopqrstuvwxyz1234';
  assert.equal(run(LINT, [wf]).code, 1);
  assert.match(run(LINT, [wf]).out, /token-shaped literal/);
});

test('lint --json emits one report per file', () => {
  const r = run(LINT, [portable, portable], ['--json']);
  const parsed = JSON.parse(r.out);
  assert.equal(parsed.reports.length, 2);
  assert.equal(parsed.blocked, false);
});

// ---------------------------------------------------------------- wf-diff and textconv

test('wf-diff treats a moved node as equivalent and a changed parameter as a difference', () => {
  const moved = structuredClone(goodWorkflow);
  moved.nodes[1].position = [999, 999];
  assert.equal(run(WFDIFF, [goodWorkflow, moved]).code, 0);
  const changed = structuredClone(goodWorkflow);
  changed.nodes[1].parameters = { mode: 'manual' };
  const r = run(WFDIFF, [goodWorkflow, changed]);
  assert.equal(r.code, 1);
  assert.match(r.out, /parameters differ: Set/);
});

test('wf-diff names a rewired connection and a node present on one side', () => {
  const b = structuredClone(goodWorkflow);
  b.nodes.push({ name: 'Extra', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} });
  b.connections.Webhook.main[0][0].node = 'Extra';
  const r = run(WFDIFF, [goodWorkflow, b]);
  assert.match(r.out, /node only in B: Extra/);
  assert.match(r.out, /connections differ/);
});

test('textconv renders normalized behavior without positions', () => {
  const r = run(TEXTCONV, [goodWorkflow]);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /position/);
  assert.match(r.out, /"parameters"/);
  assert.match(r.out, /"active": false/);
});

test('textconv falls back to raw text on a broken file', () => {
  const r = run(TEXTCONV, ['{ not json']);
  assert.equal(r.code, 0);
  assert.match(r.out, /not json/);
});
