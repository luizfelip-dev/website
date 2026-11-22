(() => {
  "use strict";

  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const billsCard = document.querySelector("#contas");
  const transactionsCard = document.querySelector("#transacoes");
  const transactionDialog = document.querySelector("#transaction-dialog");
  const transactionForm = document.querySelector("#transaction-form");
  const dialogOpeners = new WeakMap();
  const categories = ["Moradia", "Alimentação", "Transporte", "Lazer", "Serviços", "Outros"];
  const budgetCategories = ["Moradia", "Alimentação", "Transporte", "Lazer"];
  const summaryValues = [...document.querySelectorAll(".summary-stats .stat dd:not(.stat-note)")];
  const rowTemplate = document.querySelector("#transaction-row-template").content.querySelector("tr");
  const now = new Date();
  const referenceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let activeMonth = referenceDate.slice(0, 7);
  let selectedDueDate = "all";
  let state = { profile: { fullName: "", openingBalanceCents: 0 }, transactions: [], budgets: [], goals: [] };
  let editingTransaction = null;
  let editingGoal = null;
  let deletion = null;
  let loading = false;
  let focusAfterLoad = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function action(label, callback, className = "") {
    const button = el("button", className, label);
    button.type = "button";
    button.addEventListener("click", callback);
    return button;
  }

  function cents(field) {
    const value = field.valueAsNumber;
    const amount = Math.round(value * 100);
    if (!Number.isFinite(value) || !Number.isSafeInteger(amount)) throw new Error("Confira o valor informado.");
    return amount;
  }

  function monthEntries(month = activeMonth) {
    return state.transactions.filter((item) => item.date.slice(0, 7) === month);
  }

  function monthlyTransactions() { return monthEntries(); }

  function monthDate(month, offset = 0) {
    const [year, number] = month.split("-").map(Number);
    return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
  }

  function monthLabel(month, options = { month: "long", year: "numeric" }) {
    return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("pt-BR", { ...options, timeZone: "UTC" });
  }

  function balanceAt(month) {
    return state.transactions.filter((item) => item.status === "paid" && item.date.slice(0, 7) <= month)
      .reduce((sum, item) => sum + (item.type === "income" ? item.amountCents : item.type === "expense" ? -item.amountCents : 0), state.profile.openingBalanceCents);
  }

  function totalsFor(month) {
    return monthEntries(month).filter((item) => item.status === "paid").reduce((sum, item) => {
      if (item.type === "income") sum.income += item.amountCents;
      if (item.type === "expense") sum.expense += item.amountCents;
      return sum;
    }, { income: 0, expense: 0 });
  }

  function statusFor(item) {
    if (item.status === "paid") return { text: item.type === "income" ? "Recebido" : item.type === "transfer" ? "Concluída" : "Pago", tone: "success" };
    if (item.date < referenceDate) return { text: "Atrasado", tone: "danger" };
    if (item.date === referenceDate) return { text: "Vence hoje", tone: "warning" };
    return { text: "Previsto", tone: "neutral" };
  }

  function notify(message) {
    const feedback = document.querySelector("[data-transaction-feedback]");
    feedback.textContent = message;
    feedback.hidden = false;
  }

  function setAvailable(available) {
    if (!available) focusAfterLoad ||= document.activeElement?.closest(".transactions-card, .bills-card, .goals-card");
    document.querySelectorAll("#new-transaction, #dashboard-month, [data-open-budget], [data-new-goal], [data-open-profile], .row-actions button, .bill-value button, .goal-actions button").forEach((button) => { button.disabled = !available; });
    document.querySelector("#dashboard").setAttribute("aria-busy", String(!available));
    if (available && focusAfterLoad) {
      if (document.activeElement === document.body && focusAfterLoad.isConnected) { focusAfterLoad.tabIndex = -1; focusAfterLoad.focus({ preventScroll: true }); }
      focusAfterLoad = null;
    }
  }

  async function loadData() {
    if (loading) return false;
    loading = true;
    setAvailable(false);
    const feedback = document.querySelector("#connection-state");
    feedback.querySelector("span").textContent = "Carregando seus dados…";
    try {
      const owner = window.NivelaSession.getUser()?.id;
      const loaded = await window.NivelaData.load();
      if (!owner || owner !== window.NivelaSession.getUser()?.id) throw new Error("Sua conta mudou. Entre novamente para continuar.");
      state = loaded;
      renderAll();
      feedback.dataset.error = "false";
      feedback.querySelector("span").textContent = "Seus dados estão atualizados.";
      document.querySelector("#retry-load").hidden = true;
      document.querySelector("#refresh-data").hidden = false;
      document.querySelector(".app-layout").dataset.appState = "ready";
      setAvailable(true);
      return true;
    } catch (error) {
      feedback.dataset.error = "true";
      feedback.querySelector("span").textContent = error.message || "Não foi possível carregar seus dados. Tente novamente.";
      document.querySelector("#retry-load").hidden = false;
      document.querySelector("#refresh-data").hidden = true;
      return false;
    } finally { loading = false; }
  }

  async function submitAction(form, callback) {
    if (form.dataset.saving === "true") return;
    form.dataset.saving = "true";
    const submit = form.querySelector('[type="submit"]');
    const error = form.querySelector(".form-error");
    if (error) error.hidden = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    try { await callback(); }
    catch (failure) {
      if (error) { error.textContent = failure.message || "Não foi possível salvar. Tente novamente."; error.hidden = false; }
      else notify(failure.message || "Não foi possível salvar. Tente novamente.");
    } finally {
      submit.disabled = false;
      form.dataset.saving = "false";
      form.setAttribute("aria-busy", "false");
    }
  }

  async function saved(message) {
    const refreshed = await loadData();
    notify(refreshed ? message : `${message} Atualize o painel para consultar os dados mais recentes.`);
  }

  function filterBills(date) {
    const items = [...billsCard.querySelectorAll(".bill-list li")];
    items.forEach((item) => { item.hidden = date !== "all" && item.dataset.date !== date; });
    billsCard.querySelectorAll(".bill-list").forEach((list) => {
      const empty = [...list.children].every((item) => item.hidden);
      list.hidden = empty;
      list.previousElementSibling.hidden = empty;
    });
    const visible = items.filter((item) => !item.hidden);
    const pending = visible.filter((item) => item.dataset.paid !== "true");
    const unpaid = pending.filter((item) => item.dataset.type === "expense");
    const sum = (entries) => entries.reduce((total, item) => total + Number(item.dataset.amountCents), 0);
    setMoney(billsCard.querySelector(".bill-overview strong"), sum(unpaid));
    billsCard.querySelector(".bill-overview > .badge").textContent = `${unpaid.length} em aberto`;
    billsCard.querySelector(".receivables-label > span").textContent = formatMoney(sum(pending.filter((item) => item.dataset.type === "income")));
    billsCard.querySelector("[data-bills-empty]").hidden = visible.length > 0;
  }

  function renderBills() {
    const items = monthEntries().filter((item) => item.type !== "transfer").sort((a, b) => a.date.localeCompare(b.date));
    const days = [...new Set(items.map((item) => item.date))].sort().slice(0, 5);
    const buttons = billsCard.querySelector(".due-days");
    buttons.replaceChildren();
    if (!days.includes(selectedDueDate)) selectedDueDate = "all";
    ["all", ...days].forEach((date) => {
      const button = action("", () => { selectedDueDate = date; selectFilter([...buttons.children], button); filterBills(date); }, "due-day");
      const selected = selectedDueDate === date;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.append(el("strong", "", date === "all" ? "Todas" : date.slice(-2)), el("span", "", date === "all" ? "do mês" : date === referenceDate ? "Hoje" : monthLabel(date.slice(0, 7), { month: "short" }).replace(".", "")));
      buttons.append(button);
    });
    billsCard.querySelector(".list-label:not(.receivables-label) > span").textContent = monthLabel(activeMonth, { month: "long" });
    const expenseList = billsCard.querySelector(".bill-list:not(.receivable-list)");
    const incomeList = billsCard.querySelector(".receivable-list");
    expenseList.replaceChildren(); incomeList.replaceChildren();
    items.forEach((item) => {
      const li = el("li");
      Object.assign(li.dataset, { date: item.date, amountCents: item.amountCents, type: item.type, paid: String(item.status === "paid") });
      const symbol = el("span", `item-icon tone-${item.type === "income" ? "green" : "blue"}`); symbol.append(icon(item.type === "income" ? "income" : "wallet"));
      const description = el("div", "bill-description"); description.append(el("strong", "", item.description), el("span", "", `${item.category} · ${dateLabel(item.date)}`));
      const value = el("div", "bill-value"); const status = statusFor(item);
      value.append(el("strong", item.type === "income" ? "positive" : "", formatMoney(item.amountCents)), el("span", `badge badge-${status.tone}`, status.text));
      if (item.status === "pending") value.append(action(item.type === "income" ? "Receber" : "Pagar", () => changeStatus(item, "paid")));
      li.append(symbol, description, value);
      (item.type === "income" ? incomeList : expenseList).append(li);
    });
    filterBills(selectedDueDate);
  }

  function filterTransactions() {
    const type = transactionsCard.querySelector(".filter-tab.is-active").dataset.transactionType;
    const search = normalizeText(document.querySelector("#transaction-search").value);
    const rows = [...transactionsCard.querySelectorAll("tbody tr[data-type]")];
    let visible = 0;
    rows.forEach((row) => {
      const matches = (type === "all" || row.dataset.type === type) && normalizeText(`${row.dataset.description} ${row.dataset.category}`).includes(search);
      row.hidden = !matches; if (matches) visible += 1;
    });
    transactionsCard.querySelector(".card-header > .subtle-tag").textContent = `${visible} de ${rows.length} transações`;
    transactionsCard.querySelector("[data-transactions-empty]").hidden = visible > 0;
    transactionsCard.querySelector("[data-filter-status]").textContent = `${visible} movimentações encontradas.`;
  }

  function renderTransactions() {
    const tbody = transactionsCard.querySelector("tbody");
    tbody.querySelectorAll("tr[data-type]").forEach((row) => row.remove());
    const empty = tbody.querySelector("[data-transactions-empty]");
    monthEntries().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).forEach((item) => {
      const row = rowTemplate.cloneNode(true);
      Object.assign(row.dataset, { type: item.type, description: item.description, category: item.category, date: item.date });
      const detail = row.querySelector(".transaction-description > span:last-child");
      detail.replaceChildren(document.createTextNode(item.description), el("small", "", item.installmentCount > 1 ? `Parcela ${item.installment} de ${item.installmentCount}` : item.recurring ? "Recorrência mensal" : "Lançamento pessoal"));
      row.querySelector("use").setAttribute("href", `#i-${item.type === "income" ? "income" : item.type === "transfer" ? "swap" : "expense"}`);
      row.querySelector(".category-tag").textContent = item.category;
      const time = row.querySelector("time"); time.dateTime = item.date; time.textContent = dateLabel(item.date);
      row.cells[3].textContent = "Carteira pessoal";
      const status = statusFor(item); const badge = row.querySelector(".badge"); badge.className = `badge badge-${status.tone}`; badge.textContent = status.text;
      row.cells[5].className = `amount-column ${item.type === "income" ? "positive" : "expense-amount"}`;
      row.cells[5].textContent = `${item.type === "income" ? "+" : item.type === "expense" ? "−" : "↔"} ${formatMoney(item.amountCents)}`;
      const cell = el("td"); const controls = el("div", "row-actions");
      controls.append(action("Editar", () => editTransaction(item)), action(item.status === "paid" ? "Reabrir" : "Confirmar", () => changeStatus(item, item.status === "paid" ? "pending" : "paid")), action("Excluir", () => askDelete("transaction", item)));
      [...controls.children].forEach((button) => button.setAttribute("aria-label", `${button.textContent}: ${item.description}`));
      cell.append(controls); row.append(cell); tbody.insertBefore(row, empty);
    });
    document.querySelector(".nav-count").textContent = monthEntries().length;
    filterTransactions();
  }

  async function changeStatus(item, status) {
    if (loading) return;
    setAvailable(false);
    try { await window.NivelaData.updateTransaction(item.id, { status }); await saved(status === "paid" ? "Pagamento ou recebimento confirmado." : "Lançamento marcado como pendente."); }
    catch (error) { notify(error.message); setAvailable(true); }
  }

  function editTransaction(item) {
    transactionForm.reset(); editingTransaction = item;
    const fields = transactionForm.elements;
    fields.type.value = item.type; fields.description.value = item.description; fields.amount.value = (item.amountCents / 100).toFixed(2);
    fields.category.value = item.category; fields.date.value = item.date; fields.settled.checked = item.status === "paid";
    document.querySelector("#transaction-dialog-title").textContent = "Editar transação";
    updateScheduleOptions(); openDialog(transactionDialog);
  }

  function initTransactionForm() {
    const fields = transactionForm.elements;
    fields.date.value = referenceDate;
    document.querySelector("#new-transaction").addEventListener("click", () => {
      editingTransaction = null; transactionForm.reset(); fields.date.value = referenceDate;
      document.querySelector("#transaction-dialog-title").textContent = "Nova transação";
      document.querySelector("#transaction-error").hidden = true;
      updateScheduleOptions(); openDialog(transactionDialog);
    });
    transactionForm.addEventListener("change", (event) => {
      if (event.target === fields.date) fields.settled.checked = fields.date.value <= referenceDate;
      updateScheduleOptions();
    });
    transactionForm.addEventListener("submit", (event) => {
      event.preventDefault(); if (!transactionForm.reportValidity()) return;
      submitAction(transactionForm, async () => {
        if (editingTransaction) {
          await window.NivelaData.updateTransaction(editingTransaction.id, { type: fields.type.value, description: fields.description.value.trim(), amountCents: cents(fields.amount), category: fields.category.value, date: fields.date.value, status: fields.settled.checked ? "paid" : "pending" });
        } else {
          const entries = createTransactions(); if (!entries) return;
          const seriesId = crypto.randomUUID();
          entries.forEach((entry, index) => { entry.seriesId = seriesId; entry.status = index === 0 && fields.settled.checked ? "paid" : "pending"; });
          await window.NivelaData.saveTransactions(entries);
        }
        document.querySelector("#transaction-search").value = "";
        const buttons = [...transactionsCard.querySelectorAll("[data-transaction-type]")]; selectFilter(buttons, buttons[0]);
        transactionDialog.close();
        await saved(editingTransaction ? "Transação atualizada. Apenas esta ocorrência foi alterada." : "Transação salva na sua conta. As próximas parcelas e recorrências ficam pendentes.");
      });
    });
    updateScheduleOptions();
  }

  function updateSummary() {
    const totals = totalsFor(activeMonth); const previousMonth = monthDate(activeMonth, -1); const previous = totalsFor(previousMonth);
    const net = totals.income - totals.expense; const balance = balanceAt(activeMonth);
    [balance, totals.income, totals.expense, net].forEach((value, index) => {
      setMoney(summaryValues[index], value); summaryValues[index].parentElement.classList.toggle("long-value", Math.abs(value) >= 10000000);
    });
    summaryValues[0].classList.toggle("negative", balance < 0);
    summaryValues[3].classList.toggle("positive", net >= 0); summaryValues[3].classList.toggle("negative", net < 0);
    const stats = [...document.querySelectorAll(".summary-stats .stat")];
    [balanceAt(previousMonth), previous.income, previous.expense].forEach((before, index) => {
      const value = [balance, totals.income, totals.expense][index]; const spans = stats[index].querySelectorAll(".stat-note > span");
      spans[0].textContent = before ? `${((value - before) / Math.abs(before) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1, signDisplay: "always" })}%` : "—";
      spans[1].textContent = before ? "vs. mês anterior" : "sem base anterior";
    });
    stats[3].querySelector(".stat-note > span:last-child").textContent = totals.income ? `${(net / totals.income * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da receita recebida` : "Sem receitas recebidas no mês";
    const badge = document.querySelector(".summary-header > .badge"); badge.className = `badge badge-${net < 0 ? "danger" : net === 0 ? "neutral" : "success"}`;
    badge.textContent = net < 0 ? "Mês negativo" : net === 0 ? "Mês equilibrado" : "Mês positivo";
    document.querySelector(".summary-insight p").textContent = "O saldo considera pagamentos e recebimentos confirmados. Seus lançamentos pendentes ficam na agenda.";
    document.querySelector(".period-note").textContent = monthLabel(activeMonth);
    updateCharts(totals.expense);
  }

  function updateCharts(totalExpenses) {
    const totals = { Moradia: 0, Alimentação: 0, Transporte: 0, Lazer: 0, Outros: 0 };
    monthEntries().filter((item) => item.type === "expense" && item.status === "paid").forEach((item) => { totals[item.category in totals ? item.category : "Outros"] += item.amountCents; });
    const colors = ["var(--brand)", "var(--success)", "var(--warning)", "var(--purple)", "var(--chart-neutral)"];
    let start = 0;
    const stops = Object.entries(totals).map(([category, amount], index) => {
      const share = totalExpenses ? amount / totalExpenses * 100 : 0; const end = start + share;
      const stop = `${colors[index]} ${start}% ${end}%`; start = end;
      document.querySelectorAll(".chart-legend strong")[index].textContent = `${Math.round(share)}%`; return stop;
    });
    const donut = document.querySelector(".donut"); donut.style.background = totalExpenses ? `conic-gradient(${stops.join(", ")})` : "var(--bg-muted)";
    setMoney(donut.querySelector("strong"), totalExpenses, "small");
    donut.setAttribute("aria-label", `Despesas pagas: ${formatMoney(totalExpenses)}. ${Object.entries(totals).map(([name, amount]) => `${name}: ${formatMoney(amount)}`).join(". ")}`);
    const largest = Object.entries(totals).sort((a, b) => b[1] - a[1])[0][0];
    document.querySelector(".category-figure .figure-footnote").textContent = totalExpenses ? `${largest} é sua maior despesa paga.` : "Registre despesas para acompanhar a distribuição.";
    const months = Array.from({ length: 6 }, (_, index) => monthDate(activeMonth, index - 5));
    const balances = months.map(balanceAt); const maximum = Math.max(10000, ...balances.map(Math.abs)); const ceiling = Math.ceil(maximum / 10000) * 10000;
    document.querySelectorAll(".bar-column").forEach((column, index) => {
      const bar = column.querySelector(".bar"); bar.style.height = `${Math.abs(balances[index]) / ceiling * 100}%`; bar.classList.toggle("is-negative", balances[index] < 0); bar.title = formatMoney(balances[index]);
      column.querySelector(".bar-label").textContent = monthLabel(months[index], { month: "short" }).replace(".", "");
    });
    document.querySelectorAll(".chart-scale span").forEach((span, index) => { span.textContent = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(ceiling * (3 - index) / 3 / 100); });
    document.querySelector(".bar-value").textContent = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(balances[5] / 100);
    document.querySelector(".bar-chart").setAttribute("aria-label", `Saldos: ${months.map((month, index) => `${monthLabel(month)}: ${formatMoney(balances[index])}`).join("; ")}. As barras mostram a magnitude; saldos negativos estão identificados em vermelho.`);
    document.querySelector(".balance-footnote").textContent = "Histórico dos pagamentos e recebimentos confirmados. Valores negativos em vermelho.";
  }

  function updateBudgets() {
    const grid = document.querySelector(".budget-grid"); grid.replaceChildren();
    let remaining = 0; let configured = 0;
    budgetCategories.forEach((category, index) => {
      const limit = state.budgets.find((budget) => budget.category === category)?.limitCents || 0;
      const spent = monthEntries().filter((entry) => entry.type === "expense" && entry.category === category).reduce((sum, entry) => sum + entry.amountCents, 0);
      const percent = limit ? spent / limit * 100 : 0; const status = limit && percent >= 100 ? "danger" : limit && percent >= 80 ? "warning" : "normal";
      const item = el("div", "budget-item"); item.dataset.budgetStatus = status;
      const label = el("div", "budget-label"); const title = el("h3", "", category); label.append(title, el("span", "", limit ? `${(Math.floor(percent * 10) / 10).toLocaleString("pt-BR")}%${status === "danger" ? " · Limite atingido" : status === "warning" ? " · Atenção" : ""}` : "Sem limite"));
      const amount = el("p", "budget-amount", formatMoney(spent)); amount.append(el("span", "", limit ? ` / ${formatMoney(limit)}` : " comprometidos no mês"));
      const track = el("div", "progress-track"); track.setAttribute("role", "progressbar"); track.setAttribute("aria-label", `Orçamento de ${category}`); track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", String(limit ? limit / 100 : 100)); track.setAttribute("aria-valuenow", String(limit ? Math.min(spent, limit) / 100 : 0)); track.setAttribute("aria-valuetext", `${formatMoney(spent)}${limit ? ` de ${formatMoney(limit)}` : ", sem limite definido"}`);
      const fill = el("div", `progress-fill progress-${["home", "food", "transport", "leisure"][index]}`); fill.style.width = `${Math.min(100, percent)}%`; track.append(fill);
      item.append(label, amount, track); grid.append(item);
      if (limit) { remaining += limit - spent; configured += 1; }
    });
    document.querySelector(".budget-footer p").textContent = configured ? `${remaining < 0 ? "Limites ultrapassados em" : "Disponível nos limites definidos:"} ${formatMoney(Math.abs(remaining))}.` : "Defina limites para acompanhar seus gastos pagos e previstos.";
  }

  function renderGoals() {
    const grid = document.querySelector(".goals-grid"); grid.replaceChildren();
    document.querySelector(".goals-total").textContent = `${state.goals.length} ${state.goals.length === 1 ? "meta" : "metas"}`;
    if (!state.goals.length) grid.append(el("p", "empty-state", "Qual é seu próximo plano? Crie uma meta e acompanhe o valor que você já guardou."));
    state.goals.forEach((goal) => {
      const item = el("section", "goal-item"); const top = el("div", "goal-top"); const symbol = el("span", `goal-icon tone-${goal.tone}`); symbol.append(icon("target"));
      const percent = goal.savedCents / goal.targetCents * 100; top.append(symbol, el("span", `goal-percentage goal-${goal.tone}`, `${Math.floor(percent)}%`));
      const title = el("h3", "", goal.name); const amount = el("p", "goal-amount"); amount.append(el("strong", "", formatMoney(goal.savedCents)), el("span", "", ` de ${formatMoney(goal.targetCents)}`));
      const track = el("div", "progress-track"); track.setAttribute("role", "progressbar"); track.setAttribute("aria-label", goal.name); track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", String(goal.targetCents / 100)); track.setAttribute("aria-valuenow", String(Math.min(goal.targetCents, goal.savedCents) / 100)); track.setAttribute("aria-valuetext", `${formatMoney(goal.savedCents)} de ${formatMoney(goal.targetCents)}, ${Math.floor(percent)}%`);
      const fill = el("div", "progress-fill"); fill.style.width = `${Math.min(100, percent)}%`; fill.style.background = `var(--${goal.tone === "green" ? "success" : goal.tone === "purple" ? "purple" : "brand"})`; track.append(fill);
      const controls = el("div", "goal-actions"); controls.append(action("Atualizar", () => openGoal(goal), "button button-secondary"), action("Excluir", () => askDelete("goal", goal), "button button-secondary"));
      controls.querySelectorAll("button").forEach((button) => button.setAttribute("aria-label", `${button.textContent} meta ${goal.name}`));
      item.append(top, title, el("p", "goal-description", "Seu próximo passo, no seu ritmo."), amount, track, el("p", "goal-remaining", goal.savedCents >= goal.targetCents ? "Meta alcançada!" : `Faltam ${formatMoney(goal.targetCents - goal.savedCents)}.`), controls); grid.append(item);
    });
  }

  function renderAll() {
    document.querySelector(".profile-details strong").textContent = state.profile.fullName || "Minha conta";
    document.querySelector(".avatar").textContent = (state.profile.fullName || "N").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR");
    renderTransactions(); renderBills(); updateSummary(); updateBudgets(); renderGoals();
    const pending = monthEntries().filter((item) => item.status === "pending" && item.type !== "transfer");
    const notices = document.querySelector("[data-notification-list]"); notices.replaceChildren();
    pending.slice(0, 4).forEach((item) => notices.append(el("p", "", `${item.description}: ${formatMoney(item.amountCents)} · ${dateLabel(item.date)}`)));
    if (!pending.length) notices.append(el("p", "", "Nenhuma conta pendente neste mês."));
    document.querySelector(".notifications summary").setAttribute("aria-label", `Notificações, ${pending.length} contas pendentes`);
    document.querySelector(".notification-dot").hidden = !pending.length;
  }

  function openGoal(goal = null) {
    editingGoal = goal; const form = document.querySelector("#goal-form"); form.reset();
    form.elements.name.value = goal?.name || ""; form.elements.target.value = goal ? (goal.targetCents / 100).toFixed(2) : ""; form.elements.saved.value = goal ? (goal.savedCents / 100).toFixed(2) : "0"; form.elements.tone.value = goal?.tone || "blue";
    form.querySelector(".form-error").hidden = true; openDialog(document.querySelector("#goal-dialog"));
  }

  function askDelete(type, item) {
    deletion = { type, item }; document.querySelector("#delete-description").textContent = `Você vai excluir ${type === "goal" ? "a meta" : "o lançamento"} “${item.name || item.description}”. Esta ação não pode ser desfeita.${type === "transaction" ? " As demais parcelas ou recorrências serão mantidas." : ""}`;
    document.querySelector("#delete-dialog .form-error").hidden = true; openDialog(document.querySelector("#delete-dialog"));
  }

  function initSettings() {
    const profile = document.querySelector("#profile-form");
    document.querySelector("[data-open-profile]").addEventListener("click", () => {
      profile.elements.fullName.value = state.profile.fullName; profile.elements.openingBalance.value = (state.profile.openingBalanceCents / 100).toFixed(2);
      profile.querySelector(".form-error").hidden = true; openDialog(document.querySelector("#profile-dialog"));
    });
    profile.addEventListener("submit", (event) => {
      event.preventDefault(); if (!profile.reportValidity()) return;
      submitAction(profile, async () => { await window.NivelaData.saveProfile({ fullName: profile.elements.fullName.value.trim(), openingBalanceCents: cents(profile.elements.openingBalance) }); document.querySelector("#profile-dialog").close(); await saved("Perfil atualizado."); });
    });
    const budgetForm = document.querySelector("#budget-form");
    document.querySelector("[data-open-budget]").addEventListener("click", () => {
      const fields = budgetForm.querySelector("[data-budget-fields]"); fields.replaceChildren();
      budgetCategories.forEach((category, index) => {
        const field = el("div", "form-field"); const label = el("label", "", `${category} (R$)`); label.htmlFor = `budget-${index}`;
        const input = el("input"); input.id = label.htmlFor; input.name = category; input.type = "number"; input.min = "0"; input.max = "999999999.99"; input.step = "0.01"; input.required = true; input.value = ((state.budgets.find((budget) => budget.category === category)?.limitCents || 0) / 100).toFixed(2); field.append(label, input); fields.append(field);
      });
      budgetForm.querySelector(".form-error").hidden = true; openDialog(document.querySelector("#budget-dialog"));
    });
    budgetForm.addEventListener("submit", (event) => {
      event.preventDefault(); if (!budgetForm.reportValidity()) return;
      submitAction(budgetForm, async () => {
        await window.NivelaData.saveBudgets(budgetCategories.map((category) => ({ category, limitCents: cents(budgetForm.elements.namedItem(category)) })));
        document.querySelector("#budget-dialog").close(); await saved("Limites atualizados.");
      });
    });
    document.querySelector("[data-new-goal]").addEventListener("click", () => openGoal());
    const goalForm = document.querySelector("#goal-form");
    goalForm.addEventListener("submit", (event) => {
      event.preventDefault(); if (!goalForm.reportValidity()) return;
      submitAction(goalForm, async () => {
        await window.NivelaData.saveGoal({ ...(editingGoal ? { id: editingGoal.id } : {}), name: goalForm.elements.name.value.trim(), targetCents: cents(goalForm.elements.target), savedCents: cents(goalForm.elements.saved), tone: goalForm.elements.tone.value });
        document.querySelector("#goal-dialog").close(); await saved("Meta salva. O valor guardado é um acompanhamento do seu planejamento.");
      });
    });
    document.querySelector("#confirm-delete").addEventListener("click", async (event) => {
      if (!deletion || event.currentTarget.disabled) return;
      const button = event.currentTarget; button.disabled = true;
      try {
        if (deletion.type === "goal") await window.NivelaData.deleteGoal(deletion.item.id); else await window.NivelaData.deleteTransaction(deletion.item.id);
        document.querySelector("#delete-dialog").close(); await saved("Registro excluído.");
      } catch (error) { const message = document.querySelector("#delete-dialog .form-error"); message.textContent = error.message; message.hidden = false; }
      finally { button.disabled = false; }
    });
  }

  function initSupportForm() {
    const dialog = document.querySelector("#support-dialog"); const form = document.querySelector("#support-form"); const confirmation = document.querySelector("#support-confirmation");
    document.querySelectorAll("[data-open-support]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault(); form.hidden = false; confirmation.hidden = true;
      const user = window.NivelaSession.getUser(); form.elements.namedItem("name").value = state.profile.fullName || ""; form.elements.email.value = user?.email || ""; openDialog(dialog);
    }));
    form.addEventListener("submit", (event) => {
      event.preventDefault(); if (!form.reportValidity()) return;
      submitAction(form, async () => {
        const record = await window.NivelaData.sendSupport({ name: form.elements.namedItem("name").value.trim(), email: form.elements.email.value.trim(), subject: form.elements.subject.value, message: form.elements.message.value.trim() });
        confirmation.querySelector("p").textContent = `Sua mensagem foi salva. Protocolo ${record.id.slice(0, 8)}. Obrigado pelo contato!`;
        form.reset(); form.hidden = true; confirmation.hidden = false; confirmation.focus();
      });
    });
  }

  async function init() {
    const month = document.querySelector("#dashboard-month"); month.value = activeMonth;
    const time = document.querySelector(".today time"); time.dateTime = referenceDate; time.textContent = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    initKeyboardNavigation(); initTransactionFilters(); initDialogs(); initTransactionForm(); initSettings(); initSupportForm();
    month.addEventListener("change", () => {
      if (!month.reportValidity() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)) return;
      activeMonth = month.value; selectedDueDate = "all"; renderAll();
    });
    document.querySelector("#retry-load").addEventListener("click", loadData);
    document.querySelector("#refresh-data").addEventListener("click", loadData);
    const user = await window.NivelaSession.ready;
    if (user) {
      window.NivelaSession.subscribe(() => {
        if (window.NivelaSession.getUser()?.id !== user.id) {
          document.querySelector(".app-layout").hidden = true;
          location.replace("index.html");
        }
      });
      await loadData();
    }
    else { document.querySelector("#connection-state > span").textContent = window.NivelaSession.getLastError()?.message || "Entre na sua conta para consultar seus dados."; }
  }

  function formatMoney(cents) {
    return currency.format(cents / 100);
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

  function normalizeText(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
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

  function dateLabel(value) {
    const [year, month, day] = value.split("-");
    const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${day} ${months[Number(month) - 1]}, ${year}`;
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
    transactionForm.querySelectorAll('[name="type"]').forEach((radio) => { radio.disabled = Boolean(editingTransaction && editingTransaction.installmentCount > 1 && radio.value !== "expense"); });
    if (!expense) fields.installments.checked = false;
    fields.installments.disabled = Boolean(editingTransaction) || !expense || fields.recurring.checked;
    fields.recurring.disabled = Boolean(editingTransaction) || fields.installments.checked;
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

  function openDialog(dialog) {
    if (dialog.open) return;
    const other = document.querySelector("dialog[open]");
    if (other) other.close();
    dialogOpeners.set(dialog, document.activeElement);
    dialog.showModal();
    document.querySelectorAll(`[aria-controls="${dialog.id}"]`).forEach((button) => button.setAttribute("aria-expanded", "true"));
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
        document.querySelectorAll(`[aria-controls="${dialog.id}"]`).forEach((button) => button.setAttribute("aria-expanded", "false"));
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

  function initKeyboardNavigation() {
    document.querySelectorAll(".main-nav a[href^='#'], .footer-nav a[href^='#']").forEach((link) => {
      if (link.hasAttribute("data-open-support")) return;
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      target.tabIndex = -1;
      link.addEventListener("click", () => target.focus({ preventScroll: true }));
    });
  }

  init().catch((error) => notify(error.message || "Não foi possível abrir o painel."));
})();
