// Lógica de la app (API + anexos + tiempo real), sin servidor propio.
// La usan: server.js (local, con SSE) y api/index.js (función de Vercel, con sondeo).
const crypto = require('crypto');
const path = require('path');
const { crearStore, EN_VERCEL } = require('./store');

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
const TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
// Límites pensados para el plan gratuito (Supabase Storage 1 GB): el navegador ya comprime a WebP (~10–40 KB)
const MAX_BYTES = 512 * 1024;           // firma / # ID limpios
const MAX_ORIGINAL = 2 * 1024 * 1024;   // anexo original (foto/escaneo) que se conserva como soporte
const ANEXOS = { firma: 'firma', firmaId: 'imagen del documento (# ID)' };
const fallo = (msg, status = 400) => Object.assign(new Error(msg), { status });

function decodificar(dataUrl, max, etiqueta) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m || !TIPOS[m[1]]) throw fallo(`Formato de ${etiqueta} no soportado. Usa PNG, JPG, WEBP o SVG.`);
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length < 200) throw fallo(`La ${etiqueta} está vacía.`);
  if (bytes.length > max) throw fallo(`La ${etiqueta} pesa ${Math.round(bytes.length / 1024)} KB y el máximo es ${Math.round(max / 1024)} KB. Recorte la imagen o use una foto más pequeña.`);
  return { bytes, ext: TIPOS[m[1]] };
}

function crearApp({ tiempoReal = 'sse' } = {}) {
  const store = crearStore();

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
    if (req.body !== undefined && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return resolve(req.body); // ya parseado por la plataforma
    let data = '';
    req.on('data', c => { data += c; if (data.length > 15e6) { reject(fallo('Cuerpo demasiado grande', 413)); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(fallo('JSON inválido')); } });
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
    const info = { tiempoReal, persistente: store.persistente, entorno: EN_VERCEL ? 'vercel' : 'local', almacenamiento: store.nombre };
    if (col === 'info' && m === 'GET') return send(res, 200, info);
    if (col === 'eventos' && m === 'GET') {
      if (tiempoReal !== 'sse') return send(res, 404, { error: 'Use /api/version (sondeo)' });
      return eventos(req, res);
    }
    const db = await cargarDB();
    if (col === 'version' && m === 'GET') return send(res, 200, { version: db.version, ...info });
    if (col === 'db' && m === 'GET') return send(res, 200, { ...db, _info: info });

    const ok = async (code, body) => { // guarda, avisa y responde con la versión nueva
      const v = await guardarDB(db);
      avisarCambio(v, String(req.headers['x-cliente'] || ''));
      return send(res, code, body, { 'X-Version': String(v) });
    };

    if (col === 'config') {
      if (m === 'GET') return send(res, 200, db.config);
      if (m === 'PUT') { db.config = { ...db.config, ...(await readBody(req)) }; return ok(200, db.config); }
    }
    if (col === 'clientes' || col === 'bitacoras') {
      const list = db[col];
      if (m === 'GET' && !id) return send(res, 200, list);
      if (m === 'GET') { const it = list.find(x => x.id === id); return it ? send(res, 200, it) : send(res, 404, { error: 'No encontrado' }); }
      if (m === 'POST') {
        const body = await readBody(req);
        const it = { ...body, id: uid(col === 'clientes' ? 'c' : 'b'), creado: new Date().toISOString().slice(0, 10) };
        if (col === 'clientes') { it.firma = null; it.firmaId = null; await aplicarAnexos(it, { firma: body.firma ?? null, firmaId: body.firmaId ?? null }); }
        list.push(it); return ok(201, it);
      }
      if (m === 'PUT' && id) {
        const i = list.findIndex(x => x.id === id);
        if (i < 0) return send(res, 404, { error: 'No encontrado' });
        const body = await readBody(req);
        if (col === 'clientes') await aplicarAnexos(list[i], body);
        list[i] = { ...list[i], ...body, id }; return ok(200, list[i]);
      }
      if (m === 'DELETE' && id) {
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(nombre)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  }

  // Manejador único: /api/* y /firmas/*. Devuelve false si la ruta no es suya (archivos estáticos).
  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    // En Vercel las rutas llegan reescritas a /api/index?ruta=<ruta original>
    const pathname = url.searchParams.get('ruta') || url.pathname;
    const parts = pathname.split('/').filter(Boolean);
    try {
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
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Error interno: ' + e.message });
      return true;
    }
  }

  return { handler, store };
}

module.exports = { crearApp };
