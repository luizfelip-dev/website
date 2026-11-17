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
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      const selected = button.dataset.themeChoice === preferences.theme;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll("[data-font-step]").forEach((button) => {
      button.disabled = Number(button.dataset.fontStep) < 0 ? preferences.fontSize <= 87.5 : preferences.fontSize >= 125;
    });
    document.querySelectorAll("[data-font-reset]").forEach((button) => button.setAttribute("aria-pressed", String(preferences.fontSize === 100)));
    document.querySelectorAll("[data-font-output]").forEach((output) => { output.textContent = `${preferences.fontSize.toLocaleString("pt-BR")}%`; });
    document.querySelectorAll("[data-high-contrast]").forEach((checkbox) => { checkbox.checked = preferences.highContrast; });
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
    announcement.setAttribute("aria-live", "polite");
    document.body.append(announcement);
    document.querySelectorAll("[data-toggle-theme]").forEach((button) => {
      button.addEventListener("click", () => updatePreferences({ theme: preferences.theme === "dark" ? "light" : "dark" }));
    });
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.addEventListener("click", () => updatePreferences({ theme: button.dataset.themeChoice }));
    });
    document.querySelectorAll("[data-font-step]").forEach((button) => {
      button.addEventListener("click", () => updatePreferences({ fontSize: Math.min(125, Math.max(87.5, preferences.fontSize + Number(button.dataset.fontStep) * 12.5)) }));
    });
    document.querySelectorAll("[data-font-reset]").forEach((button) => {
      button.addEventListener("click", () => updatePreferences({ fontSize: 100 }));
    });
    document.querySelectorAll("[data-high-contrast]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => updatePreferences({ highContrast: checkbox.checked }));
    });
    document.querySelector("[data-reset-accessibility]")?.addEventListener("click", () => updatePreferences({ theme: "light", fontSize: 100, highContrast: false }));

    const dialog = document.querySelector("#accessibility-dialog");
    let opener;
    let startedOutside = false;
    const triggers = [...document.querySelectorAll("[data-open-accessibility]")];
    triggers.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (dialog.open) return;
        opener = button;
        document.querySelector("dialog[open]")?.close();
        dialog.showModal();
        document.body.classList.add("modal-open");
        triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "true"));
      });
    });
    dialog.querySelectorAll("[data-close-accessibility]").forEach((button) => button.addEventListener("click", () => dialog.close()));
    const outside = (event) => {
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    dialog.addEventListener("pointerdown", (event) => { startedOutside = event.target === dialog && outside(event); });
    dialog.addEventListener("click", (event) => {
      if (startedOutside && event.target === dialog && outside(event)) dialog.close();
      startedOutside = false;
    });
    dialog.addEventListener("close", () => {
      triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
      if (!document.querySelector("dialog[open]")) {
        document.body.classList.remove("modal-open");
        if (opener?.isConnected) opener.focus();
      }
    });
    applyPreferences();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key) { preferences = readPreferences(); applyPreferences(); }
  });
})();
