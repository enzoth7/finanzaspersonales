# Carga de gastos familiares

Esta implementación usa la planilla que ya existe. No crea otra planilla y no usa OpenAI, Supabase, una cuenta de servicio ni una API key de Google.

Destino:

- Spreadsheet: 1QfWNrNWRQsFpWZNnYiItdRDop_d5Hw9CgoNC1s7wMxE
- Pestaña: gid 1406094759
- Columnas: Fecha, Tipo, Importe, Categoria, Cuenta y Descripción
- Cuenta autorizada: enzothome1@gmail.com

## Componentes

- index.html, styles.css y app.js: formulario móvil con tipo, importe, fecha, categoría y descripción opcional. La cuenta se asigna internamente como Efectivo y no aparece en pantalla.
- api/gastos.js: función de Vercel que valida y reenvía el movimiento.
- apps-script/Code.gs: escribe en la hoja existente y procesa correos.
- apps-script/appsscript.json: permisos mínimos de Apps Script.

El formulario muestra categorías distintas según el tipo de movimiento. Los egresos e ingresos se validan también en el servidor para evitar combinaciones incorrectas.

## Conectar Google Sheets sin API key

Todo este paso debe hacerse con enzothome1@gmail.com.

1. Abrir la planilla existente.
2. Ir a Extensiones → Apps Script.
3. Copiar el contenido de apps-script/Code.gs.
4. Activar la visualización del manifiesto y copiar apps-script/appsscript.json.
5. En Configuración del proyecto → Propiedades de la secuencia de comandos, agregar:
   - WEBHOOK_SECRET: una frase larga privada, igual a la de Vercel.
   - GMAIL_QUERY: opcional. Por defecto usa únicamente `{from:noreply@midinero.com.uy from:noreply@redpagos.com.uy}`.
   - EMAIL_DEFAULT_ACCOUNT: normalmente MiDinero.
   - CATEGORY_RULES_JSON: opcional. Ejemplo: [{"contains":"SUPERMERCADO","category":"Comida"},{"contains":"COMEPA","category":"Salud"}]
6. Implementar como aplicación web:
   - Ejecutar como: yo.
   - Acceso: cualquiera.
7. Copiar la URL terminada en /exec.

Al abrir esa URL en el navegador debe aparecer una respuesta JSON con `"ok":true` y el ID de esta planilla.

WEBHOOK_SECRET es una clave interna entre Vercel y Apps Script, no una API key ni un servicio pago.

## Conectar Gmail

1. Ejecutar primero `previewExpenseEmails` y revisar el registro de ejecución. Esta función lee y analiza hasta diez hilos, pero no escribe filas ni etiqueta correos.
2. Ajustar el parser y `CATEGORY_RULES_JSON` con ejemplos reales anonimizados de ambos remitentes.
3. Confirmar que la validación de la columna Cuenta admite `MiDinero` para las filas que llegan por correo.
4. Ejecutar manualmente `installEmailTrigger`.
5. Autorizar acceso a Gmail y Google Sheets usando exclusivamente `enzothome1@gmail.com`.
6. El disparador revisará Gmail una vez por hora.

Los correos procesados reciben la etiqueta finanzas-procesado. Los que no pueden interpretarse reciben finanzas-error y no se agregan a la hoja.

El lector es determinista: busca fecha, importe, moneda, comercio y cuenta con expresiones regulares. Para ajustarlo al formato real de MiDinero se necesita un correo de ejemplo sin datos sensibles.

## Ejecutar localmente

1. Copiar .env.example como .env.local.
2. Mantener DRY_RUN=true para probar sin escribir.
3. Ejecutar `npm test` y luego `npm run dev`.
4. Abrir http://localhost:3002.

## Variables de Vercel

- APPS_SCRIPT_URL: URL /exec de Apps Script.
- WEBHOOK_SECRET: la misma frase privada configurada en Apps Script.
- DRY_RUN: eliminar o establecer en false para producción.

Después se puede importar esta carpeta en Vercel sin cambiar la planilla.
