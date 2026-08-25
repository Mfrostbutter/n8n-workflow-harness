// Generates the editor instruction files from ONE source, so four copies of the
// same rules cannot drift apart.
//
// Source of truth:
//   CLAUDE.md              the operating contract (hand-maintained)
//   .claude/skills/*/      skill names and descriptions, read from frontmatter
//
// Generated:
//   AGENTS.md                          cross-tool standard (Codex, Cursor, Zed, ...)
//   .github/copilot-instructions.md    GitHub Copilot in VS Code
//   .cursor/rules/n8n-harness.mdc      Cursor project rule
//   .windsurf/rules/n8n-harness.md     Windsurf
//
// Usage:
//   node scripts/gen-editor-configs.mjs           write the files
//   node scripts/gen-editor-configs.mjs --check   exit 1 if any is stale
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECK = process.argv.includes('--check');

const BANNER = (src) =>
  `<!-- GENERATED FILE. Do not edit.\n     Source: ${src}\n     Regenerate: npm run gen:editors -->`;

// --- Read the contract out of CLAUDE.md -------------------------------------
const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');

function section(title) {
  // Grabs one "## title" block, without its heading.
  const re = new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm');
  const m = claude.match(re);
  if (!m) throw new Error(`CLAUDE.md is missing the "## ${title}" section`);
  return m[1].trim();
}

const rules = section('Non-negotiables');
const order = section('Working order for any change');
const data = section('Data handling');

// --- Read the skills, so routing can never drift from what is installed -----
/**
 * Pulls `description` out of YAML frontmatter, handling both a plain scalar and
 * a block scalar (`>-`, `>`, `|-`, `|`) whose text continues on indented lines.
 * The skills use both forms, and a naive line match yields the literal ">-".
 */
function frontmatterDescription(fm) {
  const lines = fm.split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i === -1) return '';
  const first = lines[i].replace(/^description:\s*/, '').trim();

  let text;
  if (/^[|>][-+]?\d*$/.test(first)) {
    // Block scalar: take the following more-indented lines.
    const buf = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') { buf.push(''); continue; }
      if (!/^\s+/.test(lines[j])) break;
      buf.push(lines[j].trim());
    }
    text = buf.join(' ').trim();
  } else {
    text = first.replace(/^["']|["']$/g, '');
  }

  // First sentence is enough for a routing table. Avoid splitting on the dot in
  // a node type such as "n8n-nodes-base.set" or a version such as "3.5".
  const m = text.match(/^([\s\S]*?[.!?])(\s+[A-Z(]|$)/);
  return (m ? m[1] : text).replace(/\s+/g, ' ').trim();
}

const SKILLS_DIR = join(ROOT, '.claude', 'skills');
function readSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  const out = [];
  for (const name of readdirSync(SKILLS_DIR).sort()) {
    const f = join(SKILLS_DIR, name, 'SKILL.md');
    if (!existsSync(f)) continue;
    const txt = readFileSync(f, 'utf8');
    const fm = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let desc = '';
    if (fm) desc = frontmatterDescription(fm[1]);
    out.push({ name, desc });
  }
  return out;
}
const skills = readSkills();

const skillTable = skills.length
  ? skills
      .map((s) => `| \`${s.name}\` | \`.claude/skills/${s.name}/SKILL.md\` | ${s.desc} |`)
      .join('\n')
  : '| _none found_ | | |';

// --- Shared body ------------------------------------------------------------
const body = (toolName, skillNote) => `
# n8n workflow harness

Instructions for ${toolName} working in this repository.

## What this repo is

A harness for building n8n workflows. Workflow JSON under \`workflows/<env>/\` is
the source of truth; the n8n canvas is a view of it.

Two MCP servers, both running the **n8n-mcp** package pinned in
\`package.json\` (https://github.com/czlonkowski/n8n-mcp):

- **\`n8n-docs\`** — node schemas, validators, 2,700+ templates. No credentials,
  cannot reach an instance. Tools: \`search_nodes\`, \`get_node\`,
  \`validate_node\`, \`validate_workflow\`, \`search_templates\`, \`get_template\`,
  \`tools_documentation\`.
- **\`n8n\`** — workflow CRUD, executions, credentials, audit against
  \`N8N_API_URL\`. Every tool is prefixed \`n8n_\`. Touches a real instance.

If the MCP tools are unavailable, say so rather than writing n8n JSON from
memory. Guessed node parameters are the failure this harness exists to prevent.

## Non-negotiables

${rules}

## Working order for any change

${order}

## The skills library

${skillNote}

| Skill | Read this file | Covers |
|---|---|---|
${skillTable}

## Toolkit

Deterministic checks in \`scripts/\`, Node built-ins only. Ground truth when
the model and reality disagree.

| Command | When |
|---|---|
| \`npm run smoke\` | Does the n8n-mcp server actually answer? 7 tools = docs mode, 25 = credentials reached it |
| \`./scripts/verify-setup.sh\` | Whole-clone preflight, no instance needed |
| \`./scripts/doctor.sh [env]\` | Start of a session, or when something feels wrong |
| \`./scripts/health-check.sh [hours]\` | Before diagnosing anything |
| \`./scripts/drift-check.sh [env]\` | Before trusting \`workflows/\`. Exit 1 on drift |
| \`./scripts/export-all.sh [env]\` | Before every change. The rollback point |
| \`./scripts/validate.sh <file>\` | Before every deploy |

## Data handling

${data}

## Style

Terse. Lead with the action or the answer. Code comments say what a thing is and
what it does, not why; rationale goes in the commit message.
`.trim();

// --- Per-editor output ------------------------------------------------------
const CLAUDE_SKILL_NOTE = `These 20 skills carry the rules that keep generated workflows correct. **Read
the relevant \`SKILL.md\` before acting** — not after something fails. This
editor does not load them automatically, so open the file yourself: they are
plain markdown in this repo. \`using-n8n-mcp-skills\` is the router and says
which specialist owns a decision.`;

const targets = [
  {
    path: 'AGENTS.md',
    content: `${BANNER('CLAUDE.md + .claude/skills/')}\n\n${body('any AI coding agent (Codex, Cursor, Zed, Gemini CLI, and others that read AGENTS.md)', CLAUDE_SKILL_NOTE)}\n`,
  },
  {
    path: '.github/copilot-instructions.md',
    content: `${BANNER('CLAUDE.md + .claude/skills/')}\n\n${body('GitHub Copilot in VS Code', CLAUDE_SKILL_NOTE)}\n`,
  },
  {
    path: '.cursor/rules/n8n-harness.mdc',
    content: `---
description: n8n workflow harness contract - MCP tool usage, validation discipline, and the skills library
alwaysApply: true
---

${BANNER('CLAUDE.md + .claude/skills/')}

${body('Cursor', CLAUDE_SKILL_NOTE)}
`,
  },
  {
    path: '.windsurf/rules/n8n-harness.md',
    content: `---
trigger: always_on
description: n8n workflow harness contract
---

${BANNER('CLAUDE.md + .claude/skills/')}

${body('Windsurf', CLAUDE_SKILL_NOTE)}
`,
  },
];

let stale = 0;
for (const t of targets) {
  const abs = join(ROOT, t.path);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (current === t.content) {
    if (!CHECK) console.log(`  unchanged  ${t.path}`);
    continue;
  }
  if (CHECK) {
    console.error(`  STALE      ${t.path}`);
    stale++;
    continue;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, t.content, 'utf8');
  console.log(`  ${current === null ? 'created' : 'updated'}    ${t.path}`);
}

if (CHECK) {
  if (stale) {
    console.error(`\n${stale} file(s) out of date. Run: npm run gen:editors`);
    process.exit(1);
  }
  console.log('  editor instruction files are in sync');
} else {
  console.log(`\n${targets.length} files generated from CLAUDE.md and ${skills.length} skills.`);
}
