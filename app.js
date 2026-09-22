import { CATEGORIES_BY_TYPE } from "./lib/categories.js?v=5";

const form = document.querySelector("#expense-form");
const amount = document.querySelector("#amount");
const dateInput = document.querySelector("#date");
const categoryInput = document.querySelector("#category");
const accountInput = document.querySelector("#account");
const submitButton = document.querySelector("#submit-button");
const errorMessage = document.querySelector("#form-error");
const successMessage = document.querySelector("#form-success");
const pageTitle = document.querySelector("#page-title");
const tabs = Array.from(document.querySelectorAll(".app-tab"));
const registerPanel = document.querySelector("#register-panel");
const balancePanel = document.querySelector("#balance-panel");
const ocaPanel = document.querySelector("#oca-panel");
const categoriesPanel = document.querySelector("#categories-panel");
const balanceTotal = document.querySelector("#balance-total");
const accountList = document.querySelector("#account-list");
const balanceLoading = document.querySelector("#balance-loading");
const balanceError = document.querySelector("#balance-error");
const balanceUpdated = document.querySelector("#balance-updated");
const refreshBalances = document.querySelector("#refresh-balances");
const registerFootnote = document.querySelector("#register-footnote");
const ocaBalance = document.querySelector("#oca-balance");
const ocaCurrentTitle = document.querySelector("#oca-current-title");
const ocaCurrentTotal = document.querySelector("#oca-current-total");
const ocaPurchaseList = document.querySelector("#oca-purchase-list");
const ocaForecastCard = document.querySelector("#oca-forecast-card");
const ocaForecast = document.querySelector("#oca-forecast");
const ocaLoading = document.querySelector("#oca-loading");
const ocaEmpty = document.querySelector("#oca-empty");
const ocaError = document.querySelector("#oca-error");
const ocaUpdated = document.querySelector("#oca-updated");
const refreshOca = document.querySelector("#refresh-oca");
const categoryTotal = document.querySelector("#category-total");
const categoryPeriodLabel = document.querySelector("#category-period-label");
const categoryMovementCount = document.querySelector("#category-movement-count");
const categoryPeriod = document.querySelector("#category-period");
const categoryList = document.querySelector("#category-list");
const categoriesLoading = document.querySelector("#categories-loading");
const categoriesEmpty = document.querySelector("#categories-empty");
const categoriesError = document.querySelector("#categories-error");
const categoriesUpdated = document.querySelector("#categories-updated");
const refreshCategories = document.querySelector("#refresh-categories");
let balanceRequest = null;
let ocaRequest = null;
let categoryRequest = null;
const PENDING_EXPENSE_KEY = "finanzas-pending-expense-v1";
const PENDING_EXPENSE_TTL = 24 * 60 * 60 * 1000;
let volatilePendingExpense = null;

const ACCOUNT_LOGOS = Object.freeze({
  efectivo:"/public/efectivo.webp",
  midinero:"/public/mi-dinero.png",
  prex:"/public/prex.png",
  ocablue:"/public/oca-blue.png",
  mercadopago:"/public/mercado-pago.png"
});

function montevideoDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone:"America/Montevideo",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

let automaticDate = "";

function setDefaultDate(force = false) {
  const today = montevideoDate();
  if (force || !dateInput.value || dateInput.value === automaticDate) {
    dateInput.value = today;
  }
  automaticDate = today;
}

setDefaultDate(true);
window.addEventListener("pageshow", () => setDefaultDate());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") setDefaultDate();
});

const moneyFormatter = new Intl.NumberFormat("es-UY", {
  style:"currency",
  currency:"UYU",
  minimumFractionDigits:0,
  maximumFractionDigits:2
});

function formatMoney(value) {
  return moneyFormatter.format(Number(value) || 0);
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

async function readApiResult(response, feature) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    if (response.status === 404) {
      throw new Error("La función de " + feature + " todavía no está publicada. Actualizá Vercel y volvé a intentar.");
    }
    throw new Error("No se pudo leer " + feature + ". Actualizá la aplicación y volvé a intentar.");
  }
}

function createSubmissionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
}

function expenseSignature(data) {
  return JSON.stringify({
    date:data.date,
    type:data.type,
    amount:String(data.amount),
    category:data.category,
    account:data.account || "Efectivo",
    description:data.description || ""
  });
}

function getSubmissionId(data) {
  const signature = expenseSignature(data);
  if (volatilePendingExpense?.signature === signature && Date.now() - volatilePendingExpense.createdAt < PENDING_EXPENSE_TTL) {
    return volatilePendingExpense.id;
  }
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_EXPENSE_KEY) || "null");
    if (pending?.signature === signature && Date.now() - Number(pending.createdAt) < PENDING_EXPENSE_TTL) {
      volatilePendingExpense = pending;
      return pending.id;
    }
  } catch {
    // Si el almacenamiento del navegador no está disponible, el envío sigue funcionando.
  }

  const pending = {id:createSubmissionId(),signature,createdAt:Date.now()};
  volatilePendingExpense = pending;
  try {
    localStorage.setItem(PENDING_EXPENSE_KEY, JSON.stringify(pending));
  } catch {
    // El identificador todavía protege los reintentos mientras esta página permanezca abierta.
  }
  return pending.id;
}

function clearPendingExpense(submissionId) {
  if (volatilePendingExpense?.id === submissionId) volatilePendingExpense = null;
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_EXPENSE_KEY) || "null");
    if (pending?.id === submissionId) localStorage.removeItem(PENDING_EXPENSE_KEY);
  } catch {}
}

function accountKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function createAccountLogo(account) {
  const key = accountKey(account);
  const frame = document.createElement("span");
  frame.className = "account-logo " + (ACCOUNT_LOGOS[key] ? "has-logo" : "fallback-logo");
  if (ACCOUNT_LOGOS[key]) frame.classList.add("account-logo-" + key);

  if (ACCOUNT_LOGOS[key]) {
    const image = document.createElement("img");
    image.src = ACCOUNT_LOGOS[key];
    image.alt = "";
    image.width = 48;
    image.height = 48;
    image.loading = "lazy";
    image.decoding = "async";
    image.className = "account-logo-image logo-" + key;
    frame.append(image);
  } else {
    frame.textContent = String(account || "Cuenta").trim().slice(0, 2).toUpperCase();
    frame.setAttribute("aria-hidden", "true");
  }

  return frame;
}

function renderAccounts(accounts) {
  accountList.replaceChildren(...accounts.map((item) => {
    const row = document.createElement("div");
    row.className = "account-row";

    const identity = document.createElement("div");
    identity.className = "account-identity";

    const name = document.createElement("span");
    name.className = "account-name";
    name.textContent = item.account;
    identity.append(createAccountLogo(item.account), name);

    const value = document.createElement("strong");
    value.className = "account-amount";
    value.textContent = formatMoney(item.amount);
    if (Number(item.amount) < 0) value.classList.add("negative");

    row.append(identity, value);
    return row;
  }));
}

async function loadBalances() {
  if (balanceRequest) return balanceRequest;
  balanceError.hidden = true;
  balanceLoading.hidden = false;
  accountList.hidden = true;
  refreshBalances.disabled = true;
  balancePanel.setAttribute("aria-busy", "true");

  balanceRequest = (async () => {
    try {
      const response = await fetch("/api/saldos", {headers:{"Accept":"application/json"}});
      const result = await readApiResult(response, "los saldos");
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudieron cargar los saldos.");

      balanceTotal.textContent = formatMoney(result.total);
      balanceTotal.classList.toggle("negative", Number(result.total) < 0);
      renderAccounts(Array.isArray(result.accounts) ? result.accounts : []);
      accountList.hidden = false;
      balanceUpdated.textContent = formatUpdatedAt(result.updatedAt);
    } catch (error) {
      balanceError.textContent = error instanceof Error ? error.message : "No se pudieron cargar los saldos.";
      balanceError.hidden = false;
      balanceUpdated.textContent = "";
    } finally {
      balanceLoading.hidden = true;
      refreshBalances.disabled = false;
      balancePanel.removeAttribute("aria-busy");
      balanceRequest = null;
    }
  })();
  return balanceRequest;
}

function renderOcaPurchases(purchases) {
  ocaPurchaseList.replaceChildren(...purchases.map((purchase) => {
    const row = document.createElement("tr");
    row.className = "oca-purchase-row";

    const name = document.createElement("td");
    name.className = "oca-purchase-name";
    name.textContent = purchase.name;

    const installment = document.createElement("td");
    installment.className = "oca-purchase-installment";
    installment.textContent = "Cuota " + purchase.currentInstallment + " de " + purchase.totalInstallments;

    const amount = document.createElement("td");
    amount.className = "oca-purchase-amount";
    amount.textContent = formatMoney(purchase.installmentAmount);
    row.append(name, installment, amount);
    return row;
  }));
}

function renderOcaForecast(forecast) {
  ocaForecast.replaceChildren(...forecast.map((month) => {
    const item = document.createElement("tr");
    item.className = "oca-forecast-item";
    const label = document.createElement("td");
    label.textContent = month.label;
    const amount = document.createElement("td");
    amount.className = "numeric-column";
    amount.textContent = formatMoney(month.amount);
    if (Number(month.amount) === 0) item.classList.add("is-zero");
    item.append(label, amount);
    return item;
  }));
}

async function loadOca() {
  if (ocaRequest) return ocaRequest;
  ocaError.hidden = true;
  ocaEmpty.hidden = true;
  ocaLoading.hidden = false;
  ocaPurchaseList.hidden = true;
  ocaForecastCard.hidden = true;
  refreshOca.disabled = true;
  ocaPanel.setAttribute("aria-busy", "true");

  ocaRequest = (async () => {
    try {
      const response = await fetch("/api/oca", {headers:{"Accept":"application/json"}});
      const result = await readApiResult(response, "OCA");
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo cargar OCA.");

      const purchases = Array.isArray(result.purchases) ? result.purchases : [];
      const forecast = Array.isArray(result.forecast) ? result.forecast : [];
      ocaBalance.textContent = formatMoney(result.nextMonthPayment);
      ocaCurrentTitle.textContent = "Detalle de cuotas";
      ocaCurrentTotal.textContent = result.currentPeriodLabel || "Mes actual";
      renderOcaPurchases(purchases);
      renderOcaForecast(forecast);
      ocaPurchaseList.hidden = purchases.length === 0;
      ocaEmpty.hidden = purchases.length !== 0;
      ocaForecastCard.hidden = forecast.length === 0;
      ocaUpdated.textContent = formatUpdatedAt(result.updatedAt);
    } catch (error) {
      ocaError.textContent = error instanceof Error ? error.message : "No se pudo cargar OCA.";
      ocaError.hidden = false;
      ocaUpdated.textContent = "";
    } finally {
      ocaLoading.hidden = true;
      refreshOca.disabled = false;
      ocaPanel.removeAttribute("aria-busy");
      ocaRequest = null;
    }
  })();
  return ocaRequest;
}

function movementCountText(value) {
  const count = Number(value) || 0;
  return count === 1 ? "1 movimiento" : count + " movimientos";
}

function renderCategoryPeriods(periods, selectedPeriod, selectedLabel) {
  const available = Array.isArray(periods) ? [...periods] : [];
  if (selectedPeriod && !available.some((item) => item.period === selectedPeriod)) {
    available.unshift({period:selectedPeriod,label:selectedLabel || selectedPeriod});
  }
  categoryPeriod.replaceChildren(...available.map((item) => {
    const option = document.createElement("option");
    option.value = item.period;
    option.textContent = item.label;
    return option;
  }));
  if (selectedPeriod) categoryPeriod.value = selectedPeriod;
  categoryPeriod.disabled = available.length < 2;
}

function renderCategories(categories) {
  const largestAmount = categories.reduce((maximum, item) => Math.max(maximum, Number(item.amount) || 0), 0);
  categoryList.replaceChildren(...categories.map((item) => {
    const row = document.createElement("div");
    row.className = "category-item";

    const heading = document.createElement("div");
    heading.className = "category-item-heading";
    const name = document.createElement("span");
    name.className = "category-name";
    name.textContent = item.category;
    const value = document.createElement("strong");
    value.className = "category-amount";
    value.textContent = formatMoney(item.amount);
    heading.append(name, value);

    const bar = document.createElement("div");
    bar.className = "category-bar";
    bar.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.className = "category-bar-fill";
    const percentage = Math.max(0, Math.min(100, Number(item.percentage) || 0));
    const comparisonWidth = largestAmount > 0 ? ((Number(item.amount) || 0) / largestAmount) * 100 : 0;
    fill.style.width = comparisonWidth + "%";
    bar.append(fill);

    const meta = document.createElement("div");
    meta.className = "category-item-meta";
    const count = document.createElement("span");
    count.textContent = movementCountText(item.movements);
    const share = document.createElement("span");
    share.className = "category-percentage";
    share.textContent = new Intl.NumberFormat("es-UY", {maximumFractionDigits:1}).format(percentage) + "%";
    meta.append(count, share);

    row.append(heading, bar, meta);
    return row;
  }));
}

async function loadCategories(requestedPeriod = categoryPeriod.value) {
  if (categoryRequest) return categoryRequest;
  categoriesError.hidden = true;
  categoriesEmpty.hidden = true;
  categoriesLoading.hidden = false;
  categoryList.hidden = true;
  refreshCategories.disabled = true;
  categoryPeriod.disabled = true;
  categoriesPanel.setAttribute("aria-busy", "true");

  categoryRequest = (async () => {
    try {
      const search = requestedPeriod ? "?period=" + encodeURIComponent(requestedPeriod) : "";
      const response = await fetch("/api/categorias" + search, {headers:{"Accept":"application/json"}});
      const result = await readApiResult(response, "los gastos por categoría");
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudieron cargar los gastos por categoría.");

      const categories = Array.isArray(result.categories) ? result.categories : [];
      categoryTotal.textContent = formatMoney(result.total);
      categoryPeriodLabel.textContent = result.periodLabel || "Mes seleccionado";
      categoryMovementCount.textContent = movementCountText(result.movements);
      renderCategoryPeriods(result.availablePeriods, result.period, result.periodLabel);
      renderCategories(categories);
      categoryList.hidden = categories.length === 0;
      categoriesEmpty.hidden = categories.length !== 0;
      categoriesUpdated.textContent = formatUpdatedAt(result.updatedAt);
    } catch (error) {
      categoriesError.textContent = error instanceof Error ? error.message : "No se pudieron cargar los gastos por categoría.";
      categoriesError.hidden = false;
      categoriesUpdated.textContent = "";
    } finally {
      categoriesLoading.hidden = true;
      refreshCategories.disabled = false;
      if (categoryPeriod.options.length > 1) categoryPeriod.disabled = false;
      categoriesPanel.removeAttribute("aria-busy");
      categoryRequest = null;
    }
  })();
  return categoryRequest;
}

function showView(view, updateHash = true) {
  const showBalance = view === "balance";
  const showOca = view === "oca";
  const showCategories = view === "categories";
  registerPanel.hidden = showBalance || showOca || showCategories;
  balancePanel.hidden = !showBalance;
  ocaPanel.hidden = !showOca;
  categoriesPanel.hidden = !showCategories;
  registerFootnote.hidden = showBalance || showOca || showCategories;
  pageTitle.textContent = showBalance
    ? "Dinero disponible"
    : showCategories
    ? "Gastos por categoría"
    : showOca
    ? "Estado de OCA"
    : "Registrar movimiento";
  tabs.forEach((tab) => {
    const selected = tab.dataset.view === view;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  if (updateHash) history.replaceState(null, "", showBalance ? "#disponible" : showCategories ? "#gastos" : showOca ? "#oca" : "#registrar");
  if (showBalance) loadBalances();
  if (showCategories) loadCategories();
  if (showOca) loadOca();
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    next.focus();
    showView(next.dataset.view);
  });
});

refreshBalances.addEventListener("click", loadBalances);
refreshCategories.addEventListener("click", () => loadCategories(categoryPeriod.value));
categoryPeriod.addEventListener("change", () => loadCategories(categoryPeriod.value));
refreshOca.addEventListener("click", loadOca);
showView(location.hash === "#disponible" ? "balance" : location.hash === "#gastos" ? "categories" : location.hash === "#oca" ? "oca" : "register", false);

function setCategories(type, preferredCategory = "") {
  const categories = CATEGORIES_BY_TYPE[type] || [];
  categoryInput.replaceChildren(...categories.map((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    return option;
  }));
  if (categories.includes(preferredCategory)) categoryInput.value = preferredCategory;
}

setCategories(form.elements.type.value);
form.querySelectorAll('input[name="type"]').forEach((input) => {
  input.addEventListener("change", () => setCategories(input.value));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  successMessage.hidden = true;

  if (!form.reportValidity()) return;

  const data = Object.fromEntries(new FormData(form).entries());
  const submissionId = getSubmissionId(data);

  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Guardando…";

  try {
    const response = await fetch("/api/gastos", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({...data,submissionId})
    });
    let result;
    try {
      result = await readApiResult(response, "la confirmación del movimiento");
    } catch {
      throw new Error("No pudimos confirmar el guardado. No vuelvas a cargar el movimiento: esperá unos segundos y presioná Guardar otra vez; el sistema evitará duplicarlo.");
    }
    if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo guardar.");

    successMessage.textContent = result.duplicate
      ? "Este movimiento ya estaba guardado. No se agregó otra copia."
      : result.dryRun
      ? "Formulario validado. Falta conectar Google Apps Script para escribir en la planilla."
      : "Movimiento guardado correctamente en la planilla.";
    successMessage.hidden = false;
    balanceUpdated.textContent = "";
    categoriesUpdated.textContent = "";
    clearPendingExpense(submissionId);

    const selectedType = form.elements.type.value;
    const selectedCategory = form.elements.category.value;
    const selectedAccount = form.elements.account.value;
    form.reset();
    form.elements.type.value = selectedType;
    setCategories(selectedType, selectedCategory);
    accountInput.value = selectedAccount;
    setDefaultDate(true);
    amount.focus();
  } catch (error) {
    errorMessage.textContent = error instanceof Error ? error.message : "No se pudo guardar el movimiento.";
    errorMessage.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Guardar en la planilla";
  }
});
