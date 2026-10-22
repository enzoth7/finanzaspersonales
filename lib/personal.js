function cleanText(value, maxLength = 300) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeDate(value) {
  const text = cleanText(value, 20);
  if (/^20\d{2}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function validateOcaEntry(input = {}) {
  const entry = {
    mode:cleanText(input.mode, 20),
    date:normalizeDate(input.date),
    description:cleanText(input.description, 300),
    amount:Number(input.amount),
    installments:Number(input.installments) || 0
  };
  const date = new Date(`${entry.date}T12:00:00Z`);
  if (!["installments", "subscription"].includes(entry.mode)) throw new Error("Elegí compra en cuotas o suscripción.");
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== entry.date) {
    throw new Error("La fecha no es válida.");
  }
  if (!entry.description) throw new Error("Escribí una descripción.");
  if (!Number.isFinite(entry.amount) || entry.amount <= 0 || entry.amount > 100000000) throw new Error("El importe debe ser mayor a cero.");
  if (entry.mode === "installments") {
    if (!Number.isInteger(entry.installments) || entry.installments < 1 || entry.installments > 36) {
      throw new Error("Las cuotas deben ser un número entre 1 y 36.");
    }
  } else {
    entry.installments = 0;
  }
  entry.installmentAmount = roundMoney(entry.mode === "installments" ? entry.amount / entry.installments : entry.amount);
  return entry;
}
