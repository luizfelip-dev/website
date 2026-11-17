(() => {
  "use strict";

  const sessionKey = "nivela.session.v1";
  const tabKey = "nivela.session.tab";
  const loginPage = location.pathname.endsWith("/login.html");

  function readStore(name, key) {
    try { return window[name].getItem(key); } catch { return null; }
  }

  function writeStore(name, key, value) {
    try { window[name].setItem(key, value); return true; } catch { return false; }
  }

  function removeStore(name, key) {
    try { window[name].removeItem(key); } catch { /* Armazenamento indisponível. */ }
  }

  function readSession() {
    for (const name of ["localStorage", "sessionStorage"]) {
      try {
        const session = JSON.parse(readStore(name, sessionKey) || "null");
        if (!session || typeof session.email !== "string" || !session.email.includes("@")
          || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) continue;
        if (!session.remember && readStore("sessionStorage", tabKey) !== session.token) continue;
        return session;
      } catch {
        // Uma sessão inválida pode ser substituída por uma nova entrada.
      }
    }
    return null;
  }

  function signIn(email, remember) {
    const session = { email, remember, token: crypto.randomUUID(), expiresAt: Date.now() + (remember ? 30 : 1) * 86400000 };
    if (remember && writeStore("localStorage", sessionKey, JSON.stringify(session))) {
      removeStore("sessionStorage", sessionKey);
      return true;
    }
    if (!writeStore("sessionStorage", tabKey, session.token)) return false;
    const temporary = JSON.stringify({ ...session, remember: false });
    if (writeStore("localStorage", sessionKey, temporary)) {
      removeStore("sessionStorage", sessionKey);
      return true;
    }
    return writeStore("sessionStorage", sessionKey, temporary);
  }

  function signOut() {
    for (const name of ["localStorage", "sessionStorage"]) {
      removeStore(name, sessionKey);
      removeStore(name, tabKey);
    }
    location.replace("login.html");
  }

  window.NivelaSession = Object.freeze({ signIn, signOut });
  const session = readSession();
  if (!loginPage && !session) location.replace("login.html");
  if (loginPage && session) location.replace("index.html");

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-sign-out]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        signOut();
      });
    });
  });
  window.addEventListener("storage", (event) => {
    if (!loginPage && event.key === sessionKey && !readSession()) location.replace("login.html");
  });
})();
