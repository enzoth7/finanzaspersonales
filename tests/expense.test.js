import test from "node:test";
import assert from "node:assert/strict";
import { validateExpense } from "../lib/expense.js";

test("acepta una fila compatible con la hoja existente", () => {
  const expense = validateExpense({
    date:"2026-09-01",
    type:"Egreso",
    amount:"450.50",
    category:"Comida"
  });
  assert.equal(expense.amount, 450.5);
  assert.equal(expense.category, "Comida");
  assert.equal(expense.account, "");
  assert.equal(expense.description, "");
});

test("rechaza importes vacíos o negativos", () => {
  assert.throws(() => validateExpense({
    date:"2026-09-01",type:"Egreso",amount:"0",category:"Comida"
  }), /mayor a cero/);
});

test("rechaza tipos que no existen en la hoja", () => {
  assert.throws(() => validateExpense({
    date:"2026-09-01",type:"Gasto",amount:"10",category:"Comida"
  }), /Ingreso o Egreso/);
});

test("rechaza una categoría de ingreso usada como egreso", () => {
  assert.throws(() => validateExpense({
    date:"2026-09-01",type:"Egreso",amount:"10",category:"Sueldo mama"
  }), /no corresponde/);
});

test("acepta Efectivo y una descripción opcional", () => {
  const expense = validateExpense({
    date:"2026-09-01",type:"Egreso",amount:"25",category:"Comida",
    account:"Efectivo",description:"Compra del día"
  });
  assert.equal(expense.account, "Efectivo");
  assert.equal(expense.description, "Compra del día");
});

test("rechaza cuentas distintas de Efectivo", () => {
  assert.throws(() => validateExpense({
    date:"2026-09-01",type:"Egreso",amount:"25",category:"Comida",account:"Prex"
  }), /Efectivo/);
});
