// Inventory of node types and typeVersions across workflow JSON. The input to
// an upgrade plan: which node types the estate uses, at which versions, and
// where the same type runs at two versions. Offline, Node built-ins only.
//
// Usage: node scripts/node-inventory.mjs <file.json | dir> [...] [--json]
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const files = [];
for (const a of args.filter((x) => !x.startsWith('--'))) {
  if (!existsSync(a)) { console.error(`no such file: ${a}`); process.exit(2); }
  if (statSync(a).isDirectory()) for (const f of readdirSync(a).sort()) { if (f.endsWith('.json')) files.push(join(a, f)); }
  else files.push(a);
}
if (!files.length) { console.error('usage: node-inventory.mjs <file.json | dir> [...] [--json]'); process.exit(2); }

const types = new Map(); // type -> Map(version -> [{workflow,node}])
const credTypes = new Map();
let community = 0;
for (const f of files) {
  let wf;
  try { wf = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  for (const n of wf.nodes ?? []) {
    const t = String(n.type ?? '');
    if (t.endsWith('stickyNote')) continue;
    if (!t.startsWith('n8n-nodes-base.') && !t.startsWith('@n8n/')) community++;
    const v = String(n.typeVersion ?? '?');
    if (!types.has(t)) types.set(t, new Map());
    const byV = types.get(t);
    if (!byV.has(v)) byV.set(v, []);
    byV.get(v).push({ workflow: wf.name ?? f, node: n.name });
    for (const c of Object.keys(n.credentials ?? {})) credTypes.set(c, (credTypes.get(c) ?? 0) + 1);
  }
}

const rows = [...types.entries()].map(([type, byV]) => {
  const versions = [...byV.keys()].sort((a, b) => Number(a) - Number(b));
  const count = [...byV.values()].reduce((s, l) => s + l.length, 0);
  return { type, versions, count, split: versions.length > 1, uses: Object.fromEntries([...byV.entries()].map(([v, l]) => [v, l])) };
}).sort((a, b) => b.count - a.count);

if (JSON_OUT) {
  console.log(JSON.stringify({ files: files.length, nodeTypes: rows.length, communityNodes: community, credentialTypes: Object.fromEntries(credTypes), rows }, null, 2));
} else {
  console.log(`${files.length} workflow file(s), ${rows.length} node type(s), ${community} community node instance(s)\n`);
  console.log('count  type                                              typeVersions');
  for (const r of rows) console.log(`${String(r.count).padStart(5)}  ${r.type.padEnd(50)}${r.versions.join(', ')}${r.split ? '   <- mixed versions' : ''}`);
  const split = rows.filter((r) => r.split);
  if (split.length) {
    console.log('\nMixed versions (same type, different typeVersion):');
    for (const r of split) for (const [v, l] of Object.entries(r.uses)) console.log(`  ${r.type} v${v}: ${l.map((x) => `${x.workflow} / ${x.node}`).join('; ')}`);
  }
  if (credTypes.size) console.log(`\nCredential types: ${[...credTypes.entries()].map(([k, n]) => `${k} (${n})`).join(', ')}`);
  console.log('\nNext: for each type, get_node({nodeType, mode: "versions"}) and mode "breaking" on the docs server for the target n8n version.');
}
