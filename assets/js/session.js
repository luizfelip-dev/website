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
  const flowPrefix = `${prefix}:pkce:`;
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
    constructor(message, code = "auth_error", status = 0) {
      super(message);
      this.name = "NivelaAuthError";
      this.code = code;
      this.status = status;
    }
  }

  function friendlyError(status, code) {
    const messages = {
      invalid_credentials: "E-mail ou senha incorretos. Confira os dados e tente novamente.",
      email_not_confirmed: "Confirme seu e-mail pelo link recebido antes de entrar.",
      email_exists: "Não foi possível criar esta conta. Entre ou recupere sua senha.",
      user_already_exists: "Não foi possível criar esta conta. Entre ou recupere sua senha.",
      weak_password: "Escolha uma senha mais forte, com pelo menos 8 caracteres.",
      same_password: "Escolha uma senha diferente da senha atual.",
      otp_expired: "Este link expirou ou já foi utilizado. Solicite um novo link.",
      flow_state_expired: "Este link expirou. Solicite um novo link.",
      flow_state_not_found: "Este link não está mais disponível. Solicite um novo link.",
      bad_code_verifier: "Abra o link no mesmo navegador em que ele foi solicitado, ou solicite outro link.",
      validation_failed: "Confira os campos preenchidos e tente novamente.",
      signup_disabled: "O cadastro de novas contas não está disponível neste momento.",
      over_email_send_rate_limit: "Aguarde alguns minutos antes de solicitar outro e-mail.",
      over_request_rate_limit: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      email_address_invalid: "Informe um endereço de e-mail válido.",
      email_address_not_authorized: "Não foi possível enviar o e-mail para este endereço. Tente novamente mais tarde.",
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
        throw new AuthError(friendlyError(response.status, code), String(code), response.status);
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
    return Object.freeze({ ...verified });
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

  async function acceptSession(payload, remember, recovery = false, expectedEpoch = epoch, expectedUserId = null) {
    if (!payload?.access_token || !payload.refresh_token || !(Number(payload.expires_in) > 0) || !Number.isFinite(Number(payload.expires_in))) throw new AuthError("A resposta de acesso não pôde ser validada. Tente novamente.", "invalid_session");
    const verified = await validateUser(payload.access_token);
    if (expectedEpoch !== epoch) throw new AuthError("Esta sessão foi encerrada. Entre novamente.", "session_changed", 401);
    if (expectedUserId && verified.id !== expectedUserId) throw new AuthError("A conta conectada mudou. Recarregue a página para continuar.", "session_changed", 409);
    const previousUserId = user?.id;
    session = { version: 2, project: baseUrl, access_token: payload.access_token, refresh_token: payload.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in), remember: remember === true, recovery: recovery === true };
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
        await acceptSession(payload, current.remember, current.recovery, expectedEpoch, user?.id || null);
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
  async function createFlow(kind) {
    requireConfig();
    if (!crypto.subtle || !crypto.getRandomValues) throw new AuthError("Abra o Nivela por uma conexão HTTPS para continuar.", "secure_context_required");
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const id = base64url(crypto.getRandomValues(new Uint8Array(18)));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const record = { verifier, kind, project: baseUrl, expiresAt: Date.now() + 86400000 };
    // Um verificador temporário permite abrir o e-mail em outra aba do mesmo navegador.
    // Sem Manter conectado, os tokens de sessão ficam somente em sessionStorage.
    if (!writeStore("localStorage", flowPrefix + id, JSON.stringify(record)) && !writeStore("sessionStorage", flowPrefix + id, JSON.stringify(record))) throw new AuthError("Permita o armazenamento neste navegador para confirmar seu e-mail.", "storage_unavailable");
    const redirect = new URL("login.html", location.href);
    redirect.search = new URLSearchParams({ auth: kind, flow: id }).toString();
    redirect.hash = "";
    return { id, challenge: base64url(new Uint8Array(digest)), redirect: redirect.href };
  }
  function removeFlow(id) { removeStore("localStorage", flowPrefix + id); removeStore("sessionStorage", flowPrefix + id); }
  function clearCallbackUrl() {
    const clean = new URL(location.href);
    ["code", "auth", "flow", "error", "error_code", "error_description"].forEach((key) => clean.searchParams.delete(key));
    if (/access_token|refresh_token|error/.test(clean.hash)) clean.hash = "";
    history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
  }

  async function readCallback() {
    const expectedEpoch = epoch;
    const url = new URL(location.href);
    const code = url.searchParams.get("code");
    const hash = new URLSearchParams(url.hash.slice(1));
    const errorCode = url.searchParams.get("error_code") || hash.get("error_code") || url.searchParams.get("error") || hash.get("error");
    if (errorCode) { clearCallbackUrl(); throw new AuthError(friendlyError(400, errorCode), errorCode, 400); }
    // Tokens colocados na URL não são aceitos como sessão. O retorno usa PKCE.
    if (hash.has("access_token") || hash.has("refresh_token")) { clearCallbackUrl(); throw new AuthError("Solicite um novo link de confirmação ou recuperação neste navegador.", "unsupported_callback"); }
    if (!code) return false;
    const id = url.searchParams.get("flow") || "";
    const saved = readStore("localStorage", flowPrefix + id) || readStore("sessionStorage", flowPrefix + id);
    clearCallbackUrl();
    let flow;
    try { flow = JSON.parse(saved || "null"); } catch { /* Link sem verificador válido. */ }
    if (!flow || flow.project !== baseUrl || flow.expiresAt <= Date.now() || !["confirm", "recovery"].includes(flow.kind) || !/^[A-Za-z0-9_-]{43,128}$/.test(flow.verifier)) throw new AuthError("Abra o link no mesmo navegador em que ele foi solicitado, ou solicite outro link.", "pkce_missing");
    try {
      const payload = await authRequest("token?grant_type=pkce", { method: "POST", body: { auth_code: code, code_verifier: flow.verifier } });
      await acceptSession(payload, false, flow.kind === "recovery", expectedEpoch);
    } finally { removeFlow(id); }
    return true;
  }

  async function initialize() {
    const initializationEpoch = epoch;
    try {
      if (await readCallback()) return user;
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

  async function signIn(email, password, remember = false) {
    await ready;
    requireConfig();
    const expectedEpoch = ++epoch;
    const payload = await authRequest("token?grant_type=password", { method: "POST", body: { email: email.trim(), password } });
    return acceptSession(payload, remember, false, expectedEpoch);
  }
  async function signUp(name, email, password) {
    await ready;
    const expectedEpoch = ++epoch;
    const flow = await createFlow("confirm");
    try {
      const payload = await authRequest(`signup?redirect_to=${encodeURIComponent(flow.redirect)}`, { method: "POST", body: { email: email.trim(), password, data: { full_name: name.trim() }, code_challenge: flow.challenge, code_challenge_method: "s256" } });
      if (payload?.access_token) { removeFlow(flow.id); await acceptSession(payload, false, false, expectedEpoch); return { user, requiresConfirmation: false }; }
      return { user: null, requiresConfirmation: true };
    } catch (error) { removeFlow(flow.id); throw error; }
  }
  async function requestPasswordReset(email) {
    await ready;
    const flow = await createFlow("recovery");
    try { await authRequest(`recover?redirect_to=${encodeURIComponent(flow.redirect)}`, { method: "POST", body: { email: email.trim(), code_challenge: flow.challenge, code_challenge_method: "s256" } }); }
    catch (error) { removeFlow(flow.id); throw error; }
  }
  async function updatePassword(password) {
    if (!session?.recovery || !user) throw new AuthError("Solicite um novo link de recuperação para alterar sua senha.", "recovery_required");
    const expectedEpoch = epoch;
    const expectedUserId = user.id;
    const token = await getAccessToken();
    if (epoch !== expectedEpoch || user?.id !== expectedUserId || !session?.recovery) throw new AuthError("A conta conectada mudou. Solicite um novo link de recuperação.", "session_changed", 409);
    await authRequest("user", { method: "PUT", body: { password } }, token);
    if (epoch !== expectedEpoch || user?.id !== expectedUserId || !session) throw new AuthError("A conta conectada mudou. Recarregue a página.", "session_changed", 409);
    session.recovery = false;
    persistSession();
    return user;
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
    requestPasswordReset, updatePassword,
    isConfigured: () => configured, getLastError: () => lastError,
    isPasswordRecovery: () => Boolean(user && session?.recovery),
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
