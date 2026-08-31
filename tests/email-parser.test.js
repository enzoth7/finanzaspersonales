import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
const properties = new Map([
  ["EMAIL_DEFAULT_ACCOUNT", "MiDinero"],
  ["CATEGORY_RULES_JSON", JSON.stringify([
    {contains:"SUPERMERCADO",category:"Comida"},
    {contains:"COMEPA",category:"Salud"}
  ])]
]);
const context = {
  console,
  PropertiesService:{
    getScriptProperties:()=>({
      getProperty:(key)=>properties.get(key) || "",
      setProperty:(key,value)=>properties.set(key,value)
    })
  },
  Utilities:{formatDate:()=>"2026-09-02"}
};
vm.createContext(context);
vm.runInContext(source, context);

test("extrae un gasto MiDinero con coma decimal", () => {
  const expense = context.parseTransactionEmail_({
    from:"avisos@midinero.com.uy",
    subject:"Compra realizada",
    body:"Importe: $U 1.250,50\nComercio: Supermercado Central\nFecha: 02/09/2026\nTarjeta MiDinero",
    receivedAt:new Date("2026-09-02T12:00:00Z")
  });
  assert.equal(expense.amount, 1250.5);
  assert.equal(expense.account, "MiDinero");
  assert.equal(expense.category, "Comida");
  assert.equal(expense.type, "Egreso");
});

test("detecta ingresos recibidos por Prex", () => {
  const expense = context.parseTransactionEmail_({
    from:"avisos@prexcard.com",
    subject:"Transferencia recibida",
    body:"Monto: USD 25.40\nDetalle: Transferencia recibida\nFecha 03/09/2026\nPrex",
    receivedAt:new Date()
  });
  assert.equal(expense.amount, 25.4);
  assert.equal(expense.account, "Prex");
  assert.equal(expense.type, "Ingreso");
});

test("no registra un correo sin importe", () => {
  assert.throws(() => context.parseTransactionEmail_({
    from:"avisos@example.com",subject:"Aviso",body:"No contiene una transacción",receivedAt:new Date()
  }), /importe/);
});
