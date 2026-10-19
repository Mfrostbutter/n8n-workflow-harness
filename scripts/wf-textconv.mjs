// git textconv driver: renders a workflow JSON as its normalized behavior so
// `git diff` and PR reviews show parameter and wiring changes, not a node that
// was dragged across the canvas. Never changes the file on disk.
//
// Wire it once per clone (new-engagement.sh does this):
//   git config diff.n8n-workflow.textconv "node scripts/wf-textconv.mjs"
// with .gitattributes carrying:
//   workflows/**/*.json diff=n8n-workflow
//
// Usage: node scripts/wf-textconv.mjs <file.json>
import { readFileSync } from 'node:fs';
import { normalize } from './lib.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: wf-textconv.mjs <file.json>'); process.exit(2); }
let wf;
try {
  wf = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  // Fall back to the raw text so a broken file still diffs as text.
  process.stdout.write(readFileSync(file, 'utf8'));
  process.exit(0);
}
const n = normalize(wf);
// Keep the operational fields next to the behavior so a review sees them.
const view = { active: wf.active ?? false, tags: (wf.tags ?? []).map((t) => (typeof t === 'string' ? t : t?.name)), ...n };
process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
