export const PERSONAL_TYPES = Object.freeze(["Ingreso", "Egreso"]);
export const PERSONAL_CURRENCIES = Object.freeze(["Pesos", "Dolares", "Euros"]);
export const PERSONAL_ACCOUNTS = Object.freeze([
  "Efectivo",
  "BROU",
  "OCA Blue",
  "Prex",
  "N26",
  "Paypal",
  "Revolut",
  "Fiverr",
  "Grow",
  "Deuda Mamá",
  "Mercado Pago"
]);
export const PERSONAL_CATEGORIES = Object.freeze([
  "Mama",
  "Ahorro",
  "Prestamo",
  "Freelancer",
  "Ventas",
  "Otros (Dev IVA, Amigos, etc)",
  "Saldo Inicial",
  "Cambio de moneda",
  "Ahorros",
  "Prestamos",
  "OCA",
  "Comida",
  "Transporte",
  "Celular",
  "Gimnasio",
  "Ropa",
  "Suscripciones",
  "Educacion y eventos",
  "Viajes",
  "Entretenimietno y salidas",
  "Salud y estetica",
  "Compras",
  "Otros asuntos",
  "Comisiones bancarias",
  "Capex",
  "Ciudadania italiana",
  "Inversiones",
  "Pago Deuda Mamá"
]);

function cleanText(value, maxLength = 300) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function comparable(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchAllowed(value, allowed) {
  const key = comparable(value);
  return allowed.find((candidate) => comparable(candidate) === key) || "";
}

function parseAmount(value) {
  if (typeof value === "number") return value;
  let text = cleanText(value).replace(/[^0-9,.-]/g, "");
  if (!text) return Number.NaN;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma >= 0) {
    text = text.replace(",", ".");
  }
  return Number(text);
}

function normalizeDate(value) {
  const text = cleanText(value, 20);
  if (/^20\d{2}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})$/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function normalizeType(value) {
  const key = comparable(value);
  if (["egreso", "gasto", "debito", "compra", "pago"].includes(key)) return "Egreso";
  if (["ingreso", "credito", "abono", "cobro"].includes(key)) return "Ingreso";
  return matchAllowed(value, PERSONAL_TYPES);
}

function normalizeCurrency(value) {
  const key = comparable(value).replace(/[^a-z0-9$€]/g, "");
  if (["uyu", "peso", "pesos", "$", "$u"].includes(key)) return "Pesos";
  if (["usd", "dolar", "dolares", "us$"].includes(key)) return "Dolares";
  if (["eur", "euro", "euros", "€"].includes(key)) return "Euros";
  return matchAllowed(value, PERSONAL_CURRENCIES);
}

function normalizeAccount(value, paidByMother) {
  if (paidByMother === true) return "Deuda Mamá";
  const key = comparable(value).replace(/[^a-z0-9]/g, "");
  const aliases = {
    efectivo:"Efectivo",
    cash:"Efectivo",
    brou:"BROU",
    ocablue:"OCA Blue",
    oca:"OCA Blue",
    prex:"Prex",
    n26:"N26",
    paypal:"Paypal",
    revolut:"Revolut",
    fiverr:"Fiverr",
    grow:"Grow",
    growpro:"Grow",
    deudamama:"Deuda Mamá",
    tarjetamama:"Deuda Mamá",
    pagomama:"Deuda Mamá",
    mercadopago:"Mercado Pago",
    mp:"Mercado Pago"
  };
  return aliases[key] || matchAllowed(value, PERSONAL_ACCOUNTS);
}

function normalizeCategory(value, type) {
  const exact = matchAllowed(value, PERSONAL_CATEGORIES);
  if (exact) return exact;
  const key = comparable(value);
  const aliases = {
    educacion:"Educacion y eventos",
    entretenimiento:"Entretenimietno y salidas",
    "entretenimiento y salidas":"Entretenimietno y salidas",
    salud:"Salud y estetica",
    "ciudadania italiana":"Ciudadania italiana",
    comision:"Comisiones bancarias",
    comisiones:"Comisiones bancarias",
    "pago deuda mama":"Pago Deuda Mamá"
  };
  if (aliases[key]) return aliases[key];
  if (key === "otros") return type === "Ingreso" ? "Otros (Dev IVA, Amigos, etc)" : "Otros asuntos";
  return "";
}

export function normalizePersonalMovement(input = {}) {
  const type = normalizeType(input.type ?? input.tipo ?? input.movimiento);
  return {
    date:normalizeDate(input.date ?? input.fecha),
    type,
    currency:normalizeCurrency(input.currency ?? input.moneda),
    amount:parseAmount(input.amount ?? input.importe ?? input.monto),
    category:normalizeCategory(input.category ?? input.categoria, type),
    account:normalizeAccount(input.account ?? input.cuenta ?? input.medio, input.paidByMother ?? input.pagado_por_mama),
    description:cleanText(input.description ?? input.descripcion ?? input.comercio ?? input.concepto, 300),
    allowDuplicate:Boolean(input.allowDuplicate)
  };
}

export function validatePersonalMovement(input) {
  const movement = normalizePersonalMovement(input);
  const date = new Date(`${movement.date}T12:00:00Z`);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(movement.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== movement.date) {
    throw new Error("La fecha no es válida.");
  }
  if (!PERSONAL_TYPES.includes(movement.type)) throw new Error("El tipo debe ser Ingreso o Egreso.");
  if (!PERSONAL_CURRENCIES.includes(movement.currency)) throw new Error("La moneda no es válida.");
  if (!Number.isFinite(movement.amount) || movement.amount <= 0 || movement.amount > 100000000) throw new Error("El importe debe ser mayor a cero.");
  if (!PERSONAL_CATEGORIES.includes(movement.category)) throw new Error("La categoría no es válida.");
  if (!PERSONAL_ACCOUNTS.includes(movement.account)) throw new Error("La cuenta no es válida.");
  return movement;
}

export function parsePersonalImport(text) {
  const source = cleanText(text, 100000)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = source.indexOf("[");
  const end = source.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Pegá el bloque JSON completo generado por Gemini.");
  let parsed;
  try {
    parsed = JSON.parse(source.slice(start, end + 1));
  } catch {
    throw new Error("El bloque no es un JSON válido. Pedile a Gemini que responda únicamente con el JSON.");
  }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("No se encontraron movimientos en el bloque.");
  if (parsed.length > 100) throw new Error("Importá como máximo 100 movimientos por vez.");
  return parsed.map(normalizePersonalMovement);
}
