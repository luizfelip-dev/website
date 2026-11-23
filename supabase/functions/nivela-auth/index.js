const publicKeyFallback = "sb_publishable_GRrC-WLIb42OQLRyGmFbEA__KOhp_tk";
const allowedOrigins = new Set([
  "https://luizfelip-dev.github.io",
  "http://localhost:8000",
  "http://localhost:8765",
  "http://127.0.0.1:8000",
  "http://127.0.0.1:8765",
]);
const encoder = new TextEncoder();
const usernamePattern = /^[a-z0-9_]{3,24}$/;
const browserPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumBodyBytes = 4096;
const hashKeys = new Map();

class RequestError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function headersFor(origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "apikey, content-type";
    headers["Access-Control-Expose-Headers"] = "Retry-After";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

function reply(status, payload, origin, extra = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { ...headersFor(origin), ...extra } });
}

function publishableKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    if (typeof keys.default === "string" && /^sb_publishable_/.test(keys.default)) return keys.default;
  } catch { /* A chave pública local também permite a configuração inicial. */ }
  return publicKeyFallback;
}

async function readBody(request) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBodyBytes)) throw new RequestError(413, "body_too_large");
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") || "")) throw new RequestError(415, "invalid_json");
  if (!request.body) throw new RequestError(400, "invalid_json");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  let timeout;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new RequestError(408, "body_timeout"));
      reader.cancel().catch(() => {});
    }, 10000);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), expired]);
      if (done) break;
      total += value.byteLength;
      if (total > maximumBodyBytes) {
        await reader.cancel();
        throw new RequestError(413, "body_too_large");
      }
      chunks.push(value);
    }
  } finally { clearTimeout(timeout); reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new RequestError(400, "invalid_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError(400, "invalid_json");
  return body;
}

function clientAddress(request) {
  // No serviço hospedado, este cabeçalho é definido pela borda da plataforma.
  const address = (request.headers.get("cf-connecting-ip") || "").trim().toLowerCase();
  if (!address || address.length > 64 || /[,\s%]/.test(address)) throw new RequestError(503, "signup_unavailable");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
    const octets = address.split(".");
    if (octets.some((part) => Number(part) > 255)) throw new RequestError(503, "signup_unavailable");
    return octets.map(Number).join(".");
  }
  if (!address.includes(":")) throw new RequestError(503, "signup_unavailable");
  let canonical;
  try { canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1); }
  catch { throw new RequestError(503, "signup_unavailable"); }
  // Agrupar IPv6 por /64 evita multiplicar cadastros trocando só o endereço local.
  const sides = canonical.split("::");
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const groups = sides.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) throw new RequestError(503, "signup_unavailable");
  if (groups.slice(0, 5).every((group) => Number.parseInt(group, 16) === 0) && Number.parseInt(groups[5], 16) === 65535) {
    const high = Number.parseInt(groups[6], 16); const low = Number.parseInt(groups[7], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
}

async function identifierHash(secret, purpose, value) {
  if (!hashKeys.has(purpose)) {
    hashKeys.set(purpose, (async () => {
      const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("nivela-signup-v1"), info: encoder.encode(purpose) }, material,
        { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
    })());
  }
  const key = await hashKeys.get(purpose);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function serverRequest(baseUrl, secret, path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(baseUrl + path, {
      method: "POST",
      headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    return { status: response.status, ok: response.ok, payload };
  } catch { throw new RequestError(503, "signup_unavailable"); }
  finally { clearTimeout(timeout); }
}

async function handleRequest(request) {
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) return reply(403, { code: "origin_not_allowed" }, origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headersFor(origin) });
  if (request.method !== "POST") return reply(405, { code: "method_not_allowed" }, origin, { Allow: "POST, OPTIONS" });
  if (request.headers.get("apikey") !== publishableKey()) return reply(401, { code: "invalid_api_key" }, origin);

  try {
    const body = await readBody(request);
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!usernamePattern.test(username)) throw new RequestError(422, "invalid_username");
    if (typeof body.password !== "string" || Array.from(body.password.trim()).length < 8) throw new RequestError(422, "weak_password");
    if (encoder.encode(body.password).byteLength > 72) throw new RequestError(422, "password_too_long");
    if (typeof body.browserId !== "string" || !browserPattern.test(body.browserId)) throw new RequestError(422, "invalid_browser");
    if (body.website !== undefined && (typeof body.website !== "string" || body.website.trim() !== "")) throw new RequestError(422, "signup_unavailable");

    const address = clientAddress(request);
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const configuredUrl = Deno.env.get("SUPABASE_URL") || "";
    let baseUrl;
    try {
      const parsed = new URL(configuredUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error();
      baseUrl = parsed.origin;
    } catch { throw new RequestError(503, "signup_unavailable"); }
    if (!secret) throw new RequestError(503, "signup_unavailable");

    const [ipHash, browserHash] = await Promise.all([
      identifierHash(secret, "ip", address),
      identifierHash(secret, "browser", body.browserId.toLowerCase()),
    ]);
    const reservation = await serverRequest(baseUrl, secret, "/rest/v1/rpc/reserve_nivela_signup", { p_ip_hash: ipHash, p_browser_hash: browserHash });
    const quota = Array.isArray(reservation.payload) ? reservation.payload[0] : reservation.payload;
    if (!reservation.ok || typeof quota?.allowed !== "boolean") throw new RequestError(503, "signup_unavailable");
    if (!quota.allowed) {
      const retryAfter = Math.max(1, Math.min(86400, Math.ceil(Number(quota.retryAfter) || 60)));
      return reply(429, { code: "signup_rate_limited", retryAfter }, origin, { "Retry-After": String(retryAfter) });
    }

    const created = await serverRequest(baseUrl, secret, "/auth/v1/admin/users", {
      email: `${username}@accounts.nivela.invalid`, password: body.password, email_confirm: true,
      user_metadata: { username, full_name: username },
      app_metadata: { nivela_registration: "server-v1" },
    });
    if (!created.ok) {
      const code = created.payload?.error_code || created.payload?.code;
      if (["email_exists", "user_already_exists"].includes(code)) throw new RequestError(409, "username_taken");
      if (code === "weak_password") throw new RequestError(422, "weak_password");
      if (created.status === 429) return reply(429, { code: "signup_rate_limited", retryAfter: 60 }, origin, { "Retry-After": "60" });
      throw new RequestError(503, "signup_unavailable");
    }
    if (typeof created.payload?.id !== "string" || !created.payload.id) throw new RequestError(503, "signup_unavailable");
    return reply(201, { created: true }, origin);
  } catch (error) {
    if (error instanceof RequestError) return reply(error.status, { code: error.code }, origin);
    return reply(503, { code: "signup_unavailable" }, origin);
  }
}

Deno.serve(handleRequest);
