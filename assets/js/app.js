(() => {
  "use strict";

  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const billsCard = document.querySelector("#contas");
  const transactionsCard = document.querySelector("#transacoes");
  const activeMonth = document.querySelector(".month-label time").dateTime;
  const referenceDate = document.querySelector(".today time").dateTime;
  const transactionDialog = document.querySelector("#transaction-dialog");
  const transactionForm = document.querySelector("#transaction-form");
  const storageKey = "nivela.transactions.v1";
  const dialogOpeners = new WeakMap();
  const categories = ["Moradia", "Alimentação", "Transporte", "Lazer", "Serviços", "Outros"];
  const summaryValues = [...document.querySelectorAll(".summary-stats .stat dd:not(.stat-note)")];
  const summaryBase = {
    income: readMoney(summaryValues[1].textContent),
    expense: readMoney(summaryValues[2].textContent),
    opening: readMoney(summaryValues[0].textContent) - readMoney(summaryValues[3].textContent),
  };
  const categoryBase = { Moradia: 213000, Alimentação: 132980, Transporte: 79790, Lazer: 53190, Outros: 52950 };
  const budgetBase = [...document.querySelectorAll(".budget-item")].map((element) => ({
    element,
    category: element.querySelector("h3").textContent.trim(),
    spent: Math.round(Number(element.querySelector("[role=progressbar]").getAttribute("aria-valuenow")) * 100),
    limit: Math.round(Number(element.querySelector("[role=progressbar]").getAttribute("aria-valuemax")) * 100),
  }));
  let addedTransactions = loadTransactions();

  function formatMoney(cents) {
    return currency.format(cents / 100);
  }

  function readMoney(value) {
    return Number(value.replace(/[^\d-]/g, ""));
  }

  function setMoney(element, cents, fractionTag = "span") {
    const [whole, fraction] = formatMoney(cents).split(",");
    const decimals = document.createElement(fractionTag);
    decimals.textContent = `,${fraction}`;
    element.replaceChildren(document.createTextNode(whole), decimals);
  }

  function selectFilter(buttons, selected) {
    buttons.forEach((button) => {
      const active = button === selected;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function filterBills(date) {
    const items = [...billsCard.querySelectorAll(".bill-list li")];
    items.forEach((item) => {
      item.hidden = date !== "all" && item.dataset.date !== date;
    });

    billsCard.querySelectorAll(".bill-list").forEach((list) => {
      const empty = [...list.children].every((item) => item.hidden);
      list.hidden = empty;
      list.previousElementSibling.hidden = empty;
    });

    const visible = items.filter((item) => !item.hidden);
    const unpaid = visible.filter((item) => item.dataset.type === "expense" && item.dataset.paid !== "true");
    const sum = (entries) => entries.reduce((total, item) => total + Number(item.dataset.amountCents), 0);
    setMoney(billsCard.querySelector(".bill-overview strong"), sum(unpaid));
    billsCard.querySelector(".bill-overview > .badge").textContent = `${unpaid.length} em aberto`;
    billsCard.querySelector(".receivables-label > span").textContent = formatMoney(sum(visible.filter((item) => item.dataset.type === "income")));
    billsCard.querySelector("[data-bills-empty]").hidden = visible.length > 0;
  }

  function initBillFilters() {
    const buttons = [...billsCard.querySelectorAll("[data-due-date]")];
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        selectFilter(buttons, button);
        filterBills(button.dataset.dueDate);
      });
    });
    filterBills("all");
  }

  function normalizeText(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
  }

  function filterTransactions() {
    const type = transactionsCard.querySelector(".filter-tab.is-active").dataset.transactionType;
    const search = normalizeText(document.querySelector("#transaction-search").value);
    const rows = [...transactionsCard.querySelectorAll("tbody tr[data-type]")];
    let visible = 0;

    rows.forEach((row) => {
      const matchesType = type === "all" || row.dataset.type === type;
      const text = normalizeText(`${row.dataset.description} ${row.dataset.category}`);
      row.hidden = !matchesType || !text.includes(search);
      if (!row.hidden) visible += 1;
    });

    const added = rows.filter((row) => row.dataset.added === "true").length;
    transactionsCard.querySelector(".card-header > .subtle-tag").textContent = `${visible} de ${24 + added} transações`;
    transactionsCard.querySelector("[data-transactions-empty]").hidden = visible > 0;
    transactionsCard.querySelector("[data-filter-status]").textContent = `${visible} movimentações encontradas.`;
  }

  function initTransactionFilters() {
    const buttons = [...transactionsCard.querySelectorAll("[data-transaction-type]")];
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        selectFilter(buttons, button);
        filterTransactions();
      });
    });
    document.querySelector("#transaction-search").addEventListener("input", filterTransactions);
    filterTransactions();
  }

  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function loadTransactions() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(saved)) return [];
      return saved.filter((item) => item && typeof item.id === "string"
        && ["income", "expense", "transfer"].includes(item.type)
        && typeof item.description === "string" && item.description.trim().length > 0 && item.description.length <= 120
        && categories.includes(item.category) && isValidDate(item.date)
        && Number.isSafeInteger(item.amountCents) && item.amountCents > 0 && item.amountCents <= 99999999999
        && typeof item.recurring === "boolean"
        && Number.isInteger(item.installment) && Number.isInteger(item.installmentCount)
        && item.installment >= 1 && item.installment <= item.installmentCount && item.installmentCount <= 24);
    } catch {
      return [];
    }
  }

  function saveTransactions() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(addedTransactions));
      return true;
    } catch {
      return false;
    }
  }

  function monthlyTransactions() {
    return addedTransactions.filter((item) => item.date.slice(0, 7) === activeMonth);
  }

  function notify(message) {
    const feedback = document.querySelector("[data-transaction-feedback]");
    feedback.textContent = message;
    feedback.hidden = false;
  }

  function dateLabel(value) {
    const [year, month, day] = value.split("-");
    const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${day} ${months[Number(month) - 1]}, ${year}`;
  }

  function renderTransactions() {
    const tbody = transactionsCard.querySelector("tbody");
    const template = tbody.querySelector("tr[data-type]:not([data-added])");
    tbody.querySelectorAll("[data-added]").forEach((row) => row.remove());
    const icons = { Moradia: "home", Alimentação: "food", Transporte: "car", Lazer: "coffee", Serviços: "doc", Outros: "card" };

    monthlyTransactions().sort((a, b) => a.date.localeCompare(b.date)).forEach((item) => {
      const row = template.cloneNode(true);
      Object.assign(row.dataset, { type: item.type, description: item.description, category: item.category, date: item.date, amountCents: item.amountCents, added: "true" });
      row.hidden = false;
      const detail = row.querySelector(".transaction-description > span:last-child");
      const small = document.createElement("small");
      small.textContent = item.installmentCount > 1 ? `Parcela ${item.installment} de ${item.installmentCount}` : item.recurring ? "Recorrência mensal" : "Lançamento pessoal";
      detail.replaceChildren(document.createTextNode(item.description), small);
      row.querySelector(".item-icon").className = `item-icon tone-${item.type === "income" ? "green" : "blue"}`;
      row.querySelector("use").setAttribute("href", `#i-${item.type === "income" ? "income" : item.type === "transfer" ? "swap" : icons[item.category]}`);
      row.querySelector(".category-tag").textContent = item.category;
      row.querySelector("time").dateTime = item.date;
      row.querySelector("time").textContent = dateLabel(item.date);
      const account = row.querySelector(".account-dot");
      account.className = "account-dot account-blue";
      row.cells[3].replaceChildren(account, document.createTextNode("Carteira pessoal"));
      const badge = row.querySelector(".badge");
      badge.className = `badge ${item.date > referenceDate ? "badge-neutral" : "badge-success"}`;
      badge.textContent = item.date > referenceDate ? "Previsto" : item.type === "income" ? "Recebido" : item.type === "transfer" ? "Concluída" : "Pago";
      row.cells[5].className = `amount-column ${item.type === "income" ? "positive" : "expense-amount"}`;
      row.cells[5].textContent = `${item.type === "income" ? "+" : item.type === "expense" ? "−" : "↔"} ${formatMoney(item.amountCents)}`;
      tbody.prepend(row);
    });
    document.querySelector(".nav-count").textContent = 24 + monthlyTransactions().length;
    filterTransactions();
  }

  function addMonths(value, offset) {
    const [year, month, day] = value.split("-").map(Number);
    const target = new Date(Date.UTC(year, month - 1 + offset, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return target.toISOString().slice(0, 10);
  }

  function updateScheduleOptions() {
    const fields = transactionForm.elements;
    const expense = fields.type.value === "expense";
    if (!expense) fields.installments.checked = false;
    fields.installments.disabled = !expense || fields.recurring.checked;
    fields.recurring.disabled = fields.installments.checked;
    document.querySelector("#installment-field").hidden = !fields.installments.checked;
    fields.installmentCount.disabled = !fields.installments.checked;
    fields.installmentCount.required = fields.installments.checked;
    document.querySelector("#schedule-help").textContent = fields.installments.checked
      ? "O valor total será dividido entre as parcelas, uma por mês, a partir da data informada."
      : fields.recurring.checked ? "Serão criados 12 lançamentos mensais, a partir da data informada."
      : "Você pode repetir o lançamento ou dividir uma compra em parcelas.";
  }

  function createTransactions() {
    const fields = transactionForm.elements;
    const [whole, fraction = ""] = fields.amount.valueAsNumber.toFixed(2).split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    const installments = fields.installments.checked ? Number(fields.installmentCount.value) : 1;
    const error = document.querySelector("#transaction-error");
    error.hidden = true;
    if (!Number.isSafeInteger(cents) || cents <= 0 || !isValidDate(fields.date.value)
      || !fields.description.value.trim() || !categories.includes(fields.category.value)
      || !Number.isInteger(installments) || installments < 1 || installments > 24 || cents < installments) {
      error.textContent = "Confira os campos. Cada parcela precisa ter pelo menos R$ 0,01.";
      error.hidden = false;
      return null;
    }

    const count = fields.recurring.checked ? 12 : installments;
    return Array.from({ length: count }, (_, index) => ({
      id: crypto.randomUUID(),
      type: fields.type.value,
      description: fields.description.value.trim(),
      amountCents: fields.installments.checked ? Math.floor(cents / installments) + (index < cents % installments ? 1 : 0) : cents,
      category: fields.category.value,
      date: addMonths(fields.date.value, index),
      recurring: fields.recurring.checked,
      installment: fields.installments.checked ? index + 1 : 1,
      installmentCount: installments,
    }));
  }

  function initTransactionForm() {
    transactionForm.elements.date.value = referenceDate;
    document.querySelector("#new-transaction").addEventListener("click", () => openDialog(transactionDialog));
    transactionForm.addEventListener("change", updateScheduleOptions);
    transactionForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!transactionForm.reportValidity()) return;
      const entries = createTransactions();
      if (!entries) return;
      addedTransactions.push(...entries);
      const saved = saveTransactions();
      document.querySelector("#transaction-search").value = "";
      const buttons = [...transactionsCard.querySelectorAll("[data-transaction-type]")];
      selectFilter(buttons, buttons[0]);
      renderTransactions();
      updateSummary();
      const inMonth = entries.filter((item) => item.date.slice(0, 7) === activeMonth).length;
      notify(`${entries.length === 1 ? "Transação registrada" : `${entries.length} lançamentos registrados`}. ${inMonth} neste mês.${saved ? "" : " Os dados ficarão disponíveis apenas nesta sessão."}`);
      transactionForm.reset();
      transactionForm.elements.date.value = referenceDate;
      updateScheduleOptions();
      transactionDialog.close();
    });
    updateScheduleOptions();
    renderTransactions();
  }

  function updateSummary() {
    const totals = monthlyTransactions().reduce((sum, item) => {
      if (item.type === "income") sum.income += item.amountCents;
      if (item.type === "expense") sum.expense += item.amountCents;
      return sum;
    }, { income: summaryBase.income, expense: summaryBase.expense });
    const net = totals.income - totals.expense;
    const balance = summaryBase.opening + net;
    [balance, totals.income, totals.expense, net].forEach((value, index) => {
      setMoney(summaryValues[index], value);
      summaryValues[index].parentElement.classList.toggle("long-value", Math.abs(value) >= 10000000);
    });
    summaryValues[0].classList.toggle("negative", balance < 0);
    summaryValues[3].classList.toggle("positive", net >= 0);
    summaryValues[3].classList.toggle("negative", net < 0);

    const stats = [...document.querySelectorAll(".summary-stats .stat")];
    [summaryBase.opening, 800000, 578800].forEach((previous, index) => {
      const value = [balance, totals.income, totals.expense][index];
      const difference = (value - previous) / previous * 100;
      const note = stats[index].querySelector(".stat-note > span:first-child");
      note.textContent = `${difference < 0 ? "−" : "+"}${Math.abs(difference).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
      const positive = index === 2 ? difference <= 0 : difference >= 0;
      note.classList.toggle("positive", positive);
      note.classList.toggle("negative", !positive);
    });
    stats[3].querySelector(".stat-note > span:last-child").textContent = totals.income
      ? `${(net / totals.income * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da sua receita` : "Sem receitas neste mês";
    const badge = document.querySelector(".summary-header > .badge");
    badge.className = `badge ${net < 0 ? "badge-danger" : net === 0 ? "badge-neutral" : "badge-success"}`;
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.setAttribute("aria-hidden", "true");
    badge.replaceChildren(dot, document.createTextNode(net < 0 ? "Mês negativo" : net === 0 ? "Mês equilibrado" : "Mês positivo"));
    const insight = document.querySelector(".summary-insight p");
    insight.textContent = net < 0 ? "Hora de revisar os planos: suas despesas superaram as receitas." : net === 0 ? "Receitas e despesas estão equilibradas neste mês." : "Bom ritmo! Suas receitas superaram as despesas neste mês.";
    updateCharts(totals.expense, balance);
    updateBudgets();
  }

  function updateCharts(totalExpenses, balance) {
    const totals = { ...categoryBase };
    monthlyTransactions().filter((item) => item.type === "expense").forEach((item) => {
      const category = item.category in totals ? item.category : "Outros";
      totals[category] += item.amountCents;
    });
    const colors = ["var(--brand)", "var(--success)", "var(--warning)", "var(--purple)", "var(--chart-neutral)"];
    let start = 0;
    const stops = Object.entries(totals).map(([category, cents], index) => {
      const share = totalExpenses ? cents / totalExpenses * 100 : 0;
      const end = start + share;
      const gap = Math.min(0.6, share / 10);
      const stop = `${colors[index]} ${start}% ${end - gap}%, var(--bg-card) ${end - gap}% ${end}%`;
      start = end;
      document.querySelectorAll(".chart-legend strong")[index].textContent = `${Math.round(share)}%`;
      return stop;
    });
    const donut = document.querySelector(".donut");
    donut.style.background = totalExpenses ? `conic-gradient(${stops.join(", ")})` : "var(--bg-muted)";
    setMoney(donut.querySelector("strong"), totalExpenses, "small");
    donut.setAttribute("aria-label", `Despesas de ${formatMoney(totalExpenses)}. ${Object.entries(totals).map(([name, cents]) => `${name}: ${formatMoney(cents)}`).join(". ")}`);
    const largest = Object.entries(totals).sort((a, b) => b[1] - a[1])[0][0];
    const note = document.querySelector(".category-figure .figure-footnote");
    const categoryDot = document.createElement("span");
    categoryDot.className = `legend-dot ${["dot-blue", "dot-green", "dot-yellow", "dot-purple", "dot-slate"][Object.keys(totals).indexOf(largest)]}`;
    categoryDot.setAttribute("aria-hidden", "true");
    note.replaceChildren(categoryDot, document.createTextNode(`${largest} é sua maior despesa.`));

    const balances = [720000, 810000, 745000, 942000, 930000, balance];
    const ceiling = Math.max(1500000, Math.ceil(balance / 500000) * 500000);
    document.querySelectorAll(".bar-plot .bar").forEach((bar, index) => {
      bar.style.height = `${Math.max(0, balances[index]) / ceiling * 100}%`;
    });
    document.querySelectorAll(".chart-scale span").forEach((span, index) => {
      span.textContent = index === 3 ? "0" : `${(ceiling * (3 - index) / 3 / 100000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
    });
    document.querySelector(".bar-value").textContent = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(balance / 100);
    document.querySelector(".bar-chart").setAttribute("aria-label", `Saldos de junho a novembro: ${balances.map(formatMoney).join("; ")}.`);
    const change = (balance - summaryBase.opening) / summaryBase.opening * 100;
    const footnote = document.querySelector(".balance-footnote");
    const percent = document.createElement("span");
    percent.className = change >= 0 ? "positive" : "negative";
    percent.textContent = `${change < 0 ? "−" : "+"}${Math.abs(change).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    footnote.replaceChildren(percent, document.createTextNode(" em relação a outubro"));
  }

  function updateBudgets() {
    let remaining = 0;
    budgetBase.forEach(({ element, category, spent, limit }) => {
      const additions = monthlyTransactions().filter((item) => item.type === "expense" && item.category === category)
        .reduce((total, item) => total + item.amountCents, 0);
      const current = spent + additions;
      const track = element.querySelector("[role=progressbar]");
      track.dataset.spentCents = String(current);
      track.setAttribute("aria-valuenow", String(Math.min(current, limit) / 100));
      const limitLabel = document.createElement("span");
      limitLabel.textContent = ` / ${formatMoney(limit)}`;
      element.querySelector(".budget-amount").replaceChildren(document.createTextNode(formatMoney(current)), limitLabel);
      remaining += limit - current;
    });
    updateBudgetAlerts();
    const footer = document.querySelector(".budget-footer p");
    const amount = document.createElement("strong");
    amount.textContent = formatMoney(Math.abs(remaining));
    footer.replaceChildren(document.createTextNode(remaining >= 0 ? "Você ainda tem " : "Você ultrapassou seus orçamentos em "), amount,
      document.createTextNode(remaining >= 0 ? " disponíveis nos seus orçamentos." : ". Vale revisar seu planejamento."));
  }

  function updateBudgetAlerts() {
    document.querySelectorAll(".budget-item").forEach((item) => {
      const track = item.querySelector("[role=progressbar]");
      const current = Number(track.dataset.spentCents);
      const limit = Math.round(Number(track.getAttribute("aria-valuemax")) * 100);
      const percent = limit > 0 ? current / limit * 100 : 0;
      const state = percent >= 100 ? "danger" : percent >= 80 ? "warning" : "normal";
      item.dataset.budgetStatus = state;
      item.querySelector(".progress-fill").style.width = `${Math.min(100, Math.max(0, percent))}%`;
      const suffix = state === "danger" ? " · Limite atingido" : state === "warning" ? " · Atenção" : "";
      const label = `${Math.floor(percent * 10) / 10}%${suffix}`.replace(".", ",");
      item.querySelector(".budget-label > span").textContent = label;
      track.setAttribute("aria-valuetext", `${formatMoney(current)} de ${formatMoney(limit)}, ${label}`);
    });
  }

  function openDialog(dialog) {
    if (dialog.open) return;
    const other = document.querySelector("dialog[open]");
    if (other) other.close();
    dialogOpeners.set(dialog, document.activeElement);
    dialog.showModal();
    document.body.classList.add("modal-open");
  }

  function initDialogs() {
    document.querySelectorAll(".app-dialog:not([data-accessibility-dialog])").forEach((dialog) => {
      let startedOutside = false;
      const outside = (event) => {
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      };
      dialog.addEventListener("pointerdown", (event) => {
        startedOutside = event.target === dialog && outside(event);
      });
      dialog.addEventListener("click", (event) => {
        if (startedOutside && event.target === dialog && outside(event)) dialog.close();
        startedOutside = false;
      });
      dialog.addEventListener("close", () => {
        if (!document.querySelector("dialog[open]")) {
          document.body.classList.remove("modal-open");
          const opener = dialogOpeners.get(dialog);
          if (opener?.isConnected) opener.focus();
        }
      });
      dialog.querySelectorAll("[data-close-dialog]").forEach((button) => {
        button.addEventListener("click", () => dialog.close());
      });
    });
  }

  function initSupportForm() {
    const dialog = document.querySelector("#support-dialog");
    const form = document.querySelector("#support-form");
    const confirmation = document.querySelector("#support-confirmation");
    document.querySelectorAll("[data-open-support]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        form.hidden = false;
        confirmation.hidden = true;
        openDialog(dialog);
      });
    });

    function validateText(field) {
      const valid = field.value.trim().length >= field.minLength;
      field.setCustomValidity(valid ? "" : `Escreva pelo menos ${field.minLength} caracteres.`);
    }

    form.addEventListener("input", (event) => {
      if (["name", "message"].includes(event.target.name)) validateText(event.target);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      validateText(form.elements.namedItem("name"));
      validateText(form.elements.message);
      if (!form.reportValidity()) return;
      const name = form.elements.namedItem("name").value.trim();
      confirmation.querySelector("p").textContent = `Obrigado pelo contato, ${name}! Seus dados foram validados e a confirmação foi registrada nesta sessão.`;
      form.reset();
      form.hidden = true;
      confirmation.hidden = false;
      confirmation.focus();
    });
  }

  initBillFilters();
  initTransactionFilters();
  initDialogs();
  initTransactionForm();
  initSupportForm();
  updateSummary();
})();
