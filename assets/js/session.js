(() => {
  "use strict";

  const loginPage = location.pathname.endsWith("/login.html");
  const config = window.NivelaConfig || {};
  let baseUrl = "";
  try {
    const url = new URL(config.supabaseUrl);
    if (url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) baseUrl = url.origin;
  } catch { /* A configuração incompleta mantém o acesso fechado. */ }
  const configured = Boolean(baseUrl && /^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey || ""));
  const prefix = `nivela.auth.v2:${baseUrl || "unconfigured"}`;
  const sessionKey = `${prefix}:session`;
  const logoutKey = `${prefix}:logout`;
  const browserKey = `${prefix}:browser`;
  const usernamePattern = /^[a-z0-9_]{3,24}$/;
  const listeners = new Set();
  let session = null;
  let user = null;
  let lastError = null;
  let refreshPromise;
  let refreshTimer;
  let epoch = 0;
  let adoptionSequence = 0;
  let channel;
  try { channel = new BroadcastChannel(`${prefix}:events`); } catch { /* storage também sincroniza a saída. */ }

  class AuthError extends Error {
    constructor(message, code = "auth_error", status = 0, retryAfter = 0) {
      super(message);
      this.name = "NivelaAuthError";
      this.code = code;
      this.status = status;
      this.retryAfter = retryAfter;
    }
  }

  function friendlyError(status, code) {
    const messages = {
      invalid_credentials: "Usuário ou senha incorretos. Confira os dados e tente novamente.",
      username_taken: "Este usuário já está em uso. Escolha outro.",
      username_exists: "Este usuário já está em uso. Escolha outro.",
      user_already_exists: "Este usuário já está em uso. Escolha outro.",
      invalid_username: "Use de 3 a 24 letras sem acento, números ou sublinhado no usuário.",
      invalid_password: "Use uma senha com pelo menos 8 caracteres, sem contar espaços nas pontas.",
      password_too_long: "Esta senha é muito longa. Reduza a quantidade de caracteres.",
      invalid_browser: "Não foi possível preparar o cadastro neste navegador. Recarregue a página e tente novamente.",
      signup_rate_limited: "Muitas tentativas de cadastro. Aguarde alguns minutos e tente novamente.",
      signup_unavailable: "O cadastro está temporariamente indisponível. Tente novamente em instantes.",
      weak_password: "Escolha uma senha mais forte, com pelo menos 8 caracteres.",
      validation_failed: "Confira os campos preenchidos e tente novamente.",
      signup_disabled: "O cadastro de novas contas não está disponível neste momento.",
      over_request_rate_limit: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      session_not_found: "Sua sessão terminou. Entre novamente para continuar.",
      refresh_token_not_found: "Sua sessão terminou. Entre novamente para continuar.",
      refresh_token_already_used: "Sua sessão terminou. Entre novamente para continuar.",
    };
    if (messages[code]) return messages[code];
    if (status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    if (status === 401) return "Sua sessão terminou. Entre novamente para continuar.";
    if (status === 403) return "Você não tem permissão para concluir esta ação.";
    if (status >= 500) return "O serviço está temporariamente indisponível. Tente novamente em instantes.";
    return "Não foi possível concluir a ação. Confira os dados e tente novamente.";
  }

  function retryDelay(value) {
    if (value === undefined || value === null || value === "") return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(86400, Math.ceil(seconds));
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, Math.min(86400, Math.ceil((date - Date.now()) / 1000))) : 0;
  }

  function rateLimitMessage(seconds) {
    if (!seconds) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    const amount = seconds < 60 ? seconds : seconds < 3600 ? Math.ceil(seconds / 60) : Math.ceil(seconds / 3600);
    const unit = seconds < 60 ? "segundo" : seconds < 3600 ? "minuto" : "hora";
    return `Muitas tentativas. Aguarde cerca de ${amount} ${unit}${amount === 1 ? "" : "s"} e tente novamente.`;
  }

  function readStore(name, key) {
    try { return window[name].getItem(key); } catch { return null; }
  }
  function writeStore(name, key, value) {
    try { window[name].setItem(key, value); return true; } catch { return false; }
  }
  function removeStore(name, key) {
    try { window[name].removeItem(key); } catch { /* A sessão em memória também é removida. */ }
  }

  function readStoredSession(preferShared = false) {
    for (const name of preferShared ? ["localStorage", "sessionStorage"] : ["sessionStorage", "localStorage"]) {
      try {
        const saved = JSON.parse(readStore(name, sessionKey) || "null");
        if (saved?.version === 2 && saved.project === baseUrl
          && typeof saved.access_token === "string" && saved.access_token.length > 10
          && typeof saved.refresh_token === "string" && saved.refresh_token.length > 5
          && Number.isFinite(saved.expires_at)
          && (name !== "localStorage" || saved.remember === true)) return saved;
      } catch { /* Dados locais corrompidos não autenticam ninguém. */ }
    }
    return null;
  }

  function persistSession() {
    if (!session) return;
    const target = session.remember ? "localStorage" : "sessionStorage";
    if (!writeStore(target, sessionKey, JSON.stringify(session))) throw new AuthError("Permita o armazenamento neste navegador para manter sua sessão.", "storage_unavailable");
    removeStore(target === "localStorage" ? "sessionStorage" : "localStorage", sessionKey);
  }

  function emit(event) {
    const detail = { event, user };
    listeners.forEach((listener) => { try { listener(detail); } catch { /* Um observador não interrompe a autenticação. */ } });
    window.dispatchEvent(new CustomEvent("nivela:authchange", { detail }));
  }

  function clearSession(event = "SIGNED_OUT") {
    const previous = session;
    epoch += 1;
    clearTimeout(refreshTimer);
    session = null;
    user = null;
    // Uma resposta atrasada da conta anterior não apaga a sessão nova de outra aba.
    try {
      const shared = JSON.parse(readStore("localStorage", sessionKey) || "null");
      if (previous && (shared?.access_token === previous.access_token || shared?.refresh_token === previous.refresh_token)) removeStore("localStorage", sessionKey);
    } catch { /* Uma entrada local inválida nunca é aceita como autenticação. */ }
    removeStore("sessionStorage", sessionKey);
    emit(event);
  }

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const headers = new Headers(options.headers || {});
    headers.set("apikey", config.publishableKey || "");
    headers.set("Accept", "application/json");
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    try {
      const response = await fetch(url, {
        method: options.method || "GET", headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: "omit", cache: "no-store", signal: controller.signal,
        keepalive: options.keepalive === true,
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { /* Não insere respostas HTML na interface. */ }
      if (!response.ok) {
        const code = payload?.error_code || payload?.code || payload?.error || "request_failed";
        const retryAfter = retryDelay(payload?.retryAfter ?? payload?.retry_after ?? response.headers?.get?.("Retry-After"));
        const message = response.status === 429 ? rateLimitMessage(retryAfter) : friendlyError(response.status, code);
        throw new AuthError(message, String(code), response.status, retryAfter);
      }
      return payload;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError("Não foi possível conectar. Confira sua conexão e tente novamente.", "network_error");
    } finally { clearTimeout(timeout); }
  }

  function requireConfig() {
    if (!configured) throw new AuthError("O acesso à conta ainda está sendo preparado. Tente novamente mais tarde.", "configuration_missing");
  }
  function authRequest(path, options = {}, token) {
    requireConfig();
    const headers = new Headers(options.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetchJson(`${baseUrl}/auth/v1/${path}`, { ...options, headers });
  }
  async function validateUser(token) {
    const verified = await authRequest("user", {}, token);
    if (!verified || typeof verified.id !== "string" || !verified.id || !verified.email) throw new AuthError("Não foi possível validar sua sessão. Entre novamente.", "invalid_session", 401);
    const alias = String(verified.email).match(/^([a-z0-9_]{3,24})@accounts\.nivela\.invalid$/);
    return Object.freeze({ ...verified, username: alias?.[1] || "" });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!session || !user) return;
    const delay = Math.max(5000, Math.min(session.expires_at * 1000 - Date.now() - 60000, 2147483647));
    const expectedEpoch = epoch;
    refreshTimer = setTimeout(() => refreshSession().catch((error) => {
      if (epoch === expectedEpoch) { lastError = error; emit("REFRESH_ERROR"); }
    }), delay);
  }

  async function acceptSession(payload, remember, expectedEpoch = epoch, expectedUserId = null) {
    if (!payload?.access_token || !payload.refresh_token || !(Number(payload.expires_in) > 0) || !Number.isFinite(Number(payload.expires_in))) throw new AuthError("A resposta de acesso não pôde ser validada. Tente novamente.", "invalid_session");
    const verified = await validateUser(payload.access_token);
    if (expectedEpoch !== epoch) throw new AuthError("Esta sessão foi encerrada. Entre novamente.", "session_changed", 401);
    if (expectedUserId && verified.id !== expectedUserId) throw new AuthError("A conta conectada mudou. Recarregue a página para continuar.", "session_changed", 409);
    const previousUserId = user?.id;
    session = { version: 2, project: baseUrl, access_token: payload.access_token, refresh_token: payload.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in), remember: remember === true };
    user = verified;
    try { persistSession(); } catch (error) { clearSession(); throw error; }
    lastError = null;
    scheduleRefresh();
    emit("SIGNED_IN");
    if (previousUserId !== user?.id) {
      try { channel?.postMessage({ type: "SIGNED_IN", userId: user?.id, remember: session?.remember }); } catch { /* storage também compartilha sessões persistentes. */ }
    }
    if (!session || epoch !== expectedEpoch) throw new AuthError("Esta sessão foi encerrada. Entre novamente.", "session_changed", 409);
    if (!loginPage && previousUserId && previousUserId !== user.id) location.reload();
    return user;
  }

  function refreshSession(force = false) {
    if (refreshPromise) return refreshPromise;
    const run = async () => {
      if (!session) throw new AuthError("Entre na sua conta para continuar.", "session_missing", 401);
      const expectedEpoch = epoch;
      if (session.remember) {
        const latest = readStoredSession();
        if (latest?.remember && latest.refresh_token !== session.refresh_token) {
          const verified = await validateUser(latest.access_token);
          if (epoch !== expectedEpoch) throw new AuthError("Sua sessão terminou. Entre novamente.", "session_changed", 401);
          session = latest; user = verified;
        }
      }
      if (!force && session.expires_at * 1000 > Date.now() + 60000) { scheduleRefresh(); return session.access_token; }
      const current = session;
      try {
        const payload = await authRequest("token?grant_type=refresh_token", { method: "POST", body: { refresh_token: current.refresh_token } });
        await acceptSession(payload, current.remember, expectedEpoch, user?.id || null);
        emit("TOKEN_REFRESHED");
        return session.access_token;
      } catch (error) {
        if ([400, 401, 403].includes(error.status) && epoch === expectedEpoch) clearSession("SESSION_EXPIRED");
        throw error;
      }
    };
    const work = () => navigator.locks?.request ? navigator.locks.request(`${prefix}:refresh`, run) : run();
    refreshPromise = Promise.resolve().then(work).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function base64url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function initialize() {
    const initializationEpoch = epoch;
    try {
      requireConfig();
      session = readStoredSession();
      if (!session) return null;
      const expectedEpoch = epoch;
      if (session.expires_at * 1000 <= Date.now() + 60000) await refreshSession();
      else {
        try {
          const verified = await validateUser(session.access_token);
          if (epoch !== expectedEpoch) return null;
          user = verified;
        }
        catch (error) {
          if (epoch !== initializationEpoch) return user;
          if (error.status !== 401) throw error;
          await refreshSession(true);
        }
      }
      scheduleRefresh();
      return user;
    } catch (error) {
      if (epoch !== initializationEpoch) return user;
      lastError = error;
      user = null;
      if ([400, 401, 403].includes(error.status)) clearSession("SESSION_EXPIRED");
      return null;
    }
  }

  const ready = initialize();
  async function getAccessToken() {
    await ready;
    requireConfig();
    if (!session || !user) throw new AuthError("Entre na sua conta para continuar.", "session_missing", 401);
    const expectedEpoch = epoch;
    const expectedUserId = user.id;
    if (session.expires_at * 1000 <= Date.now() + 60000) await refreshSession();
    if (!session || epoch !== expectedEpoch || user?.id !== expectedUserId) throw new AuthError("A conta conectada mudou. Recarregue a página para continuar.", "session_changed", 409);
    return session.access_token;
  }

  async function request(path, options = {}) {
    await ready;
    requireConfig();
    const expectedUserId = user?.id;
    const expectedEpoch = epoch;
    const checkIdentity = () => {
      if (!expectedUserId || epoch !== expectedEpoch || user?.id !== expectedUserId) throw new AuthError("A conta conectada mudou. Recarregue a página para continuar.", "session_changed", 409);
    };
    if (typeof path !== "string" || /^(?:[a-z]+:)?\/\//i.test(path)) throw new AuthError("Endereço de dados inválido.", "invalid_path");
    const relative = path.replace(/^\/?rest\/v1\//, "").replace(/^\//, "");
    const endpoint = new URL(`${baseUrl}/rest/v1/${relative}`);
    if (endpoint.origin !== baseUrl || !endpoint.pathname.startsWith("/rest/v1/")) throw new AuthError("Endereço de dados inválido.", "invalid_path");
    const execute = async (token) => {
      checkIdentity();
      const headers = new Headers(options.headers || {});
      headers.set("Authorization", `Bearer ${token}`);
      const result = await fetchJson(endpoint.href, { ...options, headers });
      checkIdentity();
      return result;
    };
    try { return await execute(await getAccessToken()); }
    catch (error) {
      if (error.status !== 401 || !session || !user) throw error;
      checkIdentity();
      await refreshSession(true);
      checkIdentity();
      // Um único reenvio após 401. Erros de RLS (403) não iniciam um loop.
      try { return await execute(session.access_token); }
      catch (retryError) {
        checkIdentity();
        if (retryError.status === 401) clearSession("SESSION_EXPIRED");
        throw retryError;
      }
    }
  }

  function credentials(username, password) {
    const normalized = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!usernamePattern.test(normalized)) throw new AuthError(friendlyError(422, "invalid_username"), "invalid_username", 422);
    if (typeof password !== "string" || Array.from(password.trim()).length < 8) throw new AuthError(friendlyError(422, "invalid_password"), "invalid_password", 422);
    if (new TextEncoder().encode(password).length > 72) throw new AuthError(friendlyError(422, "password_too_long"), "password_too_long", 422);
    return normalized;
  }

  function browserId() {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const name of ["localStorage", "sessionStorage"]) {
      const saved = readStore(name, browserKey);
      if (pattern.test(saved || "")) return saved;
    }
    if (!crypto.randomUUID) throw new AuthError("Abra o Nivela por uma conexão HTTPS para criar sua conta.", "secure_context_required");
    const id = crypto.randomUUID();
    for (const name of ["localStorage", "sessionStorage"]) {
      if (writeStore(name, browserKey, id) && readStore(name, browserKey) === id) return id;
    }
    throw new AuthError("Permita o armazenamento neste navegador para criar sua conta.", "storage_unavailable");
  }

  async function passwordSignIn(username, password, remember, expectedEpoch) {
    if (epoch !== expectedEpoch) throw new AuthError("A conta conectada mudou. Entre novamente.", "session_changed", 409);
    // O endereço é um identificador interno exigido pelo Auth; nunca é solicitado na interface.
    const payload = await authRequest("token?grant_type=password", { method: "POST", body: { email: `${username}@accounts.nivela.invalid`, password } });
    return acceptSession(payload, remember, expectedEpoch);
  }

  async function signIn(username, password, remember = false) {
    await ready;
    requireConfig();
    const normalized = credentials(username, password);
    const expectedEpoch = ++epoch;
    return passwordSignIn(normalized, password, remember, expectedEpoch);
  }

  async function signUp(username, password, website = "") {
    await ready;
    requireConfig();
    const normalized = credentials(username, password);
    const device = browserId();
    const expectedEpoch = ++epoch;
    const result = await fetchJson(`${baseUrl}/functions/v1/nivela-auth`, {
      method: "POST", body: { username: normalized, password, browserId: device, website: String(website) },
    });
    if (epoch !== expectedEpoch) throw new AuthError("A conta conectada mudou. Entre novamente.", "session_changed", 409);
    if (result?.created !== true) throw new AuthError("Não foi possível concluir o cadastro. Tente novamente.", "registration_failed");
    try {
      return await passwordSignIn(normalized, password, false, expectedEpoch);
    } catch (error) {
      if (error.code === "session_changed") throw error;
      throw new AuthError("Sua conta foi criada. Entre com seu usuário e senha para continuar.", "registration_login_failed", error.status, error.retryAfter);
    }
  }
  async function signOut() {
    const token = session?.access_token;
    clearSession();
    const notice = { type: "SIGNED_OUT", at: Date.now(), id: base64url(crypto.getRandomValues(new Uint8Array(12))) };
    try { channel?.postMessage(notice); } catch { /* storage também sincroniza a saída. */ }
    writeStore("localStorage", logoutKey, JSON.stringify(notice));
    if (token && configured) {
      try { await authRequest("logout?scope=local", { method: "POST", keepalive: true }, token); }
      catch (error) { lastError = error; return { remote: false }; }
    }
    return { remote: true };
  }

  async function adoptSharedSession(preferShared = false) {
    const saved = readStoredSession(preferShared);
    if (!saved) { clearSession(); if (!loginPage) location.replace("login.html"); return; }
    const previousUserId = user?.id;
    const expectedEpoch = epoch;
    const adoption = ++adoptionSequence;
    try {
      const verified = await validateUser(saved.access_token);
      if (epoch !== expectedEpoch || adoption !== adoptionSequence) return;
      // A rotação do token da mesma pessoa não invalida uma gravação em andamento.
      if (previousUserId !== verified.id) epoch += 1;
      session = saved; user = verified; scheduleRefresh(); emit("SIGNED_IN");
      if (saved.remember) removeStore("sessionStorage", sessionKey);
      if (!loginPage && previousUserId && previousUserId !== user.id) location.reload();
    } catch (error) {
      if (epoch !== expectedEpoch || adoption !== adoptionSequence) return;
      lastError = error;
      if ([400, 401, 403].includes(error.status)) { clearSession("SESSION_EXPIRED"); if (!loginPage) location.replace("login.html"); }
    }
  }

  window.NivelaSession = Object.freeze({
    ready, getUser: () => user, getAccessToken, request, signIn, signUp, signOut,
    isConfigured: () => configured, getLastError: () => lastError,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
  ready.then((verified) => { if (!loginPage && !verified) location.replace("login.html"); });
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-sign-out]").forEach((button) => button.addEventListener("click", async (event) => {
      event.preventDefault(); button.disabled = true;
      await signOut(); location.replace("login.html");
    }));
  });
  window.addEventListener("storage", (event) => {
    if (event.key === logoutKey && event.newValue) { clearSession(); if (!loginPage) location.replace("login.html"); }
    else if (event.key === sessionKey) adoptSharedSession(Boolean(event.newValue)).catch(() => {});
  });
  if (channel) channel.onmessage = (event) => {
    if (event.data?.type === "SIGNED_OUT") { clearSession(); if (!loginPage) location.replace("login.html"); }
    else if (event.data?.type === "SIGNED_IN" && user && event.data.userId !== user.id) {
      if (event.data.remember) adoptSharedSession(true).catch(() => {});
      else { clearSession(); if (!loginPage) location.replace("login.html"); }
    }
  };
  window.addEventListener("focus", () => {
    if (!session || !user) return;
    const expectedEpoch = epoch;
    getAccessToken().then((token) => validateUser(token)).then((verified) => {
      if (session && epoch === expectedEpoch) { user = verified; emit("USER_VALIDATED"); }
    }).catch((error) => {
      lastError = error;
      if ([400, 401, 403].includes(error.status) && epoch === expectedEpoch) { clearSession("SESSION_EXPIRED"); if (!loginPage) location.replace("login.html"); }
    });
  });
})();
