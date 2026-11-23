(() => {
  "use strict";

  const auth = window.NivelaSession;
  const card = document.querySelector(".login-card");
  const title = document.querySelector("#login-title");
  const subtitle = document.querySelector("#auth-subtitle");
  const feedback = document.querySelector("#login-feedback");
  const forms = {
    login: document.querySelector("#login-form"),
    signup: document.querySelector("#signup-form"),
    recovery: document.querySelector("#recovery-form"),
    reset: document.querySelector("#reset-form"),
  };
  const headings = {
    login: ["Entre na sua conta", "Vamos cuidar dos seus próximos planos?"],
    signup: ["Crie sua conta", "Seu próximo passo começa com organização."],
    recovery: ["Recupere seu acesso", "Receba um link para escolher uma nova senha."],
    reset: ["Escolha uma nova senha", "Proteja o acesso aos seus planos."],
  };
  let busy = false;
  let view = "login";

  function message(text = "", kind = "info") {
    feedback.classList.toggle("auth-error", kind === "error");
    feedback.classList.toggle("auth-success", kind === "success");
    feedback.setAttribute("role", kind === "error" ? "alert" : "status");
    feedback.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    feedback.textContent = text;
    feedback.hidden = !text;
  }

  function showView(next, focus = true, keepMessage = false) {
    if (busy || !forms[next] || (next === "reset" && !auth.isPasswordRecovery())) return;
    view = next;
    Object.entries(forms).forEach(([name, form]) => { form.hidden = name !== next; });
    title.textContent = headings[next][0];
    subtitle.textContent = headings[next][1];
    document.title = `${headings[next][0]} — Nivela Controle Financeiro`;
    document.querySelector(".auth-switch").hidden = next === "reset";
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
    if (!keepMessage) message();
    if (focus) title.focus();
  }

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
    catch (error) { message(error.message || "Não foi possível concluir a ação. Tente novamente.", "error"); }
    finally { setBusy(false); }
  }

  function confirmPassword(form) {
    const confirmation = form.elements.confirmation;
    if (!confirmation) return;
    confirmation.setCustomValidity(confirmation.value && confirmation.value !== form.elements.password.value ? "As senhas precisam ser iguais." : "");
  }

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
    if (view === "reset") return;
    showView(button.dataset.authView);
  }));
  document.querySelectorAll("[data-forgot-password]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    if (busy || view === "reset") return;
    forms.recovery.elements.email.value = forms.login.elements.email.value.trim();
    showView("recovery");
  }));
  [forms.signup, forms.reset].forEach((form) => {
    form.elements.password.addEventListener("input", () => confirmPassword(form));
    form.elements.confirmation.addEventListener("input", () => confirmPassword(form));
  });
  forms.signup.elements.name.addEventListener("input", () => {
    const input = forms.signup.elements.name;
    input.setCustomValidity(input.value.trim() && input.value.trim().length < 2 ? "Informe seu nome com pelo menos 2 caracteres." : "");
  });

  forms.login.addEventListener("submit", (event) => {
    event.preventDefault();
    // Capture os valores antes de desabilitar os campos para o estado ocupado.
    const email = forms.login.elements.email.value.trim();
    const password = forms.login.elements.password.value;
    const remember = forms.login.elements.remember.checked;
    run(forms.login, "Entrando…", async () => {
      await auth.signIn(email, password, remember);
      forms.login.elements.password.value = "";
      location.replace("index.html");
    });
  });
  forms.signup.addEventListener("submit", (event) => {
    event.preventDefault();
    confirmPassword(forms.signup);
    const name = forms.signup.elements.name.value.trim();
    const email = forms.signup.elements.email.value.trim();
    const password = forms.signup.elements.password.value;
    run(forms.signup, "Criando conta…", async () => {
      const result = await auth.signUp(name, email, password);
      forms.signup.reset();
      if (!result.requiresConfirmation) { location.replace("index.html"); return; }
      message("Confira seu e-mail para concluir o cadastro. Abra o link neste mesmo navegador. Se já tiver uma conta, entre ou recupere sua senha.", "success");
    });
  });
  forms.recovery.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = forms.recovery.elements.email.value.trim();
    run(forms.recovery, "Enviando link…", async () => {
      await auth.requestPasswordReset(email);
      message("Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha. Abra-o neste mesmo navegador.", "success");
    });
  });
  forms.reset.addEventListener("submit", (event) => {
    event.preventDefault();
    confirmPassword(forms.reset);
    const password = forms.reset.elements.password.value;
    run(forms.reset, "Salvando senha…", async () => {
      await auth.updatePassword(password);
      await auth.signOut();
      forms.reset.reset();
      setBusy(false);
      showView("login");
      message("Senha alterada. Entre com sua nova senha para continuar.", "success");
    });
  });
  document.querySelector("[data-cancel-recovery]").addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    await auth.signOut();
    setBusy(false);
    showView("login");
    message("Recuperação cancelada. Você pode solicitar um novo link quando precisar.");
  });

  setBusy(true);
  auth.ready.then((verified) => {
    setBusy(false);
    if (verified && auth.isPasswordRecovery()) {
      showView("reset", false);
      message("Seu link foi confirmado. Agora escolha uma nova senha.");
    } else if (verified) location.replace("index.html");
    else if (auth.getLastError()) message(auth.getLastError().message, "error");
    else message();
  }).catch(() => {
    setBusy(false);
    message("Não foi possível preparar o acesso. Recarregue a página e tente novamente.", "error");
  });
})();
