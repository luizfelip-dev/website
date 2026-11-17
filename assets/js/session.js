(() => {
  "use strict";

  const sessionKey = "nivela.session.v1";
  const tabKey = "nivela.session.tab";
  const loginPage = location.pathname.endsWith("/login.html");

  function readSession() {
    try {
      const session = JSON.parse(localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey) || "null");
      if (!session || typeof session.email !== "string" || !session.email.includes("@")
        || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
      if (!session.remember && sessionStorage.getItem(tabKey) !== session.token) return null;
      return session;
    } catch {
      return null;
    }
  }

  function signIn(email, remember) {
    const session = { email, remember, token: crypto.randomUUID(), expiresAt: Date.now() + (remember ? 30 : 1) * 86400000 };
    try {
      sessionStorage.setItem(tabKey, session.token);
      try {
        localStorage.setItem(sessionKey, JSON.stringify(session));
        sessionStorage.removeItem(sessionKey);
      } catch {
        sessionStorage.setItem(sessionKey, JSON.stringify({ ...session, remember: false }));
      }
      return true;
    } catch {
      return false;
    }
  }

  function signOut() {
    for (const storage of [localStorage, sessionStorage]) {
      try {
        storage.removeItem(sessionKey);
        storage.removeItem(tabKey);
      } catch {
        // O navegador pode restringir o armazenamento.
      }
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
