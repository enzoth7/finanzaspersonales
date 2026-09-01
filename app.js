import { CATEGORIES_BY_TYPE } from "./lib/categories.js?v=5";

const form = document.querySelector("#expense-form");
const amount = document.querySelector("#amount");
const dateInput = document.querySelector("#date");
const categoryInput = document.querySelector("#category");
const submitButton = document.querySelector("#submit-button");
const errorMessage = document.querySelector("#form-error");
const successMessage = document.querySelector("#form-success");
const pageTitle = document.querySelector("#page-title");
const tabs = Array.from(document.querySelectorAll(".app-tab"));
const registerPanel = document.querySelector("#register-panel");
const balancePanel = document.querySelector("#balance-panel");
const ocaPanel = document.querySelector("#oca-panel");
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
let balanceRequest = null;
let ocaRequest = null;

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

function showView(view, updateHash = true) {
  const showBalance = view === "balance";
  const showOca = view === "oca";
  registerPanel.hidden = showBalance || showOca;
  balancePanel.hidden = !showBalance;
  ocaPanel.hidden = !showOca;
  registerFootnote.hidden = showBalance || showOca;
  pageTitle.textContent = showBalance ? "Dinero disponible" : showOca ? "Estado de OCA" : "Registrar movimiento";
  tabs.forEach((tab) => {
    const selected = tab.dataset.view === view;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  if (updateHash) history.replaceState(null, "", showBalance ? "#disponible" : showOca ? "#oca" : "#registrar");
  if (showBalance) loadBalances();
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
refreshOca.addEventListener("click", loadOca);
showView(location.hash === "#disponible" ? "balance" : location.hash === "#oca" ? "oca" : "register", false);

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
  data.account = "Efectivo";

  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Guardando…";

  try {
    const response = await fetch("/api/gastos", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo guardar.");

    successMessage.textContent = result.dryRun
      ? "Formulario validado. Falta conectar Google Apps Script para escribir en la planilla."
      : "Movimiento guardado correctamente en la planilla.";
    successMessage.hidden = false;
    balanceUpdated.textContent = "";

    const selectedType = form.elements.type.value;
    const selectedCategory = form.elements.category.value;
    form.reset();
    form.elements.type.value = selectedType;
    setCategories(selectedType, selectedCategory);
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
