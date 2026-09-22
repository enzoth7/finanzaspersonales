import { validateExpense } from "../lib/expense.js";

function validateSubmissionId(value) {
  const submissionId = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(submissionId)) {
    throw new Error("El identificador del movimiento no es válido. Actualizá la aplicación y volvé a intentar.");
  }
  return submissionId;
}

function reply(response, status, payload) {
  response.status(status);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return reply(response, 405, {ok:false,error:"Método no permitido."});
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    const expense = validateExpense(body);
    const submissionId = validateSubmissionId(body.submissionId);
    if (process.env.DRY_RUN === "true") {
      return reply(response, 200, {ok:true,dryRun:true,row:null});
    }

    const endpoint = process.env.APPS_SCRIPT_URL;
    if (!endpoint) {
      return reply(response, 503, {ok:false,error:"Todavía falta conectar la web con Google Apps Script."});
    }

    const upstream = await fetch(endpoint, {
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({
        ...expense,
        submissionId,
        secret:process.env.WEBHOOK_SECRET || "",
        source:"Web"
      }),
      redirect:"follow"
    });
    const text = await upstream.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      const redirectedToLogin = upstream.url.includes("accounts.google.com") || /accounts\.google\.com|signin/i.test(text);
      if (redirectedToLogin || upstream.status === 401 || upstream.status === 403) {
        throw new Error("Google Apps Script no está publicado para Cualquier usuario. Creá una nueva implementación pública y usá su URL /exec.");
      }
      throw new Error("Google Apps Script devolvió una respuesta inesperada.");
    }
    if (!upstream.ok || !result.ok) {
      throw new Error("Apps Script: " + (result.error || "No se pudo guardar en Google Sheets."));
    }
    return reply(response, 200, {ok:true,row:result.row,duplicate:Boolean(result.duplicate)});
  } catch (error) {
    return reply(response, 400, {ok:false,error:error instanceof Error ? error.message : "No se pudo guardar el gasto."});
  }
}
