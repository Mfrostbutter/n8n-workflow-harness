// Place workflows and credentials on an n8n instance: project, folder, tags.
// Node built-ins only. Importable (the functions are exported) and a CLI.
//
//   organize.sh audit [env]                                  what sits where, and every violation
//   organize.sh place <workflow.json|dir> [env] [--dry-run]  project, folder and tags from the JSON
//   organize.sh credentials <name>... --to <project> [--env <env>] [--force]
//                                                            transfer credentials into a project
//   organize.sh tables <name>... --to <project> [--env <env>] [--no-rows]
//                                                            copy data tables into a project (no transfer exists)
//   organize.sh project <name> [env]                         create a team project if it is missing
//
// A workflow JSON carries its own placement, next to "tags":
//
//   "tags": ["acme", "order-intake", "api"],
//   "project": "Acme Corp",          // a team project by name, or "personal"
//   "folder": "Order intake/API"     // a path; every segment is created on demand
//
// Defaults to dev. A named environment resolves strictly (N8N_API_URL_<ENV> and
// N8N_API_KEY_<ENV> must both exist) because every command here writes.
// "personal" is the calling key's own project: the public API cannot name it, so
// a personal workflow is never transferred and its credential scope is not checked.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadEnv, resolveTarget, request, apiAll, fail } from './lib.mjs';

export const PERSONAL = 'personal';
const errText = (r) => r.error ?? r.body?.message ?? (r.body ? JSON.stringify(r.body).slice(0, 300) : '');
const ok = (r, ...codes) => (codes.length ? codes : [200, 201]).includes(r.status);

/** Target for a write: dev by default, a named env only when its own pair is set. */
export function writeTarget(env) {
  loadEnv();
  const e = env || 'dev';
  const up = e.toUpperCase();
  if (e !== 'dev' && !(process.env[`N8N_API_URL_${up}`] && process.env[`N8N_API_KEY_${up}`])) {
    fail(`environment "${e}" is not configured: set N8N_API_URL_${up} and N8N_API_KEY_${up}. A write never falls back to the bare N8N_API_URL pair.`);
  }
  return { ...resolveTarget(e), env: e };
}

// ---------------------------------------------------------------- projects

export const projects = (t) => apiAll(t, '/projects');

/** Project record for a name. "personal" is a sentinel the folder API accepts
 *  as a path segment; it has no id and no transfer. */
export async function resolveProject(t, name) {
  if (!name) fail('workflow has no "project". Add "project": "<team project>" or "personal".', 1);
  if (name.toLowerCase() === PERSONAL) return { id: PERSONAL, name: PERSONAL, type: PERSONAL };
  const hit = (await projects(t)).find((p) => p.type === 'team' && p.name === name);
  if (!hit) {
    fail(`project "${name}" does not exist on ${t.url}. Create it: ./scripts/organize.sh project "${name}" ${t.env ?? 'dev'} (team projects need a licensed instance), or set "project": "personal".`, 1);
  }
  return hit;
}

export async function ensureProject(t, name) {
  const find = async () => (await projects(t)).find((p) => p.type === 'team' && p.name === name);
  const have = await find();
  if (have) return { project: have, created: false };
  const r = await request(t, 'POST', '/projects', { name });
  if (!ok(r)) fail(`project create FAILED HTTP ${r.status}: ${errText(r)} (team projects need a licensed instance and a key with project:create)`, 1);
  // Some versions answer 201 with an empty body; read it back by name.
  return { project: (await find()) ?? { id: r.body?.id, name, type: 'team' }, created: true };
}

/** Owning project of a live workflow record (GET /workflows/{id}). */
export const workflowProjectId = (wf) => (wf.shared ?? []).find((s) => s.role === 'workflow:owner')?.projectId ?? null;

// ----------------------------------------------------------------- folders

export async function folders(t, projectId, { soft = false } = {}) {
  const out = [];
  let skip = 0;
  for (;;) {
    const r = await request(t, 'GET', `/projects/${projectId}/folders?take=100&skip=${skip}`);
    if (r.status !== 200) {
      if (soft) return null;
      fail(`folder list FAILED HTTP ${r.status}: ${errText(r)} (folders need n8n 2.19+ on a registered or licensed instance)`, 1);
    }
    const page = r.body?.data ?? [];
    out.push(...page);
    skip += page.length;
    if (!page.length || skip >= Number(r.body?.count ?? 0)) return out;
  }
}

/** Folder id for a path like "Demos/Order intake", creating what is missing. */
export async function ensureFolder(t, projectId, path, { dry = false } = {}) {
  const segments = String(path ?? '').split('/').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) fail('workflow has no "folder". Add "folder": "<name or path>"; the project root is not organized.', 1);
  const have = await folders(t, projectId);
  let parent = null;
  const created = [];
  for (const seg of segments) {
    let hit = have.find((f) => f.name === seg && (f.parentFolderId ?? null) === parent);
    if (!hit) {
      if (dry) { created.push(seg); parent = `<new:${seg}>`; continue; }
      const body = parent ? { name: seg, parentFolderId: parent } : { name: seg };
      const r = await request(t, 'POST', `/projects/${projectId}/folders`, body);
      if (!ok(r)) fail(`folder create FAILED for '${seg}' HTTP ${r.status}: ${errText(r)}`, 1);
      hit = r.body;
      have.push(hit);
      created.push(seg);
    }
    parent = hit.id;
  }
  return { id: parent, created };
}

export async function folderCount(t, projectId, folderId) {
  const r = await request(t, 'GET', `/projects/${projectId}/folders/${folderId}`);
  return r.status === 200 ? r.body?.totalWorkflows ?? null : null;
}

// -------------------------------------------------------------------- tags

/** Resolves tag names to ids on the target, creating any that are missing. */
export async function ensureTags(t, names) {
  const r = await request(t, 'GET', '/tags?limit=250');
  const existing = new Map(r.status === 200 ? (r.body?.data ?? []).map((x) => [x.name, x.id]) : []);
  const ids = [];
  for (const name of names) {
    let id = existing.get(name);
    if (!id) {
      const c = await request(t, 'POST', '/tags', { name });
      if (!ok(c)) fail(`tag create FAILED for '${name}' HTTP ${c.status}: ${errText(c)}`, 1);
      id = c.body.id;
      existing.set(name, id);
    }
    ids.push(id);
  }
  return ids;
}

export async function setTags(t, wid, names) {
  const ids = await ensureTags(t, names);
  const r = await request(t, 'PUT', `/workflows/${wid}/tags`, ids.map((id) => ({ id })));
  if (!ok(r)) fail(`tag assign FAILED HTTP ${r.status}: ${errText(r)}`, 1);
  return names;
}

// ------------------------------------------------------------- credentials

/** id -> credential record with its `shared` projects. Needs an owner or admin key. */
export async function credentialsIndex(t) {
  return new Map((await apiAll(t, '/credentials')).map((c) => [c.id, c]));
}

export const credentialProjects = (cred) => new Set((cred.shared ?? []).map((s) => s.id));

/** {id, name} of every credential the nodes reference, once each. */
export function usedCredentials(wf) {
  const seen = new Map();
  for (const node of wf.nodes ?? []) {
    for (const ref of Object.values(node.credentials ?? {})) {
      if (ref?.id || ref?.name) seen.set(`${ref.id ?? ''}|${ref.name ?? ''}`, { id: ref.id ?? null, name: ref.name ?? null });
    }
  }
  return [...seen.values()];
}

const findCred = (creds, ref) => creds.get(ref.id) ?? [...creds.values()].find((c) => c.name === ref.name) ?? null;

/** Credentials the workflow uses that its project cannot reach. A workflow in a
 *  team project executes only with credentials that project owns or is shared
 *  with; anything else fails at runtime with "node does not have access". */
export function credentialScopeViolations(wf, project, creds) {
  if (project.id === PERSONAL) return [];
  const bad = [];
  for (const ref of usedCredentials(wf)) {
    const cred = findCred(creds, ref);
    if (!cred) bad.push(`'${ref.name}' (${ref.id}): not on this instance`);
    else if (!credentialProjects(cred).has(project.id)) {
      const owners = (cred.shared ?? []).map((s) => s.name ?? '?').sort().join(', ') || 'nobody';
      bad.push(`'${cred.name}' (${cred.id}): owned by ${owners}`);
    }
  }
  return bad;
}

/** Live workflows whose nodes bind this credential id. */
export const credentialUsers = (wfs, credId) =>
  wfs.filter((w) => (w.nodes ?? []).some((n) => Object.values(n.credentials ?? {}).some((r) => r?.id === credId)));

/** Before a batch of workflows moves into a project, move the credentials that
 *  only this batch uses. A credential some other workflow still uses stays where
 *  it is and is reported, because the move would take it away from that workflow;
 *  the caller then creates a project-scoped copy. `batch` is [{id, wf}]. */
export async function moveBatchCredentials(t, batch, project, creds, { wfs = null, dry = false } = {}) {
  if (project.id === PERSONAL) return { moved: [], bad: [] };
  const live = wfs ?? (await apiAll(t, '/workflows'));
  const batchIds = new Set(batch.map((b) => b.id).filter(Boolean));
  const moved = [];
  const bad = [];
  const seen = new Set();
  for (const { wf } of batch) {
    for (const ref of usedCredentials(wf)) {
      const cred = findCred(creds, ref);
      if (!cred || seen.has(cred.id)) continue;
      seen.add(cred.id);
      if (credentialProjects(cred).has(project.id)) continue;
      const outside = credentialUsers(live, cred.id).filter((w) => !batchIds.has(w.id)).map((w) => w.name).sort();
      if (outside.length) {
        bad.push(`'${cred.name}' (${cred.id}) is also used by ${outside.slice(0, 5).join('; ')}${outside.length > 5 ? ' ...' : ''}`);
        continue;
      }
      if (!dry) {
        const r = await request(t, 'PUT', `/credentials/${cred.id}/transfer`, { destinationProjectId: project.id });
        if (!ok(r, 200, 204)) fail(`credential transfer FAILED for '${cred.name}' HTTP ${r.status}: ${errText(r)}`, 1);
      }
      // The index now reflects the move (or, on a dry run, the plan), so the
      // scope check that follows sees the credential where it will be.
      cred.shared = [{ id: project.id, name: project.name, role: 'credential:owner' }];
      moved.push(cred.name);
    }
  }
  return { moved, bad };
}

/** Moves one credential into a project. Refuses when workflows outside the
 *  destination still use it, because the move takes the credential away from them. */
export async function transferCredential(t, cred, project, { force = false } = {}) {
  const live = await apiAll(t, '/workflows');
  const outside = credentialUsers(live, cred.id).filter((w) => workflowProjectId(w) !== project.id).map((w) => w.name).sort();
  if (outside.length && !force) {
    return { ok: false, msg: `used by ${outside.length} workflow(s) outside '${project.name}': ${outside.slice(0, 6).join('; ')}${outside.length > 6 ? ' ...' : ''}. Create a project-scoped copy for them, or --force to move it anyway.` };
  }
  const r = await request(t, 'PUT', `/credentials/${cred.id}/transfer`, { destinationProjectId: project.id });
  if (!ok(r, 200, 204)) return { ok: false, msg: `transfer FAILED HTTP ${r.status}: ${errText(r)}` };
  return { ok: true, msg: `moved${outside.length ? ` (forced; ${outside.length} outside users lost access)` : ''}` };
}

// ------------------------------------------------------------- data tables

/** id -> data table record (name, projectId, columns). Project-scoped like
 *  credentials, and unlike credentials they cannot be transferred. */
export async function dataTablesIndex(t) {
  return new Map((await apiAll(t, '/data-tables')).map((x) => [x.id, x]));
}

/** ids of every Data Table the nodes bind (n8n-nodes-base.dataTable, mode id). */
export function usedDataTables(wf) {
  const out = new Set();
  for (const node of wf.nodes ?? []) {
    if (node.type !== 'n8n-nodes-base.dataTable') continue;
    const ref = node.parameters?.dataTableId;
    const id = ref && typeof ref === 'object' ? ref.value : ref;
    if (typeof id === 'string' && id && !id.startsWith('=')) out.add(id);
  }
  return out;
}

/** Data tables the workflow binds that live in another project. A Data Table
 *  node resolves its table inside the workflow's own project and fails with
 *  "could not be found in this project" otherwise. */
export function dataTableScopeViolations(wf, project, tables) {
  if (project.id === PERSONAL) return [];
  const bad = [];
  for (const id of [...usedDataTables(wf)].sort()) {
    const x = tables.get(id);
    if (!x) bad.push(`data table ${id}: not on this instance`);
    else if (x.projectId !== project.id) bad.push(`data table '${x.name}' (${id}) lives in project ${x.projectId}`);
  }
  return bad;
}

/** Recreates a data table inside a project, copies its rows, renames the original
 *  with an archive prefix. The node binds the table by id, so the caller rebinds
 *  the workflow JSON to the new id. */
export async function copyDataTable(t, table, project, { copyRows = true, archive = true } = {}) {
  const full = await request(t, 'GET', `/data-tables/${table.id}`);
  if (full.status !== 200) fail(`data table read FAILED HTTP ${full.status}: ${errText(full)}`, 1);
  const cols = [...(full.body?.columns ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((c) => ({ name: c.name, type: c.type }));
  const made = await request(t, 'POST', '/data-tables', { name: table.name, columns: cols, projectId: project.id });
  if (!ok(made)) fail(`data table create FAILED for '${table.name}' HTTP ${made.status}: ${errText(made)}`, 1);
  const newId = made.body.id;
  let copied = 0;
  if (copyRows) {
    const names = new Set(cols.map((c) => c.name));
    let cursor = null;
    do {
      const page = await request(t, 'GET', `/data-tables/${table.id}/rows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (page.status !== 200) fail(`row read FAILED HTTP ${page.status}: ${errText(page)}`, 1);
      const rows = (page.body?.data ?? []).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => names.has(k))));
      if (rows.length) {
        const ins = await request(t, 'POST', `/data-tables/${newId}/rows`, { data: rows });
        if (!ok(ins)) fail(`row insert FAILED HTTP ${ins.status}: ${errText(ins)}`, 1);
        copied += rows.length;
      }
      cursor = page.body?.nextCursor ?? null;
    } while (cursor);
  }
  if (archive) {
    const stamp = new Date().toISOString().slice(0, 10);
    await request(t, 'PATCH', `/data-tables/${table.id}`, { name: `zz-archived-${stamp}-${table.name}`.slice(0, 128) });
  }
  return { newId, copied };
}

// ------------------------------------------------------------------ placing

/** {tags, project, folder} declared in a workflow file. */
export function placement(wf) {
  const tags = (wf.tags ?? []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
  return { tags, project: String(wf.project ?? '').trim(), folder: String(wf.folder ?? '').trim() };
}

const SETTINGS_KEYS = ['executionOrder', 'timezone', 'saveDataErrorExecution', 'saveDataSuccessExecution',
  'saveManualExecutions', 'saveExecutionProgress', 'errorWorkflow', 'executionTimeout', 'callerPolicy', 'callerIds'];

/** Puts a live workflow where its JSON says: project (transfer), folder (PUT with
 *  parentFolderId), tags. `body` is an update body a deploy already built; without
 *  it the live record is read back and re-sent unchanged. Returns a report. */
export async function placeWorkflow(t, wid, wf, { creds = null, dry = false, body = null, tables = null } = {}) {
  const { tags, project: projectName, folder: folderPath } = placement(wf);
  const report = { id: wid, name: wf.name };
  if (!tags.length) fail('tag gate: workflow has no tags. Add "tags": [...] (every workflow is tagged).', 1);
  const project = await resolveProject(t, projectName);
  const credIndex = creds ?? (await credentialsIndex(t));
  let bad = credentialScopeViolations(wf, project, credIndex);
  if (bad.length) {
    fail(`credential scope: "${project.name}" cannot reach ${bad.join('; ')}. Fix: ./scripts/organize.sh credentials "<name>" --to "${project.name}" --env ${t.env ?? 'dev'}, or create the credential inside the project.`, 1);
  }
  const tableIndex = tables ?? (usedDataTables(wf).size ? await dataTablesIndex(t) : new Map());
  bad = dataTableScopeViolations(wf, project, tableIndex);
  if (bad.length) {
    fail(`data table scope: "${project.name}" cannot reach ${bad.join('; ')}. Tables do not transfer: ./scripts/organize.sh tables "<name>" --to "${project.name}" --env ${t.env ?? 'dev'} copies one into the project, then rebind the node to the new id.`, 1);
  }

  const read = await request(t, 'GET', `/workflows/${wid}`);
  if (read.status !== 200) fail(`read-back FAILED HTTP ${read.status}: ${errText(read)}`, 1);
  const live = read.body;
  const needsTransfer = project.id !== PERSONAL && workflowProjectId(live) !== project.id;
  report.project = project.name;
  report.transfer = needsTransfer;

  const { id: folderId, created } = await ensureFolder(t, project.id, folderPath, { dry });
  report.folder = folderPath;
  report.folderCreated = created;
  report.tags = tags;
  if (dry) return report;

  if (needsTransfer) {
    const r = await request(t, 'PUT', `/workflows/${wid}/transfer`, { destinationProjectId: project.id });
    if (!ok(r, 200, 204)) fail(`transfer FAILED HTTP ${r.status}: ${errText(r)}`, 1);
  }
  const update = body ?? {
    name: live.name, nodes: live.nodes, connections: live.connections,
    settings: Object.fromEntries(Object.entries(live.settings ?? {}).filter(([k]) => SETTINGS_KEYS.includes(k))),
  };
  const put = await request(t, 'PUT', `/workflows/${wid}`, { ...update, parentFolderId: folderId });
  if (!ok(put)) fail(`folder placement PUT FAILED HTTP ${put.status}: ${errText(put)}`, 1);
  await setTags(t, wid, tags);

  // Verify: project from the read-back, folder from the folder's own count, publish state.
  const after = await request(t, 'GET', `/workflows/${wid}`);
  const final = after.body ?? {};
  if (project.id !== PERSONAL && workflowProjectId(final) !== project.id) fail(`VERIFY FAILED: workflow is not in project '${project.name}' after transfer`, 1);
  report.folderTotal = await folderCount(t, project.id, folderId);
  report.liveTags = (final.tags ?? []).map((x) => x.name).sort();
  report.draft = Boolean(final.active) && final.versionId !== final.activeVersionId;
  return report;
}

export function formatReport(r) {
  let line = `  ${r.name}\n    project ${r.project}${r.transfer ? '  (transferred)' : ''}`
    + `\n    folder  ${r.folder}${r.folderCreated?.length ? `  (created ${r.folderCreated.join(', ')})` : ''}`
    + `\n    tags    ${r.tags.join(', ')}`;
  if ('folderTotal' in r) line += `\n    verify  folder holds ${r.folderTotal} workflow(s); live tags [${r.liveTags.join(', ')}]`;
  if (r.draft) line += '\n    WARNING an unpublished draft is live (versionId != activeVersionId). Publish it: publish_workflow on the official server, or the editor\'s Publish button.';
  return line;
}

// --------------------------------------------------------------------- CLI

export function loadFiles(path) {
  const files = statSync(path).isDirectory()
    ? readdirSync(path).filter((f) => f.endsWith('.json')).sort().map((f) => join(path, f))
    : [path];
  const out = [];
  for (const f of files) {
    if (f.endsWith('.zones.json')) continue;
    let wf;
    try { wf = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { fail(`${f}: not valid JSON (${e.message})`, 1); }
    if (wf && typeof wf === 'object' && 'nodes' in wf) out.push({ file: f, wf });
  }
  if (!out.length) fail(`no workflow JSON under ${path}`, 1);
  return out;
}

export async function cmdAudit(t) {
  const projs = await projects(t);
  const wfs = await apiAll(t, '/workflows');
  const creds = await credentialsIndex(t);
  const tables = await dataTablesIndex(t);
  const byProject = new Map();
  for (const w of wfs) {
    const pid = workflowProjectId(w);
    byProject.set(pid, [...(byProject.get(pid) ?? []), w]);
  }
  const team = projs.filter((p) => p.type === 'team');
  const lines = [`${t.url}  projects ${projs.length} (${team.length} team)  workflows ${wfs.length}  credentials ${creds.size}  data tables ${tables.size}`, ''];
  for (const p of projs) {
    const ws = byProject.get(p.id) ?? [];
    const fl = await folders(t, p.id, { soft: true });
    const cs = [...creds.values()].filter((c) => credentialProjects(c).has(p.id)).length;
    const ts = [...tables.values()].filter((x) => x.projectId === p.id).length;
    lines.push(`  [${String(p.type).padEnd(8)}] ${p.name}: ${ws.length} workflows, ${fl ? fl.length : '?'} folders, ${cs} credentials, ${ts} data tables`);
  }
  const untagged = wfs.filter((w) => !(w.tags ?? []).length).map((w) => w.name).sort();
  const personalIds = new Set(projs.filter((p) => p.type === 'personal').map((p) => p.id));
  const inPersonal = wfs.filter((w) => personalIds.has(workflowProjectId(w))).map((w) => w.name).sort();
  const scope = [];
  for (const w of wfs) {
    const pid = workflowProjectId(w);
    if (personalIds.has(pid)) continue;
    const pname = projs.find((p) => p.id === pid)?.name ?? pid;
    const proj = { id: pid, name: pname };
    const bad = [...credentialScopeViolations(w, proj, creds), ...dataTableScopeViolations(w, proj, tables)];
    if (bad.length) scope.push(`${w.name} in '${pname}': ${bad.join('; ')}`);
  }
  lines.push('', `untagged workflows: ${untagged.length}`, ...untagged.map((n) => `  ${n}`));
  if (team.length) lines.push('', `workflows left in a personal project: ${inPersonal.length}`, ...inPersonal.map((n) => `  ${n}`));
  lines.push('', `credential scope violations: ${scope.length}`, ...scope.map((s) => `  ${s}`));
  const findings = untagged.length || scope.length || (team.length && inPersonal.length);
  lines.push('', `RESULT: ${findings ? 'findings' : 'ok'}`);
  console.log(lines.join('\n'));
  return untagged.length || scope.length ? 1 : 0;
}

export async function cmdPlace(t, path, dry) {
  const creds = await credentialsIndex(t);
  const files = loadFiles(path);
  console.log(`place -> ${t.url} (${t.env})${dry ? '  [dry run]' : ''}`);
  // Credentials first, per project: the ones only this batch uses move with it.
  const byProject = new Map();
  for (const { wf } of files) {
    if (wf.id) {
      const p = placement(wf).project;
      byProject.set(p, [...(byProject.get(p) ?? []), { id: wf.id, wf }]);
    }
  }
  const wfs = await apiAll(t, '/workflows');
  for (const [pname, batch] of byProject) {
    const project = await resolveProject(t, pname);
    const { moved, bad } = await moveBatchCredentials(t, batch, project, creds, { wfs, dry });
    for (const m of moved) console.log(`  credential '${m}' ${dry ? 'would move' : 'moved'} into '${pname}'`);
    if (bad.length) {
      fail(`credential scope: "${pname}" cannot take ${bad.join('; ')}. Create a project-scoped copy for this batch and rebind the nodes, or --force the move with ./scripts/organize.sh credentials.`, 1);
    }
  }
  for (const { file, wf } of files) {
    if (!wf.id) { console.log(`  ${basename(file)}: no id in the JSON. Create it on the instance first, export-all, then place.`); continue; }
    console.log(formatReport(await placeWorkflow(t, wf.id, wf, { creds, dry })));
  }
  if (dry) console.log('\nDry run. Nothing written.');
}

export async function cmdTables(t, names, projectName, copyRows) {
  const project = await resolveProject(t, projectName);
  if (project.id === PERSONAL) fail('tables copy into a named team project; the public API cannot address a personal one', 1);
  const tables = await dataTablesIndex(t);
  const idmap = {};
  let rc = 0;
  for (const name of names) {
    const hits = [...tables.values()].filter((x) => x.name === name || x.id === name);
    if (!hits.length) { console.log(`  ${name}: not found`); rc = 1; continue; }
    if (hits.length > 1) { console.log(`  ${name}: ${hits.length} tables share this name, pass the id instead: ${hits.map((x) => x.id).join(', ')}`); rc = 1; continue; }
    const x = hits[0];
    if (x.projectId === project.id) { console.log(`  ${x.name} (${x.id}): already in '${project.name}'`); continue; }
    const { newId, copied } = await copyDataTable(t, x, project, { copyRows });
    idmap[x.id] = newId;
    console.log(`  ${x.name}: ${x.id} -> ${newId} (${copied} rows copied; original renamed zz-archived-...)`);
  }
  if (Object.keys(idmap).length) console.log(`\nrebind the Data Table nodes (old id -> new id), then update the workflow:\n${JSON.stringify(idmap, null, 2)}`);
  return rc;
}

export async function cmdCredentials(t, names, projectName, force) {
  const project = await resolveProject(t, projectName);
  if (project.id === PERSONAL) fail('credentials move into a named team project; the public API cannot address a personal one', 1);
  const creds = await credentialsIndex(t);
  let rc = 0;
  for (const name of names) {
    const hits = [...creds.values()].filter((c) => c.name === name || c.id === name);
    if (!hits.length) { console.log(`  ${name}: not found`); rc = 1; continue; }
    if (hits.length > 1) { console.log(`  ${name}: ${hits.length} credentials share this name, pass the id instead: ${hits.map((c) => c.id).join(', ')}`); rc = 1; continue; }
    const cred = hits[0];
    if (credentialProjects(cred).has(project.id)) { console.log(`  ${cred.name} (${cred.id}): already in '${project.name}'`); continue; }
    const r = await transferCredential(t, cred, project, { force });
    console.log(`  ${cred.name} (${cred.id}): ${r.msg}`);
    if (!r.ok) rc = 1;
  }
  return rc;
}

const USAGE = `usage:
  organize.sh audit [env]
  organize.sh place <workflow.json|dir> [env] [--dry-run]
  organize.sh credentials <name>... --to <project> [--env <env>] [--force]
  organize.sh tables <name>... --to <project> [--env <env>] [--no-rows]
  organize.sh project <name> [env]`;

async function main(argv) {
  const args = [...argv];
  let to = null;
  let envFlag = 'dev';
  for (const opt of ['--to', '--env']) {
    const i = args.indexOf(opt);
    if (i < 0) continue;
    if (i + 1 >= args.length) fail(`${opt} needs a value`);
    if (opt === '--to') to = args[i + 1]; else envFlag = args[i + 1];
    args.splice(i, 2);
  }
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const pos = args.filter((a) => !a.startsWith('--'));
  if (!pos.length) fail(USAGE);
  const [cmd, ...rest] = pos;
  if (cmd === 'audit') process.exit(await cmdAudit(writeTarget(rest[0])));
  if (cmd === 'place') {
    if (!rest.length) fail('usage: organize.sh place <workflow.json|dir> [env] [--dry-run]');
    await cmdPlace(writeTarget(rest[1]), rest[0], flags.has('--dry-run'));
    return;
  }
  if (cmd === 'credentials') {
    if (!rest.length || !to) fail('usage: organize.sh credentials <name>... --to <project> [--env <env>] [--force]');
    process.exit(await cmdCredentials(writeTarget(envFlag), rest, to, flags.has('--force')));
  }
  if (cmd === 'tables') {
    if (!rest.length || !to) fail('usage: organize.sh tables <name>... --to <project> [--env <env>] [--no-rows]');
    process.exit(await cmdTables(writeTarget(envFlag), rest, to, !flags.has('--no-rows')));
  }
  if (cmd === 'project') {
    if (!rest.length) fail('usage: organize.sh project <name> [env]');
    const t = writeTarget(rest[1]);
    const { project, created } = await ensureProject(t, rest[0]);
    console.log(`project '${project.name}' ${project.id ?? ''} ${created ? 'created' : 'exists'} on ${t.url}`);
    return;
  }
  fail(`unknown command '${cmd}'\n${USAGE}`);
}

if (process.argv[1] && /organize\.mjs$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => fail(e.message));
}
