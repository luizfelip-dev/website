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
  const categories = ["Moradia", "Alimentação", "Transporte", "Lazer", "Serviços", "Outros"];
  let addedTransactions = loadTransactions();

  function formatMoney(cents) {
    return currency.format(cents / 100);
  }

  function setMoney(element, cents) {
    const [whole, fraction] = formatMoney(cents).split(",");
    const decimals = document.createElement("span");
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
    const [whole, fraction = ""] = fields.amount.value.split(".");
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
    document.querySelector("#new-transaction").addEventListener("click", () => transactionDialog.showModal());
    transactionDialog.querySelectorAll("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => transactionDialog.close());
    });
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

  initBillFilters();
  initTransactionFilters();
  initTransactionForm();
})();
