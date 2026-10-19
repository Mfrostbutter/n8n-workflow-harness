// Semantic diff of two workflow JSON files. Ignores canvas positions, ids,
// timestamps, pinned data and sticky notes; reports what changed behaviorally.
// Usage: node scripts/wf-diff.mjs <a.json> <b.json> [--json]
// Exit 0 when equivalent, 1 when they differ, 2 on a bad file.
import { readFileSync, existsSync } from 'node:fs';
import { normalize, describeDiff, fail } from './lib.mjs';

const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const JSON_OUT = process.argv.includes('--json');
if (!a || !b) fail('usage: wf-diff.mjs <a.json> <b.json> [--json]');
for (const f of [a, b]) if (!existsSync(f)) fail(`no such file: ${f}`);

const load = (f) => {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { return fail(`${f} is not valid JSON (${e.message})`); }
};
const na = normalize(load(a));
const nb = normalize(load(b));
const lines = describeDiff(na, nb);
const same = JSON.stringify(na) === JSON.stringify(nb);
const out = same ? [] : (lines.length ? lines : ['differs in a field not itemized above']);

if (JSON_OUT) console.log(JSON.stringify({ a, b, equivalent: same, differences: out }, null, 2));
else {
  console.log(`A: ${a}\nB: ${b}\n`);
  for (const l of out) console.log(`  ${l}`);
  console.log(same ? 'RESULT: equivalent' : `\nRESULT: ${out.length} difference(s)`);
}
process.exitCode = same ? 0 : 1;
