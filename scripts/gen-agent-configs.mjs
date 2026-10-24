// Generates the per-tool agent configuration from three sources so the
// repository works in Claude Code, Codex, Cursor, Copilot/VS Code, Devin and
// JetBrains without four hand-maintained copies.
//
//   AGENTS.md        -> CLAUDE.md (stub, only if absent), .aiassistant/rules/engagement.md
//   .mcp.json        -> .vscode/mcp.json, .cursor/mcp.json, .codex/config.toml
//   .agents/skills/  -> .claude/skills/<name> (symlink, or copy with --copy)
//
// Usage: node scripts/gen-agent-configs.mjs [--check] [--copy]
//   --check   exit 1 if any generated file is stale (CI)
//   --copy    copy skills instead of symlinking (the default on Windows, or policy)
//   --link    symlink even on Windows (needs core.symlinks=true and Developer Mode)
//
// Windows: a checkout with core.symlinks=false turns the committed symlinks into
// text files. Copies replace them; the symlink entries are marked skip-worktree
// (status stays clean) and .gitignore excludes the copies' contents (add -A
// never stages them). After a pull that changes a skill, run again.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, lstatSync, symlinkSync, rmSync, cpSync, readlinkSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { KIT_DIR } from './lib.mjs';

const CHECK = process.argv.includes('--check');
const COPY = process.argv.includes('--copy') || (process.platform === 'win32' && !process.argv.includes('--link'));
const BANNER = (src) => `<!-- GENERATED from ${src} by scripts/gen-agent-configs.mjs. Edit the source, then regenerate. -->`;
let stale = 0;
let wrote = 0;

function emit(rel, content) {
  const abs = join(KIT_DIR, rel);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (current === content) return;
  if (CHECK) { console.error(`  STALE    ${rel}`); stale++; return; }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  console.log(`  ${current === null ? 'created' : 'updated'}  ${rel}`);
  wrote++;
}

// --- 1. instructions -------------------------------------------------------
const agentsPath = join(KIT_DIR, 'AGENTS.md');
if (!existsSync(agentsPath)) {
  console.error('AGENTS.md is missing. It is the contract every tool reads; write it first.');
  process.exit(2);
}
const agents = readFileSync(agentsPath, 'utf8');

if (!existsSync(join(KIT_DIR, 'CLAUDE.md'))) {
  emit('CLAUDE.md', `@AGENTS.md\n\n## Claude Code only\n\n- Skills load from \`.claude/skills/\` (links into \`.agents/skills/\`; regenerate with \`node scripts/gen-agent-configs.mjs\`).\n- Hooks and permissions live in \`.claude/settings.json\`.\n`);
}
emit('.aiassistant/rules/engagement.md', `---\napply: always\n---\n${BANNER('AGENTS.md')}\n\n${agents}`);

// --- 2. MCP ----------------------------------------------------------------
const mcpPath = join(KIT_DIR, '.mcp.json');
if (existsSync(mcpPath)) {
  const servers = JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers ?? {};
  const VAR = /\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/g;
  const varsIn = (s) => [...String(s).matchAll(VAR)].map((m) => m[1]);
  const isSecret = (v) => /KEY|TOKEN|SECRET|PASSWORD/i.test(v);

  // VS Code: `servers`, secrets prompted through `inputs` and stored by the editor.
  const inputs = new Map();
  const vs = {};
  const sub = (s, f) => String(s).replace(VAR, (_, v) => f(v));
  for (const [name, c] of Object.entries(servers)) {
    const toInput = (v) => {
      if (!inputs.has(v)) inputs.set(v, { type: 'promptString', id: v, description: `${v} (leave blank if not used)`, ...(isSecret(v) ? { password: true } : {}) });
      return `\${input:${v}}`;
    };
    if (c.url) {
      vs[name] = { type: c.type === 'sse' ? 'sse' : 'http', url: sub(c.url, toInput), ...(c.headers ? { headers: Object.fromEntries(Object.entries(c.headers).map(([k, v]) => [k, sub(v, toInput)])) } : {}) };
    } else {
      vs[name] = { type: 'stdio', command: c.command, args: (c.args ?? []).map((a) => sub(a, toInput)), ...(c.env ? { env: Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, sub(v, toInput)])) } : {}) };
    }
  }
  emit('.vscode/mcp.json', `${JSON.stringify({ inputs: [...inputs.values()], servers: vs }, null, 2)}\n`);

  // Cursor: same shape as Claude Code, `${env:VAR}` syntax.
  const cur = {};
  for (const [name, c] of Object.entries(servers)) {
    const e = (s) => sub(s, (v) => `\${env:${v}}`);
    cur[name] = c.url
      ? { url: e(c.url), ...(c.headers ? { headers: Object.fromEntries(Object.entries(c.headers).map(([k, v]) => [k, e(v)])) } : {}) }
      : { command: c.command, args: (c.args ?? []).map(e), ...(c.env ? { env: Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, e(v)])) } : {}) };
  }
  emit('.cursor/mcp.json', `${JSON.stringify({ mcpServers: cur }, null, 2)}\n`);

  // Codex: TOML, no expansion. Secrets by env var NAME; a url that needs a
  // variable cannot be expressed and is written as a comment to fill in.
  const q = (s) => JSON.stringify(String(s));
  const lines = ['# GENERATED from .mcp.json by scripts/gen-agent-configs.mjs. Trusted projects only.', ''];
  for (const [name, c] of Object.entries(servers)) {
    const key = name.replace(/[^A-Za-z0-9_]/g, '_');
    lines.push(`[mcp_servers.${key}]`);
    if (c.url) {
      const uvars = varsIn(c.url);
      if (uvars.length) lines.push(`# url references ${uvars.join(', ')}; Codex does not expand variables. Fill the literal URL:`, `# url = ${q(c.url)}`);
      else lines.push(`url = ${q(c.url)}`);
      const hdr = Object.entries(c.headers ?? {});
      const bearer = hdr.find(([k, v]) => k.toLowerCase() === 'authorization' && /^Bearer \$\{[A-Z0-9_]+\}$/.test(v));
      if (bearer) lines.push(`bearer_token_env_var = ${q(varsIn(bearer[1])[0])}`);
      const envHdr = hdr.filter(([k, v]) => !(bearer && k === bearer[0]) && varsIn(v).length === 1 && /^\$\{[A-Z0-9_]+\}$/.test(v));
      if (envHdr.length) lines.push(`env_http_headers = { ${envHdr.map(([k, v]) => `${q(k)} = ${q(varsIn(v)[0])}`).join(', ')} }`);
      const litHdr = hdr.filter(([k, v]) => !(bearer && k === bearer[0]) && !varsIn(v).length);
      if (litHdr.length) lines.push(`http_headers = { ${litHdr.map(([k, v]) => `${q(k)} = ${q(v)}`).join(', ')} }`);
    } else {
      lines.push(`command = ${q(c.command)}`);
      lines.push(`args = [${(c.args ?? []).map(q).join(', ')}]`);
      const env = Object.entries(c.env ?? {});
      const literal = env.filter(([, v]) => !varsIn(v).length);
      const forward = env.filter(([k, v]) => varsIn(v).length === 1 && varsIn(v)[0] === k);
      const other = env.filter(([k, v]) => varsIn(v).length && !(varsIn(v).length === 1 && varsIn(v)[0] === k));
      if (literal.length) lines.push(`env = { ${literal.map(([k, v]) => `${q(k)} = ${q(v)}`).join(', ')} }`);
      if (forward.length) lines.push(`env_vars = [${forward.map(([k]) => q(k)).join(', ')}]`);
      for (const [k, v] of other) lines.push(`# ${k} = ${q(v)}  (set ${varsIn(v).join(', ')} in the environment and add to env_vars, or write the literal)`);
    }
    lines.push('');
  }
  emit('.codex/config.toml', `${lines.join('\n').trimEnd()}\n`);
}

/** Hides a copy that replaced a tracked symlink from git status and commits. Fails open outside a checkout. */
function skipWorktree(rel) {
  try {
    const entry = execFileSync('git', ['ls-files', '-s', '--', rel], { cwd: KIT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (entry.startsWith('120000')) execFileSync('git', ['update-index', '--skip-worktree', '--', rel], { cwd: KIT_DIR, stdio: 'ignore' });
  } catch { /* not a git checkout, or git missing */ }
}

// --- 3. skills ---------------------------------------------------------------
const srcSkills = join(KIT_DIR, '.agents', 'skills');
if (existsSync(srcSkills)) {
  const dst = join(KIT_DIR, '.claude', 'skills');
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(srcSkills).sort()) {
    const from = join(srcSkills, name);
    if (!existsSync(join(from, 'SKILL.md'))) continue;
    const to = join(dst, name);
    const want = relative(dst, from);
    let ok = false;
    if (existsSync(to) || (() => { try { lstatSync(to); return true; } catch { return false; } })()) {
      const st = lstatSync(to);
      if (st.isSymbolicLink()) ok = !COPY && readlinkSync(to) === want;
      else if (st.isDirectory()) ok = COPY && readFileSync(join(to, 'SKILL.md'), 'utf8') === readFileSync(join(from, 'SKILL.md'), 'utf8');
    }
    if (ok) continue;
    if (CHECK) { console.error(`  STALE    .claude/skills/${name}`); stale++; continue; }
    rmSync(to, { recursive: true, force: true });
    if (COPY) { cpSync(from, to, { recursive: true }); skipWorktree(`.claude/skills/${name}`); }
    else {
      try { symlinkSync(want, to, 'dir'); }
      catch (e) { console.error(`  symlink failed for ${name} (${e.code}); use --copy on this platform`); process.exitCode = 1; continue; }
    }
    console.log(`  ${COPY ? 'copied ' : 'linked '}  .claude/skills/${name}`);
    wrote++;
  }
}

if (CHECK) {
  if (stale) { console.error(`\n${stale} generated file(s) out of date. Run: node scripts/gen-agent-configs.mjs`); process.exit(1); }
  console.log('  agent configs are in sync');
} else {
  console.log(`\n${wrote} file(s) written.`);
}
