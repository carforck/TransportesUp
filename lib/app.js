// Lógica de la app (API + anexos + tiempo real), sin servidor propio.
// La usan: server.js (local, con SSE) y api/index.js (función de Vercel, con sondeo).
const crypto = require('crypto');
const path = require('path');
const { crearStore, EN_VERCEL } = require('./store');
const { crearAuth } = require('./auth');

// ---------- Datos de ejemplo (instalación nueva) ----------
const SEED = {
  config: {
    empresa: 'Transportes UP Cartagena',
    nit: '901729817',
    eps: 'SALUD TOTAL EPS',
    titulo: 'BITACORA DE SERVICIOS TRANSPORTE ESPECIAL PRESTADOS A USUARIOS',
    codigo: 'P100622000',
    descripcion: 'TRANSPORTE TERRESTRE REDONDO URBANO (NO POS)',
  },
  // Datos de EJEMPLO ficticios: solo se crean si no existe data/db.json (instalación nueva).
  clientes: [
    {
      id: 'c-ejemplo',
      paciente: 'PACIENTE DE EJEMPLO',
      docPaciente: '1000000000',
      origen: 'DIRECCIÓN DE RECOGIDA',
      ips: 'IPS DE DESTINO',
      regreso: 'PUNTO DE REGRESO',
      horaIda: '06:20',
      horaRegreso: '09:00',
      firmante: 'acudiente', // quién firma: 'acudiente' | 'paciente'
      acudiente: 'ACUDIENTE DE EJEMPLO',
      docAcudiente: '2000000000',
      telefono: '',
      firma: null,   // { tipo: 'escaneada'|'diligenciada', archivo: '/firmas/x.png', original: '/firmas/x-original.jpg', fecha }
      firmaId: null, // # ID escrito a mano, misma estructura que firma
      creado: '2026-07-01',
    },
  ],
  bitacoras: [
    {
      id: 'b-ejemplo-2026-07',
      clienteId: 'c-ejemplo',
      periodo: '2026-07',
      fechas: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07'],
      modoFirma: 'digital', // 'digital' = se anexa la firma del cliente · 'escrita' = en blanco para firmar a mano
      agendaFirma: '',
      estado: 'pendiente',
      ajustes: {},   // correcciones hechas en el documento: { 'AAAA-MM-DD|ida': { hora: '06:45 AM' } }
      excluidas: [], // filas quitadas: ['AAAA-MM-DD|reg']
      creado: '2026-07-01',
    },
  ],
};

// ---------- Anexos: firma y # ID (la BD guarda solo la ruta /firmas/<archivo>) ----------
// SVG ya NO se acepta (puede traer <script> y se sirve desde el mismo origen); el navegador lo convierte a WebP/PNG.
const TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }; // .svg: solo archivos viejos (se descargan)
// Límites pensados para el plan gratuito (Supabase Storage 1 GB): el navegador ya comprime a WebP (~10–40 KB)
const MAX_BYTES = 512 * 1024;           // firma / # ID limpios
const MAX_ORIGINAL = 2 * 1024 * 1024;   // anexo original (foto/escaneo) que se conserva como soporte
const ANEXOS = { firma: 'firma', firmaId: 'imagen del documento (# ID)' };
const fallo = (msg, status = 400) => Object.assign(new Error(msg), { status });

function decodificar(dataUrl, max, etiqueta) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m || !TIPOS[m[1]]) throw fallo(`Formato de ${etiqueta} no soportado. Usa PNG, JPG o WEBP.`);
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length < 200) throw fallo(`La ${etiqueta} está vacía.`);
  if (bytes.length > max) throw fallo(`La ${etiqueta} pesa ${Math.round(bytes.length / 1024)} KB y el máximo es ${Math.round(max / 1024)} KB. Recorte la imagen o use una foto más pequeña.`);
  return { bytes, ext: TIPOS[m[1]] };
}

// ---------- Saneo (lista blanca) de lo que llega del navegador / importación ----------
// Campo desconocido → se ignora · tipo o valor inválido → 400 · elemento inválido dentro de una lista → se descarta
const esObjeto = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const tiene = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const RE_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_FILA = /^\d{4}-\d{2}-\d{2}\|(ida|reg)$/; // clave de ajustes/excluidas: 'AAAA-MM-DD|ida' o '|reg'
const CAMPOS_AJUSTE = ['dir', 'hora', 'ips', 'cod', 'desc', 'cant'];
const MAX_LISTA = 1000;
// AAAA-MM-DD con día real del mes (2026-02-30 no vale)
const fechaValida = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'))
  && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
function texto(v, campo, max = 300) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string' && typeof v !== 'number') throw fallo(`El campo "${campo}" debe ser texto`);
  const s = String(v).trim();
  if (s.length > max) throw fallo(`El campo "${campo}" supera ${max} caracteres`);
  return s;
}
const uno = (v, campo, opciones) => { if (!opciones.includes(v)) throw fallo(`Valor no válido para "${campo}" (use: ${opciones.map(o => o || "''").join(', ')})`); return v; };
const digitos = (v, campo) => { const s = texto(v, campo, 30).replace(/[\s.-]/g, ''); if (s && !/^\d{1,20}$/.test(s)) throw fallo(`El campo "${campo}" solo admite dígitos`); return s; };
const hora = (v, campo) => { const s = texto(v, campo, 5); if (s && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw fallo(`El campo "${campo}" debe ser HH:MM`); return s; };
const codigoTec = (v, campo = 'codigo') => { const s = texto(v, campo, 20).toUpperCase(); if (s && !/^[A-Z0-9]+$/.test(s)) throw fallo(`El campo "${campo}" solo admite mayúsculas y dígitos (máx. 20)`); return s; };
const lista = (v, campo) => { if (!Array.isArray(v)) throw fallo(`"${campo}" debe ser una lista`); if (v.length > MAX_LISTA) throw fallo(`"${campo}" admite máximo ${MAX_LISTA} elementos`); return v; };

// Bitácora: devuelve SOLO los campos que vinieron, ya limpios (quien llama los fusiona sobre la previa).
// "previa" (al actualizar) aporta periodo/fechas si no vienen; el resultado fusionado debe tenerlos válidos.
function sanearBitacora(datos, previa = null) {
  if (!esObjeto(datos)) throw fallo('Datos de bitácora no válidos');
  const r = {};
  if (tiene(datos, 'clienteId')) r.clienteId = texto(datos.clienteId, 'clienteId', 80);
  if (tiene(datos, 'periodo')) r.periodo = typeof datos.periodo === 'string' ? datos.periodo : '';
  if (tiene(datos, 'fechas')) {
    if (!Array.isArray(datos.fechas)) throw fallo('"fechas" debe ser una lista de días AAAA-MM-DD');
    r.fechas = [...new Set(lista(datos.fechas, 'fechas').filter(fechaValida))].sort(); // se descartan las inválidas
  }
  if (tiene(datos, 'codigo')) r.codigo = codigoTec(datos.codigo);
  if (tiene(datos, 'plan')) r.plan = uno(datos.plan ?? '', 'plan', ['', 'PBS', 'NO PBS']);
  if (tiene(datos, 'modoFirma')) r.modoFirma = uno(datos.modoFirma, 'modoFirma', ['digital', 'escrita']);
  if (tiene(datos, 'estado')) r.estado = uno(datos.estado, 'estado', ['pendiente', 'firmado']);
  if (tiene(datos, 'agendaFirma')) {
    const a = datos.agendaFirma ?? '';
    if (a !== '' && !fechaValida(a)) throw fallo('"agendaFirma" debe ser una fecha AAAA-MM-DD o vacía');
    r.agendaFirma = a;
  }
  if (tiene(datos, 'ajustes')) { // { 'AAAA-MM-DD|ida': { dir, hora, ips, cod, desc, cant } } — claves o campos raros se descartan
    if (!esObjeto(datos.ajustes)) throw fallo('"ajustes" debe ser un objeto');
    r.ajustes = {};
    for (const [k, v] of Object.entries(datos.ajustes).slice(0, 2 * MAX_LISTA)) {
      if (!RE_FILA.test(k) || !esObjeto(v)) continue;
      const o = {};
      for (const c of CAMPOS_AJUSTE) if (typeof v[c] === 'string' && v[c].length <= 300) o[c] = v[c];
      if (Object.keys(o).length) r.ajustes[k] = o;
    }
  }
  if (tiene(datos, 'excluidas')) r.excluidas = [...new Set(lista(datos.excluidas, 'excluidas').filter(k => typeof k === 'string' && RE_FILA.test(k)))];
  const final = { ...(previa || {}), ...r };
  if (typeof final.periodo !== 'string' || !RE_PERIODO.test(final.periodo)) throw fallo('Falta un periodo válido (AAAA-MM, mes 01 a 12)');
  if (!Array.isArray(final.fechas)) throw fallo('"fechas" debe ser una lista de días AAAA-MM-DD');
  return r;
}
// Valores por defecto de una bitácora NUEVA (no se aplican al fusionar sobre una existente)
const BITACORA_NUEVA = { modoFirma: 'digital', estado: 'pendiente', agendaFirma: '', ajustes: {}, excluidas: [] };

// Cliente: firma / firmaId NO pasan por aquí (solo aplicarAnexos). crear=true exige paciente y documento.
function sanearCliente(datos, crear = false) {
  if (!esObjeto(datos)) throw fallo('Datos de cliente no válidos');
  const r = {};
  if (crear || tiene(datos, 'paciente')) { r.paciente = texto(datos.paciente, 'paciente', 120); if (!r.paciente) throw fallo('Falta el nombre del paciente'); }
  if (crear || tiene(datos, 'docPaciente')) { r.docPaciente = digitos(datos.docPaciente, 'docPaciente'); if (!r.docPaciente) throw fallo('Falta el documento del paciente (solo dígitos)'); }
  if (tiene(datos, 'firmante')) r.firmante = uno(datos.firmante, 'firmante', ['acudiente', 'paciente']);
  if (tiene(datos, 'docAcudiente')) r.docAcudiente = digitos(datos.docAcudiente, 'docAcudiente');
  for (const k of ['acudiente', 'telefono', 'origen', 'ips', 'regreso']) if (tiene(datos, k)) r[k] = texto(datos[k], k);
  for (const k of ['horaIda', 'horaRegreso']) if (tiene(datos, k)) r[k] = hora(datos[k], k);
  if (tiene(datos, 'codigo')) r.codigo = codigoTec(datos.codigo);
  return r;
}

// Configuración: campos fijos + catálogos de códigos e IPS
function sanearConfig(datos) {
  if (!esObjeto(datos)) throw fallo('Configuración no válida');
  const r = {};
  for (const k of ['empresa', 'nit', 'eps', 'titulo', 'codigo', 'descripcion']) if (tiene(datos, k)) r[k] = texto(datos[k], k);
  if (tiene(datos, 'codigos')) r.codigos = lista(datos.codigos, 'codigos').map((x, n) => {
    if (!esObjeto(x)) throw fallo(`Código #${n + 1} del catálogo no válido`);
    return { codigo: codigoTec(x.codigo, 'codigos.codigo'), descripcion: texto(x.descripcion, 'codigos.descripcion') };
  });
  if (tiene(datos, 'ipsCatalogo')) r.ipsCatalogo = lista(datos.ipsCatalogo, 'ipsCatalogo').map((x, n) => {
    if (!esObjeto(x)) throw fallo(`IPS #${n + 1} del catálogo no válida`);
    return { nombre: texto(x.nombre, 'ipsCatalogo.nombre'), claves: lista(x.claves ?? [], 'ipsCatalogo.claves').map(c => texto(c, 'ipsCatalogo.claves')).filter(Boolean) };
  });
  return r;
}

function crearApp({ tiempoReal = 'sse' } = {}) {
  const store = crearStore();
  const auth = crearAuth({ enVercel: EN_VERCEL });

  async function cargarDB() {
    let db = await store.leer();
    if (!db) {
      db = structuredClone(SEED); db.version = 1;
      try { await store.guardar(db, 0); } catch (e) { if (!e.conflicto) throw e; db = await store.leer(); } // otra instancia la creó primero
    }
    if (db.clientes.some(c => 'token' in c)) db.clientes.forEach(c => delete c.token); // migración: se retiró el enlace público
    db.version ||= 1;
    return db;
  }
  async function guardarDB(db) { const prev = db.version || 1; db.version = prev + 1; await store.guardar(db, prev); return db.version; }

  async function borrarAnexo(a) { for (const k of ['archivo', 'original']) if (a?.[k]) await store.borrarArchivo(path.basename(a[k])); }
  async function guardarAnexo(cliente, entrada, campo) {
    const img = decodificar(entrada?.data, MAX_BYTES, ANEXOS[campo]);
    const orig = entrada.original ? decodificar(entrada.original, MAX_ORIGINAL, 'imagen original') : null;
    const base = `${cliente.id}-${campo === 'firmaId' ? 'id-' : ''}${crypto.randomBytes(4).toString('hex')}`;
    await store.guardarArchivo(`${base}.${img.ext}`, img.bytes);
    if (orig) await store.guardarArchivo(`${base}-original.${orig.ext}`, orig.bytes);
    await borrarAnexo(cliente[campo]);
    return {
      tipo: entrada.tipo === 'diligenciada' ? 'diligenciada' : 'escaneada',
      archivo: `/firmas/${base}.${img.ext}`,
      original: orig ? `/firmas/${base}-original.${orig.ext}` : null,
      bytes: img.bytes.length + (orig ? orig.bytes.length : 0), // peso total guardado (para el indicador de espacio)
      fecha: new Date().toISOString().slice(0, 10),
    };
  }
  // Aplica cambios de anexos que vengan en el body (data nueva, null para quitar, o sin cambio)
  async function aplicarAnexos(cliente, body) {
    for (const campo of Object.keys(ANEXOS)) {
      if (!(campo in body)) continue;
      if (body[campo] === null) { await borrarAnexo(cliente[campo]); cliente[campo] = null; }
      else if (body[campo]?.data) cliente[campo] = await guardarAnexo(cliente, body[campo], campo);
      delete body[campo];
    }
  }

  // ---------- HTTP ----------
  const send = (res, code, body, extra = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(JSON.stringify(body));
  };
  const readBody = req => req.__cuerpo ||= new Promise((resolve, reject) => { // se guarda: un reintento por conflicto lo reutiliza
    // El cuerpo debe ser un objeto JSON (ni null, ni lista, ni texto suelto)
    const objeto = v => esObjeto(v) ? resolve(v) : reject(fallo('El cuerpo debe ser un objeto JSON'));
    let previo; try { previo = req.body; } catch { return reject(fallo('JSON inválido')); } // en Vercel req.body es un getter que parsea
    if (previo !== undefined && previo !== null && typeof previo === 'object' && !Buffer.isBuffer(previo)) return objeto(previo); // ya parseado por la plataforma
    let data = '';
    req.on('data', c => { data += c; if (data.length > 15e6) { reject(fallo('Cuerpo demasiado grande', 413)); req.destroy(); } });
    req.on('end', () => { let v; try { v = data ? JSON.parse(data) : {}; } catch { return reject(fallo('JSON inválido')); } objeto(v); });
    req.on('error', reject);
  });
  const uid = p => `${p}-${crypto.randomBytes(5).toString('hex')}`;

  // ---------- Tiempo real (solo SSE en local; en Vercel el navegador consulta /api/version) ----------
  const suscriptores = new Set();
  let ping = null;
  function avisarCambio(version, origen) {
    const msg = `event: datos\ndata: ${JSON.stringify({ version, origen })}\n\n`;
    for (const r of suscriptores) r.write(msg);
  }
  async function eventos(req, res) {
    const db = await cargarDB();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 2000\nevent: hola\ndata: ${JSON.stringify({ version: db.version })}\n\n`);
    suscriptores.add(res); req.on('close', () => suscriptores.delete(res));
    ping ||= setInterval(() => { for (const r of suscriptores) r.write(': ping\n\n'); }, 25000); // mantiene viva la conexión
  }

  // ---------- API ----------
  async function api(req, res, col, id) {
    const m = req.method;
    const info = { tiempoReal, persistente: store.persistente, entorno: EN_VERCEL ? 'vercel' : 'local', almacenamiento: store.nombre, acceso: auth.requerida };
    if (col === 'info' && m === 'GET') return send(res, 200, info);
    if (col === 'eventos' && m === 'GET') {
      if (tiempoReal !== 'sse') return send(res, 404, { error: 'Use /api/version (sondeo)' });
      return eventos(req, res);
    }
    const db = await cargarDB();
    if (col === 'version' && m === 'GET') return send(res, 200, { version: db.version, ...info });
    if (col === 'db' && m === 'GET') { const { idem: _i, ...resto } = db; return send(res, 200, { ...resto, _info: info }); }

    // ---- Idempotencia: la misma operación repetida (doble clic, reintento por red) no escribe dos veces ----
    // El navegador manda "Idempotency-Key" por acción; la respuesta se guarda junto con los datos (misma escritura),
    // así que también funciona entre instancias de Vercel. Se conservan las últimas 200 claves (máx. 3 días).
    const clave = m !== 'GET' ? String(req.headers['idempotency-key'] || '').slice(0, 80) : '';
    if (clave && db.idem?.[clave]) {
      const prev = db.idem[clave];
      return send(res, prev.status, prev.body, { 'X-Version': String(db.version), 'X-Idempotente': 'repetida' });
    }
    const ok = async (code, body) => { // guarda, avisa y responde con la versión nueva
      if (clave) {
        const limite = Date.now() - 3 * 864e5;
        const vivas = Object.entries(db.idem || {}).filter(([, v]) => v.t > limite).sort((a, b) => b[1].t - a[1].t).slice(0, 199);
        db.idem = Object.fromEntries([...vivas, [clave, { t: Date.now(), status: code, body }]]);
      }
      const v = await guardarDB(db);
      avisarCambio(v, String(req.headers['x-cliente'] || ''));
      return send(res, code, body, { 'X-Version': String(v) });
    };
    // ---- Unicidad: un cliente por documento; una bitácora por paciente + mes + código + PBS ----
    const soloDigitos = s => String(s ?? '').replace(/\D/g, '');
    const clientePorDoc = (doc, salvoId) => { const d = soloDigitos(doc); return d ? db.clientes.find(c => c.id !== salvoId && soloDigitos(c.docPaciente) === d) : null; };
    const repetido = c => Object.assign(fallo(`Ya existe un cliente con el documento ${c.docPaciente}: ${c.paciente}`, 409), { existente: c.id });
    const bitacoraIgual = (x, salvoId) => db.bitacoras.find(b => b.id !== salvoId && b.clienteId === x.clienteId && b.periodo === x.periodo
      && (b.codigo || '') === (x.codigo || '') && (b.plan || '') === (x.plan || ''));
    const permiteDuplicado = String(req.headers['x-permitir-duplicado'] || '') === '1';

    if (col === 'config') {
      if (m === 'GET') return send(res, 200, db.config);
      if (m === 'PUT') { db.config = { ...db.config, ...sanearConfig(await readBody(req)) }; return ok(200, db.config); }
    }
    // Importación masiva en UNA sola escritura: { clientes: [{ ref, datos }], bitacoras: [{ clienteId | clienteRef, id?, datos }] }
    // · clientes nuevos llevan "ref" (temporal) para enlazar sus bitácoras · bitácoras con "id" se actualizan (fusión de campos)
    if (col === 'lote' && m === 'POST') {
      const body = await readBody(req);
      // Listas obligatoriamente arreglos (≤ 1000) y cada elemento un objeto: lo inválido es 400, nunca 500
      const elementos = (k, nombre) => {
        const l = body[k] === undefined ? [] : lista(body[k], k);
        l.forEach((x, n) => { if (!esObjeto(x)) throw fallo(`${nombre} #${n + 1} del lote no es válido`); if (x.datos !== undefined && !esObjeto(x.datos)) throw fallo(`${nombre} #${n + 1}: "datos" debe ser un objeto`); });
        return l;
      };
      const loteClientes = elementos('clientes', 'Cliente'), loteBitacoras = elementos('bitacoras', 'Bitácora');
      const refs = Object.create(null), creados = [], tocadas = [];
      const refDe = r => (r === undefined || r === null || r === '' ? '' : texto(r, 'ref', 80));
      // Datos de ruta que trae el PDF; a un cliente existente se le actualizan SOLO estos (nunca firma, # ID ni acudiente)
      const RUTA = ['origen', 'ips', 'regreso', 'horaIda', 'horaRegreso', 'codigo'];
      const actualizados = [];
      for (const { ref: refCruda, id: cidExistente, datos = {} } of loteClientes) {
        const ref = refDe(refCruda);
        let ya = cidExistente ? db.clientes.find(c => c.id === cidExistente) : null, nuevo = null;
        if (!ya) { nuevo = sanearCliente(datos, true); ya = clientePorDoc(nuevo.docPaciente); } // existente por documento o creado antes en este lote
        if (ya) {
          if (ref) refs[ref] = ya.id;
          if (cidExistente) {
            const ruta = sanearCliente(Object.fromEntries(RUTA.filter(k => tiene(datos, k)).map(k => [k, datos[k]])));
            for (const k of RUTA) if (ruta[k]) ya[k] = ruta[k];
            actualizados.push(ya.id);
          }
          continue;
        }
        const c = { firmante: 'acudiente', ...nuevo, id: uid('c'), firma: null, firmaId: null, creado: new Date().toISOString().slice(0, 10) };
        db.clientes.push(c); creados.push(c.id); if (ref) refs[ref] = c.id;
      }
      for (const [n, { clienteId, clienteRef, id: bid, datos = {} }] of loteBitacoras.entries()) {
        const cid = clienteId || refs[refDe(clienteRef)];
        if (typeof cid !== 'string' || !db.clientes.some(c => c.id === cid)) throw fallo(`Bitácora sin cliente válido (${String(clienteRef || clienteId || '').slice(0, 80)})`);
        // En la importación el paciente de una bitácora NO cambia (eso solo se hace desde el editor)
        if (tiene(datos, 'clienteId') && datos.clienteId !== cid) throw fallo(`Bitácora #${n + 1}: no se puede cambiar el paciente desde la importación`);
        // Destino: la indicada por id, o la que ya existe para el mismo paciente + mes + código + PBS (reimportar no duplica)
        let i = bid ? db.bitacoras.findIndex(b => b.id === bid) : -1;
        if (i >= 0 && db.bitacoras[i].clienteId !== cid) throw fallo(`Bitácora #${n + 1}: la bitácora ${bid} pertenece a otro paciente`);
        const limpio = sanearBitacora(datos, i >= 0 ? db.bitacoras[i] : null);
        delete limpio.clienteId;
        if (i < 0) { const igual = bitacoraIgual({ ...limpio, clienteId: cid }); if (igual) i = db.bitacoras.indexOf(igual); }
        if (i >= 0) { const b = db.bitacoras[i]; db.bitacoras[i] = { ...b, ...limpio, id: b.id, clienteId: cid }; tocadas.push(b.id); }
        else { const b = { ...BITACORA_NUEVA, ...limpio, id: uid('b'), clienteId: cid, creado: new Date().toISOString().slice(0, 10) }; db.bitacoras.push(b); tocadas.push(b.id); }
      }
      return ok(200, { clientes: creados, actualizados, bitacoras: tocadas, refs });
    }
    if (col === 'clientes' || col === 'bitacoras') {
      const list = db[col];
      if (m === 'GET' && !id) return send(res, 200, list);
      if (m === 'GET') { const it = list.find(x => x.id === id); return it ? send(res, 200, it) : send(res, 404, { error: 'No encontrado' }); }
      if (m === 'POST') {
        const body = await readBody(req);
        // Validar ANTES de subir anexos (si no, un repetido dejaría imágenes huérfanas en el almacenamiento)
        const limpio = col === 'clientes' ? sanearCliente(body, true) : sanearBitacora(body);
        if (col === 'clientes') { const ya = clientePorDoc(limpio.docPaciente); if (ya) throw repetido(ya); }
        if (col === 'bitacoras' && !db.clientes.some(c => c.id === limpio.clienteId)) throw fallo('La bitácora debe tener un paciente existente (clienteId)');
        if (col === 'bitacoras' && !permiteDuplicado) {
          const igual = bitacoraIgual(limpio);
          if (igual) throw Object.assign(fallo('Ya existe una bitácora de este paciente para ese mes con el mismo código', 409), { existente: igual.id });
        }
        const base = col === 'clientes' ? { firmante: 'acudiente' } : BITACORA_NUEVA;
        const it = { ...base, ...limpio, id: uid(col === 'clientes' ? 'c' : 'b'), creado: new Date().toISOString().slice(0, 10) };
        if (col === 'clientes') { it.firma = null; it.firmaId = null; await aplicarAnexos(it, { firma: body.firma ?? null, firmaId: body.firmaId ?? null }); }
        list.push(it); return ok(201, it);
      }
      if (m === 'PUT' && id) {
        const i = list.findIndex(x => x.id === id);
        if (i < 0) return send(res, 404, { error: 'No encontrado' });
        const body = await readBody(req);
        const limpio = col === 'clientes' ? sanearCliente(body) : sanearBitacora(body, list[i]);
        if (col === 'clientes' && 'docPaciente' in limpio) { const ya = clientePorDoc(limpio.docPaciente, id); if (ya) throw repetido(ya); }
        // Desde el editor SÍ se puede pasar la bitácora a otro paciente, siempre que exista
        if (col === 'bitacoras' && 'clienteId' in limpio && limpio.clienteId !== list[i].clienteId && !db.clientes.some(c => c.id === limpio.clienteId))
          throw fallo('El paciente indicado (clienteId) no existe');
        if (col === 'clientes') await aplicarAnexos(list[i], body); // firma / # ID: solo por aquí
        list[i] = { ...list[i], ...limpio, id }; return ok(200, list[i]);
      }
      if (m === 'DELETE' && id) {
        if (!list.some(x => x.id === id)) return send(res, 404, { error: 'No encontrado' }); // no avisar un cambio que no ocurrió
        if (col === 'clientes') { const c = list.find(x => x.id === id); await borrarAnexo(c?.firma); await borrarAnexo(c?.firmaId); }
        db[col] = list.filter(x => x.id !== id);
        if (col === 'clientes') db.bitacoras = db.bitacoras.filter(b => b.clienteId !== id);
        return ok(200, { ok: true });
      }
    }
    send(res, 404, { error: 'Ruta no válida' });
  }

  async function firmas(res, nombre) {
    const bytes = await store.leerArchivo(nombre);
    if (!bytes) { res.writeHead(404); return res.end(); }
    const ext = path.extname(nombre).toLowerCase();
    // nosniff + sandbox: aunque el archivo traiga HTML/script, el navegador no lo ejecuta en nuestro origen
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox',
      ...(ext === '.svg' ? { 'Content-Disposition': 'attachment' } : {}), // SVG viejos: se descargan, no se abren
    });
    res.end(bytes);
  }

  // Manejador único: /api/* y /firmas/*. Devuelve false si la ruta no es suya (archivos estáticos).
  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    // En Vercel las rutas llegan reescritas a /api/index?ruta=<ruta original>
    const pathname = url.searchParams.get('ruta') || url.pathname;
    const parts = pathname.split('/').filter(Boolean);
    try {
      // Escrituras solo con JSON: un formulario o fetch "no-cors" de otro sitio no puede enviar application/json
      // (importa sobre todo en local sin login). /api/logout no lleva cuerpo y queda exento.
      if (parts[0] === 'api' && (req.method === 'POST' || req.method === 'PUT') && parts[1] !== 'logout') {
        const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (tipo !== 'application/json') return send(res, 415, { error: 'Content-Type debe ser application/json' }), true;
      }
      if (parts[0] === 'api' || parts[0] === 'firmas') {
        // /api/info queda abierto (no tiene datos); todo lo demás exige sesión si el acceso está activo
        const col = parts[0] === 'api' ? parts[1] : 'firmas';
        if (col !== 'info' && await auth.manejar(req, res, col, { readBody, send })) return true;
      }
      if (parts[0] === 'api') {
        for (let intento = 1; ; intento++) {
          try { await api(req, res, parts[1], parts[2] ? decodeURIComponent(parts[2]) : undefined); break; }
          catch (e) { if (!e.conflicto || intento >= 8) throw e; await new Promise(r => setTimeout(r, 40 * intento + Math.random() * 80)); } // releer y reintentar
        }
        return true;
      }
      if (parts[0] === 'firmas') { await firmas(res, decodeURIComponent(parts[1] || '')); return true; }
      return false;
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Error interno: ' + e.message, ...(e.existente ? { existente: e.existente } : {}) });
      return true;
    }
  }

  return { handler, store, auth };
}

module.exports = { crearApp };
