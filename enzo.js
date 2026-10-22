import { validateOcaEntry } from "./lib/personal.js?v=4";

const tabs = Array.from(document.querySelectorAll(".personal-tabs .app-tab"));
const summaryPanel = document.querySelector("#personal-summary-panel");
const creditPanel = document.querySelector("#credit-panel");
const refreshPersonal = document.querySelector("#refresh-personal");
const personalLoading = document.querySelector("#personal-loading");
const personalTotalCard = document.querySelector("#personal-total-card");
const personalTotal = document.querySelector("#personal-total");
const personalTotalNote = document.querySelector("#personal-total-note");
const summarySource = document.querySelector("#summary-source");
const currencySummary = document.querySelector("#currency-summary");
const accountsCard = document.querySelector("#accounts-card");
const accountsList = document.querySelector("#accounts-list");
const personalError = document.querySelector("#personal-error");
const personalUpdated = document.querySelector("#personal-updated");
const personalOcaCard = document.querySelector("#personal-oca-card");
const personalOcaNext = document.querySelector("#personal-oca-next");
const personalOcaNote = document.querySelector("#personal-oca-note");
const personalOcaMonths = document.querySelector("#personal-oca-months");
const financeCard = document.querySelector("#finance-card");
const financeMonths = document.querySelector("#finance-months");
const creditForm = document.querySelector("#credit-form");
const creditModes = Array.from(document.querySelectorAll('input[name="credit-mode"]'));
const creditDescription = document.querySelector("#credit-description");
const creditDescriptionLabel = document.querySelector("#credit-description-label");
const creditTotal = document.querySelector("#credit-total");
const creditTotalLabel = document.querySelector("#credit-total-label");
const creditInstallmentsField = document.querySelector("#credit-installments-field");
const creditInstallments = document.querySelector("#credit-installments");
const creditValueLabel = document.querySelector("#credit-value-label");
const creditInstallmentValue = document.querySelector("#credit-installment-value");
const creditFirstMonth = document.querySelector("#credit-first-month");
const creditNote = document.querySelector("#credit-note");
const creditDate = document.querySelector("#credit-date");
const creditError = document.querySelector("#credit-error");
const creditSuccess = document.querySelector("#credit-success");
const saveCredit = document.querySelector("#save-credit");

const currencyCodes = {Pesos:"UYU",Dolares:"USD",Euros:"EUR"};
let summaryRequest = null;

function formatMoney(value, currency = "Pesos") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("es-UY", {
    style:"currency",
    currency:currencyCodes[currency] || currency,
    maximumFractionDigits:currency === "Pesos" ? 0 : 2
  }).format(amount);
}

function formatMonth(value) {
  const match = String(value || "").match(/^(20\d{2})-(\d{2})/);
  if (!match) return "—";
  return new Intl.DateTimeFormat("es-UY", {month:"long",year:"numeric",timeZone:"UTC"})
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)))
    .replace(/^./, (letter) => letter.toUpperCase());
}

function currentDateText() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"America/Montevideo",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date()).reduce((result, part) => ({...result,[part.type]:part.value}), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function firstClosingLabel(dateText) {
  const match = String(dateText || "").match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return "—";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return new Intl.DateTimeFormat("es-UY", {month:"long",year:"numeric",timeZone:"UTC"})
    .format(date)
    .replace(/^./, (letter) => letter.toUpperCase());
}

async function readApiResult(response) {
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { throw new Error("La aplicación devolvió una respuesta inesperada."); }
  if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo completar la operación.");
  return result;
}

function createCurrencyCard(currency, data = {}) {
  const card = document.createElement("article");
  card.className = `currency-card currency-${currency.toLowerCase()}`;
  const header = document.createElement("div");
  header.className = "currency-card-header";
  const title = document.createElement("h3");
  title.textContent = currency;
  const code = document.createElement("span");
  code.className = "currency-code";
  code.textContent = currencyCodes[currency];
  const balance = document.createElement("strong");
  balance.className = "currency-balance";
  balance.textContent = formatMoney(data.available, currency);
  const label = document.createElement("span");
  label.className = "currency-balance-label";
  label.textContent = "Disponible";
  header.append(title, code);
  card.append(header, balance, label);
  return card;
}

function createAmountRow(label, amount, currency, extraClass = "") {
  const row = document.createElement("div");
  row.className = `amount-row ${extraClass}`.trim();
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("strong");
  value.textContent = formatMoney(amount, currency);
  row.append(name, value);
  return row;
}

function renderAccounts(accounts = []) {
  const visible = accounts.filter((item) => Math.abs(Number(item.amount) || 0) >= 0.005);
  accountsList.replaceChildren(...visible.map((item) => createAmountRow(item.account, item.amount, item.currency)));
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Todavía no hay saldos para mostrar.";
    accountsList.append(empty);
  }
}

function renderForecast(container, months = [], currency) {
  const rows = months.map((item) => createAmountRow(formatMonth(item.month), item.amount, currency, Number(item.amount) < 0 ? "negative" : ""));
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No hay una proyección disponible.";
    rows.push(empty);
  }
  container.replaceChildren(...rows);
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `Actualizado ${new Intl.DateTimeFormat("es-UY", {dateStyle:"short",timeStyle:"short"}).format(date)}`;
}

async function loadPersonalSummary() {
  if (summaryRequest) return summaryRequest;
  personalError.hidden = true;
  personalLoading.hidden = false;
  summaryPanel.setAttribute("aria-busy", "true");
  summaryRequest = (async () => {
    try {
      const result = await readApiResult(await fetch("/api/personal", {headers:{Accept:"application/json"}}));
      const currencies = result.currencies || {};
      personalTotal.textContent = result.totalAvailablePesos === null ? "—" : formatMoney(result.totalAvailablePesos, "Pesos");
      personalTotalNote.textContent = "Pesos, dólares y euros de tus cajas convertidos a pesos uruguayos.";
      summarySource.textContent = result.sourceSheet ? `Caja ${result.sourceSheet} y proyecciones de Finanzas.` : "Leyendo tus cajas y Finanzas.";
      currencySummary.replaceChildren(...["Pesos", "Dolares", "Euros"].map((currency) => createCurrencyCard(currency, currencies[currency])));
      renderAccounts(result.accounts || []);
      const oca = result.oca || {};
      personalOcaNext.textContent = formatMoney(oca.nextPayment, oca.currency || "Pesos");
      personalOcaNote.textContent = `${Number(oca.activeItems) || 0} cargos activos · saldo finito pendiente ${formatMoney(oca.outstanding, oca.currency || "Pesos")}.`;
      renderForecast(personalOcaMonths, oca.months || [], oca.currency || "Pesos");
      const finance = result.finance || {};
      renderForecast(financeMonths, finance.months || [], finance.currency || "Dolares");
      personalTotalCard.hidden = false;
      currencySummary.hidden = false;
      accountsCard.hidden = false;
      personalOcaCard.hidden = false;
      financeCard.hidden = false;
      personalUpdated.textContent = formatUpdatedAt(result.updatedAt);
    } catch (error) {
      personalError.textContent = error instanceof Error ? error.message : "No se pudo cargar tu estado.";
      personalError.hidden = false;
    } finally {
      personalLoading.hidden = true;
      summaryPanel.removeAttribute("aria-busy");
      summaryRequest = null;
    }
  })();
  return summaryRequest;
}

function selectedCreditMode() {
  return creditModes.find((input) => input.checked)?.value || "installments";
}

function updateCreditMode() {
  const subscription = selectedCreditMode() === "subscription";
  creditInstallmentsField.hidden = subscription;
  creditInstallments.required = !subscription;
  creditDescriptionLabel.textContent = subscription ? "Nombre de la suscripción" : "¿Qué compraste?";
  creditDescription.placeholder = subscription ? "Ej. Apple Cloud" : "Ej. Notebook";
  creditTotalLabel.textContent = subscription ? "Importe mensual" : "Valor total";
  creditValueLabel.textContent = subscription ? "Cargo mensual" : "Valor de cada cuota";
  creditNote.textContent = subscription
    ? "Se repetirá en todos los meses futuros de la proyección OCA."
    : "La primera cuota se proyecta para el próximo mes.";
  updateCreditPreview();
}

function updateCreditPreview() {
  const amount = Number(creditTotal.value);
  const installments = Number(creditInstallments.value);
  const subscription = selectedCreditMode() === "subscription";
  const installmentAmount = subscription ? amount : amount / installments;
  creditInstallmentValue.textContent = Number.isFinite(installmentAmount) && installmentAmount > 0
    ? formatMoney(installmentAmount, "Pesos")
    : formatMoney(0, "Pesos");
  creditFirstMonth.textContent = firstClosingLabel(creditDate.value);
}

creditModes.forEach((input) => input.addEventListener("change", updateCreditMode));
[creditDate, creditTotal, creditInstallments].forEach((input) => input.addEventListener("input", updateCreditPreview));

creditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  creditError.hidden = true;
  creditSuccess.hidden = true;
  try {
    const entry = validateOcaEntry({
      mode:selectedCreditMode(),
      date:creditDate.value,
      description:creditDescription.value,
      amount:Number(creditTotal.value),
      installments:Number(creditInstallments.value)
    });
    saveCredit.disabled = true;
    saveCredit.querySelector("span").textContent = "Guardando…";
    const result = await readApiResult(await fetch("/api/personal", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({entry})
    }));
    creditSuccess.textContent = `Guardado en OCA, fila ${result.row}.`;
    creditSuccess.hidden = false;
    creditForm.reset();
    creditDate.value = currentDateText();
    updateCreditMode();
    summaryRequest = null;
  } catch (error) {
    creditError.textContent = error instanceof Error ? error.message : "No se pudo guardar en OCA.";
    creditError.hidden = false;
  } finally {
    saveCredit.disabled = false;
    saveCredit.querySelector("span").textContent = "Guardar en OCA";
  }
});

function setView(view) {
  const summary = view === "summary";
  summaryPanel.hidden = !summary;
  creditPanel.hidden = summary;
  tabs.forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  if (summary) loadPersonalSummary();
}

tabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
refreshPersonal.addEventListener("click", () => {
  summaryRequest = null;
  loadPersonalSummary();
});

creditDate.value = currentDateText();
updateCreditMode();
loadPersonalSummary();
