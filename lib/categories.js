export const CATEGORIES_BY_TYPE = Object.freeze({
  Egreso: Object.freeze([
    "Factura",
    "Comida",
    "Salud",
    "Prestamo",
    "Viajes",
    "Gasolina",
    "Lujos y ropa",
    "Constriccion",
    "Ciudadania italiana",
    "Adquisiciones",
    "Otros",
    "Rep moto",
    "Diesmo y cuidamotos",
    "Ahorros"
  ]),
  Ingreso: Object.freeze([
    "Familia",
    "Prestamo",
    "Sueldo mama",
    "Ventas",
    "Enzo",
    "Pedro",
    "Tios y Otros",
    "Dev Impuestos",
    "Resto",
    "Ahorros"
  ])
});

export function isCategoryForType(type, category) {
  return CATEGORIES_BY_TYPE[type]?.includes(category) ?? false;
}
