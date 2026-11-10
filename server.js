// Transportes UP — servidor LOCAL sin dependencias (Node >= 20).
// Sirve public/, delega /api/* y /firmas/* en lib/app.js y recarga el navegador al editar (desarrollo).
// En Vercel no se usa este archivo: allí la función es api/index.js (ver vercel.json).
const http = require('http');
const fs = require('fs');
const path = require('path');
// Variables locales opcionales (p. ej. SUPABASE_URL / SUPABASE_SECRET_KEY) desde .env.local, que NUNCA va a git
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const { crearApp } = require('./lib/app');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

const app = crearApp({ tiempoReal: 'sse' });

// Recarga en vivo (solo desarrollo): avisa al navegador cuando cambia algo en public/
const recarga = new Set();
let espera;
fs.watch(PUB, { recursive: true }, () => {
  clearTimeout(espera);
  espera = setTimeout(() => recarga.forEach(r => r.write('data: reload\n\n')), 120);
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    recarga.add(res); req.on('close', () => recarga.delete(res));
    return;
  }
  if (await app.handler(req, res)) return;
  // Archivos estáticos (la app usa rutas con #, así que todo lo demás es index.html)
  let file = path.normalize(path.join(PUB, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUB, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Transportes UP → http://localhost:${PORT} · almacenamiento: ${app.store.nombre} (${app.store.dir})${app.store.persistente ? '' : ' TEMPORAL'}`));
