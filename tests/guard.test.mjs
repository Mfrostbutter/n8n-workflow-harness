// Contract tests for scripts/guard-pre-tool.mjs: allow, deny with the
// alternative named, ask as JSON in the Claude shape, deny for tools that
// cannot ask, malformed input exits clean. Run: node --test tests/guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'guard-pre-tool.mjs');
const run = (payload, env = {}) => {
  const e = { ...process.env };
  delete e.N8N_API_URL;
  delete e.N8N_API_URL_PROD;
  Object.assign(e, env);
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync(process.execPath, [GUARD], { input, encoding: 'utf8', env: e });
};
const claude = (tool, input) => ({ session_id: 's', cwd: '/x', transcript_path: '/t', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
const sh = (c) => claude('Bash', { command: c });
const DEL = ['workflow', 'delete'].join(' ');

test('allows dev deploys, reads, lists and dry runs', () => {
  const allowed = [
    sh('./scripts/deploy.sh workflows/dev/x.json dev'),
    sh('n8n-cli workflow list'),
    sh('n8n-cli promotion-connection list-changes p apply'),
    claude('mcp__n8n__n8n_get_workflow', { id: '1' }),
    claude('mcp__n8n__n8n_manage_credentials', { action: 'list' }),
  ];
  for (const p of allowed) {
    const r = run(p);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});

test('denies deletes and names the archive alternative', () => {
  const denied = [
    claude(['mcp__n8n__n8n', 'delete', 'workflow'].join('_'), { id: '1' }),
    claude('mcp__n8n-official__delete_data_table_column', {}),
    claude('mcp__n8n__n8n_manage_credentials', { action: 'delete' }),
    sh(`echo hi && n8n-cli ${DEL} 1`),
  ];
  for (const p of denied) {
    const r = run(p);
    assert.equal(r.status, 2, JSON.stringify(p));
    assert.match(r.stderr, /BLOCKED by guard-pre-tool/);
    assert.match(r.stderr, /Archive/);
  }
  assert.match(run(sh(['docker', 'rm', '-f', 'n8n'].join(' '))).stderr, /docker stop/);
});

test('asks on prod deploys and promotions in the Claude shape', () => {
  const asks = [
    [sh('./scripts/deploy.sh workflows/prod/x.json prod --confirm'), /promotion path/],
    [sh('n8n-cli promotion-connection apply c1'), /reviewed commit/],
    [sh('n8n-cli source-control pull'), /overwrites/],
  ];
  for (const [p, hint] of asks) {
    const r = run(p);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.equal(out.permissionDecision, 'ask');
    assert.match(out.permissionDecisionReason, hint);
  }
});

test('asks on a workflow write when the session points at prod', () => {
  const write = claude('mcp__n8n__n8n_update_partial_workflow', { id: '1' });
  const r = run(write, { N8N_API_URL: 'https://prod.x/', N8N_API_URL_PROD: 'https://prod.x' });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /production URL/);
  const ok = run(write, { N8N_API_URL: 'https://dev.x', N8N_API_URL_PROD: 'https://prod.x' });
  assert.equal(ok.stdout, '');
});

test('Cursor shape returns deny JSON instead of ask; Copilot and Devin shapes exit 2', () => {
  const cur = run({ hook_event_name: 'beforeShellExecution', command: './scripts/deploy.sh x.json prod', cwd: '/x' });
  assert.equal(cur.status, 0);
  assert.equal(JSON.parse(cur.stdout).permission, 'deny');
  const dev = run({ tool_info: { tool_name: 'run_command', command: `n8n-cli ${DEL} 1` } });
  assert.equal(dev.status, 2);
});

test('Copilot shape answers with permissionDecision JSON and exit 0 (a non-zero exit is an error there)', () => {
  const deny = run({ sessionId: 's', timestamp: 1, cwd: '/x', toolName: ['n8n', 'delete', 'workflow'].join('_'), toolArgs: { id: '1' } });
  assert.equal(deny.status, 0);
  assert.equal(deny.stderr, '');
  const d = JSON.parse(deny.stdout);
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /Archive/);
  const ask = run({ toolName: 'bash', toolArgs: { command: 'n8n-cli promotion-connection apply c1' } });
  assert.equal(ask.status, 0);
  assert.equal(JSON.parse(ask.stdout).permissionDecision, 'ask');
  const allow = run({ toolName: 'n8n_get_workflow', toolArgs: { id: '1' } });
  assert.equal(allow.status, 0);
  assert.equal(allow.stdout, '');
});

test('malformed input exits clean', () => {
  assert.equal(run('{ not json').status, 0);
  assert.equal(run('').status, 0);
});

test('asks before a forced credential transfer, allows the plain one', () => {
  const forced = run(sh('./scripts/organize.sh credentials "Shared Postgres" --to "Acme Corp" --force'));
  assert.equal(forced.status, 0);
  assert.equal(JSON.parse(forced.stdout).hookSpecificOutput.permissionDecision, 'ask');
  const plain = run(sh('./scripts/organize.sh credentials "Shared Postgres" --to "Acme Corp"'));
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout, '');
});
