// Inicio de sesión (sin dependencias).
// Usuario y contraseña en variables de entorno: APP_USUARIO y APP_CLAVE (Vercel → Environment Variables, o .env.local).
// · La sesión es una cookie firmada (HMAC-SHA256), HttpOnly + SameSite=Lax (+ Secure en https), válida 30 días.
// · La clave de firma sale de SESION_SECRETO o, si no existe, de APP_CLAVE + la clave de Supabase:
//   cambiar la contraseña cierra todas las sesiones abiertas.
// · En Vercel el acceso es SIEMPRE obligatorio: si faltan las variables, la API no entrega datos (falla cerrada).
// · En local solo se exige si APP_USUARIO y APP_CLAVE están definidas.
// · 5 intentos fallidos desde la misma IP → bloqueo de 15 minutos.
const crypto = require('crypto');

const COOKIE = 'tup_sesion';
const DURACION = 30 * 24 * 3600; // segundos
const MAX_FALLOS = 5, BLOQUEO_MS = 15 * 60 * 1000;
const b64 = s => Buffer.from(s).toString('base64url');
const h256 = s => crypto.createHash('sha256').update(String(s)).digest();

function crearAuth({ enVercel }) {
  const USUARIO = (process.env.APP_USUARIO || '').trim().toLowerCase();
  const CLAVE = process.env.APP_CLAVE || '';
  const configurada = !!(USUARIO && CLAVE);
  const requerida = configurada || enVercel;
  const SECRETO = process.env.SESION_SECRETO || h256(`tup|${CLAVE}|${process.env.SUPABASE_SECRET_KEY || ''}`).toString('hex');
  const fallos = new Map(); // ip → { n, hasta }

  const firmar = datos => crypto.createHmac('sha256', SECRETO).update(datos).digest('base64url');
  const iguales = (a, b) => crypto.timingSafeEqual(h256(a), h256(b));
  const ip = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const seguro = req => enVercel || req.headers['x-forwarded-proto'] === 'https';

  function leerCookie(req) {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
    return m ? m[1] : '';
  }
  function sesion(req) {
    if (!configurada) return null;
    const [datos, firma] = leerCookie(req).split('.');
    if (!datos || !firma || !iguales(firma, firmar(datos))) return null;
    try {
      const s = JSON.parse(Buffer.from(datos, 'base64url').toString());
      return s.u === USUARIO && s.exp > Date.now() / 1000 ? s : null;
    } catch { return null; }
  }
  function cookie(req, valor, maxAge) {
    return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${seguro(req) ? '; Secure' : ''}`;
  }

  // Atiende /api/sesion, /api/login y /api/logout. Para el resto de rutas protegidas, responde 401/503 si no hay sesión.
  // Devuelve true si ya respondió.
  async function manejar(req, res, col, { readBody, send }) {
    const m = req.method;
    if (col === 'sesion' && m === 'GET') {
      const s = sesion(req);
      return send(res, 200, { requerida, configurada, autenticado: !requerida || !!s, usuario: s?.u || null }), true;
    }
    if (col === 'logout' && m === 'POST') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) }), true;
    }
    if (col === 'login' && m === 'POST') {
      if (!configurada) return send(res, 503, { error: 'El inicio de sesión no está configurado (faltan APP_USUARIO y APP_CLAVE).' }), true;
      const quien = ip(req), f = fallos.get(quien);
      if (f && f.hasta > Date.now()) {
        const min = Math.ceil((f.hasta - Date.now()) / 60000);
        return send(res, 429, { error: `Demasiados intentos. Espere ${min} minuto${min > 1 ? 's' : ''} e intente de nuevo.` }), true;
      }
      const { usuario = '', clave = '' } = await readBody(req);
      const okU = iguales(String(usuario).trim().toLowerCase(), USUARIO), okC = iguales(String(clave), CLAVE);
      if (!(okU && okC)) {
        const vencido = f?.hasta && f.hasta <= Date.now(); // ya cumplió un bloqueo: empieza de cero
        const n = (f && !vencido ? f.n : 0) + 1;
        fallos.set(quien, { n, hasta: n >= MAX_FALLOS ? Date.now() + BLOQUEO_MS : 0 });
        await new Promise(r => setTimeout(r, 400)); // frena la fuerza bruta
        return send(res, 401, { error: 'Usuario o contraseña incorrectos.' }), true;
      }
      fallos.delete(quien);
      const datos = b64(JSON.stringify({ u: USUARIO, exp: Math.floor(Date.now() / 1000) + DURACION }));
      return send(res, 200, { ok: true, usuario: USUARIO }, { 'Set-Cookie': cookie(req, `${datos}.${firmar(datos)}`, DURACION) }), true;
    }
    if (!requerida) return false;
    if (!configurada) return send(res, 503, { error: 'Acceso bloqueado: configure APP_USUARIO y APP_CLAVE en el servidor.', login: true }), true;
    if (!sesion(req)) return send(res, 401, { error: 'Sesión requerida', login: true }), true;
    return false;
  }

  return { manejar, requerida, configurada };
}

module.exports = { crearAuth };
