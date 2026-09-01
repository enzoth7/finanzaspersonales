# Carga de gastos familiares

Esta implementación usa la planilla que ya existe. No crea otra planilla y no usa OpenAI, Supabase, una cuenta de servicio ni una API key de Google.

Destino:

- Spreadsheet: 1QfWNrNWRQsFpWZNnYiItdRDop_d5Hw9CgoNC1s7wMxE
- Pestaña: gid 1406094759
- Columnas: Fecha, Tipo, Importe, Categoria, Cuenta y Descripción
- Cuenta autorizada: enzothome1@gmail.com

## Componentes

- index.html, styles.css y app.js: aplicación móvil con las pestañas Registrar, Disponible y OCA. El formulario mantiene tipo, importe, fecha, categoría y descripción opcional; la cuenta se asigna internamente como Efectivo y no aparece en pantalla.
- api/gastos.js: función de Vercel que valida y reenvía el movimiento.
- api/saldos.js: función de solo lectura que solicita a Apps Script los saldos calculados desde la planilla.
- api/oca.js: función de solo lectura que solicita el estado de las compras en cuotas de OCA.
- apps-script/Code.gs: escribe en la hoja existente y procesa correos.
- apps-script/appsscript.json: permisos mínimos de Apps Script.

El formulario muestra categorías distintas según el tipo de movimiento. Los egresos e ingresos se validan también en el servidor para evitar combinaciones incorrectas.

## Dinero disponible

La pestaña `Disponible` no guarda un saldo independiente. Apps Script recorre las pestañas de movimientos desde el 1 de septiembre de 2026 y calcula por cuenta:

`ingresos - egresos`

Por eso, cualquier fila agregada, corregida o eliminada manualmente en Google Sheets se refleja al actualizar la aplicación. Un `Ingreso` con categoría `Saldo Inicial` se suma normalmente. Las filas sin cuenta se consideran `Efectivo` para mantener compatibilidad con cargas manuales anteriores.

Siempre se muestran `Efectivo` y `MiDinero`. También aparecen Prex, Mercado Pago u otras cuentas cuando tengan movimientos registrados.

## Estado de OCA

La pestaña `OCA` lee el rango `F18:J40` de la pestaña con gid `955665856` del archivo OCA existente (`1cnAoaGhzMyu0mFg5U_WZ6XBRQJkTmAlIaFbZlmNwdtI`). Muestra arriba el saldo a pagar el mes siguiente, una tabla con nombre, cuota e importe de cada compra activa y otra tabla con la proyección de los próximos seis meses. El cálculo no incluye comisiones ni cargos ubicados fuera de ese rango.

Los movimientos se separan automáticamente por mes. Septiembre de 2026 conserva la pestaña `GASTOS`; desde octubre se usan nombres como `OCT 2026`, `NOV 2026` y `DIC 2026`. Si la pestaña del mes no existe, Apps Script copia la pestaña oculta `PLANTILLA`, actualiza el título y guarda allí el primer movimiento.

## Conectar Google Sheets sin API key

Todo este paso debe hacerse con enzothome1@gmail.com.

1. Abrir la planilla existente.
2. Ir a Extensiones → Apps Script.
3. Copiar el contenido de apps-script/Code.gs.
4. Activar la visualización del manifiesto y copiar apps-script/appsscript.json.
5. En Configuración del proyecto → Propiedades de la secuencia de comandos, agregar:
   - WEBHOOK_SECRET: una frase larga privada, igual a la de Vercel.
   - GMAIL_QUERY: opcional. Por defecto usa únicamente `{from:noreply@midinero.com.uy from:noreply@redpagos.com.uy}`.
6. Implementar como aplicación web:
   - Ejecutar como: yo.
   - Acceso: cualquiera.
7. Copiar la URL terminada en /exec.

Al abrir esa URL en el navegador debe aparecer una respuesta JSON con `"ok":true`, el ID de esta planilla y la versión `2026-08-31-v9`.

Después de cambiar `Code.gs`, guardar el proyecto y crear una nueva versión de la implementación web. El lector horario de Gmail usa el código guardado, pero la web necesita que la URL `/exec` apunte a la nueva implementación para disponer también de la lectura de saldos.

WEBHOOK_SECRET es una clave interna entre Vercel y Apps Script, no una API key ni un servicio pago.

## Conectar Gmail

1. Ejecutar primero `previewAugust2026Emails` y revisar el registro de ejecución. Esta función simula todos los correos de agosto, pero no escribe filas ni etiqueta correos.
2. Usar `previewExpenseEmails` para revisar hasta diez correos recientes sin escribir ni etiquetar.
3. Revisar y mantener las reglas en la pestaña `CONFIG`, columnas A:I: Activa, Prioridad, Remitente, Texto buscado, Tipo, Categoría, Cuenta, Descripción y Monto mínimo.
4. `Monto mínimo` es estricto: una regla con 23000 solo coincide cuando el importe es mayor a 23000.
5. Ejecutar manualmente `installEmailTrigger`.
6. Autorizar acceso a Gmail y Google Sheets usando exclusivamente `enzothome1@gmail.com`.
7. El disparador revisará Gmail una vez por hora y solo escribirá movimientos con fecha desde el 1 de septiembre de 2026.

Los correos procesados reciben la etiqueta finanzas-procesado. Los que no pueden interpretarse o no encuentran una regla aplicable reciben finanzas-error y no se agregan a la hoja. Cuando se agrega la regla faltante, vuelven a intentarse automáticamente.

El lector es determinista: extrae fecha e importe con expresiones regulares y toma tipo, categoría, cuenta y descripción de `CONFIG`. Redpagos solo registra correos confirmados y separa cada servicio y devolución en un movimiento. Ignora avisos de vencimiento, correos todavía en proceso y el consumo agregado `MIREDPAGOS`, porque el detalle confirmado de Redpagos ya contiene esos gastos.

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
