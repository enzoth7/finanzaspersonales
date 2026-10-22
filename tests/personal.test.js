import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import handler from "../api/personal.js";
import { validateOcaEntry } from "../lib/personal.js";

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

function loadAppsScript() {
  const source = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const context = {
    console,
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>""})},
    Utilities:{
      formatDate:(value, _zone, pattern) => {
        const date = value instanceof Date ? value : new Date(value);
        if (pattern === "M") return String(date.getUTCMonth() + 1);
        return date.toISOString().slice(0, 10);
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test("valida una compra OCA y calcula la cuota", () => {
  assert.deepEqual(validateOcaEntry({
    mode:"installments",
    date:"2026-10-22",
    description:"Notebook",
    amount:1200,
    installments:3
  }), {
    mode:"installments",
    date:"2026-10-22",
    description:"Notebook",
    amount:1200,
    installments:3,
    installmentAmount:400
  });
});

test("valida una suscripción OCA como cargo mensual", () => {
  assert.deepEqual(validateOcaEntry({
    mode:"subscription",
    date:"22/10/2026",
    description:"Apple Cloud",
    amount:41,
    installments:12
  }), {
    mode:"subscription",
    date:"2026-10-22",
    description:"Apple Cloud",
    amount:41,
    installments:0,
    installmentAmount:41
  });
});

test("la API personal envía el alta directamente a la pestaña OCA", async () => {
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
      text:async () => JSON.stringify({ok:true,row:15,range:"B15:G15",mode:"installments",installmentAmount:400})
    };
  };

  try {
    const response = responseMock();
    await handler({method:"POST",body:{entry:{
      mode:"installments",date:"2026-10-22",description:"Notebook",amount:1200,installments:3
    }}}, response);
    assert.equal(response.statusCode, 200);
    assert.equal(sentBody.action, "personalOcaCreate");
    assert.equal(sentBody.secret, "test-secret");
    assert.equal(sentBody.entry.installmentAmount, 400);
    assert.equal(JSON.parse(response.body).row, 15);
    assert.equal(JSON.parse(response.body).range, "B15:G15");
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

test("la API personal devuelve caja, OCA y finanzas futuras", async () => {
  const previousFetch = global.fetch;
  const previousEndpoint = process.env.APPS_SCRIPT_URL;
  const previousDryRun = process.env.DRY_RUN;
  process.env.APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  delete process.env.DRY_RUN;
  global.fetch = async () => ({
    ok:true,
    status:200,
    url:"https://script.googleusercontent.com/macros/echo",
    text:async () => JSON.stringify({
      ok:true,
      currencies:{Pesos:{available:2305.07},Dolares:{available:251.89},Euros:{available:5.37}},
      totalAvailablePesos:12956.28,
      accounts:[],
      oca:{currency:"Pesos",nextPayment:10109.54,months:[{month:"2026-11-01",amount:10109.54}]},
      finance:{currency:"Dolares",months:[{month:"2026-10-01",amount:-45}]},
      sourceSheet:"OCT"
    })
  });
  try {
    const response = responseMock();
    await handler({method:"GET"}, response);
    const result = JSON.parse(response.body);
    assert.equal(result.sourceSheet, "OCT");
    assert.equal(result.oca.nextPayment, 10109.54);
    assert.equal(result.finance.months[0].amount, -45);
  } finally {
    global.fetch = previousFetch;
    if (previousEndpoint === undefined) delete process.env.APPS_SCRIPT_URL;
    else process.env.APPS_SCRIPT_URL = previousEndpoint;
    if (previousDryRun === undefined) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = previousDryRun;
  }
});

test("calcula el disponible actual desde la caja mensual", () => {
  const context = loadAppsScript();
  const result = context.summarizePersonalBoxRows_([
    ["2026-10-01","Ingreso","Pesos",8016.74,"Saldo Inicial","Mercado Pago",""] ,
    ["2026-10-03","Egreso","Pesos",263.59,"Suscripciones","Mercado Pago",""] ,
    ["2026-10-01","Ingreso","Dolares",12.8,"Saldo Inicial","Paypal",""] ,
    ["2026-10-12","Ingreso","Dolares",239.09,"Freelancer","Paypal",""] ,
    ["2026-10-01","Ingreso","Euros",5.37,"Saldo Inicial","N26",""]
  ], {Dolares:40,Euros:45});
  assert.equal(result.currencies.Pesos.available, 7753.15);
  assert.equal(result.currencies.Dolares.available, 251.89);
  assert.equal(result.currencies.Euros.available, 5.37);
  assert.equal(result.totalAvailablePesos, 18070.4);
  assert.equal(result.movements, 5);
});

test("proyecta cuotas, compras de un pago y suscripciones OCA", () => {
  const context = loadAppsScript();
  const result = context.summarizePersonalOcaRows_([
    [1,"","Apple Cloud","SUSCRIPCION","","",41],
    [2,"2026-10-17","Campera","",1,4,1138],
    [3,"2026-10-18","Cuerda","","","",450]
  ], "2026-10-22", 6);
  assert.equal(result.nextPayment, 1629);
  assert.equal(result.months[1].amount, 1179);
  assert.equal(result.months[4].amount, 41);
  assert.equal(result.outstanding, 5002);
});

test("lee la proyección financiera desde el mes actual", () => {
  const context = loadAppsScript();
  const result = context.summarizePersonalFinanceProjection_([
    "2026-09-01","2026-10-01","2026-11-01","2026-12-01"
  ], [213,-45,1657,2675], "2026-10-22", 12);
  assert.deepEqual(JSON.parse(JSON.stringify(result.months)), [
    {month:"2026-10-01",amount:-45},
    {month:"2026-11-01",amount:1657},
    {month:"2026-12-01",amount:2675}
  ]);
});
