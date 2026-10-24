// Shared helpers for the care-kit scripts. Node built-ins only, no packages.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const KIT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** Loads .env into process.env without overwriting existing values. A blank value (`KEY=`) is "not set". */
export function loadEnv() {
  const f = join(KIT_DIR, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim().replace(/\s+#.*$/, '');
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    if (v === '') continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

/** Proxy and CA variables Node's fetch cares about, names and lengths only. */
export function proxyEnv(env = process.env) {
  const out = {};
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED']) {
    if (env[k] !== undefined && env[k] !== '') out[k] = env[k].length;
  }
  return out;
}

/** Turns a status-0 error string into the fix to print. */
export function classifyNetworkError(error = '', env = process.env) {
  const e = String(error);
  const proxyVar = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].find((k) => env[k]);
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|certificate/i.test(e)) {
    return 'TLS: Node does not trust the certificate the instance (or a TLS-inspecting proxy) presents. Put the CA bundle in NODE_EXTRA_CA_CERTS=<file.pem>. Never NODE_TLS_REJECT_UNAUTHORIZED=0.';
  }
  if (proxyVar && !env.NODE_USE_ENV_PROXY) {
    return `${proxyVar} is set but Node's fetch ignores it. Set NODE_USE_ENV_PROXY=1 (Node 22.21+ / 24.5+); NO_PROXY lists hosts that must stay direct.`;
  }
  if (proxyVar && /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/.test(e)) {
    return `the proxy in ${proxyVar} did not answer (${e.match(/E[A-Z_]+/)?.[0] ?? 'no response'}). Check its address, or add this host to NO_PROXY if it should bypass the proxy.`;
  }
  if (/ECONNREFUSED/.test(e)) return 'nothing is listening at that address: wrong port, or the instance is down.';
  if (/ENOTFOUND|EAI_AGAIN/.test(e)) return 'DNS does not resolve the host: VPN, split DNS, or a typo in the URL.';
  if (/ETIMEDOUT|abort/i.test(e)) return 'no answer within the timeout: firewall, VPN, or a proxy that is required but not configured (HTTPS_PROXY plus NODE_USE_ENV_PROXY=1).';
  return 'network, DNS, VPN, or the instance is down. Infrastructure, not a workflow.';
}

/** Loopback or RFC1918 address behind a URL, or null. n8n-mcp's SSRF guard refuses these unless WEBHOOK_SECURITY_MODE=permissive. */
export async function privateAddress(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch { return null; }
  if (host === 'localhost' || host.endsWith('.localhost')) return host;
  let addr = host;
  if (!isIP(host)) {
    try { addr = (await lookup(host)).address; } catch { return null; }
  }
  return isPrivateIp(addr) ? addr : null;
}

function isPrivateIp(a) {
  if (a.includes(':')) {
    if (/^::ffff:/i.test(a)) return isPrivateIp(a.replace(/^::ffff:/i, ''));
    return a === '::1' || a === '::' || /^f[cd]/i.test(a) || /^fe[89ab]/i.test(a);
  }
  const p = a.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254);
}

/** The reason fetch gave up: the cause code first, the generic message as fallback. */
const fetchError = (e) => {
  const c = e?.cause;
  if (c?.code) return `${c.code}: ${c.message ?? e.message}`;
  return c?.message && c.message !== e.message ? `${e.message} (${c.message})` : e.message;
};

/** Resolves the URL and key for an environment, falling back to the active pair. */
export function resolveTarget(env) {
  loadEnv();
  const up = (env || '').toUpperCase();
  const url = (up && process.env[`N8N_API_URL_${up}`]) || process.env.N8N_API_URL;
  const key = (up && process.env[`N8N_API_KEY_${up}`]) || process.env.N8N_API_KEY;
  if (!url) fail(`no URL for environment "${env || 'active'}". Copy .env.example to .env and fill it.`);
  if (!key) fail(`no API key for environment "${env || 'active'}". Copy .env.example to .env and fill it.`);
  return { base: `${url.replace(/\/+$/, '')}/api/v1`, url: url.replace(/\/+$/, ''), key };
}

/** GET against the n8n public API. Returns {status, body}. Never throws on HTTP status. */
export async function api(target, path, { timeoutMs = 30000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${target.base}${path}`, {
      headers: {
        'X-N8N-API-KEY': target.key,
        Accept: 'application/json',
        // Some CDNs bot-flag a missing user agent independently of any rule.
        'User-Agent': 'n8n-care-kit',
        // Do not leave keep-alive sockets open. These are short-lived CLI runs,
        // and a lingering socket keeps libuv handles alive at exit (on Windows
        // that surfaces as a fast-fail crash instead of a clean exit code).
        Connection: 'close',
      },
      signal: ctl.signal,
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null, error: fetchError(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Any method against the n8n public API, JSON in and out. Returns {status, body}.
 *  Never throws on HTTP status. Writes go through here so one place sets the headers. */
export async function request(target, method, path, body, { timeoutMs = 60000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers = { 'X-N8N-API-KEY': target.key, Accept: 'application/json', 'User-Agent': 'n8n-care-kit', Connection: 'close' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${target.base}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal,
    });
    let out = null;
    try { out = await res.json(); } catch { /* empty or non-JSON body */ }
    return { status: res.status, body: out };
  } catch (e) {
    return { status: 0, body: null, error: fetchError(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Pages through a list endpoint via the cursor. */
export async function apiAll(target, path) {
  const out = [];
  let cursor = null;
  do {
    const q = `${path}${path.includes('?') ? '&' : '?'}limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const { status, body, error } = await api(target, q);
    if (status !== 200) fail(`GET ${q} returned ${status}${error ? ` (${error})` : ''}`);
    out.push(...(body?.data ?? []));
    cursor = body?.nextCursor ?? null;
  } while (cursor);
  return out;
}

/** Recursively sorts object keys so a serialized diff shows real changes. */
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  }
  return v;
}

// Fields that define what a workflow DOES. Everything else (ids, timestamps,
// canvas positions, pinned test data, instance-assigned webhook ids) is noise
// for a comparison: a node dragged across the canvas is not a behavior change.
const BEHAVIOR_FIELDS = [
  'name', 'type', 'typeVersion', 'parameters', 'credentials',
  'disabled', 'onError', 'retryOnFail', 'maxTries', 'waitBetweenTries',
  'alwaysOutputData', 'executeOnce', 'notesInFlow', 'notes',
];

/** Reduces a workflow to its behavior, for comparison only. Never for export.
 *  Portable references compare by name: credentials drop their instance id, and an
 *  Execute Sub-workflow reference (repo: __workflowName; instance: id) becomes the
 *  workflow name when opts.workflowNameById can resolve it. */
export function normalize(wf, opts = {}) {
  const byId = opts.workflowNameById ?? new Map();
  const portable = (params) => {
    const p = JSON.parse(JSON.stringify(params ?? {}));
    const ref = p.workflowId;
    if (ref && typeof ref === 'object' && ref.__rl) {
      const name = ref.__workflowName ?? byId.get(String(ref.value ?? '')) ?? (ref.mode === 'list' ? ref.cachedResultName : undefined);
      if (name) p.workflowId = { __rl: true, ref: name };
    }
    return p;
  };
  const nodes = (wf.nodes ?? [])
    .filter((n) => !String(n.type ?? '').endsWith('stickyNote'))
    .map((n) => {
      const out = {};
      for (const f of BEHAVIOR_FIELDS) if (n[f] !== undefined) out[f] = n[f];
      if (out.parameters) out.parameters = portable(out.parameters);
      if (out.credentials) {
        out.credentials = Object.fromEntries(Object.entries(out.credentials).map(([t, c]) => [t, { name: c?.name ?? '' }]));
      }
      return out;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return sortKeys({
    name: wf.name,
    nodes,
    connections: wf.connections ?? {},
    settings: wf.settings ?? {},
  });
}

/** Human-readable list of where two normalized workflows differ. */
export function describeDiff(a, b) {
  const out = [];
  const an = new Map(a.nodes.map((n) => [n.name, n]));
  const bn = new Map(b.nodes.map((n) => [n.name, n]));
  for (const name of an.keys()) if (!bn.has(name)) out.push(`node only in A: ${name}`);
  for (const name of bn.keys()) if (!an.has(name)) out.push(`node only in B: ${name}`);
  for (const [name, node] of an) {
    const other = bn.get(name);
    if (!other) continue;
    if (JSON.stringify(node.parameters) !== JSON.stringify(other.parameters)) {
      out.push(`parameters differ: ${name}`);
    }
    if (node.typeVersion !== other.typeVersion) {
      out.push(`typeVersion differs: ${name} (A ${node.typeVersion}, B ${other.typeVersion})`);
    }
    if (JSON.stringify(node.credentials ?? null) !== JSON.stringify(other.credentials ?? null)) {
      out.push(`credentials differ: ${name}`);
    }
    if ((node.disabled ?? false) !== (other.disabled ?? false)) {
      out.push(`disabled differs: ${name} (A ${node.disabled ?? false}, B ${other.disabled ?? false})`);
    }
  }
  if (JSON.stringify(a.connections) !== JSON.stringify(b.connections)) out.push('connections differ');
  if (JSON.stringify(a.settings) !== JSON.stringify(b.settings)) out.push('settings differ');
  return out;
}

/** Thrown by fail(). Unwinds the script; the process then ends on its own with the exit code. */
export class ExitSignal extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}

let exitHandlersInstalled = false;
const swallowExit = (e) => {
  if (e instanceof ExitSignal) return;
  console.error(e?.stack ?? String(e));
  process.exitCode = 1;
};

/** Prints the error and stops the script. Never process.exit(): a socket still closing
 *  from the last fetch makes exit() fast-fail on Windows (libuv UV_HANDLE_CLOSING). */
export function fail(msg, code = 2) {
  console.error(`ERROR: ${msg}`);
  process.exitCode = code;
  if (!exitHandlersInstalled) {
    exitHandlersInstalled = true;
    process.on('unhandledRejection', swallowExit);
    process.on('uncaughtException', swallowExit);
  }
  throw new ExitSignal(code);
}

/** Filename-safe slug from a workflow name. */
export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow';
}
