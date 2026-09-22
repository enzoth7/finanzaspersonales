import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/categorias.js";

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

test("devuelve el resumen mensual por categorías", async () => {
  const previousFetch = global.fetch;
  const previousEndpoint = process.env.APPS_SCRIPT_URL;
  const previousSecret = process.env.WEBHOOK_SECRET;
  process.env.APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.WEBHOOK_SECRET = "test-secret";
  let sentBody;
  global.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return {
      ok:true,
      status:200,
      url:"https://script.googleusercontent.com/macros/echo",
      text:async () => JSON.stringify({
        ok:true,
        period:"2026-09",
        periodLabel:"Septiembre 2026",
        total:2500,
        movements:3,
        categories:[{category:"Comida",amount:2000,percentage:80,movements:2}],
        availablePeriods:[{period:"2026-09",label:"Septiembre 2026"}],
        updatedAt:"2026-09-22T15:00:00.000Z"
      })
    };
  };

  try {
    const response = responseMock();
    await handler({method:"GET",query:{period:"2026-09"}}, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(sentBody, {action:"categorySummary",period:"2026-09",secret:"test-secret"});
    const result = JSON.parse(response.body);
    assert.equal(result.total, 2500);
    assert.equal(result.categories[0].category, "Comida");
  } finally {
    global.fetch = previousFetch;
    if (previousEndpoint === undefined) delete process.env.APPS_SCRIPT_URL;
    else process.env.APPS_SCRIPT_URL = previousEndpoint;
    if (previousSecret === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = previousSecret;
  }
});

test("rechaza un mes inválido", async () => {
  const response = responseMock();
  await handler({method:"GET",query:{period:"2026-13"}}, response);
  assert.equal(response.statusCode, 400);
});
