// Unit tests for the network helpers in lib.mjs: the fix doctor prints for a
// status-0 error, the private-address check behind the SSRF note, and fail()
// ending a script through the exit code rather than process.exit().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { classifyNetworkError, privateAddress, proxyEnv, fail, ExitSignal } from '../scripts/lib.mjs';

test('classifyNetworkError names the TLS fix for certificate errors', () => {
  for (const e of ['DEPTH_ZERO_SELF_SIGNED_CERT: self-signed certificate', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify', 'CERT_HAS_EXPIRED: certificate has expired']) {
    const fix = classifyNetworkError(e, {});
    assert.match(fix, /NODE_EXTRA_CA_CERTS/);
    assert.match(fix, /Never NODE_TLS_REJECT_UNAUTHORIZED=0/);
  }
});

test('classifyNetworkError points at NODE_USE_ENV_PROXY when a proxy is set but not honoured', () => {
  assert.match(classifyNetworkError('ETIMEDOUT: connect ETIMEDOUT', { HTTPS_PROXY: 'http://proxy:3128' }), /NODE_USE_ENV_PROXY=1/);
  assert.match(classifyNetworkError('ECONNREFUSED: connect ECONNREFUSED', { https_proxy: 'http://proxy:3128' }), /NODE_USE_ENV_PROXY=1/);
  const honoured = classifyNetworkError('ECONNREFUSED: connect ECONNREFUSED 10.0.0.1:3128', { HTTPS_PROXY: 'http://10.0.0.1:3128', NODE_USE_ENV_PROXY: '1' });
  assert.match(honoured, /proxy in HTTPS_PROXY did not answer \(ECONNREFUSED\)/);
});

test('classifyNetworkError distinguishes refused, unresolved and timed out without a proxy', () => {
  assert.match(classifyNetworkError('ECONNREFUSED: connect ECONNREFUSED', {}), /nothing is listening/);
  assert.match(classifyNetworkError('ENOTFOUND: getaddrinfo ENOTFOUND n8n.corp', {}), /DNS/);
  assert.match(classifyNetworkError('This operation was aborted', {}), /timeout/);
  assert.match(classifyNetworkError('fetch failed', {}), /Infrastructure, not a workflow/);
});

test('privateAddress recognises loopback and RFC1918 literals and public hosts', async () => {
  assert.equal(await privateAddress('http://127.0.0.1:5678'), '127.0.0.1');
  assert.equal(await privateAddress('http://localhost:5678'), 'localhost');
  assert.equal(await privateAddress('https://10.1.2.3'), '10.1.2.3');
  assert.equal(await privateAddress('https://172.20.0.9:443'), '172.20.0.9');
  assert.equal(await privateAddress('https://192.168.1.1'), '192.168.1.1');
  assert.equal(await privateAddress('http://[::1]:5678'), '::1');
  assert.equal(await privateAddress('https://8.8.8.8'), null);
  assert.equal(await privateAddress('https://172.32.0.1'), null);
  assert.equal(await privateAddress('not a url'), null);
});

test('proxyEnv reports names and lengths only', () => {
  const r = proxyEnv({ HTTPS_PROXY: 'http://proxy:3128', NODE_EXTRA_CA_CERTS: '/etc/ca.pem', NO_PROXY: '', PATH: '/bin' });
  assert.deepEqual(r, { HTTPS_PROXY: 17, NODE_EXTRA_CA_CERTS: 11 });
});

test('fail throws an ExitSignal and sets the exit code instead of calling process.exit', () => {
  const before = process.exitCode;
  assert.throws(() => fail('boom', 3), (e) => e instanceof ExitSignal && e.code === 3);
  assert.equal(process.exitCode, 3);
  process.exitCode = before;
});

test('a script that calls fail() right after a fetch exits with its code, on every platform', () => {
  const script = `
    import { fail } from '${new URL('../scripts/lib.mjs', import.meta.url).href}';
    const r = await fetch('http://127.0.0.1:1/', { headers: { Connection: 'close' } }).catch((e) => e);
    fail('after fetch ' + (r.cause?.code ?? r.message), 4);
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /ERROR: after fetch/);
  assert.doesNotMatch(r.stderr, /Assertion failed|UV_HANDLE_CLOSING/);
});
