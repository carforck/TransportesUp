# Transportes UP · Bitácoras de transporte especial

Aplicación web para **digitalizar la bitácora de servicios de transporte especial** que Transportes UP Cartagena presenta a **Salud Total EPS**.

Antes, la bitácora se hacía en Excel, se imprimía, el acudiente la firmaba a mano fila por fila y luego se escaneaba. Con esta app:

- Se registran los **clientes** una sola vez: paciente, quién firma, ruta fija, horas, **firma** y **# ID escrito a mano**.
- Cada mes solo se marcan las **fechas de servicio**. La app genera las filas de ida y regreso con los campos fijos ya diligenciados.
- La **firma** y el **# ID** del acudiente se anexan automáticamente en cada fila, con una ligera variación natural para que no queden idénticos uno debajo del otro.
- Se imprime o descarga el **PDF con el formato oficial**, nombrado `PACIENTE - MES AÑO.pdf`.

---

## ¿Qué hace?

| Módulo | Para qué sirve |
|---|---|
| **Dashboard** | Indicadores (clientes, bitácoras, servicios, firmas pendientes), registros del mes por paciente, anexos pendientes y próximas firmas agendadas. |
| **Clientes** | Gestión completa (crear, editar, eliminar) de pacientes: datos del paciente, quién firma (acudiente o el mismo paciente), ruta fija (recogida → IPS → regreso), horas, teléfono y anexos (firma y # ID). |
| **Registros** | Lista de servicios por paciente y por mes. Tiene filtros por mes, paciente y búsqueda, y permite agregar o quitar fechas. |
| **Bitácoras** | Una bitácora por cliente y mes: calendario navegable, vista previa del documento oficial, edición directa de celdas, duplicar a otro mes, imprimir o descargar PDF. |
| **Agenda de firmas** | Programar cuándo se recoge la firma, marcar como firmada o reabrir. |
| **Campos fijos** | Datos que se repiten en todas las bitácoras: empresa, NIT, EPS, título del formato, código y descripción de la tecnología. |
| **Importar bitácora PDF** | Sube una bitácora ya hecha (`TNA_…pdf` o `PACIENTE - MES AÑO.pdf`). Lee el ID del paciente y las fechas, y crea la bitácora sin marcarlas a mano. |

### Campos fijos vs. variables

En el formato oficial casi todo se repite. Lo único que cambia es la **fecha**, el **tercero que firma** y su **firma / # ID**.

| Columna | De dónde sale |
|---|---|
| ITEM, FECHA | Generado a partir de las fechas marcadas en el calendario |
| PACIENTE, ID PACIENTE | Ficha del cliente |
| DIRECCIÓN, HORA, IPS | Ruta fija del cliente. La ida va de recogida a IPS y el regreso de IPS a punto de regreso. Se pueden corregir por fila. |
| CÓDIGO / DESCRIPCIÓN TECNOLOGÍA, CANT | Campos fijos. Solo van en la fila de ida. |
| FIRMA DEL PACIENTE O ACUDIENTE | Imagen de la firma anexada al cliente |
| # ID PACIENTE O ACUDIENTE | Imagen del número escrito a mano. Si aún no está anexada, se usa el número digitado como respaldo. |

---

## ¿Cómo lo hace?

### 1. Anexos de firma y # ID (quitar fondo y validar)

Quien diligencia **adjunta la foto o el escaneo** de la firma y del número de documento. También puede dibujarlos en pantalla. Todo el procesamiento ocurre **en el navegador** (`public/firma.js`, sin librerías):

1. **Recorte opcional**: se arrastra un recuadro sobre el original para quedarse solo con el contenido.
2. **Fondo local**: se estima reduciendo y desenfocando la imagen. Así se compensan sombras, luz desigual y el tono amarillento del papel.
3. **Tinta**: cada píxel se compara con su fondo local para obtener su transparencia. La sensibilidad y el color (original, azul o negro) se pueden ajustar.
4. **Líneas del formulario**: se eliminan renglones y bordes de tabla (tramos rectos largos, tolerando una leve inclinación).
5. **Manchas sueltas**: se eliminan mediante análisis de componentes conectados con arreglos tipados.
6. **Recorte final**: se recorta al contenido y se exporta como **PNG transparente**.
7. **Validación**: se rechazan imágenes en blanco, fondos oscuros o con demasiado contenido, y trazos demasiado pequeños.

Se guardan **dos archivos** por anexo: la versión limpia (la que va en el documento) y el **original** como soporte.

### 2. Documento oficial e impresión

- Réplica del formato **"BITACORA DE SERVICIOS TRANSPORTE ESPECIAL PRESTADOS A USUARIOS SALUD TOTAL EPS"** en hoja carta horizontal.
- **Paginación propia**: hojas de **23 filas**, cada una con logo, título y encabezados, y numeradas "1 de N". No depende de cómo cada navegador corte la tabla.
- **Bordes por celda** (`border-collapse: separate`), para que no se pierdan en el salto de página.
- **Variación natural de firma e ID**: cada fila desplaza, rota (±2°) y escala levemente la imagen.
  - La variación es **determinista**: usa un generador pseudoaleatorio con semilla = fila + archivo, así que sale igual al recargar o al imprimir.
  - La imagen siempre queda **dentro de su celda**.
- **Edición en el documento**: en modo "✏️ Editar documento" se corrigen celdas o se quitan y restauran filas. Las correcciones se guardan con la bitácora en `ajustes` y `excluidas`.
- El nombre del PDF se toma del título de la página: `PACIENTE - MES AÑO`.

### 3. Tiempo real

El servidor publica un canal **Server-Sent Events** (`/api/eventos`). En cada cambio (POST, PUT o DELETE) avisa a todos los navegadores conectados, y cada uno vuelve a pintar su vista **sin recargar la página**.

- Cada pestaña envía un identificador (`X-Cliente`) para no refrescarse con sus propios cambios.
- Si la persona está trabajando (ventana abierta, escribiendo o con una bitácora sin guardar), **no se pisa su trabajo**. Se muestra el aviso "Hay cambios nuevos · Actualizar".
- Indicador **"● En vivo"** en el menú. Al reconectarse, la vista se sincroniza sola.

---

## ¿Cómo está construida?

Pensada para correr en un computador de la oficina y usarse desde cualquier celular de la misma red. **Sin dependencias**: no hay `npm install` ni base de datos externa.

```
TransporUp/
├── server.js          # Servidor LOCAL: sirve public/ y usa lib/app.js (tiempo real por SSE)
├── api/index.js       # Función de Vercel: la misma lógica de lib/app.js (tiempo real por sondeo)
├── lib/
│   ├── app.js         # API REST, anexos (firma / # ID) y tiempo real, sin servidor propio
│   └── store.js       # Almacenamiento intercambiable (hoy: archivos; mañana: nube)
├── vercel.json        # Salida estática = public/, reescrituras /api/* y /firmas/* → api/index
├── .vercelignore      # Impide subir data/, .env* y PDFs reales en un despliegue
├── .env.example       # Variables de Supabase (sin valores)
├── supabase/migrations/001_estado_y_firmas.sql   # Tabla app_estado + bucket privado "firmas" 
├── package.json       # Scripts: dev (con recarga) y start
├── public/            # Frontend: SPA en JavaScript puro
│   ├── index.html     # Estructura, menú lateral colapsable, recarga en vivo
│   ├── app.js         # Router por hash y todas las vistas (dashboard, clientes, registros, bitácoras, agenda, config)
│   ├── firma.js       # Componente de anexos: adjuntar/dibujar, recortar, quitar fondo, validar
│   ├── styles.css     # Estilos mobile-first + reglas de impresión del formato
│   └── logo.png, logo-icon.png, favicon.png   # Logo oficial con fondo transparente
└── data/              # ⚠️ NO versionado (ver .gitignore)
    ├── db.json        # Base de datos JSON (config, clientes, bitácoras)
    └── firmas/        # Firmas e # ID: versión limpia (PNG) + original (JPG)
```

### Backend (`lib/app.js` + `lib/store.js`)

- La lógica es un **manejador único** (`handler(req, res)`) que no depende del servidor. Lo usan `server.js` (local) y `api/index.js` (Vercel).
- Expone una **API REST JSON**:

  | Método | Ruta | Uso |
  |---|---|---|
  | GET | `/api/db` | Todos los datos (config, clientes, bitácoras) |
  | GET / PUT | `/api/config` | Campos fijos |
  | GET / POST | `/api/clientes`, `/api/bitacoras` | Listar / crear |
  | GET / PUT / DELETE | `/api/clientes/:id`, `/api/bitacoras/:id` | Leer / actualizar / eliminar |
  | GET | `/api/info` | Entorno, modo de tiempo real (`sse` / `sondeo`) y si el almacenamiento es persistente |
  | GET | `/api/version` | Versión de los datos (para el sondeo en serverless) |
  | GET | `/api/eventos` | Canal de tiempo real SSE (solo local) |
  | GET | `/firmas/:archivo` | Imágenes de firma e # ID |

- **Persistencia** (`lib/store.js`): una interfaz asíncrona (`leer`, `guardar`, `guardarArchivo`, `leerArchivo`, `borrarArchivo`). El driver actual guarda en `data/db.json` con escritura atómica (temporal + `rename`) y en `data/firmas/`. `DATA_DIR` permite usar otra carpeta.
- **Versión de datos**: cada escritura incrementa `db.version` y la devuelve en la cabecera `X-Version`.
- **Anexos**: llegan como `data:` URL. El servidor valida el tipo (PNG, JPG, WEBP o SVG), el tamaño (máx. 2 MB la versión limpia y 8 MB el original) y que no estén vacíos. Luego los guarda en `data/firmas/` y la base guarda solo la ruta. Al reemplazar o eliminar un anexo o un cliente, se borran sus archivos.
- **Recarga en desarrollo**: `node --watch` reinicia el servidor y un SSE (`/__reload`) recarga el navegador cuando cambia algo en `public/`.

### Frontend (`public/`)

- **SPA sin framework**: router por hash (`#/clientes`, `#/registros?m=2026-07`, `#/bitacora/:id`…) y vistas que generan HTML con plantillas, escapando siempre los datos.
- **Mobile-first**:
  - En celular: barra superior con menú ☰, tablas que se convierten en tarjetas, ventanas tipo hoja inferior y botones de mínimo 44 px.
  - En escritorio: menú lateral **colapsable** a solo iconos, que recuerda su estado.
- **Recursos externos**: la fuente Poppins (Google Fonts) y **pdf.js**, que se carga desde cdnjs solo al importar una bitácora PDF.
- **Impresión**: `@media print` oculta la interfaz y deja solo las hojas del formato.

### Modelo de datos (resumen)

```jsonc
// Cliente
{ "id": "c-…", "paciente": "…", "docPaciente": "…",
  "firmante": "acudiente" | "paciente", "acudiente": "…", "docAcudiente": "…", "telefono": "…",
  "origen": "…", "ips": "…", "regreso": "…", "horaIda": "06:20", "horaRegreso": "09:00",
  "firma":   { "tipo": "escaneada" | "diligenciada", "archivo": "/firmas/….png", "original": "/firmas/…-original.jpg", "fecha": "AAAA-MM-DD" },
  "firmaId": { "…misma estructura…" } }

// Bitácora (una por cliente y mes)
{ "id": "b-…", "clienteId": "c-…", "periodo": "AAAA-MM", "fechas": ["AAAA-MM-DD", …],
  "modoFirma": "digital" | "escrita", "agendaFirma": "AAAA-MM-DD", "estado": "pendiente" | "firmado",
  "ajustes": { "AAAA-MM-DD|ida": { "hora": "06:45 AM" } }, "excluidas": ["AAAA-MM-DD|reg"] }
```

---

## Cómo ejecutarla

Requisito: **Node.js 20 o superior**.

```bash
git clone https://github.com/carforck/TransportesUp.git
cd TransportesUp
npm run dev        # desarrollo: reinicia el servidor y recarga el navegador al guardar cambios
# o
npm start          # uso normal
```

- En el computador: <http://localhost:3000>
- Desde un celular **en la misma red Wi-Fi**: `http://<IP-del-computador>:3000`. La IP se consulta con `hostname -I` en Linux o `ipconfig` en Windows.
- Puerto distinto: `PORT=8080 npm start`.

En la primera ejecución se crea `data/db.json` con **datos de ejemplo ficticios**.

## Despliegue en Vercel (preparado)

El proyecto ya está estructurado para que el despliegue pase sin errores:

| Pieza | Cómo queda en Vercel |
|---|---|
| `public/` | Archivos estáticos servidos por la CDN (`outputDirectory`). No hay paso de build. |
| `api/index.js` | Función Node.js (Fluid Compute) que atiende `/api/*` y `/firmas/*` mediante las reescrituras de `vercel.json`. |
| Tiempo real | El navegador consulta `/api/version` cada 5 s. En serverless las instancias no comparten memoria, así que no se usa SSE. |
| Datos | Sin almacenamiento configurado, la app arranca en **modo demostración** (`/tmp`, temporal) y lo avisa en pantalla. **Nunca falla por disco de solo lectura.** |
| Seguridad | `.vercelignore` impide subir `data/`, los PDF reales y `server.js` (el servidor local). `vercel.json` fija `"framework": null`: si el proyecto se crea con un preset de servidor Node, Vercel ejecutaría `public/app.js` como backend y todas las rutas fallarían. |
| Acceso | Inicio de sesión obligatorio (ver abajo). |

### Almacenamiento permanente: Supabase

`lib/store.js` incluye un **driver de Supabase** que se activa solo cuando existen las variables `SUPABASE_URL` y `SUPABASE_SECRET_KEY`. No usa dependencias: habla con la API REST y Storage mediante `fetch`.

- **Datos**: tabla `app_estado`, con una fila JSON versionada. Cada guardado actualiza solo si nadie guardó antes (control optimista por `version`). Si dos personas guardan a la vez, la app relee y reintenta, así que no se pierden cambios.
- **Firmas e # ID**: bucket **privado** `firmas` de Supabase Storage. Las imágenes se sirven solo a través de la función.
- **Seguridad**: RLS activo y sin políticas, con permisos solo para `service_role`. La clave secreta vive únicamente en el servidor.

**Puesta en marcha:**

1. Supabase → SQL Editor: ejecutar `supabase/migrations/001_estado_y_firmas.sql` (crea la tabla y el bucket).
2. Variables de entorno, con los nombres de `.env.example`:
   - **local**: crear `.env.local`;
   - **Vercel**: Settings → Environment Variables.
3. Al arrancar, `/api/info` debe responder `"almacenamiento":"supabase"`.

### Inicio de sesión

`lib/auth.js`, sin dependencias. Variables: `APP_USUARIO` y `APP_CLAVE` (opcional `SESION_SECRETO`).

- **Sesión**: cookie firmada con HMAC-SHA256, `HttpOnly` + `SameSite=Lax` + `Secure`, válida 30 días. Cambiar `APP_CLAVE` cierra todas las sesiones.
- **Qué protege**: toda la API y las imágenes de `/firmas/*`. Solo quedan abiertas `/api/info` (sin datos), `/api/sesion`, `/api/login` y `/api/logout`.
- **En Vercel nunca queda abierta**: si faltan las variables, la API responde 503 y no entrega datos.
- **En local** se exige solo si las dos variables están en `.env.local`.
- **Fuerza bruta**: 5 intentos fallidos desde la misma IP → bloqueo de 15 minutos.

**Despliegue actual:** https://transportesup.vercel.app (equipo `carlos-carranzas-projects`). Cada push a `main` despliega solo.

La simulación local de Vercel (estáticos + reescrituras + función con `VERCEL=1`) se probó: API, anexos, modo demostración y sondeo funcionando.

## Peso de los archivos (plan gratuito)

Pensado para no pasarse de los límites gratuitos (Supabase: 1 GB de archivos y 500 MB de base de datos).

| Qué | Cómo se guarda | Peso típico |
|---|---|---|
| Firma / # ID limpios | WebP con transparencia, máx. 600 px (PNG si el navegador no soporta WebP) | ~25 KB |
| Anexo original | Máx. 1400 px, el más liviano entre WebP 70 y JPEG 72 | ~10–20 KB |
| Bitácoras en PDF | **No se guardan**: se generan en el navegador al imprimir | 0 |

- **Límites del servidor**: 512 KB por imagen limpia y 2 MB por original.
- **Cuánto pesará antes de guardar**: el componente de anexos lo muestra.
- **Espacio usado frente al límite**: está en **Campos fijos → Almacenamiento**.

## Scripts de mantenimiento (`scripts/`, solo local)

| Script | Para qué |
|---|---|
| `python3 scripts/optimizar_anexos.py [--prueba]` | Recomprime los anexos ya guardados en `data/`. Respalda antes en `data/_respaldos/`. Requiere Pillow. |
| `node scripts/supabase.js estado` | Verifica la conexión con Supabase, la tabla y el bucket |
| `node scripts/supabase.js esquema [--prueba]` | Ejecuta `supabase/migrations/*.sql` mediante la API de administración (`SUPABASE_ACCESS_TOKEN`) |
| `node scripts/supabase.js subir-datos [--prueba] [--forzar]` | Copia `data/` (datos y anexos) a Supabase. Se niega a sobrescribir sin `--forzar`. |

Los scripts leen sus variables de `.env.local` (ver `.env.example`).

## Privacidad y respaldo

- La app maneja **datos de salud** (nombres, documentos, firmas). Por eso `data/`, los PDF originales y las imágenes fuente están en `.gitignore` y **nunca se suben al repositorio**.
- Para respaldar los datos reales, copie la carpeta `data/` completa (`db.json` y `firmas/`) a un medio seguro.
- El acceso está protegido con usuario y contraseña (ver *Inicio de sesión*). Las claves viven solo en `.env.local` y en las variables de Vercel, nunca en el repositorio.
