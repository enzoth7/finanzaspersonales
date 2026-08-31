import { CATEGORIES_BY_TYPE } from "./lib/categories.js?v=5";

const form = document.querySelector("#expense-form");
const amount = document.querySelector("#amount");
const dateInput = document.querySelector("#date");
const categoryInput = document.querySelector("#category");
const submitButton = document.querySelector("#submit-button");
const errorMessage = document.querySelector("#form-error");
const successMessage = document.querySelector("#form-success");

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

function setDefaultDate() {
  const today = montevideoDate();
  dateInput.value = today < "2026-09-01" ? "2026-09-01" : today;
}

setDefaultDate();
window.addEventListener("pageshow", setDefaultDate);

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

    const selectedType = form.elements.type.value;
    const selectedCategory = form.elements.category.value;
    form.reset();
    form.elements.type.value = selectedType;
    setCategories(selectedType, selectedCategory);
    const nextDate = montevideoDate();
    dateInput.value = nextDate < "2026-09-01" ? "2026-09-01" : nextDate;
    amount.focus();
  } catch (error) {
    errorMessage.textContent = error instanceof Error ? error.message : "No se pudo guardar el movimiento.";
    errorMessage.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Guardar en la planilla";
  }
});
