(() => {
  "use strict";

  // === 01. FORMULARIOS DE ACESSO ===
  // Conecta #login-form e #signup-form de login.html a session.js.
  const auth = window.NivelaSession;
  const card = document.querySelector(".login-card");
  const title = document.querySelector("#login-title");
  const subtitle = document.querySelector("#auth-subtitle");
  const feedback = document.querySelector("#login-feedback");
  const forms = {
    login: document.querySelector("#login-form"),
    signup: document.querySelector("#signup-form"),
  };
  const headings = {
    login: ["Entre na sua conta", "Vamos cuidar dos seus próximos planos?"],
    signup: ["Crie sua conta", "Seu próximo passo começa com organização."],
  };
  let busy = false;
  let view = "login";

  // === 02. MENSAGENS E ABAS ===
  // Alterna entrar e criar conta e mostra feedback. Os textos dos títulos ficam em headings.
  function message(text = "", kind = "info") {
    feedback.classList.toggle("auth-error", kind === "error");
    feedback.setAttribute("role", kind === "error" ? "alert" : "status");
    feedback.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    feedback.textContent = text;
    feedback.hidden = !text;
  }

  function showView(next) {
    if (busy || !forms[next]) return;
    view = next;
    Object.entries(forms).forEach(([name, form]) => { form.hidden = name !== next; });
    title.textContent = headings[next][0];
    subtitle.textContent = headings[next][1];
    document.title = `${headings[next][0]} — Nivela Controle Financeiro`;
    document.querySelectorAll(".auth-switch [data-auth-view]").forEach((button) => {
      const active = button.dataset.authView === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-auth-password]").forEach((input) => {
      input.value = "";
      input.type = "password";
      input.setCustomValidity("");
    });
    document.querySelectorAll("[data-toggle-password]").forEach((button) => {
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", button.dataset.showLabel || "Mostrar senha");
      button.textContent = "Mostrar";
    });
    message();
    title.focus();
  }

  // === 03. ENVIO E VALIDACAO ===
  // Desabilita o envio durante o pedido e mostra erros. confirmPassword confere as duas senhas.
  function setBusy(value, label) {
    busy = value;
    card.setAttribute("aria-busy", String(value));
    card.querySelectorAll("form input, form button, .auth-switch button").forEach((control) => {
      control.disabled = value || !auth.isConfigured();
    });
    const submit = forms[view].querySelector("[data-auth-submit]");
    if (value && label) {
      submit.dataset.previousLabel = submit.textContent;
      submit.textContent = label;
    } else {
      card.querySelectorAll("[data-previous-label]").forEach((button) => {
        button.textContent = button.dataset.previousLabel;
        delete button.dataset.previousLabel;
      });
    }
  }

  async function run(form, label, work) {
    if (busy || !auth.isConfigured() || !form.reportValidity()) return;
    message();
    setBusy(true, label);
    try { await work(); }
    catch (error) {
      if (error.code === "registration_login_failed") {
        forms.login.elements.username.value = forms.signup.elements.username.value.trim().toLowerCase();
        setBusy(false);
        showView("login");
      }
      message(error.message || "Não foi possível concluir a ação. Tente novamente.", "error");
    }
    finally { setBusy(false); }
  }

  function confirmPassword(form) {
    const confirmation = form.elements.confirmation;
    if (!confirmation) return;
    confirmation.setCustomValidity(confirmation.value && confirmation.value !== form.elements.password.value ? "As senhas precisam ser iguais." : "");
  }

  // === 04. SENHA E AJUDA ===
  // Liga os botões Mostrar aos campos pelo atributo data-toggle-password. A senha não é salva.
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.dataset.showLabel = button.getAttribute("aria-label") || "Mostrar senha";
    button.dataset.hideLabel = button.dataset.showLabel.replace(/^Mostrar/, "Ocultar");
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.togglePassword);
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", visible ? button.dataset.hideLabel : button.dataset.showLabel);
      button.textContent = visible ? "Ocultar" : "Mostrar";
    });
  });
  document.querySelectorAll("[data-auth-view]").forEach((button) => button.addEventListener("click", () => {
    showView(button.dataset.authView);
  }));
  document.querySelectorAll("[data-auth-help]").forEach((button) => button.addEventListener("click", () => {
    if (busy) return;
    message("Entre com o usuário e a senha escolhidos no cadastro. Guarde essas informações: o Nivela não oferece recuperação automática de acesso.");
  }));
  forms.signup.elements.password.addEventListener("input", () => confirmPassword(forms.signup));
  forms.signup.elements.confirmation.addEventListener("input", () => confirmPassword(forms.signup));
  Object.values(forms).forEach((form) => form.elements.username.addEventListener("input", () => {
    form.elements.username.value = form.elements.username.value.toLowerCase();
  }));

  // === 05. ENTRAR E CRIAR CONTA ===
  // Envia os formulários a session.js e abre index.html depois da confirmação do Supabase.
  forms.login.addEventListener("submit", (event) => {
    event.preventDefault();
    // Capture os valores antes de desabilitar os campos para o estado ocupado.
    const username = forms.login.elements.username.value.trim().toLowerCase();
    const password = forms.login.elements.password.value;
    const remember = forms.login.elements.remember.checked;
    run(forms.login, "Entrando…", async () => {
      await auth.signIn(username, password, remember);
      forms.login.elements.password.value = "";
      location.replace("index.html");
    });
  });
  forms.signup.addEventListener("submit", (event) => {
    event.preventDefault();
    confirmPassword(forms.signup);
    const username = forms.signup.elements.username.value.trim().toLowerCase();
    const password = forms.signup.elements.password.value;
    const website = forms.signup.elements.website.value;
    run(forms.signup, "Criando conta…", async () => {
      await auth.signUp(username, password, website);
      forms.signup.reset();
      location.replace("index.html");
    });
  });

  // === 06. VERIFICACAO INICIAL ===
  // Aguarda auth.ready; uma sessão válida abre o painel diretamente.
  setBusy(true);
  auth.ready.then((verified) => {
    setBusy(false);
    if (verified) location.replace("index.html");
    else if (auth.getLastError()) message(auth.getLastError().message, "error");
    else message();
  }).catch(() => {
    setBusy(false);
    message("Não foi possível preparar o acesso. Recarregue a página e tente novamente.", "error");
  });
})();
