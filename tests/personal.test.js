import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import handler from "../api/personal.js";
import { parsePersonalImport, validatePersonalMovement } from "../lib/personal.js";

function responseMock() {
  return {
    statusCode:200,
    headers:{},
    body:"",
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; }
  };
}

test("interpreta el JSON de Gemini y normaliza nombres", () => {
  const movements = parsePersonalImport(`\`\`\`json
  [{"fecha":"01/09/2026","tipo":"gasto","moneda":"UYU","importe":"1.250,50","categoria":"Entretenimiento y salidas","cuenta":"Grow","comercio":"Café"}]
  \`\`\``);
  assert.deepEqual(movements, [{
    date:"2026-09-01",
    type:"Egreso",
    currency:"Pesos",
    amount:1250.5,
    category:"Entretenimietno y salidas",
    account:"Grow",
    description:"Café",
    installments:0,
    firstInstallment:"",
    installmentAmount:0,
    allowDuplicate:false
  }]);
});

test("calcula una compra OCA y la primera cuota automáticamente", () => {
  const movement = validatePersonalMovement({
    fecha:"2026-09-01",
    tipo:"Egreso",
    moneda:"Pesos",
    importe:1200,
    categoria:"Compras a credito",
    cuenta:"OCA Credito",
    descripcion:"Notebook",
    cuotas:3
  });
  assert.deepEqual(movement, {
    date:"2026-09-01",
    type:"Egreso",
    currency:"Pesos",
    amount:1200,
    category:"Compras a crédito",
    account:"OCA Crédito",
    description:"Notebook",
    installments:3,
    firstInstallment:"2026-10-01",
    installmentAmount:400,
    allowDuplicate:false
  });
});

test("normaliza una suscripción mensual de OCA", () => {
  const movement = validatePersonalMovement({
    fecha:"2026-09-01",
    tipo:"Egreso",
    moneda:"Pesos",
    importe:399,
    categoria:"Suscripciones",
    cuenta:"OCA Credito",
    descripcion:"Spotify"
  });
  assert.deepEqual(movement, {
    date:"2026-09-01",
    type:"Egreso",
    currency:"Pesos",
    amount:399,
    category:"Suscripciones",
    account:"OCA Crédito",
    description:"Spotify",
    installments:0,
    firstInstallment:"2026-10-01",
    installmentAmount:399,
    allowDuplicate:false
  });
});

test("marca una compra pagada por mamá como deuda", () => {
  const movement = validatePersonalMovement({
    fecha:"2026-09-01",
    tipo:"Egreso",
    moneda:"Pesos",
    importe:3000,
    categoria:"Compras",
    pagado_por_mama:true,
    descripcion:"Compra de prueba"
  });
  assert.equal(movement.account, "Deuda Mamá");
});

test("la API personal envía un lote validado a Apps Script", async () => {
  const previousFetch = global.fetch;
  const previousEndpoint = process.env.APPS_SCRIPT_URL;
  const previousSecret = process.env.WEBHOOK_SECRET;
  const previousDryRun = process.env.DRY_RUN;
  process.env.APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.WEBHOOK_SECRET = "test-secret";
  delete process.env.DRY_RUN;
  let sentBody;
  global.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return {
      ok:true,
      status:200,
      url:"https://script.googleusercontent.com/macros/echo",
      text:async () => JSON.stringify({ok:true,inserted:1,duplicates:[]})
    };
  };

  try {
    const response = responseMock();
    await handler({method:"POST",body:{movements:[{
      date:"2026-09-01",type:"Egreso",currency:"Pesos",amount:450,
      category:"Comida",account:"Revolut",description:"Supermercado"
    }]}}, response);
    assert.equal(response.statusCode, 200);
    assert.equal(sentBody.action, "personalImport");
    assert.equal(sentBody.secret, "test-secret");
    assert.equal(sentBody.movements[0].account, "Revolut");
    assert.equal(JSON.parse(response.body).inserted, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousEndpoint === undefined) delete process.env.APPS_SCRIPT_URL;
    else process.env.APPS_SCRIPT_URL = previousEndpoint;
    if (previousSecret === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = previousSecret;
    if (previousDryRun === undefined) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = previousDryRun;
  }
});

test("calcula disponible y deuda con mamá sin sumar monedas", () => {
  const source = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const context = {
    console,
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>""})},
    Utilities:{formatDate:(value)=>value instanceof Date ? value.toISOString().slice(0, 10) : String(value)}
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const result = context.summarizePersonalRows_([
    ["1","2026-09-01","Ingreso","Pesos",10000,"Saldo Inicial","Mercado Pago","","",new Date()],
    ["2","2026-09-01","Egreso","Pesos",2000,"Comida","Mercado Pago","Supermercado","",new Date()],
    ["3","2026-09-01","Egreso","Pesos",3000,"Compras","Deuda Mamá","Compra con tarjeta de mamá","",new Date()],
    ["4","2026-09-01","Egreso","Pesos",1000,"Pago Deuda Mamá","Efectivo","Devolución","",new Date()],
    ["5","2026-09-01","Ingreso","Dolares",200,"Freelancer","Paypal","Trabajo","",new Date()],
    ["6","2026-09-01","Egreso","Dolares",50,"Comida","Revolut","Cena","",new Date()],
    ["7","2026-09-01","Egreso","Pesos",1200,"Compras a crédito","OCA Crédito","Notebook","",new Date(),3,"2026-10-01",400],
    ["8","2026-09-01","Egreso","Pesos",250,"Suscripciones","OCA Crédito","Software","",new Date(),"","2026-10-01",250]
  ], "2026-09-15");
  assert.deepEqual(JSON.parse(JSON.stringify(result.currencies)), {
    Pesos:{available:7000,debt:2000,net:5000},
    Dolares:{available:150,debt:0,net:150},
    Euros:{available:0,debt:0,net:0}
  });
  assert.equal(result.movements, 8);
  assert.equal(result.oca.outstanding, 1200);
  assert.deepEqual(JSON.parse(JSON.stringify(result.oca.months.slice(0, 4))), [
    {month:"2026-10-01",amount:650},
    {month:"2026-11-01",amount:650},
    {month:"2026-12-01",amount:650},
    {month:"2027-01-01",amount:250}
  ]);
});
