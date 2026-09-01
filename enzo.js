import {
  PERSONAL_ACCOUNTS,
  PERSONAL_CATEGORIES,
  PERSONAL_CURRENCIES,
  PERSONAL_TYPES,
  parsePersonalImport,
  validatePersonalMovement
} from "./lib/personal.js?v=2";

const title = document.querySelector("#personal-title");
const subtitle = document.querySelector("#personal-subtitle");
const tabs = Array.from(document.querySelectorAll(".personal-tabs .app-tab"));
const importPanel = document.querySelector("#import-panel");
const summaryPanel = document.querySelector("#personal-summary-panel");
const creditPanel = document.querySelector("#credit-panel");
const importText = document.querySelector("#import-text");
const analyzeButton = document.querySelector("#analyze-import");
const parseError = document.querySelector("#parse-error");
const reviewSection = document.querySelector("#review-section");
const reviewList = document.querySelector("#review-list");
const reviewCount = document.querySelector("#review-count");
const saveButton = document.querySelector("#save-import");
const saveError = document.querySelector("#save-error");
const saveSuccess = document.querySelector("#save-success");
const refreshPersonal = document.querySelector("#refresh-personal");
const personalLoading = document.querySelector("#personal-loading");
const currencySummary = document.querySelector("#currency-summary");
const personalAccountsCard = document.querySelector("#personal-accounts-card");
const personalAccountList = document.querySelector("#personal-account-list");
const recentCard = document.querySelector("#recent-card");
const recentList = document.querySelector("#recent-list");
const personalError = document.querySelector("#personal-error");
const personalUpdated = document.querySelector("#personal-updated");
const personalOcaCard = document.querySelector("#personal-oca-card");
const personalOcaOutstanding = document.querySelector("#personal-oca-outstanding");
const personalOcaMonths = document.querySelector("#personal-oca-months");
const creditForm = document.querySelector("#credit-form");
const creditDate = document.querySelector("#credit-date");
const creditDescription = document.querySelector("#credit-description");
const creditTotal = document.querySelector("#credit-total");
const creditInstallments = document.querySelector("#credit-installments");
const creditInstallmentValue = document.querySelector("#credit-installment-value");
const creditFirstMonth = document.querySelector("#credit-first-month");
const creditError = document.querySelector("#credit-error");
const creditSuccess = document.querySelector("#credit-success");
const saveCredit = document.querySelector("#save-credit");

let reviewMovements = [];
let summaryRequest = null;

function optionList(values, selected, placeholder) {
  const fragment = document.createDocumentFragment();
  if (placeholder) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    option.selected = !selected;
    fragment.append(option);
  }
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    fragment.append(option);
  });
  return fragment;
}

function createField(labelText, name, movement, index, options) {
  const label = document.createElement("label");
  label.className = `movement-field${options?.wide ? " wide" : ""}`;
  const text = document.createElement("span");
  text.textContent = labelText;
  const id = `movement-${index}-${name}`;
  let input;
  if (options?.values) {
    input = document.createElement("select");
    input.append(optionList(options.values, movement[name], options.placeholder || "Seleccionar"));
  } else {
    input = document.createElement("input");
    input.type = options?.type || "text";
    input.value = Number.isNaN(movement[name]) ? "" : String(movement[name] ?? "");
    if (options?.inputMode) input.inputMode = options.inputMode;
    if (options?.step) input.step = options.step;
  }
  input.id = id;
  input.dataset.field = name;
  input.dataset.index = String(index);
  label.htmlFor = id;
  label.append(text, input);
  return label;
}

function createMovementCard(movement, index) {
  const card = document.createElement("article");
  card.className = "movement-card";
  card.dataset.index = String(index);

  const header = document.createElement("div");
  header.className = "movement-card-header";
  const number = document.createElement("span");
  number.className = "movement-number";
  number.textContent = `Movimiento ${index + 1}`;
  const remove = document.createElement("button");
  remove.className = "remove-movement";
  remove.type = "button";
  remove.dataset.remove = String(index);
  remove.setAttribute("aria-label", `Quitar movimiento ${index + 1}`);
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>';
  header.append(number, remove);

  const grid = document.createElement("div");
  grid.className = "movement-grid";
  grid.append(
    createField("Fecha", "date", movement, index, {type:"date"}),
    createField("Importe", "amount", movement, index, {type:"number",inputMode:"decimal",step:"0.01"}),
    createField("Tipo", "type", movement, index, {values:PERSONAL_TYPES}),
    createField("Moneda", "currency", movement, index, {values:PERSONAL_CURRENCIES}),
    createField("Categoría", "category", movement, index, {values:PERSONAL_CATEGORIES,wide:true}),
    createField("Cuenta", "account", movement, index, {values:PERSONAL_ACCOUNTS,wide:true}),
    createField("Descripción", "description", movement, index, {wide:true})
  );
  if (movement.category === "Compras a crédito" || movement.account === "OCA Crédito") {
    grid.append(
      createField("Cuotas", "installments", movement, index, {type:"number",inputMode:"numeric",step:"1"}),
      createField("Primera cuota", "firstInstallment", movement, index, {type:"date"})
    );
  }

  if (movement.duplicate) {
    const duplicate = document.createElement("label");
    duplicate.className = "duplicate-choice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.field = "allowDuplicate";
    checkbox.dataset.index = String(index);
    checkbox.checked = Boolean(movement.allowDuplicate);
    duplicate.append(checkbox, document.createTextNode("Es una compra diferente: guardarla igualmente"));
    grid.append(duplicate);
  }

  card.append(header, grid);
  return card;
}

function renderReview() {
  reviewCount.textContent = String(reviewMovements.length);
  reviewList.replaceChildren(...reviewMovements.map(createMovementCard));
  reviewSection.hidden = reviewMovements.length === 0;
  saveButton.querySelector("span").textContent = reviewMovements.length === 1
    ? "Guardar 1 movimiento"
    : `Guardar ${reviewMovements.length} movimientos`;
}

function updateMovementFromInput(input) {
  const index = Number(input.dataset.index);
  const field = input.dataset.field;
  if (!Number.isInteger(index) || !reviewMovements[index] || !field) return;
  reviewMovements[index][field] = ["amount", "installments"].includes(field) ? Number(input.value) : field === "allowDuplicate" ? input.checked : input.value;
  input.classList.remove("invalid");
}

reviewList.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) updateMovementFromInput(event.target);
});
reviewList.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) updateMovementFromInput(event.target);
});
reviewList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  reviewMovements.splice(Number(button.dataset.remove), 1);
  renderReview();
});

analyzeButton.addEventListener("click", () => {
  parseError.hidden = true;
  saveError.hidden = true;
  saveSuccess.hidden = true;
  try {
    reviewMovements = parsePersonalImport(importText.value);
    renderReview();
    reviewSection.scrollIntoView({behavior:"smooth",block:"start"});
  } catch (error) {
    parseError.textContent = error instanceof Error ? error.message : "No se pudo interpretar el bloque.";
    parseError.hidden = false;
  }
});

function validateReview() {
  const validated = [];
  let firstInvalid = null;
  reviewMovements.forEach((movement, index) => {
    const card = reviewList.querySelector(`[data-index="${index}"]`);
    card?.classList.remove("has-errors");
    card?.querySelectorAll(".invalid").forEach((field) => field.classList.remove("invalid"));
    try {
      validated.push(validatePersonalMovement(movement));
    } catch {
      card?.classList.add("has-errors");
      card?.querySelectorAll("input,select").forEach((field) => {
        if (!field.value || (field.dataset.field === "amount" && Number(field.value) <= 0)) field.classList.add("invalid");
      });
      if (!firstInvalid) firstInvalid = card;
    }
  });
  if (firstInvalid) {
    firstInvalid.scrollIntoView({behavior:"smooth",block:"center"});
    throw new Error("Revisá los campos marcados antes de guardar.");
  }
  return validated;
}

async function readApiResult(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("La aplicación recibió una respuesta inesperada.");
  }
}

saveButton.addEventListener("click", async () => {
  saveError.hidden = true;
  saveSuccess.hidden = true;
  try {
    const movements = validateReview();
    saveButton.disabled = true;
    saveButton.querySelector("span").textContent = "Guardando…";
    const response = await fetch("/api/personal", {
      method:"POST",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({movements})
    });
    const result = await readApiResult(response);
    if (!response.ok || !result.ok) throw new Error(result.error || "No se pudieron guardar los movimientos.");

    const duplicateIndexes = new Set((result.duplicates || []).map((item) => Number(item.index)));
    reviewMovements = reviewMovements
      .filter((_, index) => duplicateIndexes.has(index))
      .map((movement) => ({...movement,duplicate:true,allowDuplicate:false}));
    renderReview();

    const inserted = Number(result.inserted) || 0;
    saveSuccess.textContent = inserted === 1 ? "Se guardó 1 movimiento." : `Se guardaron ${inserted} movimientos.`;
    if (reviewMovements.length) saveSuccess.textContent += ` Quedaron ${reviewMovements.length} posibles duplicados para confirmar.`;
    saveSuccess.hidden = false;
    if (!reviewMovements.length) importText.value = "";
  } catch (error) {
    saveError.textContent = error instanceof Error ? error.message : "No se pudieron guardar los movimientos.";
    saveError.hidden = false;
  } finally {
    saveButton.disabled = false;
    if (reviewMovements.length) {
      saveButton.querySelector("span").textContent = reviewMovements.length === 1 ? "Guardar 1 movimiento" : `Guardar ${reviewMovements.length} movimientos`;
    }
  }
});

const CURRENCY_INFO = Object.freeze({
  Pesos:{code:"UYU",label:"Pesos uruguayos"},
  Dolares:{code:"USD",label:"Dólares"},
  Euros:{code:"EUR",label:"Euros"}
});

function formatMoney(value, currency) {
  return new Intl.NumberFormat("es-UY", {
    style:"currency",
    currency:CURRENCY_INFO[currency]?.code || "UYU",
    minimumFractionDigits:0,
    maximumFractionDigits:2
  }).format(Number(value) || 0);
}

function todayInMontevideo() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"America/Montevideo", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function firstInstallmentDate(dateText) {
  const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 1)).toISOString().slice(0, 10);
}

function formatMonth(dateText) {
  const date = new Date(`${dateText}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  const label = new Intl.DateTimeFormat("es-UY", {timeZone:"UTC",month:"long",year:"numeric"}).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function createCurrencyCard(currency, values) {
  const card = document.createElement("article");
  card.className = "currency-card";
  card.innerHTML = `
    <div class="currency-card-header">
      <h3>${CURRENCY_INFO[currency].label}</h3>
      <span class="currency-code">${CURRENCY_INFO[currency].code}</span>
    </div>
    <strong class="currency-net">${formatMoney(values.net, currency)}</strong>
    <span class="currency-net-label">Disponible menos deudas</span>
    <div class="currency-breakdown">
      <div class="currency-metric"><span>En cuentas</span><strong>${formatMoney(values.available, currency)}</strong></div>
      <div class="currency-metric debt"><span>Deuda con mamá</span><strong>${formatMoney(values.debt, currency)}</strong></div>
    </div>`;
  return card;
}

function renderPersonalAccounts(accounts) {
  if (!accounts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Todavía no hay saldos por cuenta.";
    personalAccountList.replaceChildren(empty);
    return;
  }
  personalAccountList.replaceChildren(...accounts.map((item) => {
    const row = document.createElement("div");
    row.className = "personal-account-row";
    const copy = document.createElement("div");
    const name = document.createElement("div");
    name.className = "personal-account-name";
    name.textContent = item.account;
    const meta = document.createElement("div");
    meta.className = "personal-account-meta";
    meta.textContent = CURRENCY_INFO[item.currency]?.label || item.currency;
    copy.append(name, meta);
    const amount = document.createElement("strong");
    amount.className = "personal-account-amount";
    amount.textContent = formatMoney(item.amount, item.currency);
    if (Number(item.amount) < 0) amount.classList.add("negative");
    row.append(copy, amount);
    return row;
  }));
}

function renderRecent(items) {
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Los movimientos importados aparecerán acá.";
    recentList.replaceChildren(empty);
    return;
  }
  recentList.replaceChildren(...items.map((item) => {
    const row = document.createElement("div");
    row.className = `recent-row ${item.type === "Ingreso" ? "income" : "expense"}`;
    const copy = document.createElement("div");
    const name = document.createElement("div");
    name.className = "recent-title";
    name.textContent = item.description || item.category;
    const meta = document.createElement("div");
    meta.className = "recent-meta";
    const installmentText = item.installments ? ` · ${item.installments} cuotas` : "";
    meta.textContent = `${item.date.split("-").reverse().join("/")} · ${item.account} · ${item.category}${installmentText}`;
    copy.append(name, meta);
    const amount = document.createElement("strong");
    amount.className = "recent-amount";
    amount.textContent = `${item.type === "Ingreso" ? "+" : "−"}${formatMoney(item.amount, item.currency)}`;
    row.append(copy, amount);
    return row;
  }));
}

function renderPersonalOca(oca = {}) {
  personalOcaOutstanding.textContent = formatMoney(oca.outstanding, oca.currency || "Pesos");
  const months = Array.isArray(oca.months) ? oca.months : [];
  personalOcaMonths.replaceChildren(...months.map((item) => {
    const row = document.createElement("div");
    row.className = "personal-oca-row";
    const month = document.createElement("span");
    month.textContent = formatMonth(item.month);
    const amount = document.createElement("strong");
    amount.textContent = formatMoney(item.amount, oca.currency || "Pesos");
    row.append(month, amount);
    return row;
  }));
}

function formatUpdatedAt(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "Actualizado recién";
  return "Actualizado " + new Intl.DateTimeFormat("es-UY", {
    timeZone:"America/Montevideo",
    hour:"2-digit",
    minute:"2-digit"
  }).format(date);
}

async function loadPersonalSummary() {
  if (summaryRequest) return summaryRequest;
  personalError.hidden = true;
  personalLoading.hidden = false;
  currencySummary.hidden = true;
  personalOcaCard.hidden = true;
  personalAccountsCard.hidden = true;
  recentCard.hidden = true;
  refreshPersonal.disabled = true;
  summaryPanel.setAttribute("aria-busy", "true");
  summaryRequest = (async () => {
    try {
      const response = await fetch("/api/personal", {headers:{"Accept":"application/json"}});
      const result = await readApiResult(response);
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo cargar tu estado.");
      const currencies = result.currencies || {};
      currencySummary.replaceChildren(...PERSONAL_CURRENCIES.map((currency) => createCurrencyCard(currency, currencies[currency] || {available:0,debt:0,net:0})));
      renderPersonalAccounts(Array.isArray(result.accounts) ? result.accounts : []);
      renderPersonalOca(result.oca || {});
      renderRecent(Array.isArray(result.recent) ? result.recent : []);
      currencySummary.hidden = false;
      personalOcaCard.hidden = false;
      personalAccountsCard.hidden = false;
      recentCard.hidden = false;
      personalUpdated.textContent = formatUpdatedAt(result.updatedAt);
    } catch (error) {
      personalError.textContent = error instanceof Error ? error.message : "No se pudo cargar tu estado.";
      personalError.hidden = false;
    } finally {
      personalLoading.hidden = true;
      refreshPersonal.disabled = false;
      summaryPanel.removeAttribute("aria-busy");
      summaryRequest = null;
    }
  })();
  return summaryRequest;
}

function updateCreditPreview() {
  const total = Number(creditTotal.value);
  const installments = Number(creditInstallments.value);
  creditInstallmentValue.textContent = formatMoney(total > 0 && installments > 0 ? total / installments : 0, "Pesos");
  creditFirstMonth.textContent = formatMonth(firstInstallmentDate(creditDate.value));
}

creditDate.value = todayInMontevideo();
creditDate.addEventListener("input", updateCreditPreview);
creditTotal.addEventListener("input", updateCreditPreview);
creditInstallments.addEventListener("input", updateCreditPreview);
updateCreditPreview();

creditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  creditError.hidden = true;
  creditSuccess.hidden = true;
  try {
    const movement = validatePersonalMovement({
      date:creditDate.value,
      type:"Egreso",
      currency:"Pesos",
      amount:creditTotal.value,
      category:"Compras a crédito",
      account:"OCA Crédito",
      description:creditDescription.value,
      installments:creditInstallments.value,
      firstInstallment:firstInstallmentDate(creditDate.value)
    });
    if (!movement.description) throw new Error("Indicá qué compraste.");
    saveCredit.disabled = true;
    saveCredit.querySelector("span").textContent = "Guardando…";
    const response = await fetch("/api/personal", {
      method:"POST",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({movements:[movement]})
    });
    const result = await readApiResult(response);
    if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo guardar la compra.");
    if (result.duplicates?.length) throw new Error("Esta compra parece ya registrada. Revisá MOVIMIENTOS antes de repetirla.");
    creditSuccess.textContent = `Compra guardada en ${movement.installments} cuotas de ${formatMoney(movement.installmentAmount, "Pesos")}.`;
    creditSuccess.hidden = false;
    creditDescription.value = "";
    creditTotal.value = "";
    creditInstallments.value = "";
    creditDate.value = todayInMontevideo();
    updateCreditPreview();
    summaryRequest = null;
  } catch (error) {
    creditError.textContent = error instanceof Error ? error.message : "No se pudo guardar la compra.";
    creditError.hidden = false;
  } finally {
    saveCredit.disabled = false;
    saveCredit.querySelector("span").textContent = "Guardar compra en cuotas";
  }
});

function activateView(view) {
  const views = {import:importPanel,summary:summaryPanel,credit:creditPanel};
  Object.entries(views).forEach(([name, panel]) => { panel.hidden = name !== view; });
  title.textContent = view === "summary" ? "Mi estado financiero" : view === "credit" ? "Compra en cuotas" : "Importar gastos";
  subtitle.textContent = view === "summary"
    ? "Disponible, deudas y próximos pagos en un vistazo."
    : view === "credit"
      ? "La cuota se calcula sola y empieza el mes siguiente."
      : "Capturas a movimientos, sin registrar uno por uno.";
  tabs.forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  if (view === "summary") loadPersonalSummary();
}

tabs.forEach((tab) => tab.addEventListener("click", () => activateView(tab.dataset.view)));
refreshPersonal.addEventListener("click", loadPersonalSummary);
