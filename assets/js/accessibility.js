(() => {
  "use strict";

  const key = "nivela.accessibility.v1";
  let preferences = readPreferences();

  function readPreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      return {
        theme: stored?.theme === "dark" ? "dark" : "light",
        fontSize: [87.5, 100, 112.5, 125].includes(stored?.fontSize) ? stored.fontSize : 100,
        highContrast: stored?.highContrast === true,
      };
    } catch {
      return { theme: "light", fontSize: 100, highContrast: false };
    }
  }

  function applyPreferences() {
    const root = document.documentElement;
    root.classList.toggle("dark-theme", preferences.theme === "dark");
    root.classList.toggle("high-contrast", preferences.highContrast);
    root.style.fontSize = `${preferences.fontSize}%`;
    root.dataset.fontSize = preferences.fontSize;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", preferences.highContrast ? "#000000" : preferences.theme === "dark" ? "#0B1120" : "#F8FAFC");
    document.querySelectorAll("[data-toggle-theme]").forEach((button) => {
      const dark = preferences.theme === "dark";
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "Ativar modo claro" : "Ativar modo escuro");
      button.textContent = dark ? "Modo claro" : "Modo escuro";
    });
  }

  function updatePreferences(changes) {
    preferences = { ...preferences, ...changes };
    let saved = true;
    try {
      localStorage.setItem(key, JSON.stringify(preferences));
    } catch {
      saved = false;
    }
    applyPreferences();
    const status = document.querySelector("#accessibility-status") || document.querySelector("#accessibility-announcement");
    if (status) status.textContent = `${preferences.theme === "dark" ? "Modo escuro" : "Modo claro"}, fonte ${preferences.fontSize.toLocaleString("pt-BR")}%${preferences.highContrast ? ", alto contraste ativo" : ""}.${saved ? " Preferências salvas." : " Preferências aplicadas nesta página."}`;
  }

  applyPreferences();
  document.addEventListener("DOMContentLoaded", () => {
    const announcement = document.createElement("p");
    announcement.id = "accessibility-announcement";
    announcement.className = "sr-only";
    announcement.setAttribute("role", "status");
    document.body.append(announcement);
    document.querySelectorAll("[data-toggle-theme]").forEach((button) => {
      button.addEventListener("click", () => updatePreferences({ theme: preferences.theme === "dark" ? "light" : "dark" }));
    });
    applyPreferences();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key) { preferences = readPreferences(); applyPreferences(); }
  });
})();
