// Pre-tool guard for every agent that runs hooks: Claude Code, Codex, Cursor,
// GitHub Copilot, Devin Desktop. One script, payload shape detected at runtime.
//
// deny  (exit 2, message on stderr): delete tools and delete commands.
//       Archive instead: export, commit, deactivate, rename with an ARCHIVED- prefix.
// ask   (Claude Code and Codex: permissionDecision "ask"; others: deny, since
//       they cannot ask): deploy or promote to staging or prod, promotion apply,
//       source-control pull, CLI activate, and any workflow write while
//       N8N_API_URL equals N8N_API_URL_PROD.
// allow everything else. Fails open on malformed input.
//
// Wired from: .claude/settings.json (PreToolUse), .codex/hooks.json,
// .cursor/hooks.json, .github/hooks/n8n-guard.json, .devin/hooks.json.
// Shapes checked against each vendor's docs on 2026-10-19; the Claude Code
// shape is tested end to end, the others follow the documented fields.
import { readFileSync } from 'node:fs';

const ARCHIVE = 'Archive, do not delete: export-all and commit, deactivate, rename with an ARCHIVED- prefix (archive_workflow or n8n_update_partial_workflow). Deletion is a separate decision made later.';
const DENY_TOOL = /(^|__)(n8n_delete_workflow|delete_workflow|delete_data_table(_column)?|delete_agent)$/;
const DENY_ACTIONS = {
  n8n_manage_credentials: ['delete'],
  n8n_manage_datatable: ['delete', 'deleteColumn', 'deleteTable'],
  n8n_manage_folders: ['delete'],
  n8n_manage_agents: ['delete'],
};
const DENY_CMD = [
  [/\bn8n-cli\s+(workflow|credential|project|data-table|tag|variable)\s+delete\b/, ARCHIVE],
  [/\b(docker|podman)\s+(container\s+)?rm\b/, 'Stop the container (docker stop) and rename it; removal is a separate decision.'],
];
const ASK_CMD = [
  [/\b(deploy\.sh|deploy_workflow\.py)\b[^|;&]*\b(prod|production|staging)\b/, 'Deploy to a non-dev environment. The promotion path, not an ad-hoc write, moves changes to staging and prod.'],
  [/\bn8n-cli\s+promotion-connection\s+(promote|apply|apply-continue|promote-selection|apply-selection|apply-selection-continue)\b/, 'A promotion writes to a Git branch or overwrites a target instance. Confirm the reviewed commit and the rollback snapshot exist.'],
  [/\bn8n-cli\s+source-control\s+pull\b/, 'A source-control pull overwrites local workflows with Git. Confirm export-all ran first.'],
  [/\bn8n-cli\s+workflow\s+activate\b/, 'Activating over the CLI skips validate-and-verify. Confirm validation and a read-back happened.'],
];
const ASK_TOOL_ON_PROD = /(^|__)(publish_workflow|n8n_create_workflow|n8n_update_(full|partial)_workflow|n8n_deploy_template|n8n_autofix_workflow|update_workflow|create_workflow_from_code)$/;

const splitShell = (c) => String(c).split(/&&|\|\||;|\n/).filter((p) => p.trim());
const onProd = () => {
  const u = (process.env.N8N_API_URL || '').replace(/\/+$/, '');
  const p = (process.env.N8N_API_URL_PROD || '').replace(/\/+$/, '');
  return Boolean(u && p && u === p);
};

/** Normalizes the vendor payload shapes to {flavor, tool, input, command}. */
export function parsePayload(p) {
  const empty = { flavor: 'unknown', tool: '', input: {}, command: '' };
  if (!p || typeof p !== 'object') return empty;
  // Claude Code and Codex: tool_name + tool_input. Cursor preToolUse uses the same keys.
  if (p.tool_name !== undefined) {
    const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
    const flavor = p.hook_event_name && /^[a-z]/.test(String(p.hook_event_name)) ? 'cursor' : 'claude';
    return { flavor, tool: String(p.tool_name), input, command: String(input.command ?? '') };
  }
  // Cursor beforeShellExecution / beforeMCPExecution.
  if (p.command !== undefined && p.hook_event_name) return { flavor: 'cursor', tool: 'Bash', input: p, command: String(p.command) };
  // Copilot: toolName + toolArgs.
  if (p.toolName !== undefined || p.toolArgs !== undefined) {
    const input = p.toolArgs && typeof p.toolArgs === 'object' ? p.toolArgs : {};
    return { flavor: 'copilot', tool: String(p.toolName ?? ''), input, command: String(input.command ?? '') };
  }
  // Devin: tool_info with the command or tool name.
  if (p.tool_info && typeof p.tool_info === 'object') {
    const ti = p.tool_info;
    return { flavor: 'devin', tool: String(ti.tool_name ?? ti.name ?? ''), input: ti, command: String(ti.command ?? '') };
  }
  return empty;
}

export function decide({ tool, input, command }) {
  const short = tool.includes('__') ? tool.split('__').pop() : tool;
  if (DENY_TOOL.test(tool)) return ['deny', ARCHIVE];
  if (DENY_ACTIONS[short] && DENY_ACTIONS[short].includes(String(input.action ?? ''))) return ['deny', ARCHIVE];
  if (ASK_TOOL_ON_PROD.test(tool) && onProd()) return ['ask', 'N8N_API_URL is the production URL. A build-session write to prod is not the promotion path. Confirm, or point the session at dev.'];
  const clauses = splitShell(command);
  for (const clause of clauses) for (const [rx, msg] of DENY_CMD) if (rx.test(clause)) return ['deny', msg];
  for (const clause of clauses) for (const [rx, msg] of ASK_CMD) if (rx.test(clause)) return ['ask', msg];
  return ['allow', ''];
}

if (process.argv[1] && /guard-pre-tool\.mjs$/.test(process.argv[1])) {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const parsed = parsePayload(payload);
  const [verdict, msg] = decide(parsed);
  if (verdict === 'deny') {
    process.stderr.write(`BLOCKED by guard-pre-tool: ${msg}\n`);
    process.exit(2);
  }
  if (verdict === 'ask') {
    if (parsed.flavor === 'cursor') {
      process.stdout.write(JSON.stringify({ permission: 'deny', userMessage: msg, agentMessage: `${msg} Run this step yourself from a terminal.` }));
      process.exit(0);
    }
    if (parsed.flavor !== 'claude') {
      process.stderr.write(`BLOCKED by guard-pre-tool (this tool cannot ask): ${msg} Run this step yourself from a terminal.\n`);
      process.exit(2);
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: msg } }));
  }
  process.exit(0);
}
