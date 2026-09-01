import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/oca.js";

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

test("devuelve el estado de OCA leído desde Apps Script", async () => {
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
        currentPeriod:"2026-09",
        currentPeriodLabel:"Septiembre 2026",
        thisMonthPayment:2113.17,
        nextMonthPayment:2113.17,
        outstandingAfterCurrent:8412.67,
        outstandingTotal:10525.83,
        installmentsAfterCurrent:11,
        activePurchases:3,
        purchases:[{
          name:"Lentes giuliano",
          currentInstallment:8,
          totalInstallments:10,
          installmentsAfterCurrent:2,
          installmentAmount:490,
          outstandingAfterCurrent:980
        }],
        forecast:[{period:"2026-10",label:"Octubre 2026",amount:2113.17}],
        updatedAt:"2026-09-01T15:00:00.000Z"
      })
    };
  };

  try {
    const response = responseMock();
    await handler({method:"GET"}, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(sentBody, {action:"oca",secret:"test-secret"});
    assert.equal(JSON.parse(response.body).nextMonthPayment, 2113.17);
    assert.equal(JSON.parse(response.body).outstandingTotal, 10525.83);
    assert.equal(JSON.parse(response.body).forecast[0].label, "Octubre 2026");
    assert.equal(JSON.parse(response.body).purchases[0].name, "Lentes giuliano");
  } finally {
    global.fetch = previousFetch;
    if (previousEndpoint === undefined) delete process.env.APPS_SCRIPT_URL;
    else process.env.APPS_SCRIPT_URL = previousEndpoint;
    if (previousSecret === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = previousSecret;
  }
});

test("rechaza métodos distintos de GET para OCA", async () => {
  const response = responseMock();
  await handler({method:"POST"}, response);
  assert.equal(response.statusCode, 405);
});
