'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const APP_ORIGIN = 'https://nivela.test';
const SUPABASE_ORIGIN = 'https://nivela-qa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_nivela_local_tests_only';
const USERS = Object.freeze({
  A: { id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.test', password: 'SenhaAna123!', full_name: 'Ana Teste' },
  B: { id: '22222222-2222-4222-8222-222222222222', email: 'bia@example.test', password: 'SenhaBia123!', full_name: 'Bia Teste' },
});
const clone = value => structuredClone(value);
const jsonResponse = (status, body, headers = {}) => ({ status, body, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const apiError = (status, code, message) => jsonResponse(status, { code, message, msg: message, error_code: code });

// Este transporte é um dublê de HTTP. Ele não valida policies de um PostgreSQL real.
class FakeSupabase {
  constructor(options = {}) {
    this.origin = options.origin || SUPABASE_ORIGIN;
    this.publishableKey = options.publishableKey || PUBLISHABLE_KEY;
    this.confirmEmail = options.confirmEmail !== false;
    this.schema = options.schema || { profiles: { owner: 'user_id' }, transactions: { owner: 'user_id' }, budgets: { owner: 'user_id' }, goals: { owner: 'user_id' }, support_messages: { owner: 'user_id' } };
    this.tables = Object.fromEntries(Object.keys(this.schema).map(name => [name, clone(options.rows?.[name] || [])]));
    this.users = new Map();
    this.authCodes = new Map();
    this.emailFlows = [];
    this.access = new Map();
    this.refresh = new Map();
    this.requests = [];
    this.faults = [];
    this.unhandled = [];
    this.rpc = options.rpc || {};
    this.onUserCreated = options.onUserCreated || (() => {});
    for (const fixture of Object.values(USERS)) this.addUser({ ...fixture, confirmed: true });
  }
  addUser(input) {
    const user = { id: input.id || crypto.randomUUID(), email: input.email, password: input.password, confirmed: input.confirmed !== false, metadata: input.metadata || { full_name: input.full_name || '' } };
    this.users.set(user.id, user);
    return clone(user);
  }
  userPayload(user) {
    const now = new Date().toISOString();
    return { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', created_at: now, updated_at: now, email_confirmed_at: user.confirmed ? now : null, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: clone(user.metadata), identities: [{ id: user.id, identity_id: user.id, user_id: user.id, provider: 'email', identity_data: { sub: user.id, email: user.email } }] };
  }
  issueSession(userId, options = {}) {
    const user = this.users.get(userId);
    if (!user) throw new Error('Unknown mock user');
    const expiresAt = Math.floor(Date.now() / 1000) + (options.expiresIn ?? 3600);
    const payload = { sub: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', exp: expiresAt, iss: `${this.origin}/auth/v1`, session_id: crypto.randomUUID() };
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.mock-signature-not-real`;
    const refreshToken = `mock-refresh-${crypto.randomUUID()}`;
    this.access.set(token, { userId, expiresAt, revoked: false });
    this.refresh.set(refreshToken, userId);
    return { access_token: token, token_type: 'bearer', expires_in: options.expiresIn ?? 3600, expires_at: expiresAt, refresh_token: refreshToken, user: this.userPayload(user) };
  }
  tokenUser(headers = {}) {
    const token = String(headers.authorization || headers.Authorization || '').replace(/^Bearer\s+/i, '');
    const session = this.access.get(token);
    if (!session || session.revoked || session.expiresAt <= Date.now() / 1000) return null;
    return this.users.get(session.userId) || null;
  }
  emailCode(email, kind = 'confirm') {
    const flow = [...this.emailFlows].reverse().find(item => item.email === email && item.kind === kind);
    if (!flow) throw new Error('No mock email flow');
    const user = [...this.users.values()].find(item => item.email === email);
    if (!user) throw new Error('No mock email user');
    if (kind === 'confirm') user.confirmed = true;
    const code = crypto.randomUUID();
    this.authCodes.set(code, { userId: user.id, challenge: flow.challenge });
    const url = new URL(flow.redirect); url.searchParams.set('code', code);
    return url.href;
  }
  failNext(pathname, options = {}) { this.faults.push({ pathname, ...options, status: options.status || 503, once: true }); }
  delayNext(pathname, delayMs, options = {}) { this.faults.push({ pathname, ...options, delayMs, once: true }); }
  async handle(input) {
    const url = new URL(input.url, this.origin);
    const method = input.method || 'GET';
    const headers = Object.fromEntries(Object.entries(input.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const body = typeof input.body === 'string' ? JSON.parse(input.body || 'null') : input.body;
    const user = this.tokenUser(headers);
    const faultIndex = this.faults.findIndex(fault => (!fault.pathname || fault.pathname === url.pathname) && (!fault.method || fault.method === method));
    const fault = faultIndex < 0 ? null : this.faults[faultIndex];
    if (fault?.once) this.faults.splice(faultIndex, 1);
    const record = { method, pathname: url.pathname, query: url.search, userId: user?.id || null, bodyKeys: body && !Array.isArray(body) ? Object.keys(body) : Array.isArray(body) ? ['<batch>'] : [] };
    this.requests.push(record);
    let result;
    if (method === 'OPTIONS') result = jsonResponse(200, {});
    else if (!headers.apikey || headers.apikey !== this.publishableKey) result = apiError(401, 'invalid_api_key', 'Invalid API key');
    else if (fault?.status) result = jsonResponse(fault.status, fault.body || { message: 'Mock temporary failure', code: 'mock_failure' });
    else if (url.pathname.startsWith('/auth/v1/')) result = this.handleAuth({ url, method, headers, body, user });
    else if (url.pathname.startsWith('/rest/v1/')) result = this.handleRest({ url, method, headers, body, user });
    else { this.unhandled.push(record); result = apiError(501, 'mock_unhandled', 'Unsupported mock endpoint'); }
    record.status = result.status;
    if (fault?.delayMs) await new Promise(resolve => setTimeout(resolve, fault.delayMs));
    return result;
  }
  handleAuth({ url, method, headers, body, user }) {
    const endpoint = url.pathname.slice('/auth/v1/'.length);
    if (endpoint === 'signup' && method === 'POST') {
      if (!body?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) return apiError(422, 'validation_failed', 'Invalid email');
      if (typeof body.password !== 'string' || body.password.length < 8) return apiError(422, 'weak_password', 'Password should be at least 8 characters');
      const existing = [...this.users.values()].find(item => item.email === body.email);
      if (existing) return jsonResponse(200, { ...this.userPayload(existing), identities: [] });
      const added = this.addUser({ email: body.email, password: body.password, confirmed: !this.confirmEmail, metadata: body.data || body.user_metadata || {} });
      this.onUserCreated(added, this);
      this.emailFlows.push({ email: added.email, kind: 'confirm', redirect: url.searchParams.get('redirect_to'), challenge: body.code_challenge });
      return jsonResponse(200, this.confirmEmail ? this.userPayload(added) : this.issueSession(added.id));
    }
    if (endpoint === 'token' && method === 'POST') {
      if (url.searchParams.get('grant_type') === 'pkce') {
        const flow = this.authCodes.get(body?.auth_code);
        if (!flow) return apiError(400, 'flow_state_not_found', 'Invalid authorization code');
        const challenge = crypto.createHash('sha256').update(body?.code_verifier || '').digest('base64url');
        if (challenge !== flow.challenge) return apiError(400, 'bad_code_verifier', 'Invalid code verifier');
        this.authCodes.delete(body.auth_code);
        return jsonResponse(200, this.issueSession(flow.userId));
      }
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const userId = this.refresh.get(body?.refresh_token);
        if (!userId) return apiError(400, 'refresh_token_not_found', 'Invalid Refresh Token');
        this.refresh.delete(body.refresh_token);
        return jsonResponse(200, this.issueSession(userId));
      }
      if (url.searchParams.get('grant_type') !== 'password') return apiError(400, 'unsupported_grant_type', 'Unsupported grant type');
      const account = [...this.users.values()].find(item => item.email === body?.email && item.password === body?.password);
      if (!account) return apiError(400, 'invalid_credentials', 'Invalid login credentials');
      if (!account.confirmed) return apiError(400, 'email_not_confirmed', 'Email not confirmed');
      return jsonResponse(200, this.issueSession(account.id));
    }
    if (endpoint === 'recover' && method === 'POST') { this.emailFlows.push({ email: body?.email, kind: 'recovery', redirect: url.searchParams.get('redirect_to'), challenge: body?.code_challenge }); return jsonResponse(200, {}); }
    if (endpoint === 'user' && method === 'GET') return user ? jsonResponse(200, this.userPayload(user)) : apiError(401, 'bad_jwt', 'Invalid JWT');
    if (endpoint === 'user' && method === 'PUT') {
      if (!user) return apiError(401, 'bad_jwt', 'Invalid JWT');
      if (body?.password && body.password.length < 8) return apiError(422, 'weak_password', 'Password should be at least 8 characters');
      if (body?.password) user.password = body.password;
      if (body?.data) user.metadata = { ...user.metadata, ...body.data };
      return jsonResponse(200, this.userPayload(user));
    }
    if (endpoint === 'logout' && method === 'POST') {
      if (!user) return apiError(401, 'bad_jwt', 'Invalid JWT');
      // O logout revoga refresh tokens; access tokens JWT ainda podem valer até expirar.
      for (const [token, userId] of this.refresh) if (userId === user.id) this.refresh.delete(token);
      return { status: 204, body: null, headers: {} };
    }
    this.unhandled.push({ method, pathname: url.pathname });
    return apiError(501, 'mock_unhandled_auth', 'Unsupported mock Auth endpoint');
  }
  matches(row, params) {
    const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
    for (const [column, filter] of params) {
      if (reserved.has(column)) continue;
      const dot = filter.indexOf('.');
      if (dot < 0) throw new Error('Unsupported filter');
      const op = filter.slice(0, dot), raw = filter.slice(dot + 1), value = row[column];
      const expected = raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : raw;
      const equal = expected === null ? value == null : String(value) === String(expected);
      if (op === 'eq' && !equal || op === 'neq' && equal || op === 'is' && !equal) return false;
      if (op === 'gte' && !(value >= expected) || op === 'lte' && !(value <= expected) || op === 'gt' && !(value > expected) || op === 'lt' && !(value < expected)) return false;
      if (op === 'in' && !raw.replace(/^\(|\)$/g, '').split(',').includes(String(value))) return false;
      if (!['eq', 'neq', 'is', 'gte', 'lte', 'gt', 'lt', 'in'].includes(op)) throw new Error('Unsupported filter operator');
    }
    return true;
  }
  validate(table, row, user) {
    const rule = this.schema[table];
    if (row[rule.owner || 'user_id'] !== user.id) return apiError(403, '42501', 'new row violates row-level security policy');
    for (const [key, value] of Object.entries(row)) {
      if (key.endsWith('_cents') && (!Number.isSafeInteger(value) || key !== 'opening_balance_cents' && value < 0 || key === 'amount_cents' && value === 0)) return apiError(400, '23514', 'Check constraint violated');
    }
    const error = rule.validate?.(row);
    return error ? apiError(400, '23514', error) : null;
  }
  handleRest({ url, method, headers, body, user }) {
    if (!user) return apiError(401, 'PGRST301', 'JWT required');
    const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
    if (table.startsWith('rpc/')) {
      const name = table.slice(4);
      if (!this.rpc[name]) { this.unhandled.push({ method, pathname: url.pathname }); return apiError(501, 'mock_rpc_unhandled', 'Unsupported mock RPC'); }
      return this.rpc[name]({ body, user: this.userPayload(user), backend: this, headers, url, method });
    }
    if (!this.schema[table]) { this.unhandled.push({ method, pathname: url.pathname }); return apiError(404, 'PGRST205', 'Could not find table in schema cache'); }
    if (this.schema[table].methods && !this.schema[table].methods.includes(method)) return apiError(403, '42501', 'Permission denied for table');
    const owner = this.schema[table].owner || 'user_id';
    const all = this.tables[table];
    let rows;
    try { rows = all.filter(row => row[owner] === user.id && this.matches(row, url.searchParams)); }
    catch (error) { this.unhandled.push({ method, pathname: url.pathname, reason: error.message }); return apiError(400, 'PGRST100', error.message); }
    const representation = (headers.prefer || '').includes('return=representation');
    let output;
    if (method === 'GET' || method === 'HEAD') {
      const count = rows.length;
      const orders = (url.searchParams.get('order') || '').split(',').filter(Boolean).map(order => order.split('.'));
      if (orders.length) rows.sort((a, b) => { for (const [column, direction] of orders) { const comparison = (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (direction === 'desc' ? -1 : 1); if (comparison) return comparison; } return 0; });
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || count);
      rows = rows.slice(offset, offset + limit);
      const selected = url.searchParams.get('select');
      if (selected && selected !== '*') rows = rows.map(row => Object.fromEntries(selected.split(',').map(key => [key, row[key]])));
      if ((headers.accept || '').includes('application/vnd.pgrst.object+json')) return rows.length === 1 ? jsonResponse(200, clone(rows[0])) : apiError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
      return jsonResponse(200, method === 'HEAD' ? null : clone(rows), { 'content-range': `0-${Math.max(0, rows.length - 1)}/${count}` });
    }
    if (method === 'POST') {
      const batch = Array.isArray(body) ? body : [body];
      output = batch.map(input => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...input, [owner]: input?.[owner] || user.id }));
      for (const row of output) { const invalid = this.validate(table, row, user); if (invalid) return invalid; }
      const merge = (headers.prefer || '').includes('resolution=merge-duplicates');
      const ignore = (headers.prefer || '').includes('resolution=ignore-duplicates');
      const produced = [];
      const keys = (url.searchParams.get('on_conflict') || 'id').split(',');
      const next = clone(all);
      for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
        const row = output[outputIndex];
        const index = next.findIndex(existing => keys.every(key => existing[key] === row[key]));
        if (index >= 0) {
          if (ignore && next[index][owner] === user.id) continue;
          if (!merge || next[index][owner] !== user.id) return apiError(409, '23505', 'Unique constraint violated');
          next[index] = { ...next[index], ...row, id: Object.hasOwn(batch[outputIndex], 'id') ? row.id : next[index].id };
          output[outputIndex] = next[index];
        } else next.push(row);
        produced.push(output[outputIndex]);
      }
      this.tables[table] = next;
      return representation ? jsonResponse(201, clone(produced)) : { status: 201, body: null, headers: {} };
    }
    if (method === 'PATCH') {
      output = rows.map(row => ({ ...row, ...body }));
      for (const row of output) { const invalid = this.validate(table, row, user); if (invalid) return invalid; }
      const updates = new Map(output.map(row => [row.id, row]));
      this.tables[table] = all.map(row => updates.get(row.id) || row);
    } else if (method === 'DELETE') {
      output = rows;
      const ids = new Set(rows.map(row => row.id));
      this.tables[table] = all.filter(row => !ids.has(row.id));
    } else return apiError(405, 'method_not_allowed', 'Unsupported method');
    return representation ? jsonResponse(200, clone(output)) : { status: 204, body: null, headers: {} };
  }
}

async function createContext(browser, options = {}) {
  const root = options.root || path.resolve(__dirname, '../..');
  const backend = options.backend || new FakeSupabase();
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, locale: 'pt-BR', reducedMotion: options.reducedMotion || 'no-preference' });
  const errors = [], blocked = [];
  context.on('page', page => page.on('pageerror', error => errors.push({ url: page.url(), message: error.message })));
  if (options.storageSeed) await context.addInitScript(seed => {
    if (location.origin !== 'https://nivela.test') return;
    if (sessionStorage.getItem('__qa_storage_seeded')) return;
    for (const [name, entries] of Object.entries(seed)) for (const [key, value] of Object.entries(entries)) window[name].setItem(key, value);
    sessionStorage.setItem('__qa_storage_seeded', 'true');
  }, options.storageSeed);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === backend.origin) {
      const result = await backend.handle({ url: url.href, method: request.method(), headers: request.headers(), body: request.postData() });
      const headers = { 'access-control-allow-origin': APP_ORIGIN, 'access-control-allow-headers': 'apikey, authorization, content-type, prefer, x-client-info, range, range-unit, accept-profile, content-profile', 'access-control-expose-headers': 'content-range, range-unit', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', ...result.headers };
      return route.fulfill({ status: result.status, headers, body: result.body == null ? '' : JSON.stringify(result.body) });
    }
    if (url.origin !== APP_ORIGIN) { blocked.push(url.href); return route.abort(); }
    const relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    if (Object.hasOwn(options.overrides || {}, relative)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: options.overrides[relative] });
    const target = path.resolve(root, relative);
    if (!target.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return route.fulfill({ status: 404, body: 'not found' });
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(target)] || 'application/octet-stream';
    return route.fulfill({ status: 200, contentType, body: fs.readFileSync(target) });
  });
  return { context, backend, errors, blocked, async open(pathname = '/login.html') { const page = await context.newPage(); page.setDefaultTimeout(7000); await page.goto(APP_ORIGIN + pathname, { waitUntil: 'load' }); return page; } };
}
module.exports = { FakeSupabase, createContext, APP_ORIGIN, SUPABASE_ORIGIN, PUBLISHABLE_KEY, USERS };
