const CONFIG = Object.freeze({
  VERSION: "2026-09-01-v12",
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
  PERSONAL_SPREADSHEET_ID: "1rPs2YmiHSdpB_m4XDHEz1LFcH1LbWU4TRIWf0InjvKs",
  PERSONAL_SHEET_NAME: "MOVIMIENTOS"
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
    if (payload.action === "oca") {
      return json_(Object.assign({ok:true,version:CONFIG.VERSION}, getOcaStatus_()));
    }
    if (payload.action === "personalSummary") {
      return json_(Object.assign({ok:true,version:CONFIG.VERSION}, getPersonalSummary_()));
    }
    if (payload.action === "personalImport") {
      return json_(Object.assign({ok:true,version:CONFIG.VERSION}, appendPersonalMovements_(payload.movements)));
    }
    const expense = validateExpense_(payload);
    const saved = appendExpense_(expense);
    return json_({ok:true,row:saved.row,sheet:saved.sheet,version:CONFIG.VERSION});
  } catch (error) {
    return json_({ok:false,error:error.message || "No se pudo guardar el movimiento."});
  }
}

function getPersonalSheet_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.PERSONAL_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(CONFIG.PERSONAL_SHEET_NAME);
  if (!sheet) throw new Error("No se encontró la pestaña MOVIMIENTOS de la planilla personal.");
  return sheet;
}

function appendPersonalMovements_(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    throw new Error("La importación debe contener entre 1 y 100 movimientos.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getPersonalSheet_();
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const existingFingerprints = {};
    if (lastRow >= 2) {
      sheet.getRange(2, 9, lastRow - 1, 1).getDisplayValues().forEach(function(row) {
        const value = cleanText_(row[0], 128);
        if (value) existingFingerprints[value] = true;
      });
    }

    const rows = [];
    const duplicates = [];
    input.forEach(function(raw, index) {
      const movement = validatePersonalMovement_(raw);
      const fingerprint = personalFingerprint_(movement);
      if (existingFingerprints[fingerprint] && !movement.allowDuplicate) {
        duplicates.push({index:index,fingerprint:fingerprint,description:movement.description});
        return;
      }

      const date = Utilities.parseDate(movement.date, "America/Montevideo", "yyyy-MM-dd");
      const firstInstallment = movement.firstInstallment
        ? Utilities.parseDate(movement.firstInstallment, "America/Montevideo", "yyyy-MM-dd")
        : "";
      rows.push([
        Utilities.getUuid(),
        date,
        movement.type,
        movement.currency,
        movement.amount,
        movement.category,
        movement.account,
        movement.description,
        fingerprint,
        new Date(),
        movement.installments || "",
        firstInstallment,
        movement.installmentAmount || ""
      ]);
      existingFingerprints[fingerprint] = true;
    });

    if (rows.length) {
      const startRow = Math.max(sheet.getLastRow() + 1, 2);
      sheet.getRange(startRow, 1, rows.length, 13).setValues(rows);
      sheet.getRange(startRow, 2, rows.length, 1).setNumberFormat("dd/mm/yyyy");
      sheet.getRange(startRow, 5, rows.length, 1).setNumberFormat("0.00");
      sheet.getRange(startRow, 10, rows.length, 1).setNumberFormat("dd/mm/yyyy hh:mm");
      sheet.getRange(startRow, 11, rows.length, 1).setNumberFormat("0");
      sheet.getRange(startRow, 12, rows.length, 1).setNumberFormat("dd/mm/yyyy");
      sheet.getRange(startRow, 13, rows.length, 1).setNumberFormat("0.00");
      SpreadsheetApp.flush();
    }

    return {inserted:rows.length,duplicates:duplicates};
  } finally {
    lock.releaseLock();
  }
}

function validatePersonalMovement_(input) {
  const allowedTypes = ["Ingreso", "Egreso"];
  const allowedCurrencies = ["Pesos", "Dolares", "Euros"];
  const allowedAccounts = ["Efectivo", "BROU", "OCA Blue", "Prex", "N26", "Paypal", "Revolut", "Fiverr", "Grow", "Deuda Mamá", "Mercado Pago", "OCA Crédito"];
  const allowedCategories = [
    "Mama", "Ahorro", "Prestamo", "Freelancer", "Ventas", "Otros (Dev IVA, Amigos, etc)",
    "Saldo Inicial", "Cambio de moneda", "Ahorros", "Prestamos", "OCA", "Comida", "Transporte",
    "Celular", "Gimnasio", "Ropa", "Suscripciones", "Educacion y eventos", "Viajes",
    "Entretenimietno y salidas", "Salud y estetica", "Compras", "Otros asuntos",
    "Comisiones bancarias", "Capex", "Ciudadania italiana", "Inversiones", "Pago Deuda Mamá",
    "Compras a crédito"
  ];
  const movement = {
    date:cleanText_(input && input.date, 10),
    type:cleanText_(input && input.type, 16),
    currency:cleanText_(input && input.currency, 16),
    amount:Number(input && input.amount),
    category:cleanText_(input && input.category, 80),
    account:cleanText_(input && input.account, 80),
    description:cleanText_(input && input.description, 300),
    installments:Number(input && input.installments) || 0,
    firstInstallment:cleanText_(input && input.firstInstallment, 10),
    installmentAmount:Number(input && input.installmentAmount) || 0,
    allowDuplicate:Boolean(input && input.allowDuplicate)
  };

  parseDateParts_(movement.date);
  if (allowedTypes.indexOf(movement.type) === -1) throw new Error("Tipo personal inválido.");
  if (allowedCurrencies.indexOf(movement.currency) === -1) throw new Error("Moneda personal inválida.");
  if (!isFinite(movement.amount) || movement.amount <= 0 || movement.amount > 100000000) throw new Error("Importe personal inválido.");
  if (allowedCategories.indexOf(movement.category) === -1) throw new Error("Categoría personal inválida: " + movement.category);
  if (allowedAccounts.indexOf(movement.account) === -1) throw new Error("Cuenta personal inválida: " + movement.account);
  if (movement.category === "Compras a crédito") {
    if (movement.type !== "Egreso" || movement.account !== "OCA Crédito") throw new Error("La compra a crédito debe registrarse como egreso de OCA Crédito.");
    if (!Number.isInteger(movement.installments) || movement.installments < 1 || movement.installments > 36) throw new Error("Cuotas inválidas.");
    parseDateParts_(movement.firstInstallment);
    movement.installmentAmount = roundMoney_(movement.amount / movement.installments);
  } else if (movement.category === "Suscripciones" && movement.account === "OCA Crédito") {
    if (movement.type !== "Egreso") throw new Error("La suscripción de OCA debe registrarse como egreso.");
    parseDateParts_(movement.firstInstallment);
    movement.installments = 0;
    movement.installmentAmount = roundMoney_(movement.amount);
  } else {
    movement.installments = 0;
    movement.firstInstallment = "";
    movement.installmentAmount = 0;
  }
  return movement;
}

function personalFingerprint_(movement) {
  const canonical = [
    movement.date,
    movement.type,
    movement.currency,
    movement.amount.toFixed(2),
    normalizeText_(movement.category),
    normalizeText_(movement.account),
    normalizeText_(movement.description),
    movement.installments || 0,
    movement.firstInstallment || "",
    Number(movement.installmentAmount || 0).toFixed(2)
  ].join("|");
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical)
    .map(function(byte) { return (byte + 256).toString(16).slice(-2); })
    .join("");
}

function getPersonalSummary_() {
  const sheet = getPersonalSheet_();
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 13).getValues() : [];
  const summary = summarizePersonalRows_(rows);
  summary.updatedAt = new Date().toISOString();
  return summary;
}

function summarizePersonalRows_(rows, today) {
  const currencies = {};
  const accounts = {};
  const recent = [];
  const currentMonth = personalMonthStartText_(sheetDateText_(today || new Date()), 0);
  const oca = {
    currency:"Pesos",
    outstanding:0,
    months:[1, 2, 3, 4, 5, 6].map(function(offset) {
      return {month:personalMonthStartText_(currentMonth, offset),amount:0};
    })
  };

  ["Pesos", "Dolares", "Euros"].forEach(function(currency) {
    currencies[currency] = {available:0,debt:0,net:0};
  });

  rows.forEach(function(row) {
    const date = sheetDateText_(row[1]);
    const type = cleanText_(row[2], 16);
    const currency = cleanText_(row[3], 16);
    const amount = Number(row[4]);
    const category = cleanText_(row[5], 80);
    const account = cleanText_(row[6], 80);
    if (!date || ["Ingreso", "Egreso"].indexOf(type) === -1 || !currencies[currency] || !isFinite(amount) || amount <= 0) return;

    const installments = Number(row[10]) || 0;
    const firstInstallment = sheetDateText_(row[11]);
    const installmentAmount = Number(row[12]) || (installments > 0 ? amount / installments : 0);
    const isCreditPurchase = category === "Compras a crédito" && account === "OCA Crédito";
    const isCreditSubscription = category === "Suscripciones" && account === "OCA Crédito";

    if (isCreditPurchase) {
      if (currency === "Pesos" && installments > 0 && firstInstallment && isFinite(installmentAmount)) {
        const elapsed = personalMonthDifference_(firstInstallment, currentMonth);
        const remaining = elapsed < 0 ? installments : Math.max(0, installments - elapsed);
        oca.outstanding += remaining * installmentAmount;
        oca.months.forEach(function(item) {
          const index = personalMonthDifference_(firstInstallment, item.month);
          if (index >= 0 && index < installments) item.amount += installmentAmount;
        });
      }
    } else if (isCreditSubscription) {
      if (currency === "Pesos" && firstInstallment && isFinite(installmentAmount) && installmentAmount > 0) {
        oca.months.forEach(function(item) {
          if (personalMonthDifference_(firstInstallment, item.month) >= 0) item.amount += installmentAmount;
        });
      }
    } else if (account === "Deuda Mamá") {
      currencies[currency].debt += type === "Egreso" ? amount : -amount;
    } else {
      const key = currency + "|" + account;
      if (!accounts[key]) accounts[key] = {currency:currency,account:account,amount:0};
      accounts[key].amount += type === "Ingreso" ? amount : -amount;
      currencies[currency].available += type === "Ingreso" ? amount : -amount;
    }
    if (category === "Pago Deuda Mamá" && account !== "Deuda Mamá" && type === "Egreso") {
      currencies[currency].debt -= amount;
    }

    recent.push({
      id:cleanText_(row[0], 80),date:date,type:type,currency:currency,amount:amount,
      category:category,account:account,description:cleanText_(row[7], 300),
      installments:installments,firstInstallment:firstInstallment,installmentAmount:roundMoney_(installmentAmount)
    });
  });

  Object.keys(currencies).forEach(function(currency) {
    currencies[currency].available = roundMoney_(currencies[currency].available);
    currencies[currency].debt = roundMoney_(Math.max(0, currencies[currency].debt));
    currencies[currency].net = roundMoney_(currencies[currency].available - currencies[currency].debt);
  });

  const accountList = Object.keys(accounts).map(function(key) {
    return {currency:accounts[key].currency,account:accounts[key].account,amount:roundMoney_(accounts[key].amount)};
  }).sort(function(a, b) {
    return a.currency.localeCompare(b.currency) || a.account.localeCompare(b.account);
  });

  oca.outstanding = roundMoney_(oca.outstanding);
  oca.months.forEach(function(item) { item.amount = roundMoney_(item.amount); });

  return {
    currencies:currencies,
    accounts:accountList,
    oca:oca,
    recent:recent.slice(-10).reverse(),
    movements:recent.length
  };
}

function personalMonthStartText_(dateText, offset) {
  const parts = parseDateParts_(dateText);
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + Number(offset || 0), 1));
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-01";
}

function personalMonthDifference_(fromText, toText) {
  const from = parseDateParts_(fromText);
  const to = parseDateParts_(toText);
  return (to.year - from.year) * 12 + to.month - from.month;
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

  const summary = summarizeBalanceRows_(rows);
  summary.updatedAt = new Date().toISOString();
  return summary;
}

function summarizeBalanceRows_(rows) {
  const preferredOrder = ["Efectivo", "MiDinero", "Prex", "Mercado Pago"];
  const amounts = {};
  preferredOrder.forEach(function(account) { amounts[account] = 0; });
  let movements = 0;

  rows.forEach(function(row) {
    const date = sheetDateText_(row[0]);
    const type = cleanText_(row[1], 16);
    const amount = Number(row[2]);
    if (!date || date < CONFIG.START_DATE || ["Ingreso", "Egreso"].indexOf(type) === -1 || !isFinite(amount) || amount <= 0) return;

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

function appendExpense_(expense) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
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
    return {row:row,sheet:sheet.getName()};
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
    account: cleanText_(input.account, 80),
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
  const query = getEmailQuery_() + " after:2026/08/31 -label:" + CONFIG.PROCESSED_LABEL;
  const threads = GmailApp.search(query, 0, 50);

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
        result.expenses.forEach(function(expense) {
          if (expense.date >= CONFIG.START_DATE) appendExpense_(expense);
        });
        markEmailProcessed_(message.getId());
      } catch (error) {
        failed = true;
        console.error("No se pudo procesar el correo " + message.getId() + ": " + error.message);
      }
    });
    if (failed) {
      thread.addLabel(errorLabel);
    } else {
      thread.addLabel(processedLabel);
      thread.removeLabel(errorLabel);
    }
  });
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
