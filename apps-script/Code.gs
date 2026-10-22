const CONFIG = Object.freeze({
  VERSION: "2026-10-22-v18",
  SPREADSHEET_ID: "1QfWNrNWRQsFpWZNnYiItdRDop_d5Hw9CgoNC1s7wMxE",
  SHEET_GID: 1406094759,
  CONFIG_SHEET_GID: 900241103,
  TEMPLATE_SHEET_NAME: "PLANTILLA",
  START_DATE: "2026-09-01",
  HEADER_ROW: 2,
  DATA_START_ROW: 3,
  WIDTH: 6,
  EMAIL_QUERY: "{from:noreply@midinero.com.uy from:noreply@redpagos.com.uy}",
  PROCESSED_LABEL: "finanzas-procesado",
  ERROR_LABEL: "finanzas-error",
  OCA_SPREADSHEET_ID: "1cnAoaGhzMyu0mFg5U_WZ6XBRQJkTmAlIaFbZlmNwdtI",
  OCA_SHEET_GID: 955665856,
  OCA_RANGE: "F18:J40",
  ENZO_BOXES_SPREADSHEET_ID: "1VPZL31ruHgzx80UW-MPng2Abk1mdERffE0Je6BpeKHg",
  ENZO_BOXES_CONFIG_SHEET_NAME: "CONFIG",
  ENZO_BOXES_EXCHANGE_RATE_RANGE: "I20:I21",
  FINANCES_SPREADSHEET_ID: "1rPs2YmiHSdpB_m4XDHEz1LFcH1LbWU4TRIWf0InjvKs",
  FINANCES_OCA_SHEET_GID: 1825070646,
  FINANCES_VIEW_SHEET_NAME: "FINANZAS VIEWER",
  FINANCES_PROJECTION_HEADER_RANGE: "C1:AC1",
  FINANCES_PROJECTION_VALUE_RANGE: "C47:AC47",
  PERSONAL_OCA_DATA_START_ROW: 3,
  PERSONAL_OCA_WRITE_START_ROW: 6,
  PERSONAL_OCA_END_ROW: 32,
  PERSONAL_FORECAST_MONTHS: 12
});

function doGet() {
  return json_({
    ok:true,
    service:"gastos-familiares",
    version:CONFIG.VERSION,
    spreadsheetId:CONFIG.SPREADSHEET_ID,
    sheetGid:CONFIG.SHEET_GID,
    monthlySheets:true
  });
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
    validateSecret_(payload.secret);
    if (payload.action === "balances") {
      return json_(Object.assign({ok:true,version:CONFIG.VERSION}, getAvailableBalances_()));
    }
    if (payload.action === "categorySummary") {
      return json_(Object.assign({ok:true,version:CONFIG.VERSION}, getCategorySummary_(payload.period)));
    }
    if (payload.action === "oca") {
      return json_(Object.assign({ok:true,version:CONFIG.VERSION}, getOcaStatus_()));
    }
    if (payload.action === "personalSummary") {
      return json_(Object.assign({ok:true,version:CONFIG.VERSION}, getPersonalSummary_()));
    }
    if (payload.action === "personalOcaCreate") {
      return json_(Object.assign({ok:true,version:CONFIG.VERSION}, appendPersonalOcaEntry_(payload.entry)));
    }
    const expense = validateExpense_(payload);
    const submissionId = validateSubmissionId_(payload.submissionId);
    const saved = appendExpense_(expense, submissionId);
    return json_({ok:true,row:saved.row,sheet:saved.sheet,duplicate:saved.duplicate,version:CONFIG.VERSION});
  } catch (error) {
    return json_({ok:false,error:error.message || "No se pudo guardar el movimiento."});
  }
}

function getPersonalSummary_() {
  const today = new Date();
  const boxes = SpreadsheetApp.openById(CONFIG.ENZO_BOXES_SPREADSHEET_ID);
  const sheetName = personalMonthSheetName_(today);
  const sheet = boxes.getSheetByName(sheetName);
  if (!sheet) throw new Error("No se encontró la pestaña mensual " + sheetName + " en la caja de Enzo.");
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= CONFIG.DATA_START_ROW
    ? sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, 7).getValues()
    : [];
  const summary = summarizePersonalBoxRows_(rows, getPersonalExchangeRates_(boxes));
  const finances = SpreadsheetApp.openById(CONFIG.FINANCES_SPREADSHEET_ID);
  const ocaSheet = getPersonalOcaSheet_(finances);
  const ocaRows = ocaSheet.getRange(
    CONFIG.PERSONAL_OCA_DATA_START_ROW,
    1,
    CONFIG.PERSONAL_OCA_END_ROW - CONFIG.PERSONAL_OCA_DATA_START_ROW + 1,
    7
  ).getValues();
  summary.oca = summarizePersonalOcaRows_(ocaRows, today, CONFIG.PERSONAL_FORECAST_MONTHS);
  const viewer = finances.getSheetByName(CONFIG.FINANCES_VIEW_SHEET_NAME);
  if (!viewer) throw new Error("No se encontró la pestaña " + CONFIG.FINANCES_VIEW_SHEET_NAME + ".");
  summary.finance = summarizePersonalFinanceProjection_(
    viewer.getRange(CONFIG.FINANCES_PROJECTION_HEADER_RANGE).getValues()[0],
    viewer.getRange(CONFIG.FINANCES_PROJECTION_VALUE_RANGE).getValues()[0],
    today,
    CONFIG.PERSONAL_FORECAST_MONTHS
  );
  summary.sourceSheet = sheetName;
  summary.updatedAt = new Date().toISOString();
  return summary;
}

function getPersonalExchangeRates_(spreadsheet) {
  const config = spreadsheet.getSheetByName(CONFIG.ENZO_BOXES_CONFIG_SHEET_NAME);
  if (!config) throw new Error("No se encontró la pestaña CONFIG de la caja de Enzo.");
  const values = config.getRange(CONFIG.ENZO_BOXES_EXCHANGE_RATE_RANGE).getValues();
  const uyuPerUsd = Number(values[0][0]);
  const eurPerUsd = Number(values[1][0]);
  if (!isFinite(uyuPerUsd) || uyuPerUsd <= 0 || !isFinite(eurPerUsd) || eurPerUsd <= 0) {
    throw new Error("Revisá las cotizaciones en CONFIG!" + CONFIG.ENZO_BOXES_EXCHANGE_RATE_RANGE + ".");
  }
  return {Dolares:uyuPerUsd,Euros:uyuPerUsd / eurPerUsd};
}

function summarizePersonalBoxRows_(rows, exchangeRates) {
  const rates = Object.assign({Dolares:0,Euros:0}, exchangeRates || {});
  const currencies = {};
  const accounts = {};
  const recent = [];

  ["Pesos", "Dolares", "Euros"].forEach(function(currency) {
    currencies[currency] = {available:0,debt:0,net:0};
  });

  rows.forEach(function(row) {
    const date = sheetDateText_(row[0]);
    const type = cleanText_(row[1], 16);
    const currency = cleanText_(row[2], 16);
    const amount = Number(row[3]);
    const category = cleanText_(row[4], 80);
    const account = cleanText_(row[5], 80) || "Efectivo";
    if (!date || ["Ingreso", "Egreso"].indexOf(type) === -1 || !currencies[currency] || !isFinite(amount) || amount <= 0) return;
    const signedAmount = type === "Ingreso" ? amount : -amount;
    const key = currency + "|" + account;
    if (!accounts[key]) accounts[key] = {currency:currency,account:account,amount:0};
    accounts[key].amount += signedAmount;
    currencies[currency].available += signedAmount;

    recent.push({
      date:date,type:type,currency:currency,amount:amount,
      category:category,account:account,description:cleanText_(row[6], 300)
    });
  });

  Object.keys(currencies).forEach(function(currency) {
    currencies[currency].available = roundMoney_(currencies[currency].available);
    currencies[currency].debt = 0;
    currencies[currency].net = currencies[currency].available;
  });

  const accountList = Object.keys(accounts).map(function(key) {
    return {currency:accounts[key].currency,account:accounts[key].account,amount:roundMoney_(accounts[key].amount)};
  }).sort(function(a, b) {
    return a.currency.localeCompare(b.currency) || a.account.localeCompare(b.account);
  });

  const totalAvailablePesos = roundMoney_(
    currencies.Pesos.available +
    currencies.Dolares.available * Number(rates.Dolares || 0) +
    currencies.Euros.available * Number(rates.Euros || 0)
  );

  return {
    currencies:currencies,
    totalAvailablePesos:totalAvailablePesos,
    exchangeRates:{Dolares:Number(rates.Dolares || 0),Euros:Number(rates.Euros || 0)},
    accounts:accountList,
    recent:recent.slice(-10).reverse(),
    movements:recent.length
  };
}

function summarizePersonalOcaRows_(rows, today, monthCount) {
  const count = Number(monthCount) || 12;
  const currentMonth = personalMonthStartText_(sheetDateText_(today || new Date()), 0);
  const forecast = [];
  for (let offset = 1; offset <= count; offset += 1) {
    forecast.push({month:personalMonthStartText_(currentMonth, offset),amount:0});
  }
  let outstanding = 0;
  let activeItems = 0;

  rows.forEach(function(row) {
    const description = cleanText_(row[2], 300);
    const mode = normalizeText_(row[3]);
    const currentInstallment = Number(row[4]);
    const totalInstallments = Number(row[5]);
    const installmentAmount = Number(row[6]);
    if (!description || !isFinite(installmentAmount) || installmentAmount <= 0) return;
    activeItems += 1;

    if (mode === "SUSCRIPCION") {
      forecast.forEach(function(item) { item.amount += installmentAmount; });
      return;
    }

    if (Number.isInteger(currentInstallment) && Number.isInteger(totalInstallments) &&
        currentInstallment >= 1 && totalInstallments >= currentInstallment) {
      const remaining = totalInstallments - currentInstallment + 1;
      outstanding += remaining * installmentAmount;
      forecast.forEach(function(item, index) {
        if (index < remaining) item.amount += installmentAmount;
      });
      return;
    }

    outstanding += installmentAmount;
    forecast[0].amount += installmentAmount;
  });

  forecast.forEach(function(item) { item.amount = roundMoney_(item.amount); });
  return {
    currency:"Pesos",
    outstanding:roundMoney_(outstanding),
    nextPayment:forecast.length ? forecast[0].amount : 0,
    projectedTotal:roundMoney_(forecast.reduce(function(sum, item) { return sum + item.amount; }, 0)),
    activeItems:activeItems,
    months:forecast
  };
}

function summarizePersonalFinanceProjection_(headers, values, today, monthCount) {
  const currentMonth = personalMonthStartText_(sheetDateText_(today || new Date()), 0).slice(0, 7);
  const months = [];
  (headers || []).forEach(function(header, index) {
    const dateText = sheetDateText_(header);
    const amount = Number((values || [])[index]);
    if (!dateText || dateText.slice(0, 7) < currentMonth || !isFinite(amount)) return;
    months.push({month:personalMonthStartText_(dateText, 0),amount:roundMoney_(amount)});
  });
  return {currency:"Dolares",months:months.slice(0, Number(monthCount) || 12)};
}

function validatePersonalOcaEntry_(input) {
  const entry = {
    mode:cleanText_(input && input.mode, 20),
    date:cleanText_(input && input.date, 10),
    description:cleanText_(input && input.description, 300),
    amount:Number(input && input.amount),
    installments:Number(input && input.installments) || 0
  };
  if (["installments", "subscription"].indexOf(entry.mode) === -1) throw new Error("Tipo de registro OCA inválido.");
  parseDateParts_(entry.date);
  if (!entry.description) throw new Error("Falta la descripción de OCA.");
  if (!isFinite(entry.amount) || entry.amount <= 0 || entry.amount > 100000000) throw new Error("Importe OCA inválido.");
  if (entry.mode === "installments") {
    if (!Number.isInteger(entry.installments) || entry.installments < 1 || entry.installments > 36) throw new Error("Las cuotas deben estar entre 1 y 36.");
  } else {
    entry.installments = 0;
  }
  entry.installmentAmount = roundMoney_(entry.mode === "installments" ? entry.amount / entry.installments : entry.amount);
  return entry;
}

function appendPersonalOcaEntry_(input) {
  const entry = validatePersonalOcaEntry_(input);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.FINANCES_SPREADSHEET_ID);
    const sheet = getPersonalOcaSheet_(spreadsheet);
    const rowCount = CONFIG.PERSONAL_OCA_END_ROW - CONFIG.PERSONAL_OCA_WRITE_START_ROW + 1;
    const rows = sheet.getRange(CONFIG.PERSONAL_OCA_WRITE_START_ROW, 2, rowCount, 6).getValues();
    const emptyIndex = rows.findIndex(function(row) {
      return !cleanText_(row[1], 300) && (row[5] === "" || row[5] === null);
    });
    if (emptyIndex < 0) throw new Error("No quedan filas libres dentro de OCA!B6:G32.");
    const rowNumber = CONFIG.PERSONAL_OCA_WRITE_START_ROW + emptyIndex;
    const date = Utilities.parseDate(entry.date, "America/Montevideo", "yyyy-MM-dd");
    const isSubscription = entry.mode === "subscription";
    sheet.getRange(rowNumber, 2, 1, 6).setValues([[
      date,
      entry.description,
      isSubscription ? "SUSCRIPCION" : "",
      isSubscription ? "" : 1,
      isSubscription ? "" : entry.installments,
      entry.installmentAmount
    ]]);
    sheet.getRange(rowNumber, 2).setNumberFormat("yyyy-mm-dd");
    sheet.getRange(rowNumber, 7).setNumberFormat("0.00");
    const formulas = [];
    for (let offset = 0; offset < CONFIG.PERSONAL_FORECAST_MONTHS; offset += 1) {
      formulas.push(isSubscription
        ? "=$G$" + rowNumber
        : "=IF(COLUMN()-COLUMN($K$1)<=$F$" + rowNumber + "-$E$" + rowNumber + ";$G$" + rowNumber + ";0)");
    }
    sheet.getRange(rowNumber, 11, 1, CONFIG.PERSONAL_FORECAST_MONTHS).setFormulas([formulas]);
    SpreadsheetApp.flush();
    return {row:rowNumber,range:"B" + rowNumber + ":G" + rowNumber,mode:entry.mode,installmentAmount:entry.installmentAmount};
  } finally {
    lock.releaseLock();
  }
}

function getPersonalOcaSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheets().find(function(candidate) {
    return candidate.getSheetId() === CONFIG.FINANCES_OCA_SHEET_GID;
  });
  if (!sheet) throw new Error("No se encontró la pestaña OCA de Finanzas.");
  return sheet;
}

function personalMonthSheetName_(date) {
  const names = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  const month = Number(Utilities.formatDate(date || new Date(), "America/Montevideo", "M"));
  return names[month - 1];
}

function personalMonthStartText_(dateText, offset) {
  const parts = parseDateParts_(dateText);
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + Number(offset || 0), 1));
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-01";
}

function roundMoney_(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getOcaStatus_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.OCA_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheets().find(function(candidate) {
    return candidate.getSheetId() === CONFIG.OCA_SHEET_GID;
  });
  if (!sheet) throw new Error("No se encontró la pestaña OCA.");

  const summary = summarizeOcaRows_(sheet.getRange(CONFIG.OCA_RANGE).getValues(), getOcaPeriod_());
  summary.updatedAt = new Date().toISOString();
  return summary;
}

function summarizeOcaRows_(rows, period) {
  const purchases = [];
  const basePeriod = period || getOcaPeriod_();

  rows.forEach(function(row) {
    const name = cleanText_(row[0], 120);
    const currentInstallment = Number(row[2]);
    const totalInstallments = Number(row[3]);
    const installmentAmount = Number(row[4]);
    if (!name || !Number.isInteger(currentInstallment) || !Number.isInteger(totalInstallments) ||
        currentInstallment < 1 || totalInstallments < currentInstallment ||
        !isFinite(installmentAmount) || installmentAmount <= 0) return;

    const installmentsAfterCurrent = totalInstallments - currentInstallment;
    const installmentsIncludingCurrent = installmentsAfterCurrent + 1;
    purchases.push({
      name:name,
      currentInstallment:currentInstallment,
      totalInstallments:totalInstallments,
      installmentsAfterCurrent:installmentsAfterCurrent,
      installmentsIncludingCurrent:installmentsIncludingCurrent,
      installmentAmount:Math.round(installmentAmount * 100) / 100,
      outstandingAfterCurrent:Math.round(installmentsAfterCurrent * installmentAmount * 100) / 100,
      outstandingTotal:Math.round(installmentsIncludingCurrent * installmentAmount * 100) / 100
    });
  });

  const thisMonthPayment = purchases.reduce(function(sum, purchase) {
    return sum + purchase.installmentAmount;
  }, 0);
  const outstandingAfterCurrent = purchases.reduce(function(sum, purchase) {
    return sum + purchase.outstandingAfterCurrent;
  }, 0);
  const outstandingTotal = purchases.reduce(function(sum, purchase) {
    return sum + purchase.outstandingTotal;
  }, 0);
  const installmentsAfterCurrent = purchases.reduce(function(sum, purchase) {
    return sum + purchase.installmentsAfterCurrent;
  }, 0);

  const forecast = [];
  for (let offset = 1; offset <= 6; offset += 1) {
    const forecastPeriod = addMonthsToPeriod_(basePeriod, offset);
    const amount = purchases.reduce(function(sum, purchase) {
      return sum + (purchase.currentInstallment + offset <= purchase.totalInstallments ? purchase.installmentAmount : 0);
    }, 0);
    forecast.push({
      period:forecastPeriod,
      label:periodLabel_(forecastPeriod),
      amount:Math.round(amount * 100) / 100
    });
  }

  return {
    currentPeriod:basePeriod,
    currentPeriodLabel:periodLabel_(basePeriod),
    thisMonthPayment:Math.round(thisMonthPayment * 100) / 100,
    nextMonthPayment:forecast.length ? forecast[0].amount : 0,
    outstandingAfterCurrent:Math.round(outstandingAfterCurrent * 100) / 100,
    outstandingTotal:Math.round(outstandingTotal * 100) / 100,
    installmentsAfterCurrent:installmentsAfterCurrent,
    activePurchases:purchases.length,
    purchases:purchases,
    forecast:forecast
  };
}

function getOcaPeriod_() {
  const todayPeriod = Utilities.formatDate(new Date(), "America/Montevideo", "yyyy-MM");
  const firstPeriod = CONFIG.START_DATE.slice(0, 7);
  return todayPeriod < firstPeriod ? firstPeriod : todayPeriod;
}

function addMonthsToPeriod_(period, offset) {
  const match = String(period || "").match(/^(20\d{2})-(\d{2})$/);
  if (!match) throw new Error("Período OCA inválido.");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0");
}

function periodLabel_(period) {
  const match = String(period || "").match(/^(20\d{2})-(\d{2})$/);
  if (!match) return "";
  const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return names[Number(match[2]) - 1] + " " + match[1];
}

function getAvailableBalances_() {
  const currentPeriod = Utilities.formatDate(new Date(), "America/Montevideo", "yyyy-MM");
  const summary = summarizeBalanceRows_(readFamilyMovementRows_(), currentPeriod);
  summary.updatedAt = new Date().toISOString();
  return summary;
}

function readFamilyMovementRows_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const rows = [];

  spreadsheet.getSheets().forEach(function(sheet) {
    if (sheet.getSheetId() === CONFIG.CONFIG_SHEET_GID || sheet.getName() === CONFIG.TEMPLATE_SHEET_NAME) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.DATA_START_ROW) return;
    const height = lastRow - CONFIG.DATA_START_ROW + 1;
    sheet.getRange(CONFIG.DATA_START_ROW, 1, height, 5).getValues().forEach(function(row) {
      rows.push(row);
    });
  });

  return rows;
}

function getCategorySummary_(requestedPeriod) {
  const summary = summarizeCategoryRows_(readFamilyMovementRows_(), requestedPeriod);
  summary.updatedAt = new Date().toISOString();
  return summary;
}

function summarizeCategoryRows_(rows, requestedPeriod) {
  const byPeriod = {};

  rows.forEach(function(row) {
    const date = sheetDateText_(row[0]);
    const type = cleanText_(row[1], 16);
    const amount = Number(row[2]);
    if (!date || date < CONFIG.START_DATE || type !== "Egreso" || !isFinite(amount) || amount <= 0) return;

    const period = date.slice(0, 7);
    const category = cleanText_(row[3], 80) || "Sin categoría";
    if (!byPeriod[period]) byPeriod[period] = {total:0,movements:0,categories:{}};
    if (!byPeriod[period].categories[category]) byPeriod[period].categories[category] = {amount:0,movements:0};
    byPeriod[period].total += amount;
    byPeriod[period].movements += 1;
    byPeriod[period].categories[category].amount += amount;
    byPeriod[period].categories[category].movements += 1;
  });

  const availablePeriodKeys = Object.keys(byPeriod).sort().reverse();
  const currentPeriod = Utilities.formatDate(new Date(), "America/Montevideo", "yyyy-MM");
  const cleanRequested = /^20\d{2}-(0[1-9]|1[0-2])$/.test(String(requestedPeriod || "")) ? String(requestedPeriod) : "";
  const period = cleanRequested || (byPeriod[currentPeriod] ? currentPeriod : availablePeriodKeys[0] || currentPeriod);
  const selected = byPeriod[period] || {total:0,movements:0,categories:{}};
  const roundedTotal = Math.round(selected.total * 100) / 100;
  const categories = Object.keys(selected.categories)
    .map(function(category) {
      const item = selected.categories[category];
      const roundedAmount = Math.round(item.amount * 100) / 100;
      return {
        category:category,
        amount:roundedAmount,
        percentage:roundedTotal > 0 ? Math.round((roundedAmount / roundedTotal) * 1000) / 10 : 0,
        movements:item.movements
      };
    })
    .sort(function(a, b) { return b.amount - a.amount || a.category.localeCompare(b.category); });

  return {
    period:period,
    periodLabel:periodLabel_(period),
    total:roundedTotal,
    movements:selected.movements,
    categories:categories,
    availablePeriods:availablePeriodKeys.map(function(value) { return {period:value,label:periodLabel_(value)}; })
  };
}

function summarizeBalanceRows_(rows, period) {
  const preferredOrder = ["Efectivo", "MiDinero", "Prex", "Mercado Pago", "OCA Blue"];
  const amounts = {};
  preferredOrder.forEach(function(account) { amounts[account] = 0; });
  let movements = 0;
  const cleanPeriod = /^20\d{2}-(0[1-9]|1[0-2])$/.test(String(period || "")) ? String(period) : "";

  rows.forEach(function(row) {
    const date = sheetDateText_(row[0]);
    const type = cleanText_(row[1], 16);
    const amount = Number(row[2]);
    if (!date || date < CONFIG.START_DATE || ["Ingreso", "Egreso"].indexOf(type) === -1 || !isFinite(amount) || amount <= 0) return;
    if (cleanPeriod && date.slice(0, 7) !== cleanPeriod) return;

    const account = cleanText_(row[4], 80) || "Efectivo";
    if (!Object.prototype.hasOwnProperty.call(amounts, account)) amounts[account] = 0;
    amounts[account] += type === "Ingreso" ? amount : -amount;
    movements += 1;
  });

  const accounts = Object.keys(amounts)
    .sort(function(a, b) {
      const aIndex = preferredOrder.indexOf(a);
      const bIndex = preferredOrder.indexOf(b);
      if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex);
      return a.localeCompare(b);
    })
    .filter(function(account) {
      return account === "Efectivo" || account === "MiDinero" || Math.abs(amounts[account]) > 0.0001;
    })
    .map(function(account) {
      return {account:account,amount:Math.round(amounts[account] * 100) / 100};
    });

  const total = accounts.reduce(function(sum, item) { return sum + item.amount; }, 0);
  return {total:Math.round(total * 100) / 100,accounts:accounts,movements:movements};
}

function sheetDateText_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "America/Montevideo", "yyyy-MM-dd");
  }
  const text = cleanText_(value, 10);
  if (/^20\d{2}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})$/);
  if (!match) return "";
  return match[3] + "-" + String(match[2]).padStart(2, "0") + "-" + String(match[1]).padStart(2, "0");
}

function validateSubmissionId_(value) {
  const submissionId = cleanText_(value, 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(submissionId)) {
    throw new Error("El identificador del movimiento no es válido. Actualizá la aplicación y volvé a intentar.");
  }
  return submissionId;
}

function expenseFingerprint_(expense) {
  return JSON.stringify([
    expense.date,
    expense.type,
    expense.amount,
    expense.category,
    expense.account,
    expense.description
  ]);
}

function readRecentExpenseSubmissionIds_(properties) {
  try {
    const value = JSON.parse(properties.getProperty("RECENT_EXPENSE_SUBMISSION_IDS") || "[]");
    return Array.isArray(value) ? value.filter(function(id) { return typeof id === "string" && id !== ""; }) : [];
  } catch (error) {
    return [];
  }
}

function rememberExpenseSubmission_(properties, submissionId, saved) {
  properties.setProperty("EXPENSE_SUBMISSION_" + submissionId, JSON.stringify(saved));
  const recentIds = readRecentExpenseSubmissionIds_(properties).filter(function(id) { return id !== submissionId; });
  recentIds.unshift(submissionId);
  recentIds.slice(100).forEach(function(id) {
    properties.deleteProperty("EXPENSE_SUBMISSION_" + id);
  });
  properties.setProperty("RECENT_EXPENSE_SUBMISSION_IDS", JSON.stringify(recentIds.slice(0, 100)));
}

function appendExpense_(expense, submissionId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const propertyKey = "EXPENSE_SUBMISSION_" + submissionId;
    const fingerprint = expenseFingerprint_(expense);
    const previousText = properties.getProperty(propertyKey);
    const previous = previousText ? JSON.parse(previousText) : null;
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new Error("El identificador ya fue usado para otro movimiento.");
      }
      return {row:previous.row,sheet:previous.sheet,duplicate:true};
    }

    // v14 guardó los correos sin ID bajo la clave "undefined". Si coincide con
    // este movimiento, se adopta la fila ya escrita para no volver a insertarla.
    const legacyText = properties.getProperty("EXPENSE_SUBMISSION_undefined");
    const legacy = legacyText ? JSON.parse(legacyText) : null;
    if (legacy && legacy.fingerprint === fingerprint) {
      rememberExpenseSubmission_(properties, submissionId, legacy);
      properties.deleteProperty("EXPENSE_SUBMISSION_undefined");
      return {row:legacy.row,sheet:legacy.sheet,duplicate:true};
    }

    const sheet = getTargetSheet_(expense.date);
    const row = findFirstBlankRow_(sheet);
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 50);

    const target = sheet.getRange(row, 1, 1, CONFIG.WIDTH);
    const sourceRow = Math.max(CONFIG.DATA_START_ROW, row - 1);
    const source = sheet.getRange(sourceRow, 1, 1, CONFIG.WIDTH);
    source.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    target.setDataValidations(source.getDataValidations());

    const date = Utilities.parseDate(expense.date, "America/Montevideo", "yyyy-MM-dd");
    target.setValues([[
      date,
      expense.type,
      expense.amount,
      expense.category,
      expense.account,
      expense.description
    ]]);
    target.getCell(1, 1).setNumberFormat("dd/mm/yyyy");
    SpreadsheetApp.flush();
    const saved = {fingerprint:fingerprint,row:row,sheet:sheet.getName(),savedAt:Date.now()};
    rememberExpenseSubmission_(properties, submissionId, saved);
    return {row:row,sheet:sheet.getName(),duplicate:false};
  } finally {
    lock.releaseLock();
  }
}

function getTargetSheet_(dateText) {
  const parts = parseDateParts_(dateText);
  if (parts.year === 2026 && parts.month === 9) {
    return getSheetByGid_(CONFIG.SHEET_GID, "GASTOS");
  }

  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheetName = monthlySheetName_(dateText);
  const existing = spreadsheet.getSheetByName(sheetName);
  if (existing) return existing;
  return createMonthlySheet_(spreadsheet, dateText);
}

function createMonthlySheet_(spreadsheet, dateText) {
  const sheetName = monthlySheetName_(dateText);
  const existing = spreadsheet.getSheetByName(sheetName);
  if (existing) return existing;

  const template = getOrCreateTemplate_(spreadsheet);

  const sheet = template.copyTo(spreadsheet).setName(sheetName);
  sheet.showSheet();
  sheet.getRange(1, 1).setValue(monthlyHeader_(dateText));
  const dataRows = sheet.getMaxRows() - CONFIG.DATA_START_ROW + 1;
  if (dataRows > 0) sheet.getRange(CONFIG.DATA_START_ROW, 1, dataRows, CONFIG.WIDTH).clearContent();
  return sheet;
}

function getOrCreateTemplate_(spreadsheet) {
  const existing = spreadsheet.getSheetByName(CONFIG.TEMPLATE_SHEET_NAME);
  if (existing) return existing;

  const source = spreadsheet.getSheets().find(function(candidate) {
    return candidate.getSheetId() === CONFIG.SHEET_GID;
  });
  if (!source) throw new Error("No se encontró la pestaña base GASTOS.");

  const template = source.copyTo(spreadsheet).setName(CONFIG.TEMPLATE_SHEET_NAME);
  template.getRange(1, 1).setValue("MES");
  const dataRows = template.getMaxRows() - CONFIG.DATA_START_ROW + 1;
  if (dataRows > 0) template.getRange(CONFIG.DATA_START_ROW, 1, dataRows, CONFIG.WIDTH).clearContent();
  template.hideSheet();
  return template;
}

function monthlySheetName_(dateText) {
  const parts = parseDateParts_(dateText);
  const names = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  return names[parts.month - 1] + " " + parts.year;
}

function monthlyHeader_(dateText) {
  const parts = parseDateParts_(dateText);
  const names = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
  return names[parts.month - 1] + " " + parts.year;
}

function parseDateParts_(dateText) {
  const match = String(dateText || "").match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("Fecha inválida para seleccionar la pestaña mensual.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || day < 1 || day > 31 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Fecha inválida para seleccionar la pestaña mensual.");
  }
  return {year:year,month:month,day:day};
}

function getSheetByGid_(sheetGid, label) {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = spreadsheet.getSheets().find(function(candidate) {
    return candidate.getSheetId() === sheetGid;
  });
  if (!sheet) throw new Error("No se encontró la pestaña " + label + ".");
  return sheet;
}

function findFirstBlankRow_(sheet) {
  const available = sheet.getMaxRows() - CONFIG.DATA_START_ROW + 1;
  const values = sheet.getRange(CONFIG.DATA_START_ROW, 1, available, CONFIG.WIDTH).getDisplayValues();
  const emptyIndex = values.findIndex(function(row) {
    return row.every(function(value) { return value === ""; });
  });
  return emptyIndex === -1 ? sheet.getMaxRows() + 1 : CONFIG.DATA_START_ROW + emptyIndex;
}

function validateExpense_(input) {
  const expense = {
    date: cleanText_(input.date, 10),
    type: cleanText_(input.type, 16),
    amount: Number(input.amount),
    category: cleanText_(input.category, 80),
    account: cleanText_(input.account, 80) || "Efectivo",
    description: cleanText_(input.description, 300)
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expense.date)) throw new Error("Fecha inválida.");
  if (["Ingreso", "Egreso"].indexOf(expense.type) === -1) throw new Error("Tipo inválido.");
  if (!isFinite(expense.amount) || expense.amount <= 0) throw new Error("Importe inválido.");
  if (!expense.category) throw new Error("Falta la categoría.");
  return expense;
}

function validateSecret_(received) {
  const expected = PropertiesService.getScriptProperties().getProperty("WEBHOOK_SECRET") || "";
  if (expected && received !== expected) throw new Error("Solicitud no autorizada.");
}

function cleanText_(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function processExpenseEmails() {
  const rules = loadConfigRules_();
  const processedLabel = getOrCreateLabel_(CONFIG.PROCESSED_LABEL);
  const errorLabel = getOrCreateLabel_(CONFIG.ERROR_LABEL);
  const baseQuery = getEmailQuery_() + " after:2026/08/31";
  const threadById = {};
  GmailApp.search(baseQuery + " -label:" + CONFIG.PROCESSED_LABEL, 0, 50)
    .concat(GmailApp.search(baseQuery + " label:" + CONFIG.ERROR_LABEL, 0, 50))
    .forEach(function(thread) {
      threadById[thread.getId()] = thread;
    });
  const threads = Object.keys(threadById).map(function(threadId) { return threadById[threadId]; });

  threads.forEach(function(thread) {
    let failed = false;
    thread.getMessages().forEach(function(message) {
      if (isProcessedEmail_(message.getId())) return;
      try {
        const result = parseTransactionEmail_({
          id:message.getId(),
          from:message.getFrom(),
          subject:message.getSubject(),
          body:message.getPlainBody(),
          receivedAt:message.getDate()
        }, rules);
        result.expenses.forEach(function(expense, expenseIndex) {
          if (expense.date >= CONFIG.START_DATE) {
            appendExpense_(expense, emailSubmissionId_(message.getId(), expenseIndex));
          }
        });
        markEmailProcessed_(message.getId());
      } catch (error) {
        failed = true;
        console.error("No se pudo procesar el correo " + message.getId() + ": " + error.message);
      }
    });
    if (failed) {
      thread.addLabel(errorLabel);
      thread.removeLabel(processedLabel);
    } else {
      thread.addLabel(processedLabel);
      thread.removeLabel(errorLabel);
    }
  });
}

function emailSubmissionId_(messageId, expenseIndex) {
  const safeMessageId = cleanText_(messageId, 80).replace(/[^a-zA-Z0-9_-]/g, "_");
  return "mail_" + safeMessageId + "_" + Number(expenseIndex || 0);
}

function previewExpenseEmails() {
  return previewExpenseEmailsForQuery_(getEmailQuery_() + " newer_than:30d", 10);
}

function previewAugust2026Emails() {
  return previewExpenseEmailsForQuery_(getEmailQuery_() + " after:2026/07/31 before:2026/09/01", 100);
}

function previewExpenseEmailsForQuery_(query, limit) {
  const rules = loadConfigRules_();
  const threads = GmailApp.search(query, 0, limit);
  const previews = [];

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(message) {
      try {
        const result = parseTransactionEmail_({
          id:message.getId(),
          from:message.getFrom(),
          subject:message.getSubject(),
          body:message.getPlainBody(),
          receivedAt:message.getDate()
        }, rules);
        previews.push({
          messageId:message.getId(),
          subject:message.getSubject(),
          status:result.status,
          reason:result.reason || "",
          expenses:result.expenses
        });
      } catch (error) {
        previews.push({
          messageId:message.getId(),
          subject:message.getSubject(),
          error:error.message
        });
      }
    });
  });

  console.log(JSON.stringify(previews, null, 2));
  return previews;
}

function getEmailQuery_() {
  const configured = PropertiesService.getScriptProperties().getProperty("GMAIL_QUERY") || CONFIG.EMAIL_QUERY;
  if (!/from:noreply@midinero\.com\.uy/i.test(configured) || !/from:noreply@redpagos\.com\.uy/i.test(configured)) {
    throw new Error("GMAIL_QUERY debe limitarse a los remitentes de MiDinero y Redpagos.");
  }
  return configured;
}

function parseTransactionEmail_(email, rules) {
  const sender = extractEmailAddress_(email.from);
  if (sender === "noreply@midinero.com.uy") return parseMidineroEmail_(email, rules || []);
  if (sender === "noreply@redpagos.com.uy") return parseRedpagosEmail_(email, rules || []);
  throw new Error("El remitente no está autorizado.");
}

function parseMidineroEmail_(email, rules) {
  const subject = cleanText_(email.subject, 300);
  const text = cleanText_(subject + "\n" + (email.body || ""), 20000);
  const normalizedSubject = normalizeText_(subject);

  if (/TRANSFERENCIA HA SIDO (ENVIADA|RECHAZADA)/.test(normalizedSubject)) {
    return ignoredEmail_("Transferencia no definitiva.");
  }

  let type = "";
  if (normalizedSubject.indexOf("AVISO CONSUMO POR") >= 0) {
    type = "Egreso";
    if (/\bMIREDPAGOS\b/.test(normalizeText_(text))) {
      return ignoredEmail_("Cargo agregado de Redpagos; se usa el detalle del correo confirmado.");
    }
  } else if (normalizedSubject.indexOf("AVISO RECARGA POR") >= 0) {
    type = "Ingreso";
  } else if (normalizedSubject.indexOf("TRANSFERENCIA HA SIDO ACREDITADA") >= 0) {
    type = "Egreso";
  } else {
    throw new Error("Formato de correo MiDinero no reconocido.");
  }

  const amount = extractAmount_(text);
  if (!amount) throw new Error("No se encontró un importe.");
  const rule = findConfigRule_(email.from, text, amount, type, rules);
  if (!rule) {
    if (type === "Ingreso" && isBelowConfiguredMinimum_(email.from, text, amount, type, rules)) {
      return ignoredEmail_("Ingreso inferior al monto mínimo configurado.");
    }
    throw new Error("No hay una regla aplicable en CONFIG para este correo.");
  }

  return readyEmail_([buildExpense_(rule, amount, extractDate_(text, email.receivedAt))]);
}

function parseRedpagosEmail_(email, rules) {
  const subject = cleanText_(email.subject, 300);
  const normalizedSubject = normalizeText_(subject);
  if (normalizedSubject.indexOf("CONFIRMADO TODOS TUS PAGOS FUERON PROCESADOS") !== 0) {
    if (normalizedSubject.indexOf("ESTAMOS PROCESANDO TUS PAGOS") >= 0 || normalizedSubject.indexOf("AVISO") === 0) {
      return ignoredEmail_("Redpagos todavía no confirmó un pago.");
    }
    throw new Error("Formato de correo Redpagos no reconocido.");
  }

  const body = String(email.body || "");
  const date = extractDate_(body, email.receivedAt);
  const lines = body.split(/\r?\n/).map(function(line) {
    return cleanText_(line, 300);
  }).filter(function(line) { return line !== ""; });
  const normalizedLines = lines.map(normalizeText_);
  const start = normalizedLines.findIndex(function(line) { return line === "SERVICIOS"; });
  const end = normalizedLines.findIndex(function(line, index) {
    return index > start && line.indexOf("TOTAL PESOS") === 0;
  });
  if (start < 0 || end < 0) throw new Error("No se encontró el detalle de servicios de Redpagos.");

  const sender = extractEmailAddress_(email.from);
  const senderRules = rules.filter(function(rule) { return rule.sender === sender; });
  const expenses = [];

  for (let index = start + 1; index < end; index += 1) {
    const rule = senderRules
      .filter(function(candidate) {
        return normalizedLines[index].indexOf(candidate.normalizedSearchText) >= 0;
      })
      .sort(function(a, b) {
        return b.priority - a.priority || b.normalizedSearchText.length - a.normalizedSearchText.length;
      })[0];
    if (!rule) continue;

    let signedAmount = null;
    for (let amountIndex = index + 1; amountIndex < end; amountIndex += 1) {
      const nextRule = senderRules.some(function(candidate) {
        return normalizedLines[amountIndex].indexOf(candidate.normalizedSearchText) >= 0;
      });
      if (nextRule) break;
      signedAmount = extractStandaloneSignedAmount_(lines[amountIndex]);
      if (signedAmount !== null) break;
    }
    if (signedAmount === null) {
      throw new Error("No se encontró el importe para la regla de CONFIG, fila " + rule.rowNumber + ".");
    }
    expenses.push(buildExpense_(rule, Math.abs(signedAmount), date));
  }

  if (!expenses.length) throw new Error("No hay reglas aplicables al detalle confirmado de Redpagos.");
  return readyEmail_(expenses);
}

function readyEmail_(expenses) {
  return {status:"ready",expenses:expenses};
}

function ignoredEmail_(reason) {
  return {status:"ignored",reason:reason,expenses:[]};
}

function buildExpense_(rule, amount, date) {
  return {
    date:date,
    type:rule.type,
    amount:amount,
    category:rule.category,
    account:rule.account,
    description:cleanText_(rule.description || rule.searchText, 300),
    ruleRow:rule.rowNumber
  };
}

function loadConfigRules_() {
  const sheet = getSheetByGid_(CONFIG.CONFIG_SHEET_GID, "CONFIG");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("CONFIG no contiene reglas.");
  const values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

  const rules = values.map(function(row, index) {
    const rowNumber = index + 2;
    const active = row[0] === true || ["TRUE", "SI", "SÍ"].indexOf(normalizeText_(row[0])) >= 0;
    if (!active) return null;

    const priority = Number(row[1]);
    const minimumAmount = row[8] === "" || row[8] === null ? null : Number(row[8]);
    const rule = {
      rowNumber:rowNumber,
      priority:priority,
      sender:extractEmailAddress_(row[2]),
      searchText:cleanText_(row[3], 200),
      normalizedSearchText:normalizeText_(row[3]),
      type:cleanText_(row[4], 16),
      category:cleanText_(row[5], 80),
      account:cleanText_(row[6], 80),
      description:cleanText_(row[7], 300),
      minimumAmount:minimumAmount
    };

    if (!isFinite(priority)) throw new Error("Prioridad inválida en CONFIG, fila " + rowNumber + ".");
    if (minimumAmount !== null && (!isFinite(minimumAmount) || minimumAmount < 0)) {
      throw new Error("Monto mínimo inválido en CONFIG, fila " + rowNumber + ".");
    }
    if (!rule.sender || !rule.normalizedSearchText || !rule.category || !rule.account) {
      throw new Error("Faltan datos obligatorios en CONFIG, fila " + rowNumber + ".");
    }
    if (["Ingreso", "Egreso"].indexOf(rule.type) === -1) {
      throw new Error("Tipo inválido en CONFIG, fila " + rowNumber + ".");
    }
    return rule;
  }).filter(function(rule) { return rule !== null; });

  if (!rules.length) throw new Error("CONFIG no contiene reglas activas.");
  return rules;
}

function findConfigRule_(senderValue, text, amount, detectedType, rules) {
  const sender = extractEmailAddress_(senderValue);
  const normalizedText = normalizeText_(text);
  return rules
    .filter(function(rule) {
      return rule.sender === sender &&
        rule.type === detectedType &&
        normalizedText.indexOf(rule.normalizedSearchText) >= 0 &&
        (rule.minimumAmount === null || amount > rule.minimumAmount);
    })
    .sort(function(a, b) {
      return b.priority - a.priority || b.normalizedSearchText.length - a.normalizedSearchText.length;
    })[0];
}

function isBelowConfiguredMinimum_(senderValue, text, amount, detectedType, rules) {
  const sender = extractEmailAddress_(senderValue);
  const normalizedText = normalizeText_(text);
  return rules.some(function(rule) {
    return rule.sender === sender &&
      rule.type === detectedType &&
      rule.minimumAmount !== null &&
      normalizedText.indexOf(rule.normalizedSearchText) >= 0 &&
      amount <= rule.minimumAmount;
  });
}

function extractEmailAddress_(value) {
  const text = String(value || "").trim().toLowerCase();
  const bracketed = text.match(/<([^>]+)>/);
  if (bracketed) return bracketed[1].trim();
  const plain = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return plain ? plain[0] : "";
}

function extractAmount_(text) {
  const patterns = [
    /(?:importe|monto|total|compra por|consumo por|operaci[oó]n por)\s*:?\s*(?:UYU|USD|U\$S|US\$|\$U|\$)?\s*([\d.,]+)/i,
    /(?:UYU|USD|U\$S|US\$|\$U|\$)\s*([\d.,]+)/i
  ];
  for (let index = 0; index < patterns.length; index += 1) {
    const match = text.match(patterns[index]);
    if (match) return normalizeAmount_(match[1]);
  }
  return null;
}

function normalizeAmount_(raw) {
  let value = String(raw || "").replace(/\s/g, "");
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    value = lastComma > lastDot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  } else if (lastComma >= 0) {
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0 && value.length - lastDot - 1 === 3) {
    value = value.replace(/\./g, "");
  }
  const amount = Number(value);
  return isFinite(amount) && amount > 0 ? amount : null;
}

function extractStandaloneSignedAmount_(line) {
  const match = String(line || "").trim().match(/^(-?)\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/);
  if (!match) return null;
  const amount = Number(match[2].replace(/\./g, "") + "." + match[3]);
  return match[1] === "-" ? -amount : amount;
}

function extractDate_(text, fallback) {
  let match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (match) return match[3] + "-" + String(match[2]).padStart(2, "0") + "-" + String(match[1]).padStart(2, "0");
  match = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (match) return match[0];
  match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2})\b/);
  if (match) return "20" + match[3] + "-" + String(match[2]).padStart(2, "0") + "-" + String(match[1]).padStart(2, "0");
  return Utilities.formatDate(fallback || new Date(), "America/Montevideo", "yyyy-MM-dd");
}

function normalizeText_(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function isProcessedEmail_(messageId) {
  return PropertiesService.getScriptProperties().getProperty("MAIL_" + messageId) === "1";
}

function markEmailProcessed_(messageId) {
  PropertiesService.getScriptProperties().setProperty("MAIL_" + messageId, "1");
}

function installEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "processExpenseEmails") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("processExpenseEmails").timeBased().everyHours(1).create();
  getOrCreateLabel_(CONFIG.PROCESSED_LABEL);
  getOrCreateLabel_(CONFIG.ERROR_LABEL);
}
