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
├── server.js          # Servidor HTTP (Node ≥ 20, solo módulos nativos)
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

### Backend (`server.js`)

- `http` nativo de Node. Sirve los archivos estáticos y una **API REST JSON**:

  | Método | Ruta | Uso |
  |---|---|---|
  | GET | `/api/db` | Todos los datos (config, clientes, bitácoras) |
  | GET / PUT | `/api/config` | Campos fijos |
  | GET / POST | `/api/clientes`, `/api/bitacoras` | Listar / crear |
  | GET / PUT / DELETE | `/api/clientes/:id`, `/api/bitacoras/:id` | Leer / actualizar / eliminar |
  | GET | `/api/eventos` | Canal de tiempo real (SSE) |
  | GET | `/firmas/:archivo` | Imágenes de firma e # ID |

- **Persistencia**: `data/db.json`, con escritura atómica (archivo temporal y luego `rename`).
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

## Privacidad y respaldo

- La app maneja **datos de salud** (nombres, documentos, firmas). Por eso `data/`, los PDF originales y las imágenes fuente están en `.gitignore` y **nunca se suben al repositorio**.
- Para respaldar los datos reales, copie la carpeta `data/` completa (`db.json` y `firmas/`) a un medio seguro.
- La app no tiene usuarios ni contraseñas: está pensada para una **red local de confianza**. Antes de publicarla en internet hay que agregar autenticación.
