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
    const endpoint = process.env.APPS_SCRIPT_URL;
    if (!endpoint) {
      return reply(response, 503, {ok:false,error:"Todavía falta conectar la aplicación con Google Sheets."});
    }

    const upstream = await fetch(endpoint, {
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({
        action:"oca",
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
      throw new Error("Apps Script: " + (result.error || "No se pudo leer el estado de OCA."));
    }

    return reply(response, 200, {
      ok:true,
      currentPeriod:result.currentPeriod || null,
      currentPeriodLabel:result.currentPeriodLabel || "Este mes",
      thisMonthPayment:Number(result.thisMonthPayment) || 0,
      nextMonthPayment:Number(result.nextMonthPayment) || 0,
      outstandingAfterCurrent:Number(result.outstandingAfterCurrent) || 0,
      outstandingTotal:Number(result.outstandingTotal) || 0,
      installmentsAfterCurrent:Number(result.installmentsAfterCurrent) || 0,
      activePurchases:Number(result.activePurchases) || 0,
      purchases:Array.isArray(result.purchases) ? result.purchases : [],
      forecast:Array.isArray(result.forecast) ? result.forecast : [],
      updatedAt:result.updatedAt || null
    });
  } catch (error) {
    return reply(response, 502, {ok:false,error:error instanceof Error ? error.message : "No se pudo leer el estado de OCA."});
  }
}
