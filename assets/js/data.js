(() => {
  "use strict";

  const categories = ["Moradia", "Alimentação", "Transporte", "Lazer", "Serviços", "Outros"];
  const defaultBudgetCategories = categories.slice(0, 4);
  const types = ["income", "expense", "transfer"];
  const statuses = ["pending", "paid"];
  const tones = ["blue", "purple", "green"];
  const subjects = ["Transações", "Orçamentos e metas", "Dúvidas sobre o painel", "Sugestões", "Outros"];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const pageSize = 1000;
  const maxCents = 99999999999;
  const transactionColumns = "id,user_id,type,description,amount_cents,category,date,recurring,installment,installment_count,series_id,status,created_at";

  function invalid(message, code = "VALIDATION_ERROR") {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Os dados informados não são válidos.");
    return value;
  }

  function text(value, label, min, max) {
    if (typeof value !== "string") invalid(`Preencha ${label}.`);
    const result = value.trim();
    if (result.length < min || result.length > max) invalid(`${label} deve ter entre ${min} e ${max} caracteres.`);
    return result;
  }

  function choice(value, values, label) {
    if (!values.includes(value)) invalid(`Confira ${label}.`);
    return value;
  }

  function cents(value, label, min = 0) {
    if (!Number.isSafeInteger(value) || value < min || value > maxCents) invalid(`Informe ${label} em centavos inteiros, dentro do limite permitido.`);
    return value;
  }

  function uuid(value) {
    if (typeof value !== "string" || !uuidPattern.test(value)) invalid("O identificador informado não é válido.");
    return value;
  }

  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") invalid("Informe uma data válida.");
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid("Informe uma data válida.");
    return value;
  }

  function bool(value) {
    if (typeof value !== "boolean") invalid("Confira a opção de recorrência.");
    return value;
  }

  function installment(value) {
    if (!Number.isInteger(value) || value < 1 || value > 24) invalid("Informe uma quantidade de parcelas entre 1 e 24.");
    return value;
  }

  function storedCents(value) {
    const number = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number) || Math.abs(number) > maxCents) invalid("O banco devolveu um valor monetário inválido.", "INVALID_RESPONSE");
    return number;
  }

  async function session() {
    const auth = window.NivelaSession;
    if (!auth || typeof auth.getUser !== "function" || typeof auth.request !== "function") invalid("A conexão com sua conta ainda não foi preparada.", "AUTH_REQUIRED");
    await auth.ready;
    const user = await auth.getUser();
    if (!user || typeof user.id !== "string" || !uuidPattern.test(user.id)) invalid("Entre na sua conta para continuar.", "AUTH_REQUIRED");
    const userId = user.id;
    const assertCurrent = async () => {
      const current = await auth.getUser();
      if (window.NivelaSession !== auth || !current || current.id !== userId) invalid("Sua conta mudou. Atualize os dados antes de continuar.", "AUTH_CHANGED");
    };
    const request = async (target, options) => {
      await assertCurrent();
      const result = await auth.request(target, options);
      await assertCurrent();
      return result;
    };
    return { user: { ...user, id: userId }, request, assertCurrent };
  }

  function path(table, userId, params = {}) {
    const query = new URLSearchParams({ user_id: `eq.${userId}`, ...params });
    return `/rest/v1/${table}?${query.toString()}`;
  }

  function rows(value) {
    if (!Array.isArray(value)) invalid("Não foi possível ler os dados da sua conta.", "INVALID_RESPONSE");
    return value;
  }

  function first(value) {
    const result = rows(value);
    if (result.length !== 1) invalid("O registro não foi encontrado ou não está disponível para sua conta.", "NOT_FOUND");
    return result[0];
  }

  async function allRows(context, table, select, order) {
    const records = [];
    let offset = 0;
    while (true) {
      const page = rows(await context.request(path(table, context.user.id, { select, order, limit: String(pageSize), offset: String(offset) })));
      if (!page.length) return records;
      records.push(...page);
      offset += page.length;
    }
  }

  function profile(row) {
    return { userId: row.user_id, fullName: row.full_name, openingBalanceCents: storedCents(row.opening_balance_cents) };
  }

  function transaction(row) {
    return {
      id: row.id, userId: row.user_id, type: row.type, description: row.description,
      amountCents: storedCents(row.amount_cents), category: row.category, date: row.date,
      recurring: row.recurring, installment: row.installment, installmentCount: row.installment_count,
      seriesId: row.series_id, status: row.status, createdAt: row.created_at,
    };
  }

  function budget(row) {
    return { category: row.category, limitCents: storedCents(row.limit_cents) };
  }

  function goal(row) {
    return { id: row.id, name: row.name, targetCents: storedCents(row.target_cents), savedCents: storedCents(row.saved_cents), tone: row.tone };
  }

  async function load() {
    const context = await session();
    const profilePath = path("profiles", context.user.id, { select: "user_id,full_name,opening_balance_cents", limit: "1" });
    let [profiles, budgets, transactions, goals] = await Promise.all([
      context.request(profilePath).then(rows),
      allRows(context, "budgets", "category,limit_cents", "category.asc"),
      allRows(context, "transactions", transactionColumns, "date.asc,id.asc"),
      allRows(context, "goals", "id,name,target_cents,saved_cents,tone", "name.asc,id.asc"),
    ]);

    if (!profiles.length) {
      const name = context.user.user_metadata?.full_name;
      const fullName = Array.from(typeof name === "string" && name.trim() ? name.trim() : context.user.email?.split("@")[0] || "Minha conta").slice(0, 80).join("");
      await context.request("/rest/v1/profiles?on_conflict=user_id", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: { user_id: context.user.id, full_name: fullName, opening_balance_cents: 0 },
      });
      profiles = rows(await context.request(profilePath));
    }

    const missing = defaultBudgetCategories.filter((category) => !budgets.some((item) => item.category === category));
    if (missing.length) {
      await context.request("/rest/v1/budgets?on_conflict=user_id,category", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: missing.map((category) => ({ user_id: context.user.id, category, limit_cents: 0 })),
      });
      budgets = await allRows(context, "budgets", "category,limit_cents", "category.asc");
    }

    await context.assertCurrent();
    return { profile: profile(first(profiles)), transactions: transactions.map(transaction), budgets: budgets.map(budget), goals: goals.map(goal) };
  }

  function transactionFields(input, partial = false) {
    object(input);
    const output = {};
    const validators = {
      type: (value) => choice(value, types, "o tipo de transação"),
      description: (value) => text(value, "a descrição", 1, 120),
      amountCents: (value) => cents(value, "um valor positivo", 1),
      category: (value) => choice(value, categories, "a categoria"),
      date,
      recurring: bool,
      installment,
      installmentCount: installment,
      seriesId: (value) => value === null ? null : uuid(value),
      status: (value) => choice(value, statuses, "o status"),
    };
    const names = { amountCents: "amount_cents", installmentCount: "installment_count", seriesId: "series_id" };
    const defaults = { recurring: false, installment: 1, installmentCount: 1, seriesId: null, status: "pending" };
    for (const [key, validate] of Object.entries(validators)) {
      if (Object.hasOwn(input, key)) output[names[key] || key] = validate(input[key]);
      else if (!partial) output[names[key] || key] = validate(defaults[key]);
    }
    if (output.installment !== undefined && output.installment_count !== undefined && output.installment > output.installment_count) invalid("A parcela atual não pode ultrapassar o total de parcelas.");
    if ((output.installment_count > 1 && output.type && output.type !== "expense") || (output.recurring && output.installment_count > 1)) invalid("Confira as opções de parcelamento e recorrência.");
    return output;
  }

  async function saveTransactions(entries) {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 1000) invalid("Informe entre 1 e 1000 lançamentos por envio.");
    const context = await session();
    const body = entries.map((item) => ({ ...transactionFields(item), id: item.id ? uuid(item.id) : crypto.randomUUID(), user_id: context.user.id }));
    const result = rows(await context.request("/rest/v1/transactions", { method: "POST", body, headers: { Prefer: "return=representation" } }));
    if (result.length !== body.length) invalid("Não foi possível confirmar todos os lançamentos. Atualize a página para conferir os registros.", "INVALID_RESPONSE");
    return result.map(transaction);
  }

  async function updateTransaction(id, changes) {
    const context = await session();
    const body = transactionFields(changes, true);
    if (!Object.keys(body).length) invalid("Não há alterações válidas para salvar.");
    const result = await context.request(path("transactions", context.user.id, { id: `eq.${uuid(id)}` }), { method: "PATCH", body, headers: { Prefer: "return=representation" } });
    return transaction(first(result));
  }

  async function remove(table, id) {
    const context = await session();
    const result = await context.request(path(table, context.user.id, { id: `eq.${uuid(id)}`, select: "id" }), { method: "DELETE", headers: { Prefer: "return=representation" } });
    return { id: first(result).id };
  }

  async function saveBudgets(entries) {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > categories.length) invalid("Informe entre 1 e 6 orçamentos por envio.");
    const values = entries.map((item) => {
      object(item);
      return { category: choice(item.category, categories, "a categoria"), limit_cents: cents(item.limitCents, "o limite do orçamento") };
    });
    if (new Set(values.map((item) => item.category)).size !== values.length) invalid("Cada categoria pode aparecer apenas uma vez no envio dos orçamentos.");
    const context = await session();
    const body = values.map((item) => ({ ...item, user_id: context.user.id }));
    const result = await context.request("/rest/v1/budgets?on_conflict=user_id,category", { method: "POST", body, headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
    if (rows(result).length !== body.length) invalid("Não foi possível confirmar todos os limites. Atualize a página para conferir os orçamentos.", "INVALID_RESPONSE");
    return result.map(budget);
  }

  async function saveBudget(category, limitCents) {
    return (await saveBudgets([{ category, limitCents }]))[0];
  }

  async function saveGoal(input) {
    object(input);
    const context = await session();
    const body = {
      name: text(input.name, "o nome da meta", 1, 80),
      target_cents: cents(input.targetCents, "o valor da meta", 1),
      saved_cents: cents(input.savedCents ?? 0, "o total guardado"),
      tone: choice(input.tone ?? "blue", tones, "a cor da meta"),
    };
    const editing = Boolean(input.id);
    const target = editing ? path("goals", context.user.id, { id: `eq.${uuid(input.id)}` }) : "/rest/v1/goals";
    if (!editing) Object.assign(body, { id: crypto.randomUUID(), user_id: context.user.id });
    const result = await context.request(target, { method: editing ? "PATCH" : "POST", body, headers: { Prefer: "return=representation" } });
    return goal(first(result));
  }

  async function saveProfile(changes) {
    object(changes);
    const context = await session();
    const body = {};
    if (Object.hasOwn(changes, "fullName")) body.full_name = text(changes.fullName, "o nome", 1, 80);
    if (Object.hasOwn(changes, "openingBalanceCents")) body.opening_balance_cents = cents(changes.openingBalanceCents, "o saldo inicial", -maxCents);
    if (!Object.keys(body).length) invalid("Não há alterações válidas para salvar.");
    const result = await context.request(path("profiles", context.user.id), { method: "PATCH", body, headers: { Prefer: "return=representation" } });
    return profile(first(result));
  }

  async function sendSupport(input) {
    object(input);
    const context = await session();
    const id = crypto.randomUUID();
    const body = {
      id, user_id: context.user.id, name: text(input.name, "o nome", 2, 80),
      subject: choice(input.subject, subjects, "o assunto"), message: text(input.message, "a mensagem", 10, 2000),
    };
    if (input.email) {
      body.email = text(input.email, "o e-mail", 3, 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) invalid("Informe um e-mail válido.");
    }
    await context.request("/rest/v1/support_messages", { method: "POST", body, headers: { Prefer: "return=minimal" } });
    return { id };
  }

  window.NivelaData = Object.freeze({
    load, saveTransactions, updateTransaction, deleteTransaction: (id) => remove("transactions", id),
    saveBudget, saveBudgets, saveGoal, deleteGoal: (id) => remove("goals", id), saveProfile, sendSupport,
  });
})();
