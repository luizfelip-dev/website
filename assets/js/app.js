(() => {
  "use strict";

  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const billsCard = document.querySelector("#contas");
  const transactionsCard = document.querySelector("#transacoes");

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

  initBillFilters();
  initTransactionFilters();
})();
