// Promotion lint for workflow JSON. Headless, no AI, no network.
// validate.mjs asks "is this well-formed"; this asks "can this move to another
// environment without someone editing it by hand".
//
// Usage: node scripts/lint-workflow.mjs <file.json | dir> [...] [--strict] [--json]
//        [--require-tags] [--require-error-workflow] [--allow-host <host>]...
//
// Exit 1 on any error. --strict promotes warnings to errors. --json prints one
// report object per file for CI. Prints a promotion manifest per file: the
// credentials (by name and type) and variables the target must already have.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const allowHosts = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--allow-host' && args[i + 1]) allowHosts.push(args[++i].toLowerCase());
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--allow-host') { i++; continue; }
  if (a.startsWith('--')) continue;
  if (!existsSync(a)) { console.error(`no such file: ${a}`); process.exit(2); }
  if (statSync(a).isDirectory()) {
    for (const f of readdirSync(a).sort()) if (f.endsWith('.json')) files.push(join(a, f));
  } else files.push(a);
}
if (!files.length) { console.error('usage: lint-workflow.mjs <file.json | dir> [...] [--strict] [--json]'); process.exit(2); }

const STRICT = flag('--strict');
const JSON_OUT = flag('--json');
const REQUIRE_TAGS = flag('--require-tags');
const REQUIRE_ERROR_WF = flag('--require-error-workflow');

// Hosts that only resolve in one environment. A literal one in a parameter
// breaks on promotion; it belongs in a variable ($vars) or a credential.
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|host\.docker\.internal)$/i;
const PRIVATE_IP = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
const INTERNAL_TLD = /\.(local|internal|lan|corp|intranet|home|test)$/i;
const ENV_LABEL = /(^|[.-])(dev|develop|development|staging|stage|stg|test|uat|qa|lab|sandbox|preprod|nonprod)([.-]|$)/i;
const URL_RE = /https?:\/\/([^\s/:"'`<>{}]+)(?::(\d+))?/gi;

const TOKEN_SHAPE = /\b(sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/;

function walkStrings(v, path, cb) {
  if (typeof v === 'string') cb(v, path);
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, cb));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkStrings(x, path ? `${path}.${k}` : k, cb);
}

function lint(file) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  const manifest = { credentials: [], variables: new Set(), workflowRefs: [], hosts: new Set() };

  let wf;
  try {
    wf = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { file, errors: [`not valid JSON (${e.message})`], warnings: [], manifest: null };
  }
  const nodes = Array.isArray(wf.nodes) ? wf.nodes : [];

  // --- tags: the deploy gate requires them; a promotion target sorts by them
  const tags = (wf.tags ?? []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
  if (!tags.length) (REQUIRE_TAGS ? err : warn)('no tags: the instance cannot sort or scope this workflow');

  // --- error workflow: unattended failures must go somewhere
  if (!wf.settings?.errorWorkflow) {
    (REQUIRE_ERROR_WF ? err : warn)('settings.errorWorkflow is not set: failures are silent unless the instance default covers it');
  }

  // --- pinned data: test payloads in the repo are a data-handling question
  if (wf.pinData && Object.keys(wf.pinData).length) {
    warn(`pinData present for ${Object.keys(wf.pinData).length} node(s): pinned payloads travel with the JSON; strip before promotion`);
  }

  for (const n of nodes) {
    const label = n.name || '<unnamed>';
    const type = String(n.type ?? '');
    if (type.endsWith('stickyNote')) {
      if (/\b(TODO|FIXME|XXX)\b/.test(String(n.parameters?.content ?? ''))) warn(`sticky note carries TODO/FIXME: ${label}`);
      continue;
    }

    if (n.disabled) warn(`node is disabled: ${label} (promoting a disabled node promotes dead code)`);
    if (/\b(TODO|FIXME|XXX)\b/.test(String(n.notes ?? ''))) warn(`node notes carry TODO/FIXME: ${label}`);

    // --- credentials: bind by id AND name; a name is what survives promotion
    for (const [ctype, c] of Object.entries(n.credentials ?? {})) {
      if (!c || typeof c !== 'object') { err(`credential block malformed on node: ${label}`); continue; }
      if (!c.name) err(`credential ${ctype} on node ${label} has no name: it cannot be matched on another instance`);
      manifest.credentials.push({ node: label, type: ctype, name: c.name ?? '' });
    }

    // --- cross-workflow references: ids are instance-local
    const ref = n.parameters?.workflowId;
    if (ref && typeof ref === 'object' && ref.__rl) {
      const name = ref.cachedResultName ?? ref.__workflowName;
      manifest.workflowRefs.push({ node: label, id: String(ref.value ?? ''), name: name ?? '' });
      if (!name) warn(`node ${label} references workflow id ${ref.value} with no cached name: the id will not exist on the target`);
    }

    // --- parameter strings: hosts, env access, variables, secrets
    walkStrings(n.parameters ?? {}, '', (s, path) => {
      if (TOKEN_SHAPE.test(s)) err(`token-shaped literal in ${label} (${path}): use a credential`);

      if (/\$env\b/.test(s)) warn(`${label} (${path}) reads $env: environment access is often blocked on hardened instances; prefer $vars or a credential`);
      for (const m of s.matchAll(/\$vars\.([A-Za-z_][A-Za-z0-9_]*)/g)) manifest.variables.add(m[1]);

      if (/process\.env\b/.test(s)) warn(`${label} (${path}) reads process.env: unavailable under external task runners`);

      for (const m of s.matchAll(URL_RE)) {
        const host = m[1].toLowerCase();
        // An expression that builds the host from a variable is the portable form.
        if (host.startsWith('{{') || host.includes('$vars') || host.includes('$env')) continue;
        manifest.hosts.add(host);
        if (allowHosts.includes(host)) continue;
        if (LOCAL_HOST.test(host) || PRIVATE_IP.test(host) || INTERNAL_TLD.test(host)) {
          err(`${label} (${path}) hardcodes a local or private host "${host}": move it to $vars`);
        } else if (ENV_LABEL.test(host)) {
          err(`${label} (${path}) hardcodes an environment-labelled host "${host}": move it to $vars`);
        }
      }
    });

    // --- webhook paths: fine to ship, but a bare id-looking path is an accident
    if (/\.webhook$/i.test(type) && typeof n.parameters?.path === 'string' && /^[0-9a-f-]{36}$/i.test(n.parameters.path)) {
      warn(`webhook ${label} uses an auto-generated uuid path: name it, or the URL changes on every re-create`);
    }
  }

  return {
    file,
    errors,
    warnings,
    manifest: {
      tags,
      credentials: manifest.credentials,
      variables: [...manifest.variables].sort(),
      workflowRefs: manifest.workflowRefs,
      hosts: [...manifest.hosts].sort(),
    },
  };
}

const reports = files.map(lint);
let blocked = false;
for (const r of reports) {
  const effectiveErrors = STRICT ? [...r.errors, ...r.warnings] : r.errors;
  if (effectiveErrors.length) blocked = true;
  if (JSON_OUT) continue;
  console.log(`linting ${r.file}`);
  for (const w of r.warnings) console.log(`  ${STRICT ? 'ERROR' : 'WARN'}: ${w}`);
  for (const e of r.errors) console.log(`  ERROR: ${e}`);
  if (r.manifest) {
    const m = r.manifest;
    console.log(`  manifest: tags [${m.tags.join(', ')}]`);
    if (m.credentials.length) console.log(`    credentials the target needs: ${[...new Set(m.credentials.map((c) => `${c.name} (${c.type})`))].join('; ')}`);
    if (m.variables.length) console.log(`    variables the target needs: ${m.variables.join(', ')}`);
    if (m.workflowRefs.length) console.log(`    sub-workflows referenced: ${m.workflowRefs.map((w) => w.name || w.id).join(', ')}`);
    if (m.hosts.length) console.log(`    hosts called: ${m.hosts.join(', ')}`);
  }
  console.log(`  ${effectiveErrors.length ? 'RESULT: BLOCKED' : 'RESULT: ok'}\n`);
}
if (JSON_OUT) console.log(JSON.stringify({ strict: STRICT, blocked, reports }, null, 2));
else console.log(blocked ? 'RESULT: BLOCKED' : 'RESULT: ok');
process.exitCode = blocked ? 1 : 0;
