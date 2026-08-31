const CONFIG = Object.freeze({
  VERSION: "2026-08-31-v3",
  SPREADSHEET_ID: "1QfWNrNWRQsFpWZNnYiItdRDop_d5Hw9CgoNC1s7wMxE",
  SHEET_GID: 1406094759,
  HEADER_ROW: 2,
  DATA_START_ROW: 3,
  WIDTH: 6,
  EMAIL_QUERY: "{from:noreply@midinero.com.uy from:noreply@redpagos.com.uy}",
  PROCESSED_LABEL: "finanzas-procesado",
  ERROR_LABEL: "finanzas-error"
});

function doGet() {
  return json_({
    ok:true,
    service:"gastos-familiares",
    version:CONFIG.VERSION,
    spreadsheetId:CONFIG.SPREADSHEET_ID,
    sheetGid:CONFIG.SHEET_GID
  });
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
    validateSecret_(payload.secret);
    const expense = validateExpense_(payload);
    const row = appendExpense_(expense);
    return json_({ok:true,row:row,version:CONFIG.VERSION});
  } catch (error) {
    return json_({ok:false,error:error.message || "No se pudo guardar el movimiento."});
  }
}

function appendExpense_(expense) {
  const sheet = getTargetSheet_();
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
  return row;
}

function getTargetSheet_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = spreadsheet.getSheets().find(function(candidate) {
    return candidate.getSheetId() === CONFIG.SHEET_GID;
  });
  if (!sheet) throw new Error("No se encontró la pestaña configurada.");
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
  const processedLabel = getOrCreateLabel_(CONFIG.PROCESSED_LABEL);
  const errorLabel = getOrCreateLabel_(CONFIG.ERROR_LABEL);
  const query = getEmailQuery_() + " newer_than:30d -label:" + CONFIG.PROCESSED_LABEL + " -label:" + CONFIG.ERROR_LABEL;
  const threads = GmailApp.search(query, 0, 50);

  threads.forEach(function(thread) {
    let failed = false;
    thread.getMessages().forEach(function(message) {
      if (isProcessedEmail_(message.getId())) return;
      try {
        const expense = parseTransactionEmail_({
          id:message.getId(),
          from:message.getFrom(),
          subject:message.getSubject(),
          body:message.getPlainBody(),
          receivedAt:message.getDate()
        });
        appendExpense_(expense);
        markEmailProcessed_(message.getId());
      } catch (error) {
        failed = true;
        console.error("No se pudo procesar el correo " + message.getId() + ": " + error.message);
      }
    });
    thread.addLabel(failed ? errorLabel : processedLabel);
  });
}

function previewExpenseEmails() {
  const threads = GmailApp.search(getEmailQuery_() + " newer_than:30d", 0, 10);
  const previews = [];

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(message) {
      try {
        const expense = parseTransactionEmail_({
          id:message.getId(),
          from:message.getFrom(),
          subject:message.getSubject(),
          body:message.getPlainBody(),
          receivedAt:message.getDate()
        });
        previews.push({
          messageId:message.getId(),
          subject:message.getSubject(),
          expense:expense
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

function parseTransactionEmail_(email) {
  const text = cleanText_((email.subject || "") + "\n" + (email.body || ""), 20000);
  const amount = extractAmount_(text);
  if (!amount) throw new Error("No se encontró un importe.");

  const type = /\b(acreditaci[oó]n|acreditado|recibiste|ingreso|devoluci[oó]n|transferencia recibida)\b/i.test(text) ? "Ingreso" : "Egreso";
  const merchant = extractMerchant_(text) || cleanText_(email.subject, 100) || "Movimiento por correo";
  const account = detectAccount_(text);
  const category = categorize_(merchant + " " + text);
  const date = extractDate_(text, email.receivedAt);
  const sender = cleanText_(email.from, 70);

  return {
    date:date,
    type:type,
    amount:amount,
    category:category,
    account:account,
    description:cleanText_(merchant + " · correo " + sender, 300)
  };
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

function detectAccount_(text) {
  if (/mercado\s*pago/i.test(text)) return "Mercado Pago";
  if (/\bprex\b/i.test(text)) return "Prex";
  if (/\boca\b/i.test(text)) return "OCA";
  if (/mi\s*dinero|midinero/i.test(text)) return "MiDinero";
  return PropertiesService.getScriptProperties().getProperty("EMAIL_DEFAULT_ACCOUNT") || "MiDinero";
}

function extractMerchant_(text) {
  const match = text.match(/(?:comercio|establecimiento|local|concepto|detalle)\s*:?\s*([^\n\r]{2,100})/i);
  return match ? cleanText_(match[1], 100) : "";
}

function extractDate_(text, fallback) {
  let match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (match) return match[3] + "-" + String(match[2]).padStart(2, "0") + "-" + String(match[1]).padStart(2, "0");
  match = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (match) return match[0];
  return Utilities.formatDate(fallback || new Date(), "America/Montevideo", "yyyy-MM-dd");
}

function categorize_(text) {
  const raw = PropertiesService.getScriptProperties().getProperty("CATEGORY_RULES_JSON") || "[]";
  let rules = [];
  try {
    rules = JSON.parse(raw);
  } catch (error) {
    throw new Error("CATEGORY_RULES_JSON no contiene JSON válido.");
  }
  const normalized = normalizeText_(text);
  const match = rules
    .filter(function(rule) { return rule.contains && rule.category; })
    .sort(function(a, b) { return String(b.contains).length - String(a.contains).length; })
    .find(function(rule) { return normalized.indexOf(normalizeText_(rule.contains)) >= 0; });
  return match ? cleanText_(match.category, 80) : "Otros";
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
