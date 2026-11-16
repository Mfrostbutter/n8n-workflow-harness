// Deploys one workflow JSON to an instance over the public API: validate and
// lint gates, PUT by name (create when missing), placement, read-back verify.
// The harness path for a community edition instance, which has no promotions
// or environments; dev only on a licensed one (the promotion path owns prod).
// Never activates: publishing is a separate, reviewed step.
//
// Usage: node scripts/deploy.mjs <workflow.json> [env] [--confirm] [--dry-run] [--allow-host <host>]...
//   env       dev (default), or a named environment with its own N8N_API_URL_<ENV> pair
//   --confirm required for any environment other than dev (the guard asks as well)
//   --dry-run run the gates and print the plan; nothing is written
// Exit 0 deployed and verified, 1 a gate or the verify failed, 2 cannot run.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request, apiAll, fail, ExitSignal, normalize, describeDiff } from './lib.mjs';
import { writeTarget, placeWorkflow, formatReport, placement, SETTINGS_KEYS } from './organize.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const errText = (r) => r.error ?? r.body?.message ?? (r.body ? JSON.stringify(r.body).slice(0, 300) : '');

const USAGE = 'usage: deploy.sh <workflow.json> [env] [--confirm] [--dry-run] [--allow-host <host>]...';

function parseArgs(argv) {
  const args = [...argv];
  const allowHosts = [];
  for (let i = args.indexOf('--allow-host'); i >= 0; i = args.indexOf('--allow-host')) {
    if (i + 1 >= args.length) fail('--allow-host needs a value');
    allowHosts.push(args[i + 1]);
    args.splice(i, 2);
  }
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const pos = args.filter((a) => !a.startsWith('--'));
  if (!pos.length) fail(USAGE);
  return { file: pos[0], env: pos[1] || 'dev', confirm: flags.has('--confirm'), dry: flags.has('--dry-run'), allowHosts };
}

/** Runs a gate script; its output is shown only when it fails. */
function gate(label, script, args) {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: 'utf8' });
  if (r.status === 0) { console.log(`  ${label.padEnd(8)} ok`); return; }
  console.log(`  ${label.padEnd(8)} FAILED\n${(r.stdout + r.stderr).trim().split('\n').map((l) => `    ${l}`).join('\n')}`);
  fail(`${label} gate failed. Fix the file; nothing was written.`, 1);
}

/** The update body the public API accepts: name, nodes, connections, and the settings keys it knows. */
export function updateBody(wf) {
  return {
    name: wf.name, nodes: wf.nodes ?? [], connections: wf.connections ?? {},
    settings: Object.fromEntries(Object.entries(wf.settings ?? {}).filter(([k]) => SETTINGS_KEYS.includes(k))),
  };
}

/** Live workflow to update: the file's id when it exists there, else the one live workflow with the same name. */
export async function findLive(t, wf) {
  if (wf.id) {
    const r = await request(t, 'GET', `/workflows/${wf.id}`);
    if (r.status === 200) return r.body;
  }
  const hits = (await apiAll(t, '/workflows')).filter((w) => w.name === wf.name);
  if (hits.length > 1) fail(`${hits.length} live workflows are named "${wf.name}" (${hits.map((w) => w.id).join(', ')}). Put the right id in the JSON.`, 1);
  return hits[0] ?? null;
}

async function main(argv) {
  const { file, env, confirm, dry, allowHosts } = parseArgs(argv);
  if (!existsSync(file)) fail(`no such file: ${file}`);
  const t = writeTarget(env);
  if (env !== 'dev' && !confirm) fail(`deploy to "${env}" needs --confirm. Dev is the build target; anything else is a promotion and the guard asks before it runs.`);

  let wf;
  try { wf = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { fail(`${file}: not valid JSON (${e.message})`); }
  console.log(`deploy ${file} -> ${t.url} (${env})${dry ? '  [dry run]' : ''}\n`);

  // Gates first: a file that cannot promote does not reach the instance either.
  gate('validate', 'validate.mjs', [file]);
  gate('lint', 'lint-workflow.mjs', [file, '--require-tags', '--require-placement', ...allowHosts.flatMap((h) => ['--allow-host', h])]);

  const live = await findLive(t, wf);
  const body = updateBody(wf);
  console.log(`  ${live ? `update   ${live.id} "${live.name}"` : `create   "${wf.name}" (no live workflow has this name)`}`);
  if (wf.active) console.log('  note     "active": true in the file is ignored; publish is a separate step after the verify');

  let id = live?.id ?? null;
  if (!dry && !id) {
    const r = await request(t, 'POST', '/workflows', body);
    if (!(r.status === 200 || r.status === 201) || !r.body?.id) fail(`create FAILED HTTP ${r.status}: ${errText(r)}`, 1);
    id = r.body.id;
    // The repo copy carries the id from now on: export-all and organize key on it.
    wf.id = id;
    writeFileSync(file, `${JSON.stringify({ id, ...wf }, null, 2)}\n`, 'utf8');
    console.log(`  created  ${id} (id written into ${file})`);
  }

  // Placement does the PUT (transfer first, folder and tags after) with this body.
  if (dry && !id) {
    const { project, folder, tags } = placement(wf);
    console.log(`  place    project ${project}, folder ${folder}, tags [${tags.join(', ')}] (after the create)`);
  } else {
    console.log(formatReport(await placeWorkflow(t, id, wf, { body, dry })));
  }
  if (dry) { console.log('\nDry run. Nothing written.'); return; }

  // Read back and compare behavior, not canvas: nodes, connections, settings.
  const after = await request(t, 'GET', `/workflows/${id}`);
  if (after.status !== 200) fail(`read-back FAILED HTTP ${after.status}: ${errText(after)}`, 1);
  const diff = describeDiff(normalize({ ...wf, name: body.name }), normalize(after.body));
  const want = placement(wf).tags.slice().sort();
  const have = (after.body.tags ?? []).map((x) => x.name ?? x).sort();
  if (JSON.stringify(want) !== JSON.stringify(have)) diff.push(`tags differ: file [${want.join(', ')}], live [${have.join(', ')}]`);
  if (diff.length) fail(`VERIFY FAILED on ${id}: ${diff.join('; ')}. The instance did not store what was sent.`, 1);
  console.log(`\n  verify   ${(after.body.nodes ?? []).length} nodes, connections and settings match the file, tags [${have.join(', ')}]`);
  console.log(`\ndeployed ${id} to ${t.url}. Not activated: run it on ${env}, then publish deliberately.`);
}

if (process.argv[1] && /deploy\.mjs$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { if (!(e instanceof ExitSignal)) fail(e.message); });
}
