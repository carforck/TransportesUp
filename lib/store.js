// Capa de almacenamiento intercambiable.
// Drivers con la MISMA interfaz:
//   · "archivo"  → data/db.json + data/firmas/ (local)
//   · "supabase" → tabla app_estado (JSON versionado) + bucket privado "firmas" (producción / Vercel)
//
// Interfaz (todo asíncrono para que un driver en la nube encaje sin cambiar la app):
//   leer() → objeto db | null        guardar(db, versionAnterior)  (lanza status 409 si otro guardó antes)
//   guardarArchivo(nombre, bytes)    leerArchivo(nombre) → Buffer | null    borrarArchivo(nombre)
//   persistente: boolean (false = los datos se pierden al reiniciar, p. ej. /tmp en Vercel)
const fs = require('fs');
const path = require('path');

const EN_VERCEL = !!process.env.VERCEL;

function storeArchivo(dir, persistente) {
  const DB = path.join(dir, 'db.json'), FIRMAS = path.join(dir, 'firmas');
  fs.mkdirSync(FIRMAS, { recursive: true });
  const ruta = nombre => path.join(FIRMAS, path.basename(String(nombre))); // basename: evita salir de la carpeta
  return {
    nombre: 'archivo',
    persistente,
    dir,
    async leer() {
      try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return null; }
    },
    async guardar(db, _versionAnterior) { // escritura atómica: archivo temporal + rename
      const tmp = DB + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DB);
    },
    async guardarArchivo(nombre, bytes) { fs.writeFileSync(ruta(nombre), bytes); },
    async leerArchivo(nombre) { try { return fs.readFileSync(ruta(nombre)); } catch { return null; } },
    async borrarArchivo(nombre) { fs.rmSync(ruta(nombre), { force: true }); },
  };
}

// ---------- Driver Supabase (sin dependencias: REST de PostgREST + Storage vía fetch) ----------
// Requiere SUPABASE_URL y SUPABASE_SECRET_KEY (clave secreta/service_role: SOLO en el servidor).
// Esquema: supabase/migrations/001_estado_y_firmas.sql (tabla app_estado + bucket privado "firmas").
function storeSupabase(url, clave) {
  const base = url.replace(/\/+$/, '');
  const h = (extra = {}) => ({ apikey: clave, Authorization: `Bearer ${clave}`, ...extra }); // mismos encabezados que usa supabase-js
  const fallo = async (r, que) => {
    const txt = await r.text().catch(() => '');
    return Object.assign(new Error(`Supabase (${que}) respondió ${r.status}: ${txt.slice(0, 200)}`), { status: 502 });
  };
  const enc = n => encodeURIComponent(path.basename(String(n)));
  return {
    nombre: 'supabase',
    persistente: true,
    dir: base,
    async leer() {
      const r = await fetch(`${base}/rest/v1/app_estado?id=eq.1&select=datos,version`, { headers: h() });
      if (!r.ok) throw await fallo(r, 'leer');
      const filas = await r.json();
      if (!filas.length) return null;
      return { ...filas[0].datos, version: filas[0].version };
    },
    async guardar(db, versionAnterior) {
      const { version, ...datos } = db;
      const cuerpo = JSON.stringify({ datos, version, actualizado: new Date().toISOString() });
      // Primera vez: crear la fila. Después: actualizar SOLO si nadie guardó antes (control optimista por versión).
      if (!versionAnterior) {
        const r = await fetch(`${base}/rest/v1/app_estado`, { method: 'POST', headers: h({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
          body: JSON.stringify({ id: 1, datos, version }) });
        if (r.status === 409) throw Object.assign(new Error('Conflicto al crear el estado'), { status: 409, conflicto: true });
        if (!r.ok) throw await fallo(r, 'crear');
        return;
      }
      const r = await fetch(`${base}/rest/v1/app_estado?id=eq.1&version=eq.${versionAnterior}`, {
        method: 'PATCH', headers: h({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: cuerpo });
      if (!r.ok) throw await fallo(r, 'guardar');
      if (!(await r.json()).length) throw Object.assign(new Error('Otra persona guardó al mismo tiempo'), { status: 409, conflicto: true });
    },
    async guardarArchivo(nombre, bytes) {
      const ext = path.extname(nombre).slice(1), tipo = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'application/octet-stream';
      const r = await fetch(`${base}/storage/v1/object/firmas/${enc(nombre)}`, { method: 'POST', headers: h({ 'Content-Type': tipo, 'x-upsert': 'true' }), body: bytes });
      if (!r.ok) throw await fallo(r, 'subir archivo');
    },
    async leerArchivo(nombre) {
      const r = await fetch(`${base}/storage/v1/object/firmas/${enc(nombre)}`, { headers: h() });
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw await fallo(r, 'leer archivo');
      return Buffer.from(await r.arrayBuffer());
    },
    async borrarArchivo(nombre) {
      const r = await fetch(`${base}/storage/v1/object/firmas`, { method: 'DELETE', headers: h({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: [path.basename(String(nombre))] }) });
      if (!r.ok && r.status !== 404) throw await fallo(r, 'borrar archivo');
    },
  };
}

function crearStore() {
  // Supabase si están configuradas las variables (Vercel → Settings → Environment Variables, o .env.local en local)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) return storeSupabase(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  // DATA_DIR permite apuntar a otra carpeta (p. ej. un disco persistente en otro hosting).
  if (process.env.DATA_DIR) return storeArchivo(process.env.DATA_DIR, true);
  // En Vercel el disco es de solo lectura salvo /tmp, que es temporal: modo demostración.
  if (EN_VERCEL) return storeArchivo('/tmp/transporup', false);
  return storeArchivo(path.join(__dirname, '..', 'data'), true);
}

module.exports = { crearStore, EN_VERCEL };
