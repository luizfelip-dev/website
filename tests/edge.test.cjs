'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').resolve(__dirname, '../supabase/functions/nivela-auth/index.js'), 'utf8');
const apiKey = 'sb_publishable_GRrC-WLIb42OQLRyGmFbEA__KOhp_tk';
const browserId = '11111111-1111-4111-8111-111111111111';
const defaults = { username: 'usuario123', password: 'Senha123!', browserId, website: '' };
const result = [];
function world(options = {}) {
  const calls = [];
  let handler;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only-server-secret', ...options.env };
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, TextDecoder, URL, Headers, Request, Response, AbortController, Uint8Array,
    Deno: { env: { get: name => env[name] }, serve: fn => { handler = fn; } },
    setTimeout: (fn, ms) => setTimeout(fn, options.quickTimeout && ms === 10000 ? 5 : ms), clearTimeout,
    fetch: async (url, request) => {
      const body = JSON.parse(request.body); calls.push({ url, request, body });
      if (options.fetch) return options.fetch(url, request, body, calls);
      return new Response(JSON.stringify(url.endsWith('/rpc/reserve_nivela_signup') ? { allowed: true, retryAfter: 0 } : { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  vm.runInContext(source, context);
  return { handler, calls, context };
}
function request(body = defaults, options = {}) {
  const headers = { apikey: apiKey, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.20', ...options.headers };
  for (const [key, value] of Object.entries(headers)) if (value === null) delete headers[key];
  return new Request('https://example.supabase.co/functions/v1/nivela-auth', { method: options.method || 'POST', headers,
    ...(options.method && options.method !== 'POST' ? {} : { body: options.raw ?? JSON.stringify(body) }) });
}
async function test(name, run) {
  try { await run(); result.push({ name, passed: true }); }
  catch (error) { result.push({ name, passed: false, error: error.message }); }
}
(async () => {
  await test('valid signup reserves hashed identifiers before Admin user creation', async () => {
    const w = world(); const response = await w.handler(request({ ...defaults, username: '  Usuario123  ' }));
    assert.equal(response.status, 201); assert.deepEqual(await response.json(), { created: true });
    assert.equal(w.calls.length, 2);
    assert.ok(w.calls[0].url.endsWith('/rpc/reserve_nivela_signup'));
    const hashes = w.calls[0].body;
    assert.match(hashes.p_ip_hash, /^[a-f0-9]{64}$/); assert.match(hashes.p_browser_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(hashes.p_ip_hash, hashes.p_browser_hash);
    assert.ok(!JSON.stringify(hashes).includes('192.0.2.20'));
    assert.ok(!JSON.stringify(hashes).includes(browserId));
    assert.equal(w.calls[1].body.email, 'usuario123@accounts.nivela.invalid');
    assert.equal(w.calls[1].body.email_confirm, true);
    assert.equal(w.calls[1].body.app_metadata.nivela_registration, 'server-v1');
    assert.equal(w.calls[1].request.headers.Authorization, 'Bearer test-only-server-secret');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  for (const username of ['ab', 'nome com espaço', 'ábc', 'a'.repeat(25), '', null]) {
    await test(`invalid username is rejected before quota: ${String(username)}`, async () => {
      const w = world(); const response = await w.handler(request({ ...defaults, username }));
      assert.equal(response.status, 422); assert.equal((await response.json()).code, 'invalid_username'); assert.equal(w.calls.length, 0);
    });
  }
  for (const password of ['1234567', '        ', null]) {
    await test(`weak password is rejected before quota: ${JSON.stringify(password)}`, async () => {
      const w = world(); const response = await w.handler(request({ ...defaults, password }));
      assert.equal(response.status, 422); assert.equal((await response.json()).code, 'weak_password'); assert.equal(w.calls.length, 0);
    });
  }
  await test('eight visible Unicode characters and 72 UTF8-byte upper bound', async () => {
    const w = world(); assert.equal((await w.handler(request({ ...defaults, password: 'a'.repeat(72) }))).status, 201);
    const tooLong = await w.handler(request({ ...defaults, password: 'á'.repeat(37) }));
    assert.equal(tooLong.status, 422); assert.equal((await tooLong.json()).code, 'password_too_long');
    assert.equal((await w.handler(request({ ...defaults, password: '😀'.repeat(7) }))).status, 422);
  });
  await test('invalid browser identifiers and filled honeypot never reach backend', async () => {
    const w = world();
    assert.equal((await w.handler(request({ ...defaults, browserId: 'invalid' }))).status, 422);
    assert.equal((await w.handler(request({ ...defaults, website: 'https://bot.test' }))).status, 422);
    assert.equal(w.calls.length, 0);
  });
  await test('missing platform IP never falls back to spoofable headers', async () => {
    const w = world(); const response = await w.handler(request(defaults, { headers: { 'cf-connecting-ip': null, 'true-client-ip': '192.0.2.1', 'x-forwarded-for': '192.0.2.1' } }));
    assert.equal(response.status, 503); assert.equal(w.calls.length, 0);
  });
  for (const address of ['not-an-ip', '256.1.1.1', '192.0.2.1, 192.0.2.2', 'fe80::1%eth0']) {
    await test(`malformed platform IP fails closed: ${address}`, async () => {
      const w = world(); assert.equal((await w.handler(request(defaults, { headers: { 'cf-connecting-ip': address } }))).status, 503); assert.equal(w.calls.length, 0);
    });
  }
  await test('IPv6 canonicalization groups /64 while mapped IPv4 matches IPv4', async () => {
    const w = world();
    for (const address of ['2001:db8:1:2::1', '2001:0db8:0001:0002:ffff::1', '192.0.2.20', '::ffff:192.0.2.20']) await w.handler(request(defaults, { headers: { 'cf-connecting-ip': address } }));
    const hashes = w.calls.filter(call => call.url.includes('/rpc/')).map(call => call.body.p_ip_hash);
    assert.equal(hashes[0], hashes[1]); assert.equal(hashes[2], hashes[3]); assert.notEqual(hashes[0], hashes[2]);
  });
  await test('quota denial has Retry-After and never creates Auth user', async () => {
    const w = world({ fetch: async () => new Response(JSON.stringify({ allowed: false, retryAfter: 321 }), { status: 200 }) });
    const response = await w.handler(request()); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '321');
    assert.deepEqual(await response.json(), { code: 'signup_rate_limited', retryAfter: 321 }); assert.equal(w.calls.length, 1);
  });
  await test('quota HTTP failure and malformed response fail closed', async () => {
    for (const fixture of [{ status: 500, body: {} }, { status: 200, body: { allowed: 'true' } }]) {
      const w = world({ fetch: async () => new Response(JSON.stringify(fixture.body), { status: fixture.status }) });
      assert.equal((await w.handler(request())).status, 503); assert.equal(w.calls.length, 1);
    }
  });
  await test('duplicate Auth email maps to username_taken without raw server error', async () => {
    const w = world({ fetch: async url => new Response(JSON.stringify(url.includes('/rpc/') ? { allowed: true } : { code: 'email_exists', message: 'sensitive internal message' }), { status: url.includes('/rpc/') ? 200 : 422 }) });
    const response = await w.handler(request()); assert.equal(response.status, 409); assert.deepEqual(await response.json(), { code: 'username_taken' });
  });
  await test('wrong API key and denied browser origin never reach database', async () => {
    const w = world(); assert.equal((await w.handler(request(defaults, { headers: { apikey: 'bad' } }))).status, 401);
    assert.equal((await w.handler(request(defaults, { headers: { origin: 'https://evil.test' } }))).status, 403); assert.equal(w.calls.length, 0);
  });
  await test('allowed origin and preflight expose retry information without credentials', async () => {
    const w = world(); const response = await w.handler(request(defaults, { headers: { origin: 'https://luizfelip-dev.github.io' } }));
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://luizfelip-dev.github.io'); assert.equal(response.headers.get('access-control-expose-headers'), 'Retry-After');
    const preflight = await w.handler(new Request('https://example.test/', { method: 'OPTIONS', headers: { origin: 'http://localhost:8765' } })); assert.equal(preflight.status, 204);
  });
  await test('GET is rejected without touching backend', async () => {
    const w = world(); const response = await w.handler(request(defaults, { method: 'GET' })); assert.equal(response.status, 405); assert.equal(w.calls.length, 0);
  });
  await test('JSON type, invalid JSON, arrays and declared oversized bodies rejected', async () => {
    const w = world();
    assert.equal((await w.handler(request(defaults, { headers: { 'content-type': 'text/plain' } }))).status, 415);
    assert.equal((await w.handler(request(defaults, { raw: '{bad' }))).status, 400);
    assert.equal((await w.handler(request([], {}))).status, 400);
    assert.equal((await w.handler(request(defaults, { headers: { 'content-length': '4097' } }))).status, 413);
    assert.equal(w.calls.length, 0);
  });
  await test('streamed body limit works without Content-Length', async () => {
    const w = world();
    const response = await w.handler({ method: 'POST', headers: new Headers({ apikey: apiKey, 'content-type': 'application/json' }), body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); } }) });
    assert.equal(response.status, 413); assert.equal(w.calls.length, 0);
  });
  await test('slow body times out and cancels stream', async () => {
    const w = world({ quickTimeout: true }); let cancelled = false;
    const response = await w.handler({ method: 'POST', headers: new Headers({ apikey: apiKey, 'content-type': 'application/json' }), body: new ReadableStream({ cancel() { cancelled = true; } }) });
    assert.equal(response.status, 408); assert.equal(cancelled, true); assert.equal(w.calls.length, 0);
  });
  await test('no service key or invalid backend URL fails closed', async () => {
    for (const env of [{ SUPABASE_SERVICE_ROLE_KEY: '' }, { SUPABASE_URL: 'http://unsafe.test' }, { SUPABASE_URL: 'https://example.test/path' }]) {
      const w = world({ env }); assert.equal((await w.handler(request())).status, 503); assert.equal(w.calls.length, 0);
    }
  });
  await test('runtime publishable key is accepted instead of fallback', async () => {
    const w = world({ env: { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_rotated_test' }) } });
    assert.equal((await w.handler(request(defaults, { headers: { apikey: 'sb_publishable_rotated_test' } }))).status, 201);
    assert.equal((await w.handler(request())).status, 401);
  });
  await test('network failure never exposes secret or reports success', async () => {
    const w = world({ fetch: async () => { throw new Error('test-only-server-secret'); } });
    const response = await w.handler(request()); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { code: 'signup_unavailable' });
  });
  const report = { passed: result.filter(item => item.passed).length, failed: result.filter(item => !item.passed).length, results: result };
  fs.writeFileSync(require('node:path').join(require('node:os').tmpdir(), 'nivela-edge-unit-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); if (report.failed) process.exitCode = 1;
})();
