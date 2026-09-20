import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
const properties = new Map();
const context = {
  console,
  PropertiesService:{
    getScriptProperties:()=>({
      getProperty:(key)=>properties.get(key) || "",
      setProperty:(key,value)=>properties.set(key,value)
    })
  },
  Utilities:{formatDate:()=>"2026-08-02"}
};
vm.createContext(context);
vm.runInContext(source, context);

const rule = (overrides) => {
  const value = {
    rowNumber:2,
    priority:100,
    sender:"noreply@midinero.com.uy",
    searchText:"SUPERMERCADO",
    type:"Egreso",
    category:"Comida",
    account:"MiDinero",
    description:"",
    minimumAmount:null,
    ...overrides
  };
  value.normalizedSearchText = context.normalizeText_(value.searchText);
  return value;
};

const rules = [
  rule({rowNumber:2,searchText:"SUPERMERCADO"}),
  rule({rowNumber:12,searchText:"JOSE BELTRAN",category:"Factura",description:"Aqua Gym"}),
  rule({rowNumber:15,searchText:"MIDINERO",type:"Ingreso",category:"Familia",minimumAmount:23000}),
  rule({rowNumber:17,sender:"noreply@redpagos.com.uy",searchText:"OSE",category:"Factura",description:"OSE"}),
  rule({rowNumber:18,sender:"noreply@redpagos.com.uy",searchText:"OCA",category:"Factura",description:"OCA"}),
  rule({rowNumber:19,sender:"noreply@redpagos.com.uy",searchText:"UTE",category:"Factura",description:"UTE"}),
  rule({rowNumber:20,sender:"noreply@redpagos.com.uy",searchText:"ANTEL",category:"Factura",description:"ANTEL"}),
  rule({rowNumber:21,sender:"noreply@redpagos.com.uy",searchText:"BANCO DE SEGUROS DEL ESTADO",category:"Factura"}),
  rule({rowNumber:22,sender:"noreply@redpagos.com.uy",searchText:"Devolución IVA 19210",type:"Ingreso",category:"Dev Impuestos"})
];

test("extrae un consumo MiDinero con coma decimal", () => {
  const result = context.parseTransactionEmail_({
    from:"Midinero <noreply@midinero.com.uy>",
    subject:"Aviso consumo por $1.250,50",
    body:"Se registró un consumo en SUPERMERCADO\nFecha y hora\n02/08/2026 12:00\nComercio\nSUPERMERCADO\nTotal Pesos\n$ 1.250,50",
    receivedAt:new Date("2026-08-02T12:00:00Z")
  }, rules);
  assert.equal(result.status, "ready");
  assert.equal(result.expenses.length, 1);
  assert.equal(result.expenses[0].amount, 1250.5);
  assert.equal(result.expenses[0].account, "MiDinero");
  assert.equal(result.expenses[0].category, "Comida");
  assert.equal(result.expenses[0].type, "Egreso");
});

test("aplica la excepción de recarga solo por encima de 23000", () => {
  const base = {
    from:"Midinero <noreply@midinero.com.uy>",
    body:"Se registró una recarga Midinero\nFecha y hora\n04/08/2026 01:59\nProducto\nMIDINERO",
    receivedAt:new Date("2026-08-04T05:00:00Z")
  };
  const exact = context.parseTransactionEmail_({...base,subject:"Aviso recarga por $23.000,00",body:base.body + "\nTotal Pesos\n$ 23.000,00"}, rules);
  assert.equal(exact.status, "ignored");
  assert.equal(exact.expenses.length, 0);

  const above = context.parseTransactionEmail_({...base,subject:"Aviso recarga por $23.573,00",body:base.body + "\nTotal Pesos\n$ 23.573,00"}, rules);
  assert.equal(above.status, "ready");
  assert.equal(above.expenses[0].amount, 23573);
  assert.equal(above.expenses[0].type, "Ingreso");
  assert.equal(above.expenses[0].category, "Familia");
});

test("ignora el consumo agregado MIREDPAGOS para evitar duplicar el detalle", () => {
  const result = context.parseTransactionEmail_({
    from:"noreply@midinero.com.uy",
    subject:"Aviso consumo por $5.191,37",
    body:"Se registró un consumo en MIREDPAGOS\nFecha y hora\n05/08/2026 14:39\nTotal Pesos\n$ 5.191,37",
    receivedAt:new Date()
  }, rules);
  assert.equal(result.status, "ignored");
});

test("registra solo la confirmación final de una transferencia saliente", () => {
  const ignored = context.parseTransactionEmail_({
    from:"noreply@midinero.com.uy",
    subject:"Tu transferencia ha sido enviada (referencia: 123).",
    body:"Nombre destino JOSE BELTRAN\nTotal Pesos $ 1.550,00",
    receivedAt:new Date()
  }, rules);
  assert.equal(ignored.status, "ignored");

  const final = context.parseTransactionEmail_({
    from:"noreply@midinero.com.uy",
    subject:"Tu transferencia ha sido acreditada (referencia: 123).",
    body:"Enviada 05/08/26 14:43\nNombre destino JOSE BELTRAN\nTotal Pesos $ 1.550,00",
    receivedAt:new Date()
  }, rules);
  assert.equal(final.status, "ready");
  assert.equal(final.expenses[0].date, "2026-08-05");
  assert.equal(final.expenses[0].type, "Egreso");
  assert.equal(final.expenses[0].description, "Aqua Gym");
});

test("descompone un pago confirmado de Redpagos en servicios y devoluciones", () => {
  const result = context.parseTransactionEmail_({
    from:"Miredpagos <noreply@redpagos.com.uy>",
    subject:"Confirmado: Todos tus pagos fueron procesados (referencia: 54361884)",
    body:[
      "Tu resumen de pagos",
      "Fecha y hora 05/08/2026 - 14:39",
      "Servicios",
      "Referencia",
      "Pesos ($)",
      "UTE",
      "Cuenta: 8011851000",
      "2.611,00",
      "Devolución IVA 19210",
      "-40,95",
      "ANTEL",
      "03010766000235",
      "1.652,00",
      "Devolución IVA 19210",
      "-27,08",
      "BANCO DE SEGUROS DEL ESTADO",
      "36378924",
      "1.013,00",
      "Devolución IVA 19210",
      "-16,60",
      "Total Pesos ($)",
      "$ 5.191,37"
    ].join("\n"),
    receivedAt:new Date()
  }, rules);
  assert.equal(result.status, "ready");
  assert.deepEqual(Array.from(result.expenses, item => item.amount), [2611,40.95,1652,27.08,1013,16.6]);
  assert.deepEqual(Array.from(result.expenses, item => item.type), ["Egreso","Ingreso","Egreso","Ingreso","Egreso","Ingreso"]);
  assert.equal(result.expenses.filter(item => item.category === "Dev Impuestos").length, 3);
});

test("genera un identificador distinto para cada movimiento del mismo correo", () => {
  const first = context.emailSubmissionId_("1a09556644678e91", 0);
  const second = context.emailSubmissionId_("1a09556644678e91", 1);
  assert.equal(first, "mail_1a09556644678e91_0");
  assert.equal(second, "mail_1a09556644678e91_1");
  assert.notEqual(first, second);
});

test("ignora avisos y pagos todavía no confirmados de Redpagos", () => {
  const pending = context.parseTransactionEmail_({
    from:"noreply@redpagos.com.uy",
    subject:"Muchas gracias! Estamos procesando tus pagos (referencia: 1)",
    body:"Servicios\nOCA\n21.692,74\nTotal Pesos ($)\n$ 21.692,74",
    receivedAt:new Date()
  }, rules);
  const notice = context.parseTransactionEmail_({
    from:"noreply@redpagos.com.uy",
    subject:"Aviso: Mi UTE vence el 10/09/2026",
    body:"El total a pagar es $ 2.446,00",
    receivedAt:new Date()
  }, rules);
  assert.equal(pending.status, "ignored");
  assert.equal(notice.status, "ignored");
});

test("deja pendiente un comercio desconocido", () => {
  assert.throws(() => context.parseTransactionEmail_({
    from:"noreply@midinero.com.uy",
    subject:"Aviso consumo por $100,00",
    body:"Se registró un consumo en COMERCIO NUEVO\nTotal Pesos $ 100,00",
    receivedAt:new Date()
  }, rules), /No hay una regla/);
});

test("no registra un correo de consumo sin importe", () => {
  assert.throws(() => context.parseTransactionEmail_({
    from:"noreply@midinero.com.uy",
    subject:"Aviso consumo por",
    body:"Se registró un consumo en SUPERMERCADO",
    receivedAt:new Date()
  }, rules), /importe/);
});

test("calcula la pestaña y el encabezado del mes por fecha", () => {
  assert.equal(context.monthlySheetName_("2026-10-01"), "OCT 2026");
  assert.equal(context.monthlyHeader_("2026-10-01"), "OCTUBRE 2026");
  assert.equal(context.monthlySheetName_("2027-01-15"), "ENE 2027");
  assert.equal(context.monthlyHeader_("2027-01-15"), "ENERO 2027");
});

test("rechaza fechas mensuales inexistentes", () => {
  assert.throws(() => context.monthlySheetName_("2026-02-30"), /Fecha inválida/);
  assert.throws(() => context.monthlySheetName_("01/10/2026"), /Fecha inválida/);
});

test("crea una pestaña mensual limpia cuando todavía no existe", () => {
  const calls = [];
  const createdSheet = {
    setName:(name)=>{ calls.push(["name",name]); return createdSheet; },
    showSheet:()=>{ calls.push(["show"]); return createdSheet; },
    getMaxRows:()=>999,
    getRange:(row,column,height,width)=>({
      setValue:(value)=>{ calls.push(["header",row,column,value]); },
      clearContent:()=>{ calls.push(["clear",row,column,height,width]); }
    })
  };
  const template = {copyTo:()=>{ calls.push(["copy"]); return createdSheet; }};
  const spreadsheet = {
    getSheetByName:(name)=>name === "PLANTILLA" ? template : null
  };

  const result = context.createMonthlySheet_(spreadsheet, "2026-10-01");
  assert.equal(result, createdSheet);
  assert.deepEqual(calls, [
    ["copy"],
    ["name","OCT 2026"],
    ["show"],
    ["header",1,1,"OCTUBRE 2026"],
    ["clear",3,1,997,6]
  ]);
});

test("calcula el disponible incluyendo un saldo inicial manual", () => {
  const result = context.summarizeBalanceRows_([
    ["2026-09-01","Ingreso",30000,"Saldo Inicial","MiDinero"],
    ["2026-09-01","Ingreso",5000,"Saldo Inicial",""],
    ["2026-09-02","Egreso",1200,"Comida","Efectivo"],
    ["2026-09-03","Egreso",2500,"Factura","MiDinero"],
    ["2026-08-31","Ingreso",99999,"Saldo Inicial","Efectivo"]
  ]);

  assert.equal(result.total, 31300);
  assert.equal(result.movements, 4);
  assert.deepEqual(Array.from(result.accounts, item => [item.account,item.amount]), [
    ["Efectivo",3800],
    ["MiDinero",27500]
  ]);
});

test("incluye cuentas adicionales registradas en la planilla", () => {
  const result = context.summarizeBalanceRows_([
    ["01/09/2026","Ingreso",1000,"Saldo Inicial","Prex"],
    ["02/09/2026","Egreso",250,"Otros","Prex"],
    ["2026-09-02","Ingreso",500,"Saldo Inicial","Mercado Pago"]
  ]);

  assert.equal(result.total, 1250);
  assert.deepEqual(Array.from(result.accounts, item => [item.account,item.amount]), [
    ["Efectivo",0],
    ["MiDinero",0],
    ["Prex",750],
    ["Mercado Pago",500]
  ]);
});

test("calcula las cuotas y el próximo pago de OCA", () => {
  const result = context.summarizeOcaRows_([
    ["Lentes giuliano","",8,10,490],
    ["Microondas","",2,6,4099 / 6],
    ["Operación Zoe","",1,6,940],
    ["COMISIONES","","","",14.5],
    ["TOTAL","","","",2128]
  ], "2026-09");

  assert.equal(result.activePurchases, 3);
  assert.equal(result.installmentsAfterCurrent, 11);
  assert.equal(result.nextMonthPayment, 2113.17);
  assert.equal(result.outstandingAfterCurrent, 8412.67);
  assert.equal(result.outstandingTotal, 10525.83);
  assert.equal(result.thisMonthPayment, 2113.17);
  assert.equal(result.purchases[0].installmentsAfterCurrent, 2);
  assert.deepEqual(Array.from(result.forecast, item => [item.label,item.amount]), [
    ["Octubre 2026",2113.17],
    ["Noviembre 2026",2113.17],
    ["Diciembre 2026",1623.17],
    ["Enero 2027",1623.17],
    ["Febrero 2027",940],
    ["Marzo 2027",0]
  ]);
});

test("no lleva al mes siguiente una compra OCA que termina este mes", () => {
  const result = context.summarizeOcaRows_([
    ["Compra final","",6,6,1000]
  ], "2026-09");

  assert.equal(result.activePurchases, 1);
  assert.equal(result.nextMonthPayment, 0);
  assert.equal(result.installmentsAfterCurrent, 0);
});

test("la proyección OCA cruza correctamente el cambio de año", () => {
  assert.equal(context.addMonthsToPeriod_("2026-12", 1), "2027-01");
  assert.equal(context.periodLabel_("2027-01"), "Enero 2027");
});
