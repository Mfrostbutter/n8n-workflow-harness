// n8n credentials from the secret manager, by name, per environment. Node
// built-ins only. Importable (the functions are exported) and a CLI.
//
//   secret-map.sh check  [env]                        map well-formed, every reference resolvable, every type's schema on the target accepts the keys
//   secret-map.sh sync   [env] [--dry-run] [--only <name>...]
//                                                     create the map's credentials that are missing on the target, in their project; write ids to deploy/creds.<env>.json
//   secret-map.sh rotate <name>... [--env <env>]      create a replacement with fresh values, move the ledger id, list the workflows still bound to the old id
//   secret-map.sh verify [env]                        every mapped credential exists on the target with its type and project; the id ledger agrees; unmapped credentials in use
//   secret-map.sh ids    [env]                        refresh deploy/creds.<env>.json from the target by name (retrofit)
//
// The map, deploy/secret-map.<env>.json, is committed. Names and references,
// never a value:
//
//   {
//     "_secrets": {"provider": "infisical", "env": "dev", "path": "/"},
//     "Acme API (dev)": {
//       "type": "httpHeaderAuth",
//       "project": "Acme Corp",
//       "data": {"name": "Authorization", "value": "secret:ACME_API_TOKEN"}
//     }
//   }
//
// "secret:NAME" is read from the secret manager (or from the environment when
// the process already runs under `infisical run`), "env:VAR" from the process
// environment only, anything else is a literal. Values stay in memory; every
// line this tool prints is scrubbed against them, and none goes on a command
// line. The public API cannot update a credential's values, so rotation
// creates a replacement and the workflow rebinds by name.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KIT_DIR, resolveTarget, request, apiAll, fail as libFail } from './lib.mjs';
import { PERSONAL, resolveProject, credentialsIndex, credentialProjects, credentialUsers, writeTarget } from './organize.mjs';

const LEDGER_DIR = join(KIT_DIR, 'deploy');
const SECRET = 'secret:';
const ENV = 'env:';
const values = new Set();

/** Every resolved value that could appear in a message, replaced. */
export function scrub(text) {
  let s = String(text);
  for (const v of values) if (v && s.includes(v)) s = s.split(v).join('[redacted]');
  return s;
}
const out = (msg = '') => console.log(scrub(msg));
const fail = (msg, code = 2) => libFail(scrub(msg), code);
const errText = (r) => r.error ?? r.body?.message ?? (r.body ? JSON.stringify(r.body).slice(0, 300) : '');
const readTarget = (env) => ({ ...resolveTarget(env || 'dev'), env: env || 'dev' });

// ------------------------------------------------------------------ ledger

export const mapPath = (env) => join(LEDGER_DIR, `secret-map.${env}.json`);
export const idsPath = (env) => join(LEDGER_DIR, `creds.${env}.json`);

export function loadMap(env) {
  const p = mapPath(env);
  if (!existsSync(p)) fail(`no secret map for ${env}: write deploy/secret-map.${env}.json (names and references, never values).`);
  let d;
  try { d = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { fail(`${p}: not valid JSON (${e.message})`, 1); }
  const cfg = d._secrets && typeof d._secrets === 'object' ? d._secrets : {};
  const entries = Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_')));
  const problems = [];
  for (const [name, e] of Object.entries(entries)) {
    if (!e || typeof e !== 'object' || !e.type) { problems.push(`'${name}': needs "type"`); continue; }
    if (!e.data || typeof e.data !== 'object' || !Object.keys(e.data).length) problems.push(`'${name}': needs a "data" object`);
    for (const [k, v] of Object.entries(e.data ?? {})) {
      if (typeof v === 'string' && (v.startsWith(SECRET) || v.startsWith(ENV)) && !v.split(':').slice(1).join(':')) problems.push(`'${name}'.${k}: empty reference`);
    }
  }
  if (problems.length) fail(`secret map: ${problems.join('; ')}`, 1);
  return { cfg, entries };
}

export function loadIds(env) {
  const p = idsPath(env);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

export function saveIds(env, ids) {
  mkdirSync(LEDGER_DIR, { recursive: true });
  const sorted = Object.fromEntries(Object.keys(ids).sort().map((k) => [k, ids[k]]));
  writeFileSync(idsPath(env), `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------- resolver

/** {key, kind, name} for every reference in an entry's data. */
export function references(entry) {
  const refs = [];
  for (const [k, v] of Object.entries(entry.data ?? {})) {
    if (typeof v === 'string' && v.startsWith(SECRET)) refs.push({ key: k, kind: 'secret', name: v.slice(SECRET.length) });
    else if (typeof v === 'string' && v.startsWith(ENV)) refs.push({ key: k, kind: 'env', name: v.slice(ENV.length) });
  }
  return refs;
}

function infisicalArgs(cfg) {
  const a = [];
  if (cfg.env) a.push('--env', cfg.env);
  if (cfg.path) a.push('--path', cfg.path);
  if (cfg.projectId) a.push('--projectId', cfg.projectId);
  return a;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 });
  if (r.error) return { status: r.error.code === 'ENOENT' ? 'missing' : 'error', stdout: '', stderr: String(r.error.message) };
  return { status: r.status === 0 ? 'ok' : 'error', stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Names the secret manager holds at the map's env and path. Values are read
 *  into this process and dropped; only the names leave it. null when the
 *  provider cannot list. */
export function secretNames(cfg) {
  if ((cfg.provider ?? 'infisical') !== 'infisical') return null;
  const r = run('infisical', ['secrets', '--output', 'json', '--silent', ...infisicalArgs(cfg)]);
  if (r.status !== 'ok') return null;
  let data;
  try { data = JSON.parse(r.stdout); } catch { return null; }
  const items = Array.isArray(data) ? data : data?.secrets ?? [];
  const names = new Set();
  for (const s of items) {
    if (!s || typeof s !== 'object') continue;
    const key = s.secretKey ?? s.key ?? s.name;
    if (key) names.add(key);
    for (const k of ['secretValue', 'value']) if (s[k]) values.add(String(s[k]));
  }
  return names;
}

/** Splits a command template on spaces, honouring single and double quotes. */
function splitCmd(s) {
  const outp = [];
  let cur = '';
  let q = null;
  for (const c of s) {
    if (q) { if (c === q) q = null; else cur += c; } else if (c === '"' || c === "'") q = c; else if (/\s/.test(c)) { if (cur) { outp.push(cur); cur = ''; } } else cur += c;
  }
  if (cur) outp.push(cur);
  return outp;
}

/** One value, into memory. Environment first (infisical run), then the provider. */
export function fetchSecret(cfg, name) {
  const fromEnv = process.env[name];
  if (fromEnv) { values.add(fromEnv); return fromEnv; }
  const provider = cfg.provider ?? 'infisical';
  let cmd;
  let args;
  if (provider === 'infisical') { cmd = 'infisical'; args = ['secrets', 'get', name, '--plain', '--silent', ...infisicalArgs(cfg)]; }
  else if (provider === 'cmd') {
    const template = process.env.N8N_SECRET_CMD;
    if (!template) fail('provider "cmd" needs N8N_SECRET_CMD, e.g. \'vault kv get -field={name} secret/n8n\'');
    [cmd, ...args] = splitCmd(template).map((a) => a.replaceAll('{name}', name));
  } else return null;
  const r = run(cmd, args);
  if (r.status === 'missing') fail(`${cmd} is not on PATH`);
  const v = r.stdout.trim();
  if (r.status !== 'ok' || !v) return null;
  values.add(v);
  return v;
}

/** The credential's data with every reference replaced. Missing references are
 *  reported by key and reference name, never by value. */
export function resolve(cfg, name, entry) {
  const data = {};
  const missing = [];
  for (const [k, v] of Object.entries(entry.data)) {
    if (typeof v === 'string' && v.startsWith(SECRET)) {
      const ref = v.slice(SECRET.length);
      const val = fetchSecret(cfg, ref);
      if (val === null || val === undefined) missing.push(`${k} <- secret:${ref}`);
      data[k] = val;
    } else if (typeof v === 'string' && v.startsWith(ENV)) {
      const ref = v.slice(ENV.length);
      const val = process.env[ref];
      if (val === undefined) missing.push(`${k} <- env:${ref}`); else values.add(val);
      data[k] = val;
    } else data[k] = v;
  }
  if (missing.length) fail(`'${name}': unresolved ${missing.join('; ')}. Run under \`infisical run --env <env> -- ...\`, or check the name and path in _secrets.`, 1);
  return data;
}

// ------------------------------------------------------------------ target

async function schema(t, type) {
  const r = await request(t, 'GET', `/credentials/schema/${type}`);
  return r.status === 200 ? r.body : null;
}

/** Credentials on the target with this name; narrowed to a project when one is named. */
export function byName(creds, name, project) {
  let hits = [...creds.values()].filter((c) => c.name === name);
  if (project && project.id !== PERSONAL) hits = hits.filter((c) => credentialProjects(c).has(project.id));
  return hits;
}

async function projectFor(t, entry, cache) {
  const pname = String(entry.project ?? PERSONAL).trim() || PERSONAL;
  if (!cache.has(pname)) cache.set(pname, await resolveProject(t, pname));
  return cache.get(pname);
}

async function createCredential(t, name, entry, data, project) {
  const body = { name, type: entry.type, data };
  if (project.id !== PERSONAL) body.projectId = project.id;
  const r = await request(t, 'POST', '/credentials', body);
  if (![200, 201].includes(r.status)) fail(`create FAILED for '${name}' HTTP ${r.status}: ${errText(r)}`, 1);
  return r.body?.id;
}

// ---------------------------------------------------------------- commands

export async function cmdCheck(env) {
  const { cfg, entries } = loadMap(env);
  const t = readTarget(env);
  const names = secretNames(cfg);
  let rc = 0;
  out(`secret map deploy/secret-map.${env}.json -> ${t.url} (${env}); ${Object.keys(entries).length} credential(s); provider ${cfg.provider ?? 'infisical'}`
    + (names ? `, ${names.size} secret(s) listed` : ', listing unavailable (will fetch each)'));
  const schemas = new Map();
  for (const [name, e] of Object.entries(entries)) {
    const issues = [];
    for (const { key, kind, name: ref } of references(e)) {
      if (kind === 'secret') {
        const present = names ? names.has(ref) : fetchSecret(cfg, ref) !== null;
        if (!present && !process.env[ref]) issues.push(`${key}: secret ${ref} not found`);
      } else if (process.env[ref] === undefined) issues.push(`${key}: env ${ref} not set`);
    }
    if (!schemas.has(e.type)) schemas.set(e.type, await schema(t, e.type));
    const sch = schemas.get(e.type);
    if (!sch) issues.push(`type ${e.type}: no schema on the target (unknown type, or the node is not installed)`);
    else {
      const props = new Set(Object.keys(sch.properties ?? {}));
      const unknown = props.size ? Object.keys(e.data).filter((k) => !props.has(k)).sort() : [];
      if (unknown.length) issues.push(`keys not in the ${e.type} schema: ${unknown.join(', ')}`);
      const missingReq = (sch.required ?? []).filter((k) => !(k in e.data)).sort();
      if (missingReq.length) issues.push(`required by ${e.type} but not in data: ${missingReq.join(', ')}`);
    }
    out(`  ${name} (${e.type}, project ${e.project || 'personal'}): ${issues.length ? issues.join('; ') : 'ok'}`);
    if (issues.length) rc = 1;
  }
  out(`\nRESULT: ${rc ? 'findings' : 'ok'}`);
  return rc;
}

export async function cmdSync(env, dry, only) {
  const { cfg, entries } = loadMap(env);
  const t = writeTarget(env);
  const creds = await credentialsIndex(t);
  const ids = loadIds(env);
  const projects = new Map();
  out(`sync deploy/secret-map.${env}.json -> ${t.url} (${env})${dry ? '  [dry run]' : ''}`);
  let created = 0;
  for (const [name, e] of Object.entries(entries)) {
    if (only.size && !only.has(name)) continue;
    const project = await projectFor(t, e, projects);
    const hits = byName(creds, name, project);
    if (hits.length) {
      if (hits.length > 1) { out(`  ${name}: ${hits.length} credentials share this name in '${project.name}'; ids ${hits.map((h) => h.id).join(', ')}. Pick one into deploy/creds.${env}.json by hand.`); continue; }
      if (hits[0].type !== e.type) { out(`  ${name}: exists as ${hits[0].type}, map says ${e.type}. Rename one side.`); continue; }
      if (ids[name] !== hits[0].id) { ids[name] = hits[0].id; out(`  ${name}: exists (${hits[0].id}), id recorded`); } else out(`  ${name}: exists (${hits[0].id})`);
      continue;
    }
    if (dry) {
      const refs = references(e).map((r) => `${r.key}<-${r.kind}:${r.name}`).join(', ') || 'literals only';
      out(`  ${name}: would create ${e.type} in '${project.name}' (${refs})`);
      continue;
    }
    const data = resolve(cfg, name, e);
    const cid = await createCredential(t, name, e, data, project);
    if (!cid) fail(`create for '${name}' returned no id`, 1);
    ids[name] = cid;
    created += 1;
    out(`  ${name}: created ${e.type} in '${project.name}' -> ${cid}`);
  }
  if (dry) out('\nDry run. Nothing written.');
  else { saveIds(env, ids); out(`\n${created} created; ids in deploy/creds.${env}.json`); }
  return 0;
}

export async function cmdRotate(env, names) {
  const { cfg, entries } = loadMap(env);
  const t = writeTarget(env);
  const creds = await credentialsIndex(t);
  const wfs = await apiAll(t, '/workflows');
  const ids = loadIds(env);
  const projects = new Map();
  let rc = 0;
  for (const name of names) {
    const e = entries[name];
    if (!e) { out(`  ${name}: not in the secret map`); rc = 1; continue; }
    const project = await projectFor(t, e, projects);
    const oldIds = byName(creds, name, project).map((c) => c.id);
    const data = resolve(cfg, name, e);
    const cid = await createCredential(t, name, e, data, project);
    ids[name] = cid;
    const bound = oldIds.flatMap((oid) => credentialUsers(wfs, oid).map((w) => w.name)).sort();
    out(`  ${name}: replacement ${cid} created in '${project.name}'`
      + (bound.length ? `; previous ${oldIds.join(', ')} still bound by ${bound.length} workflow(s): ${bound.slice(0, 8).join('; ')}${bound.length > 8 ? ' ...' : ''}` : '; nothing bound the previous one')
      + '. Rebind those workflows to the new id (deploy/creds.' + env + '.json has it), verify a run, then retire the previous credential by hand.');
  }
  saveIds(env, ids);
  return rc;
}

export async function cmdVerify(env) {
  const { entries } = loadMap(env);
  const t = readTarget(env);
  const creds = await credentialsIndex(t);
  const wfs = await apiAll(t, '/workflows');
  const ids = loadIds(env);
  const projects = new Map();
  const findings = [];
  out(`verify deploy/secret-map.${env}.json against ${t.url} (${env})`);
  const mappedIds = new Set();
  for (const [name, e] of Object.entries(entries)) {
    const project = await projectFor(t, e, projects);
    const hits = byName(creds, name, project);
    if (!hits.length) { findings.push(`'${name}' (${e.type}) is not on the target in '${project.name}': secret-map.sh sync ${env}`); continue; }
    if (hits.length > 1) findings.push(`'${name}' exists ${hits.length} times in '${project.name}': ${hits.map((h) => h.id).join(', ')}`);
    for (const h of hits) mappedIds.add(h.id);
    if (hits[0].type !== e.type) findings.push(`'${name}' is ${hits[0].type} on the target, ${e.type} in the map`);
    if (name in ids && !hits.some((h) => h.id === ids[name])) findings.push(`'${name}': deploy/creds.${env}.json says ${ids[name]}, target has ${hits.map((h) => h.id).join(', ')}: secret-map.sh ids ${env}`);
    else if (!(name in ids)) findings.push(`'${name}': no id in deploy/creds.${env}.json: secret-map.sh ids ${env}`);
  }
  // On a shared instance only this repo's workflows count as "in use": the ids
  // in deploy/workflows.<env>.json, when that ledger exists.
  const own = join(LEDGER_DIR, `workflows.${env}.json`);
  let scope = null;
  if (existsSync(own)) {
    try { scope = new Set(Object.entries(JSON.parse(readFileSync(own, 'utf8'))).filter(([k]) => !k.startsWith('_')).map(([, v]) => v)); } catch { scope = null; }
  }
  const used = new Map();
  for (const w of wfs) {
    if (scope && !scope.has(w.id)) continue;
    for (const n of w.nodes ?? []) for (const ref of Object.values(n.credentials ?? {})) {
      if (ref?.id && !mappedIds.has(ref.id)) {
        const k = `${ref.name ?? ''}|${ref.id}`;
        if (!used.has(k)) used.set(k, { name: ref.name, id: ref.id, ws: new Set() });
        used.get(k).ws.add(w.name);
      }
    }
  }
  const unmapped = [...used.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const where = scope ? `this repo's ${scope.size} workflow(s)` : `all ${wfs.length} workflows on the target`;
  out(`  mapped: ${Object.keys(entries).length}; on target: ${creds.size}; in use by ${where} but not in the map: ${unmapped.length}`);
  for (const u of unmapped) out(`    '${u.name}' (${u.id}) used by ${[...u.ws].sort().slice(0, 5).join('; ')}${u.ws.size > 5 ? ' ...' : ''}`);
  if (unmapped.length) findings.push(`${unmapped.length} credential(s) in use trace to no secret: add each to the map (name, type, project, data references), then secret-map.sh ids ${env}`);
  for (const f of findings) out(`  ${f}`);
  out(`\nRESULT: ${findings.length ? 'findings' : 'ok'}`);
  return findings.length ? 1 : 0;
}

export async function cmdIds(env) {
  const { entries } = loadMap(env);
  const t = readTarget(env);
  const creds = await credentialsIndex(t);
  const ids = loadIds(env);
  const projects = new Map();
  let rc = 0;
  for (const [name, e] of Object.entries(entries)) {
    const project = await projectFor(t, e, projects);
    const hits = byName(creds, name, project);
    if (hits.length === 1) { ids[name] = hits[0].id; out(`  ${name}: ${hits[0].id}`); }
    else if (!hits.length) { out(`  ${name}: not on the target`); rc = 1; }
    else { out(`  ${name}: ${hits.length} candidates, pick by hand: ${hits.map((h) => h.id).join(', ')}`); rc = 1; }
  }
  saveIds(env, ids);
  out(`\nids written to deploy/creds.${env}.json`);
  return rc;
}

const USAGE = `usage:
  secret-map.sh check  [env]
  secret-map.sh sync   [env] [--dry-run] [--only <name>...]
  secret-map.sh rotate <name>... [--env <env>]
  secret-map.sh verify [env]
  secret-map.sh ids    [env]`;

async function main(argv) {
  let args = [...argv];
  let envFlag = null;
  const i = args.indexOf('--env');
  if (i >= 0) { if (i + 1 >= args.length) fail('--env needs a value'); envFlag = args[i + 1]; args.splice(i, 2); }
  let only = [];
  const j = args.indexOf('--only');
  if (j >= 0) { only = args.slice(j + 1).filter((a) => !a.startsWith('--')); args = [...args.slice(0, j), ...args.slice(j + 1).filter((a) => a.startsWith('--'))]; }
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const pos = args.filter((a) => !a.startsWith('--'));
  if (!pos.length) fail(USAGE);
  const [cmd, ...rest] = pos;
  const env = rest[0] ?? envFlag ?? 'dev';
  if (cmd === 'check') process.exit(await cmdCheck(env));
  if (cmd === 'sync') process.exit(await cmdSync(env, flags.has('--dry-run'), new Set(only)));
  if (cmd === 'rotate') { if (!rest.length) fail('usage: secret-map.sh rotate <name>... [--env <env>]'); process.exit(await cmdRotate(envFlag ?? 'dev', rest)); }
  if (cmd === 'verify') process.exit(await cmdVerify(env));
  if (cmd === 'ids') process.exit(await cmdIds(env));
  fail(`unknown command '${cmd}'\n${USAGE}`);
}

if (process.argv[1] && /secret-map\.mjs$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => fail(e.message));
}
