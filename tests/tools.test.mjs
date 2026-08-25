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
