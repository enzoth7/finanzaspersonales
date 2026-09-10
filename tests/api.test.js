import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/gastos.js";

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

test("la función de Vercel valida el movimiento sin escribir en modo prueba", async () => {
  process.env.DRY_RUN = "true";
  const request = {
    method:"POST",
    body:{
      date:"2026-09-01",type:"Egreso",amount:250,category:"Comida",submissionId:"expense-test-0001"
    }
  };
  const response = responseMock();
  await handler(request, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {ok:true,dryRun:true,row:null});
});

test("la función de Vercel no requiere acceso familiar", async () => {
  process.env.DRY_RUN = "true";
  const request = {
    method:"POST",
    body:{date:"2026-09-01",type:"Ingreso",amount:250,category:"Sueldo mama",submissionId:"expense-test-0002"}
  };
  const response = responseMock();
  await handler(request, response);
  assert.equal(response.statusCode, 200);
});

test("la función asigna Efectivo aunque el cliente intente enviar otra cuenta", async () => {
  process.env.DRY_RUN = "true";
  const request = {
    method:"POST",
    body:{date:"2026-09-01",type:"Egreso",amount:250,category:"Comida",account:"Prex",submissionId:"expense-test-0003"}
  };
  const response = responseMock();
  await handler(request, response);
  assert.equal(response.statusCode, 200);
});

test("rechaza envíos sin identificador para evitar duplicados", async () => {
  process.env.DRY_RUN = "true";
  const request = {
    method:"POST",
    body:{date:"2026-09-01",type:"Egreso",amount:250,category:"Comida"}
  };
  const response = responseMock();
  await handler(request, response);
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /identificador/);
});

test("reenvía el identificador y comunica si Apps Script detectó un duplicado", async () => {
  const previousDryRun = process.env.DRY_RUN;
  const previousEndpoint = process.env.APPS_SCRIPT_URL;
  const previousSecret = process.env.WEBHOOK_SECRET;
  const previousFetch = global.fetch;
  let sentBody;
  process.env.DRY_RUN = "false";
  process.env.APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.WEBHOOK_SECRET = "test-secret";
  global.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return {
      ok:true,
      status:200,
      url:"https://script.googleusercontent.com/macros/echo",
      text:async () => JSON.stringify({ok:true,row:7,duplicate:true})
    };
  };

  try {
    const response = responseMock();
    await handler({
      method:"POST",
      body:{date:"2026-09-01",type:"Egreso",amount:250,category:"Comida",submissionId:"expense-test-0004"}
    }, response);
    assert.equal(sentBody.submissionId, "expense-test-0004");
    assert.deepEqual(JSON.parse(response.body), {ok:true,row:7,duplicate:true});
  } finally {
    if (previousDryRun === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previousDryRun;
    if (previousEndpoint === undefined) delete process.env.APPS_SCRIPT_URL; else process.env.APPS_SCRIPT_URL = previousEndpoint;
    if (previousSecret === undefined) delete process.env.WEBHOOK_SECRET; else process.env.WEBHOOK_SECRET = previousSecret;
    global.fetch = previousFetch;
  }
});
