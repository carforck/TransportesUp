// Capa de almacenamiento intercambiable.
// Hoy: driver "archivo" (data/db.json + data/firmas/). Mañana: un driver en la nube con la MISMA interfaz
// (por ejemplo Postgres/Redis del Marketplace de Vercel para los datos y Vercel Blob para las imágenes).
//
// Interfaz (todo asíncrono para que un driver en la nube encaje sin cambiar la app):
//   leer() → objeto db | null        guardar(db)
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
    async guardar(db) { // escritura atómica: archivo temporal + rename
      const tmp = DB + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DB);
    },
    async guardarArchivo(nombre, bytes) { fs.writeFileSync(ruta(nombre), bytes); },
    async leerArchivo(nombre) { try { return fs.readFileSync(ruta(nombre)); } catch { return null; } },
    async borrarArchivo(nombre) { fs.rmSync(ruta(nombre), { force: true }); },
  };
}

function crearStore() {
  // DATA_DIR permite apuntar a otra carpeta (p. ej. un disco persistente en otro hosting).
  if (process.env.DATA_DIR) return storeArchivo(process.env.DATA_DIR, true);
  // En Vercel el disco es de solo lectura salvo /tmp, que es temporal: modo demostración.
  if (EN_VERCEL) return storeArchivo('/tmp/transporup', false);
  return storeArchivo(path.join(__dirname, '..', 'data'), true);
}

module.exports = { crearStore, EN_VERCEL };
