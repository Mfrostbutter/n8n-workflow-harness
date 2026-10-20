// Snapshot every workflow from an instance into workflows/<env>/. The undo point.
// Run and commit before any change. No AI required.
// Usage: node scripts/export-all.mjs [env]   (default dev)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_DIR, resolveTarget, api, apiAll, slugify, sortKeys, fail } from './lib.mjs';

// Placement keys live only in the repo copy: the API never returns them, so an
// export carries them over from the file it is about to replace.
function placementOf(file) {
  if (!existsSync(file)) return {};
  try {
    const prev = JSON.parse(readFileSync(file, 'utf8'));
    const out = {};
    if (typeof prev.project === 'string' && prev.project.trim()) out.project = prev.project;
    if (typeof prev.folder === 'string' && prev.folder.trim()) out.folder = prev.folder;
    return out;
  } catch { return {}; }
}

const envName = process.argv[2] ?? 'dev';
const target = resolveTarget(envName);
const outDir = join(KIT_DIR, 'workflows', envName);

console.log(`exporting from ${target.url} -> workflows/${envName}/`);
mkdirSync(outDir, { recursive: true });

// The list endpoint omits nodes and connections, so fetch each workflow by id.
const list = await apiAll(target, '/workflows');
if (!list.length) fail('no workflows returned. Check the URL, the key, and that the public API is enabled.', 1);

let count = 0;
const seen = new Map();
for (const { id } of list) {
  const { status, body } = await api(target, `/workflows/${id}`);
  if (status !== 200 || !body?.name) {
    console.log(`  skipped ${id} (HTTP ${status})`);
    continue;
  }

  // Two workflows can share a name; keep both rather than silently overwriting.
  let slug = slugify(body.name);
  const n = (seen.get(slug) ?? 0) + 1;
  seen.set(slug, n);
  if (n > 1) slug = `${slug}-${id}`;

  const file = join(outDir, `${slug}.json`);
  const snapshot = sortKeys({
    id: body.id ?? id,
    name: body.name,
    nodes: body.nodes ?? [],
    connections: body.connections ?? {},
    settings: body.settings ?? {},
    active: body.active ?? false,
    tags: (body.tags ?? []).map((t) => t.name ?? t),
    ...placementOf(file),
  });

  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`  ${slug}.json`);
  count += 1;
}

console.log(`\nexported ${count} workflows\n`);
console.log('Now commit. This is the rollback point:');
console.log(`  git add -A && git commit -m 'snapshot ${envName} before <change>'\n`);
console.log('NOTE: workflow JSON embeds credential REFERENCES and internal hostnames.');
console.log('It does not contain credential values. Review a diff before pushing anywhere public.');
