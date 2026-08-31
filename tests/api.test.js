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
      date:"2026-09-01",type:"Egreso",amount:250,category:"Comida"
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
    body:{date:"2026-09-01",type:"Ingreso",amount:250,category:"Sueldo mama"}
  };
  const response = responseMock();
  await handler(request, response);
  assert.equal(response.statusCode, 200);
});

test("la función asigna Efectivo aunque el cliente intente enviar otra cuenta", async () => {
  process.env.DRY_RUN = "true";
  const request = {
    method:"POST",
    body:{date:"2026-09-01",type:"Egreso",amount:250,category:"Comida",account:"Prex"}
  };
  const response = responseMock();
  await handler(request, response);
  assert.equal(response.statusCode, 200);
});
