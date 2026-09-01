import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/saldos.js";

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

test("devuelve los saldos leídos desde Apps Script", async () => {
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
        total:31300,
        accounts:[
          {account:"Efectivo",amount:3800},
          {account:"MiDinero",amount:27500}
        ],
        movements:4,
        updatedAt:"2026-09-01T15:00:00.000Z"
      })
    };
  };

  try {
    const response = responseMock();
    await handler({method:"GET"}, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(sentBody, {action:"balances",secret:"test-secret"});
    assert.deepEqual(JSON.parse(response.body), {
      ok:true,
      total:31300,
      accounts:[
        {account:"Efectivo",amount:3800},
        {account:"MiDinero",amount:27500}
      ],
      movements:4,
      updatedAt:"2026-09-01T15:00:00.000Z"
    });
  } finally {
    global.fetch = previousFetch;
    if (previousEndpoint === undefined) delete process.env.APPS_SCRIPT_URL;
    else process.env.APPS_SCRIPT_URL = previousEndpoint;
    if (previousSecret === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = previousSecret;
  }
});

test("rechaza métodos distintos de GET", async () => {
  const response = responseMock();
  await handler({method:"POST"}, response);
  assert.equal(response.statusCode, 405);
});
