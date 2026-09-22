function reply(response, status, payload) {
  response.status(status);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return reply(response, 405, {ok:false,error:"Método no permitido."});
  }

  try {
    const period = String(request.query?.period || "").trim();
    if (period && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(period)) {
      return reply(response, 400, {ok:false,error:"El mes seleccionado no es válido."});
    }

    const endpoint = process.env.APPS_SCRIPT_URL;
    if (!endpoint) {
      return reply(response, 503, {ok:false,error:"Todavía falta conectar la aplicación con Google Sheets."});
    }

    const upstream = await fetch(endpoint, {
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({
        action:"categorySummary",
        period,
        secret:process.env.WEBHOOK_SECRET || ""
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
      throw new Error("Apps Script: " + (result.error || "No se pudieron leer los gastos por categoría."));
    }

    return reply(response, 200, {
      ok:true,
      period:result.period || period || null,
      periodLabel:result.periodLabel || "",
      total:Number(result.total) || 0,
      movements:Number(result.movements) || 0,
      categories:Array.isArray(result.categories) ? result.categories : [],
      availablePeriods:Array.isArray(result.availablePeriods) ? result.availablePeriods : [],
      updatedAt:result.updatedAt || null
    });
  } catch (error) {
    return reply(response, 502, {ok:false,error:error instanceof Error ? error.message : "No se pudieron leer los gastos por categoría."});
  }
}
