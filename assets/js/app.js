(() => {
  "use strict";

  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const billsCard = document.querySelector("#contas");

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

  initBillFilters();
})();
