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

test('Copilot names MCP tools <server>-<tool>: deny on delete, deny on delete actions, ask on pull', () => {
  const cp = (toolName, toolArgs) => ({ sessionId: 's', timestamp: 1, cwd: '/x', toolName, toolArgs });
  const del = run(cp('n8n-n8n_delete_workflow', { id: '1' }));
  assert.equal(del.status, 0);
  assert.equal(JSON.parse(del.stdout).permissionDecision, 'deny');
  assert.match(JSON.parse(del.stdout).permissionDecisionReason, /Archive, do not delete/);
  const folder = run(cp('n8n-n8n_manage_folders', { action: 'delete', folderId: 'f' }));
  assert.equal(JSON.parse(folder.stdout).permissionDecision, 'deny');
  const pull = run(cp('powershell', { command: 'npx n8n-cli source-control pull', description: 'pull', initial_wait: 120 }));
  assert.equal(JSON.parse(pull.stdout).permissionDecision, 'ask');
  assert.match(JSON.parse(pull.stdout).permissionDecisionReason, /overwrites local workflows/);
  const read = run(cp('n8n-n8n_get_workflow', { id: '1' }));
  assert.equal(read.status, 0);
  assert.equal(read.stdout, '');
});

test('Copilot preMcpToolCall shape (bare tool name, serverName, arguments) is denied on delete', () => {
  const r = run({ toolCallId: 'n8n-n8n_delete_workflow:23', serverName: 'n8n', toolName: 'n8n_delete_workflow', arguments: { id: 'q' }, sessionId: 's', timestamp: 1, cwd: '/x' });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).permissionDecision, 'deny');
  const act = run({ toolCallId: 'x', serverName: 'n8n', toolName: 'n8n_manage_credentials', arguments: { action: 'delete', id: 'c' }, sessionId: 's', timestamp: 1, cwd: '/x' });
  assert.equal(JSON.parse(act.stdout).permissionDecision, 'deny');
});

test('Copilot SDK batched toolCalls: strictest verdict across the batch', () => {
  const r = run({ sessionId: 's', cwd: '/x', toolCalls: [
    { id: 'view:1', name: 'view', args: { path: '/x/AGENTS.md' } },
    { id: 'n8n-n8n_delete_workflow:2', name: 'n8n-n8n_delete_workflow', args: { id: 'q' } },
  ] });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).permissionDecision, 'deny');
  const ok = run({ sessionId: 's', cwd: '/x', toolCalls: [{ id: 'view:1', name: 'view', args: { path: '/x/AGENTS.md' } }] });
  assert.equal(ok.stdout, '');
});

// Skill gate. Each test uses its own session id so the per-session state file starts empty.
const sid = () => `guard-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CODE_WF = { name: 'x', nodes: [{ name: 'Code', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: 'return $input.all();' } }], connections: {} };
const PY_WF = { name: 'x', nodes: [{ name: 'Code', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { language: 'python', pythonCode: 'return _input.all()' } }], connections: {} };
const TOOL_WF = { name: 'x', nodes: [{ name: 'T', type: '@n8n/n8n-nodes-langchain.toolCode', typeVersion: 1, parameters: { jsCode: 'return "x"' } }], connections: {} };
const PLAIN_WF = { name: 'x', nodes: [{ name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 3.5, parameters: {} }], connections: {} };
const cl = (session, tool, input) => ({ session_id: session, cwd: '/x', transcript_path: '/t', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
const cp = (session, toolName, toolArgs) => ({ sessionId: session, timestamp: 1, cwd: '/x', toolName, toolArgs });

test('skill gate (Claude shape): a Code-node write is denied until the skill was loaded; plain writes pass', () => {
  const s = sid();
  const plain = run(cl(s, 'mcp__n8n__n8n_create_workflow', PLAIN_WF));
  assert.equal(plain.status, 0, plain.stderr);
  const first = run(cl(s, 'mcp__n8n__n8n_create_workflow', CODE_WF));
  assert.equal(first.status, 2);
  assert.match(first.stderr, /Load the n8n-code-javascript skill first/);
  const load = run(cl(s, 'Skill', { skill: 'n8n-code-javascript' }));
  assert.equal(load.status, 0);
  const second = run(cl(s, 'mcp__n8n__n8n_create_workflow', CODE_WF));
  assert.equal(second.status, 0, second.stderr);
  const partial = run(cl(s, 'mcp__n8n__n8n_update_partial_workflow', { id: '1', operations: [{ type: 'updateNode', nodeName: 'Code', updates: { parameters: { jsCode: '// x\nreturn []' } } }] }));
  assert.equal(partial.status, 0, partial.stderr);
});

test('skill gate: reading the SKILL.md counts as a load; Python and Code Tool map to their own skills', () => {
  const s = sid();
  const py = run(cl(s, 'mcp__n8n__n8n_create_workflow', PY_WF));
  assert.equal(py.status, 2);
  assert.match(py.stderr, /n8n-code-python/);
  assert.doesNotMatch(py.stderr, /n8n-code-javascript/);
  run(cl(s, 'Read', { file_path: 'M:\\repo\\.agents\\skills\\n8n-code-python\\SKILL.md' }));
  assert.equal(run(cl(s, 'mcp__n8n__n8n_create_workflow', PY_WF)).status, 0);
  const tool = run(cl(s, 'mcp__n8n__n8n_create_workflow', TOOL_WF));
  assert.equal(tool.status, 2);
  assert.match(tool.stderr, /n8n-code-tool/);
  run(cl(s, 'Read', { file_path: '/repo/.claude/skills/n8n-code-tool/SKILL.md' }));
  assert.equal(run(cl(s, 'mcp__n8n__n8n_create_workflow', TOOL_WF)).status, 0);
});

test('skill gate (Copilot shape): deny JSON names the skill, the skill tool unlocks it, reads via view count', () => {
  const s = sid();
  const first = run(cp(s, 'n8n-n8n_create_workflow', CODE_WF));
  assert.equal(first.status, 0);
  assert.equal(JSON.parse(first.stdout).permissionDecision, 'deny');
  assert.match(JSON.parse(first.stdout).permissionDecisionReason, /n8n-code-javascript/);
  run(cp(s, 'skill', { skill: 'n8n-code-javascript' }));
  assert.equal(run(cp(s, 'n8n-n8n_create_workflow', CODE_WF)).stdout, '');
  const s2 = sid();
  run(cp(s2, 'view', { path: 'm:\\Code\\repo\\.agents\\skills\\n8n-code-javascript\\SKILL.md' }));
  assert.equal(run(cp(s2, 'n8n-n8n_update_full_workflow', { id: '1', ...CODE_WF })).stdout, '');
});

test('skill gate is off for hooks that cannot see skill loads, without a session id, and with N8N_GUARD_SKILL_GATE=0', () => {
  const cursor = run({ hook_event_name: 'beforeMCPExecution', tool_name: 'n8n_create_workflow', tool_input: CODE_WF });
  assert.equal(cursor.status, 0);
  assert.equal(cursor.stdout, '');
  const noSession = run({ cwd: '/x', hook_event_name: 'PreToolUse', tool_name: 'mcp__n8n__n8n_create_workflow', tool_input: CODE_WF });
  assert.equal(noSession.status, 0);
  const off = run(cl(sid(), 'mcp__n8n__n8n_create_workflow', CODE_WF), { N8N_GUARD_SKILL_GATE: '0' });
  assert.equal(off.status, 0);
});

test('session-start hook answers Copilot with top-level additionalContext and Claude Code with the envelope', () => {
  const HOOK = join(dirname(GUARD), '..', '.claude', 'hooks', 'session-start.mjs');
  const cpOut = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ sessionId: 's', source: 'new', cwd: '/x', timestamp: 1 }), encoding: 'utf8' });
  const cpJson = JSON.parse(cpOut.stdout);
  assert.ok(cpJson.additionalContext && !cpJson.hookSpecificOutput);
  const clOut = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: 's', source: 'startup', hook_event_name: 'SessionStart' }), encoding: 'utf8' });
  assert.ok(JSON.parse(clOut.stdout).hookSpecificOutput.additionalContext);
  const empty = spawnSync(process.execPath, [HOOK], { input: '{}', encoding: 'utf8' });
  assert.ok(JSON.parse(empty.stdout).hookSpecificOutput.additionalContext);
});
