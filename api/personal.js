import { validatePersonalMovement } from "../lib/personal.js";

function reply(response, status, payload) {
  response.status(status);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readUpstream(upstream) {
  const text = await upstream.text();
  try {
    return JSON.parse(text);
  } catch {
    const redirectedToLogin = upstream.url.includes("accounts.google.com") || /accounts\.google\.com|signin/i.test(text);
    if (redirectedToLogin || upstream.status === 401 || upstream.status === 403) {
      throw new Error("Google Apps Script no está publicado para Cualquier usuario. Creá una implementación pública nueva y usá su URL /exec.");
    }
    throw new Error("Google Apps Script devolvió una respuesta inesperada.");
  }
}

async function callAppsScript(payload) {
  const endpoint = process.env.APPS_SCRIPT_URL;
  if (!endpoint) throw new Error("Todavía falta conectar la aplicación con Google Sheets.");
  const upstream = await fetch(endpoint, {
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({...payload,secret:process.env.WEBHOOK_SECRET || ""}),
    redirect:"follow"
  });
  const result = await readUpstream(upstream);
  if (!upstream.ok || !result.ok) throw new Error("Apps Script: " + (result.error || "No se pudo completar la operación personal."));
  return result;
}

export default async function handler(request, response) {
  try {
    if (request.method === "GET") {
      if (process.env.DRY_RUN === "true") {
        return reply(response, 200, {
          ok:true,
          currencies:{
            Pesos:{available:0,debt:0,net:0},
            Dolares:{available:0,debt:0,net:0},
            Euros:{available:0,debt:0,net:0}
          },
          accounts:[],recent:[],movements:0,updatedAt:new Date().toISOString(),dryRun:true
        });
      }
      const result = await callAppsScript({action:"personalSummary"});
      return reply(response, 200, {
        ok:true,
        currencies:result.currencies || {},
        accounts:Array.isArray(result.accounts) ? result.accounts : [],
        recent:Array.isArray(result.recent) ? result.recent : [],
        movements:Number(result.movements) || 0,
        updatedAt:result.updatedAt || null
      });
    }

    if (request.method === "POST") {
      const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
      if (!Array.isArray(body.movements) || body.movements.length < 1 || body.movements.length > 100) {
        return reply(response, 400, {ok:false,error:"La importación debe contener entre 1 y 100 movimientos."});
      }
      const movements = body.movements.map(validatePersonalMovement);
      if (process.env.DRY_RUN === "true") {
        return reply(response, 200, {ok:true,dryRun:true,inserted:movements.length,duplicates:[]});
      }
      const result = await callAppsScript({action:"personalImport",movements});
      return reply(response, 200, {
        ok:true,
        inserted:Number(result.inserted) || 0,
        duplicates:Array.isArray(result.duplicates) ? result.duplicates : []
      });
    }

    response.setHeader("Allow", "GET, POST");
    return reply(response, 405, {ok:false,error:"Método no permitido."});
  } catch (error) {
    return reply(response, 400, {ok:false,error:error instanceof Error ? error.message : "No se pudo completar la operación personal."});
  }
}
