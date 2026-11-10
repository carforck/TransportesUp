// Transportes UP — servidor local sin dependencias (Node >= 20)
// API JSON + archivos estáticos + recarga en vivo (SSE)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const FIRMAS = path.join(__dirname, 'data', 'firmas'); // equivalente al bucket 'firmas'
fs.mkdirSync(FIRMAS, { recursive: true });

// ---------- Base de datos (archivo JSON) ----------
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

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { saveDB(SEED); return structuredClone(SEED); }
}
function saveDB(db) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
let db = loadDB();
// Migración: se retiró el enlace público de firma
if (db.clientes.some(c => 'token' in c)) { db.clientes.forEach(c => delete c.token); saveDB(db); }

// ---------- Firmas (archivo en data/firmas, la BD guarda solo la ruta) ----------
const TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const MAX_BYTES = 2 * 1024 * 1024;      // firma procesada: 2 MB, igual que cuentas de cobro
const MAX_ORIGINAL = 8 * 1024 * 1024;   // anexo original (foto/escaneo) que se conserva como soporte
function borrarFirma(firma) {
  for (const k of ['archivo', 'original']) if (firma?.[k]) fs.rmSync(path.join(FIRMAS, path.basename(firma[k])), { force: true });
}
function decodificar(dataUrl, max, etiqueta) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  const fallo = msg => Object.assign(new Error(msg), { status: 400 });
  if (!m || !TIPOS[m[1]]) throw fallo(`Formato de ${etiqueta} no soportado. Usa PNG, JPG, WEBP o SVG.`);
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length < 200) throw fallo(`La ${etiqueta} está vacía.`);
  if (bytes.length > max) throw fallo(`La ${etiqueta} excede ${max / 1048576} MB.`);
  return { bytes, ext: TIPOS[m[1]] };
}
// Anexos del cliente con la misma dinámica: 'firma' (firma) y 'firmaId' (# ID escrito a mano)
const ANEXOS = { firma: 'firma', firmaId: 'imagen del documento (# ID)' };
function guardarFirma(cliente, entrada, campo = 'firma') {
  // entrada: { tipo: 'escaneada'|'diligenciada', data: PNG sin fondo, original?: anexo tal como se subió }
  const firma = decodificar(entrada?.data, MAX_BYTES, ANEXOS[campo]);
  const orig = entrada.original ? decodificar(entrada.original, MAX_ORIGINAL, 'imagen original') : null;
  const base = `${cliente.id}-${campo === 'firmaId' ? 'id-' : ''}${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(path.join(FIRMAS, `${base}.${firma.ext}`), firma.bytes);
  if (orig) fs.writeFileSync(path.join(FIRMAS, `${base}-original.${orig.ext}`), orig.bytes);
  borrarFirma(cliente[campo]);
  return {
    tipo: entrada.tipo === 'diligenciada' ? 'diligenciada' : 'escaneada',
    archivo: `/firmas/${base}.${firma.ext}`,
    original: orig ? `/firmas/${base}-original.${orig.ext}` : null,
    fecha: new Date().toISOString().slice(0, 10),
  };
}
// Aplica cambios de firma que vengan en el body (data nueva, null para quitar, o sin cambio)
function aplicarFirma(cliente, body) {
  for (const campo of Object.keys(ANEXOS)) {
    if (!(campo in body)) continue;
    if (body[campo] === null) { borrarFirma(cliente[campo]); cliente[campo] = null; }
    else if (body[campo]?.data) cliente[campo] = guardarFirma(cliente, body[campo], campo);
    delete body[campo];
  }
}

// ---------- Utilidades HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 15e6) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
const uid = p => `${p}-${crypto.randomBytes(5).toString('hex')}`;

// ---------- Recarga en vivo ----------
const clients = new Set();
let debounce;
fs.watch(PUB, { recursive: true }, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => clients.forEach(r => r.write('data: reload\n\n')), 120);
});

// ---------- Tiempo real: avisa a todos los navegadores cuando cambian los datos ----------
const suscriptores = new Set();
let version = Date.now();
function avisarCambio(origen) {
  version++;
  const msg = `event: datos\ndata: ${JSON.stringify({ version, origen })}\n\n`;
  for (const r of suscriptores) r.write(msg);
}
setInterval(() => { for (const r of suscriptores) r.write(': ping\n\n'); }, 25000); // mantiene viva la conexión (proxies, celulares)

// ---------- API ----------
async function api(req, res, parts) {
  const [, , col, id] = parts; // /api/:col/:id
  const m = req.method;

  if (col === 'db' && m === 'GET') return send(res, 200, db);

  if (col === 'config') {
    if (m === 'GET') return send(res, 200, db.config);
    if (m === 'PUT') { db.config = { ...db.config, ...(await readBody(req)) }; saveDB(db); return send(res, 200, db.config); }
  }

  if (col === 'clientes' || col === 'bitacoras') {
    const list = db[col];
    if (m === 'GET' && !id) return send(res, 200, list);
    if (m === 'GET') { const it = list.find(x => x.id === id); return it ? send(res, 200, it) : send(res, 404, { error: 'No encontrado' }); }
    if (m === 'POST') {
      const body = await readBody(req);
      const it = { ...body, id: uid(col === 'clientes' ? 'c' : 'b'), creado: new Date().toISOString().slice(0, 10) };
      if (col === 'clientes') { it.firma = null; it.firmaId = null; aplicarFirma(it, { firma: body.firma ?? null, firmaId: body.firmaId ?? null }); }
      list.push(it); saveDB(db); return send(res, 201, it);
    }
    if (m === 'PUT' && id) {
      const i = list.findIndex(x => x.id === id);
      if (i < 0) return send(res, 404, { error: 'No encontrado' });
      const body = await readBody(req);
      if (col === 'clientes') aplicarFirma(list[i], body);
      list[i] = { ...list[i], ...body, id }; saveDB(db); return send(res, 200, list[i]);
    }
    if (m === 'DELETE' && id) {
      if (col === 'clientes') { const c = list.find(x => x.id === id); borrarFirma(c?.firma); borrarFirma(c?.firmaId); }
      db[col] = list.filter(x => x.id !== id);
      if (col === 'clientes') db.bitacoras = db.bitacoras.filter(b => b.clienteId !== id);
      saveDB(db); return send(res, 200, { ok: true });
    }
  }
  send(res, 404, { error: 'Ruta no válida' });
}

// ---------- Servidor ----------
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/');
  try {
    if (url.pathname === '/__reload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 1000\n\n');
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/eventos') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 2000\nevent: hola\ndata: ${JSON.stringify({ version })}\n\n`);
      suscriptores.add(res); req.on('close', () => suscriptores.delete(res));
      return;
    }
    if (parts[1] === 'api') {
      await api(req, res, parts);
      if (req.method !== 'GET' && res.statusCode < 300) avisarCambio(String(req.headers['x-cliente'] || ''));
      return;
    }
    if (parts[1] === 'firmas') {
      const f = path.join(FIRMAS, path.basename(decodeURIComponent(parts[2] || '')));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }

    let file = path.normalize(path.join(PUB, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUB, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`Transportes UP → http://localhost:${PORT}`));
