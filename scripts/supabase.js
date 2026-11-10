#!/usr/bin/env node
// Herramienta de Supabase para Transportes UP (sin dependencias, Node ≥ 20).
// Lee las variables de .env.local (nunca va a git).
//
//   node scripts/supabase.js estado                  → verifica conexión, tabla y bucket
//   node scripts/supabase.js esquema                 → ejecuta supabase/migrations/*.sql (API de administración)
//   node scripts/supabase.js subir-datos [--prueba] [--forzar]
//                                                    → copia data/db.json y data/firmas/ a Supabase
//
// Variables:
//   SUPABASE_URL           https://<ref>.supabase.co
//   SUPABASE_SECRET_KEY    sb_secret_… (Project Settings → API Keys)        → estado / subir-datos
//   SUPABASE_ACCESS_TOKEN  sbp_…  (Account → Access Tokens)                 → esquema
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
try {
  for (const l of fs.readFileSync(path.join(RAIZ, '.env.local'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.SUPABASE_SECRET_KEY || '';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const API = (process.env.SUPABASE_API_URL || 'https://api.supabase.com').replace(/\/+$/, '');
const REF = (/^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(URL_) || [])[1] || process.env.SUPABASE_REF || '';
const args = process.argv.slice(2), cmd = args[0], PRUEBA = args.includes('--prueba'), FORZAR = args.includes('--forzar');
const h = (extra = {}) => ({ apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, ...extra });
const kb = n => (n / 1024).toFixed(1) + ' KB';
const salir = msg => { console.error('✗ ' + msg); process.exit(1); };
const falta = (...v) => { const f = v.filter(x => !process.env[x]); if (f.length) salir(`Falta ${f.join(', ')} en .env.local (ver .env.example).`); };

async function sql(query) {
  if (!REF) salir('No se pudo deducir el ref del proyecto desde SUPABASE_URL.');
  const r = await fetch(`${API}/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const t = await r.text();
  if (!r.ok) salir(`La API de administración respondió ${r.status}: ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return t; }
}

async function estado() {
  falta('SUPABASE_URL', 'SUPABASE_SECRET_KEY');
  console.log(`Proyecto: ${URL_}`);
  const r = await fetch(`${URL_}/rest/v1/app_estado?id=eq.1&select=version,actualizado`, { headers: h() });
  if (r.status === 401 || r.status === 403) salir(`La clave fue rechazada (${r.status}). Revise SUPABASE_SECRET_KEY.`);
  if (r.status === 404 || r.status === 400) console.log('  · Tabla app_estado: NO existe (ejecute: node scripts/supabase.js esquema)');
  else if (r.ok) { const f = await r.json(); console.log(`  ✓ Tabla app_estado: ${f.length ? `con datos (versión ${f[0].version}, ${f[0].actualizado})` : 'vacía'}`); }
  else console.log(`  ? Tabla app_estado: respuesta ${r.status} ${(await r.text()).slice(0, 150)}`);
  const b = await fetch(`${URL_}/storage/v1/bucket/firmas`, { headers: h() });
  if (b.ok) { const j = await b.json(); console.log(`  ✓ Bucket firmas: ${j.public ? '⚠️ PÚBLICO' : 'privado'}, límite ${j.file_size_limit ? kb(j.file_size_limit) : '—'}`); }
  else console.log(`  · Bucket firmas: no existe (${b.status})`);
}

async function esquema() {
  falta('SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN');
  const dir = path.join(RAIZ, 'supabase', 'migrations');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
    console.log(`→ ${f}`);
    if (PRUEBA) { console.log('  (prueba: no se ejecuta)'); continue; }
    await sql(fs.readFileSync(path.join(dir, f), 'utf8'));
    console.log('  ✓ aplicado');
  }
  if (!PRUEBA) {
    const chk = await sql(`select (select count(*) from information_schema.tables where table_schema='public' and table_name='app_estado') as tabla,
      (select relrowsecurity from pg_class where oid='public.app_estado'::regclass) as rls,
      (select public from storage.buckets where id='firmas') as bucket_publico`);
    console.log('Verificación:', JSON.stringify(chk));
  }
}

async function subirDatos() {
  falta('SUPABASE_URL', 'SUPABASE_SECRET_KEY');
  const db = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'db.json'), 'utf8'));
  const dirF = path.join(RAIZ, 'data', 'firmas');
  const archivos = db.clientes.flatMap(c => [c.firma, c.firmaId]).filter(Boolean)
    .flatMap(a => [a.archivo, a.original]).filter(Boolean).map(r => path.basename(r));
  const total = archivos.reduce((s, n) => s + (fs.existsSync(path.join(dirF, n)) ? fs.statSync(path.join(dirF, n)).size : 0), 0);
  console.log(`Local: ${db.clientes.length} cliente(s), ${db.bitacoras.length} bitácora(s), ${archivos.length} archivo(s) (${kb(total)}), versión ${db.version}`);

  const r = await fetch(`${URL_}/rest/v1/app_estado?id=eq.1&select=version`, { headers: h() });
  if (!r.ok) salir(`No se pudo leer app_estado (${r.status}). ¿Se ejecutó el esquema?`);
  const remoto = await r.json();
  if (remoto.length && !FORZAR) salir(`Supabase ya tiene datos (versión ${remoto[0].version}). Use --forzar para reemplazarlos.`);
  if (PRUEBA) { console.log('Prueba: no se subió nada.'); return; }

  for (const n of archivos) {
    const ruta = path.join(dirF, n);
    if (!fs.existsSync(ruta)) { console.log(`  ! falta ${n}`); continue; }
    const tipo = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(n)];
    const up = await fetch(`${URL_}/storage/v1/object/firmas/${encodeURIComponent(n)}`, { method: 'POST', headers: h({ 'Content-Type': tipo, 'x-upsert': 'true' }), body: fs.readFileSync(ruta) });
    if (!up.ok) salir(`Error subiendo ${n}: ${up.status} ${(await up.text()).slice(0, 150)}`);
    console.log(`  ✓ ${n}`);
  }
  const { version, ...datos } = db;
  const nueva = (remoto[0]?.version || 0) + 1;
  const w = remoto.length
    ? await fetch(`${URL_}/rest/v1/app_estado?id=eq.1`, { method: 'PATCH', headers: h({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ datos, version: nueva, actualizado: new Date().toISOString() }) })
    : await fetch(`${URL_}/rest/v1/app_estado`, { method: 'POST', headers: h({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ id: 1, datos, version: nueva }) });
  if (!w.ok) salir(`Error guardando datos: ${w.status} ${(await w.text()).slice(0, 200)}`);
  console.log(`✓ Datos subidos (versión ${nueva}).`);
}

const comandos = { estado, esquema, 'subir-datos': subirDatos };
if (!comandos[cmd]) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
comandos[cmd]().catch(e => salir(e.message));
