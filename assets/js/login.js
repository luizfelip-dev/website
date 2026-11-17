(() => {
  "use strict";

  const form = document.querySelector("#login-form");
  const password = document.querySelector("#login-password");
  const feedback = document.querySelector("#login-feedback");
  const toggle = document.querySelector("#toggle-password");

  toggle.addEventListener("click", () => {
    const visible = password.type === "password";
    password.type = visible ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(visible));
    toggle.setAttribute("aria-label", visible ? "Ocultar senha" : "Mostrar senha");
    toggle.textContent = visible ? "Ocultar" : "Mostrar";
  });

  password.addEventListener("input", () => {
    password.setCustomValidity(password.value.trim().length >= 8 ? "" : "Use pelo menos 8 caracteres, sem contar espaços nas pontas.");
  });

  document.querySelector("#forgot-password").addEventListener("click", (event) => {
    event.preventDefault();
    feedback.textContent = "Este acesso é de demonstração. Entre com um e-mail válido e uma senha de teste com pelo menos 8 caracteres.";
    feedback.hidden = false;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const success = window.NivelaSession.signIn(form.elements.email.value.trim(), form.elements.remember.checked);
    if (!success) {
      feedback.textContent = "Permita o armazenamento neste navegador para iniciar sua sessão.";
      feedback.hidden = false;
      return;
    }
    password.value = "";
    location.assign("index.html");
  });
})();
