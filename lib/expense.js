import { isCategoryForType } from "./categories.js";

export const TYPES = ["Egreso", "Ingreso"];
export const ACCOUNTS = ["Efectivo", "Mercado Pago", "Prex"];

function cleanText(value, maxLength) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function validateExpense(input) {
  const expense = {
    date: cleanText(input.date, 10),
    type: cleanText(input.type, 16),
    amount: Number(input.amount),
    category: cleanText(input.category, 80),
    account: cleanText(input.account, 80) || "Efectivo",
    description: cleanText(input.description, 300)
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(expense.date)) {
    throw new Error("La fecha no es válida.");
  }
  if (!TYPES.includes(expense.type)) {
    throw new Error("El tipo debe ser Ingreso o Egreso.");
  }
  if (!Number.isFinite(expense.amount) || expense.amount <= 0 || expense.amount > 100000000) {
    throw new Error("El importe debe ser mayor a cero.");
  }
  if (!isCategoryForType(expense.type, expense.category)) {
    throw new Error("La categoría no corresponde al tipo de movimiento.");
  }
  if (!ACCOUNTS.includes(expense.account)) {
    throw new Error("El medio debe ser Efectivo, Mercado Pago o Prex.");
  }
  return expense;
}
