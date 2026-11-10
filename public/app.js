/* Transportes UP — Bitácoras de transporte especial (SPA sin dependencias) */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
let DB = { config: {}, clientes: [], bitacoras: [] };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoy = () => new Date().toISOString().slice(0, 10);
const periodoTxt = p => { const [y, m] = p.split('-'); return `${MESES[+m - 1]} ${y}`; };
const fechaDoc = iso => { const [y, m, d] = iso.split('-'); return `${+d}/${m}/${y}`; };
const fechaLarga = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${+d} ${MESES[+m - 1].slice(0, 3)} ${y}`; };
const hora12 = h => { if (!h) return ''; let [H, M] = h.split(':').map(Number); const ap = H >= 12 ? 'PM' : 'AM'; H = H % 12 || 12; return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')} ${ap}`; };
const cliente = id => DB.clientes.find(c => c.id === id);
const esPaciente = c => (c.firmante || 'acudiente') === 'paciente';
const nombreFirmante = c => esPaciente(c) ? c.paciente : (c.acudiente || '');
const docFirmante = c => esPaciente(c) ? c.docPaciente : (c.docAcudiente || '');
const anexoSrc = a => a ? `${a.archivo}?v=${encodeURIComponent(a.fecha + a.archivo)}` : '';
const firmaSrc = c => anexoSrc(c?.firma);
const idSrc = c => anexoSrc(c?.firmaId);
const anexosCompletos = c => !!(c?.firma && c?.firmaId);
const faltantes = c => [!c.firma && 'firma', !c.firmaId && '# ID'].filter(Boolean);
const miniAnexos = c => `<span class="anexos">${c.firma ? `<img class="mini" src="${firmaSrc(c)}" alt="firma" title="Firma">` : '<span class="badge b-mute">Sin firma</span>'}${c.firmaId ? `<img class="mini" src="${idSrc(c)}" alt="# ID" title="# ID escrito">` : '<span class="badge b-mute">Sin # ID</span>'}</span>`;
const MODO = { digital: 'Automática', escrita: 'A mano' };
const TITULO_APP = 'Transportes UP · Bitácoras';
// Nombre del PDF descargable: paciente + mes (el navegador usa el título de la página como nombre del archivo)
const nombreArchivo = b => {
  const c = cliente(b.clienteId); const [y, m] = b.periodo.split('-');
  return `${c?.paciente || 'BITACORA'} - ${MESES[+m - 1].toUpperCase()} ${y}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
};

// Identifica esta pestaña para no refrescarse con sus propios cambios
const CLIENTE_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
async function api(method, url, body) {
  const r = await fetch('/api/' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Cliente': CLIENTE_ID }, body: body ? JSON.stringify(body) : undefined });
  const out = await r.json().catch(() => ({}));
  if (out.login && (r.status === 401 || r.status === 503)) { ACCESO.mostrar(out.error); throw new Error('Inicie sesión para continuar'); }
  if (!r.ok) throw new Error(out.error || r.statusText);
  const v = r.headers.get('X-Version'); if (v) VIVO.version = +v; // mi propio cambio: el sondeo no debe tomarlo como ajeno
  return out;
}
async function reload() { DB = await api('GET', 'db'); $('#nit').textContent = DB.config.nit; }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
function modal(html, wide) { const m = $('#modal'); m.innerHTML = `<div class="box" ${wide ? 'style="width:min(860px,100%)"' : ''}>${html}</div>`; m.hidden = false; return m; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; if (VIVO.pendiente) setTimeout(() => VIVO.intentar(), 50); }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
window.addEventListener('unhandledrejection', e => toast('⚠️ ' + (e.reason?.message || e.reason)));

function estadoFirma(b) {
  const c = cliente(b.clienteId);
  if (b.estado === 'firmado') return { txt: 'Firmado', cls: 'b-ok' };
  if (b.modoFirma === 'digital' && anexosCompletos(c)) return { txt: 'Firma e ID anexados', cls: 'b-ok' };
  if (b.modoFirma === 'digital') return { txt: 'Falta ' + faltantes(c || {}).join(' y '), cls: 'b-warn' };
  return { txt: b.agendaFirma ? `Firma a mano ${fechaLarga(b.agendaFirma)}` : 'Pendiente firma a mano', cls: 'b-warn' };
}
const firmaBadge = c => c.firma
  ? `<span class="badge ${c.firma.tipo === 'escaneada' ? 'b-esc' : 'b-dig'}">${c.firma.tipo === 'escaneada' ? 'Escaneada' : 'Diligenciada'}</span>`
  : '<span class="badge b-mute">Sin firma</span>';
const modoBadge = b => `<span class="badge ${b.modoFirma === 'digital' ? 'b-dig' : 'b-esc'}">${MODO[b.modoFirma] || b.modoFirma}</span>`;

/* ================= Router ================= */
const routes = { '': viewDashboard, clientes: viewClientes, registros: viewRegistros, bitacoras: viewBitacoras, bitacora: viewBitacora, agenda: viewAgenda, config: viewConfig };
async function router() {
  const [ruta, qs = ''] = location.hash.replace(/^#/, '').split('?');
  let [, name = '', id = ''] = ruta.split('/');
  id = name === 'registros' ? qs : id + (qs ? '?' + qs : '');
  $$('.sidebar nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (name || 'dashboard') || (name === 'bitacora' && a.dataset.nav === 'bitacoras')));
  window.__bitOcupado = null; // solo la vista de bitácora lo define
  await reload();
  document.title = TITULO_APP;
  (routes[name] || viewDashboard)(id);
}
window.addEventListener('hashchange', () => { router(); window.scrollTo(0, 0); });

/* ================= Dashboard ================= */
/* ================= Dashboard ================= */
// Paleta validada (dataviz validate_palette.js --ordinal, superficie #fff): un solo tono de la marca.
const VIZ = { real: '#6E2A8E', prog: '#B98ACF', calor: ['#F4EEF7', '#C7A0D9', '#9A5BB8', '#6E2A8E'], grid: '#EEE9F1', eje: '#6F6577', tinta: '#241B2B', sup: '#FFFFFF' };
const sumaMes = (m, fn) => DB.bitacoras.filter(b => b.periodo === m).reduce((s, b) => s + fn(b), 0);
const mesMas = (m, d) => { const [y, mm] = m.split('-').map(Number), x = new Date(y, mm - 1 + d, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
const mesCorto = m => { const [y, mm] = m.split('-'); return MESES[+mm - 1].slice(0, 3); };
const nfmt = n => n.toLocaleString('es-CO');

// Datos de un mes: realizado (fecha ≤ hoy), programado (fecha futura), pacientes atendidos
function datosMes(m) {
  const h = hoy(); let real = 0, prog = 0; const pac = new Set();
  for (const b of DB.bitacoras.filter(b => b.periodo === m)) {
    const fs = fechasDe(b); if (fs.length) pac.add(b.clienteId);
    for (const f of fs) f <= h ? real++ : prog++;
  }
  return { m, real, prog, total: real + prog, pac: pac.size };
}
// Proyección: promedio de servicios de los 3 meses anteriores al mes proyectado
const proyeccion = m => { const prev = [1, 2, 3].map(d => datosMes(mesMas(m, -d)).total); return Math.round(prev.reduce((a, b) => a + b, 0) / 3); };

/* ---- Tooltip compartido (texto con textContent: los nombres son datos) ---- */
function tip() { let t = $('#viztip'); if (!t) { t = document.createElement('div'); t.id = 'viztip'; t.className = 'viz-tip'; t.setAttribute('role', 'tooltip'); t.hidden = true; document.body.appendChild(t); } return t; }
function mostrarTip(ev, filas) {
  const t = tip(); t.replaceChildren();
  for (const [valor, etiqueta, color] of filas) {
    const r = document.createElement('div'); r.className = 'viz-tip-row';
    if (color) { const k = document.createElement('i'); k.style.background = color; r.appendChild(k); }
    const v = document.createElement('b'); v.textContent = valor; r.appendChild(v);
    if (etiqueta) { const l = document.createElement('span'); l.textContent = etiqueta; r.appendChild(l); }
    t.appendChild(r);
  }
  t.hidden = false;
  const rect = ev.target.getBoundingClientRect?.(), x = ev.clientX ?? (rect.left + rect.width / 2), y = ev.clientY ?? rect.top;
  const w = t.offsetWidth, hgt = t.offsetHeight;
  t.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
  t.style.top = (y - hgt - 12 < 8 ? y + 18 : y - hgt - 12) + 'px';
}
const ocultarTip = () => { const t = $('#viztip'); if (t) t.hidden = true; };
function conectarTips(raiz, datos) {
  raiz.querySelectorAll('[data-tip]').forEach(el => {
    const f = ev => mostrarTip(ev, datos[el.dataset.tip]);
    el.addEventListener('pointermove', f); el.addEventListener('focus', f);
    el.addEventListener('pointerleave', ocultarTip); el.addEventListener('blur', ocultarTip);
  });
}

/* ---- Gráfico 1: servicios por mes (histórico + proyección) ---- */
function graficoMeses(el, meses, sel, alClic) {
  const W = Math.max(300, el.clientWidth), H = 230, m = { t: 26, r: 8, b: 30, l: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, n = meses.length, banda = iw / n, bw = Math.min(24, banda * 0.55);
  const maxV = Math.max(4, ...meses.map(d => Math.max(d.total, d.proy || 0)));
  const paso = maxV <= 8 ? 2 : maxV <= 20 ? 5 : maxV <= 50 ? 10 : maxV <= 100 ? 20 : 50, top = Math.ceil(maxV / paso) * paso;
  const y = v => m.t + ih - (v / top) * ih;
  const col = (x, y0, y1, r) => { const h = y0 - y1; if (h <= 0) return ''; r = Math.min(r, h, bw / 2);
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y0} Z`; };
  const sq = (x, y0, y1) => y0 - y1 > 0 ? `M${x},${y0} V${y1} H${x + bw} V${y0} Z` : '';
  let g = '';
  for (let v = 0; v <= top; v += paso) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${VIZ.grid}" stroke-width="1"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" class="viz-ax">${v}</text>`;
  const datos = {}; let marcas = '';
  meses.forEach((d, i) => {
    const cx = m.l + banda * i + banda / 2, x = cx - bw / 2, base = y(0), esSel = d.m === sel;
    if (esSel) marcas += `<rect x="${m.l + banda * i + 2}" y="${m.t - 18}" width="${banda - 4}" height="${ih + 18}" rx="8" fill="#F7EEFA"/>`;
    const yR = y(d.real), yP = y(d.total), gap = d.real && d.prog ? 2 : 0;
    // realizado abajo (cuadrado en la base, redondeado arriba si no hay programado encima)
    if (d.real) marcas += `<path d="${d.prog ? sq(x, base, yR) : col(x, base, yR, 4)}" fill="${VIZ.real}"/>`;
    if (d.prog) marcas += `<path d="${col(x, d.real ? yR - gap : base, yP - gap, 4)}" fill="${VIZ.prog}"/>`;
    if (d.proy > d.total) { // proyección: lo que falta para el promedio, rayado
      const y0 = d.total ? yP - 2 - (d.prog ? 2 : 0) : base;
      marcas += `<path d="${col(x, y0, y(d.proy), 4)}" fill="url(#rayas)"/>`;
    }
    const etiqueta = d.proy > d.total ? `~${d.proy}` : (d.total ? d.total : '');
    if (etiqueta !== '' && (esSel || d.proy > d.total || i === n - 2 || d.total === Math.max(...meses.map(z => z.total))))
      marcas += `<text x="${cx}" y="${y(Math.max(d.total, d.proy || 0)) - 6}" text-anchor="middle" class="viz-val">${etiqueta}</text>`;
    const anio = d.m.slice(0, 4), mostrarAnio = i === 0 || d.m.endsWith('-01');
    marcas += `<text x="${cx}" y="${H - 12}" text-anchor="middle" class="viz-ax ${esSel ? 'viz-sel' : ''}">${mesCorto(d.m)}</text>`;
    if (mostrarAnio) marcas += `<text x="${cx}" y="${H - 1}" text-anchor="middle" class="viz-ax viz-anio">${anio}</text>`;
    datos[d.m] = [[`${nfmt(d.total)} servicios`, periodoTxt(d.m)], ...(d.real ? [[nfmt(d.real), 'realizados', VIZ.real]] : []),
      ...(d.prog ? [[nfmt(d.prog), 'programados', VIZ.prog]] : []), ...(d.proy > d.total ? [[`~${d.proy}`, 'proyección (promedio 3 meses)', VIZ.real]] : []),
      [`${d.pac}`, d.pac === 1 ? 'paciente' : 'pacientes']];
    marcas += `<rect x="${m.l + banda * i}" y="${m.t - 18}" width="${banda}" height="${ih + 18 + m.b}" fill="transparent" data-tip="${d.m}" data-m="${d.m}" tabindex="0" role="button" aria-label="${periodoTxt(d.m)}: ${d.total} servicios" class="viz-hit"/>`;
  });
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Servicios por mes, histórico y proyección">
    <defs><pattern id="rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#F3E9F8"/><line x1="0" y1="0" x2="0" y2="6" stroke="${VIZ.real}" stroke-width="2"/></pattern></defs>
    ${g}${marcas}<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="#D9D0E0" stroke-width="1"/></svg>`;
  conectarTips(el, datos);
  el.querySelectorAll('[data-m]').forEach(r => { r.onclick = () => alClic(r.dataset.m); r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alClic(r.dataset.m); } }; });
}

/* ---- Gráfico 2: actividad diaria del mes (calendario de calor) ---- */
function calorMes(m) {
  const [y, mm] = m.split('-').map(Number), n = new Date(y, mm, 0).getDate(), off = (new Date(y, mm - 1, 1).getDay() + 6) % 7, h = hoy();
  const porDia = {};
  for (const b of DB.bitacoras.filter(b => b.periodo === m)) for (const f of fechasDe(b)) (porDia[f] ||= []).push(cliente(b.clienteId)?.paciente || '—');
  const datos = {}; let celdas = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<div class="hm-dow">${d}</div>`).join('') + '<div></div>'.repeat(off);
  for (let d = 1; d <= n; d++) {
    const f = `${m}-${String(d).padStart(2, '0')}`, lista = porDia[f] || [], k = Math.min(3, lista.length);
    const dia = DIAS[new Date(f + 'T12:00').getDay()];
    datos[f] = [[lista.length ? `${lista.length} ${lista.length === 1 ? 'paciente' : 'pacientes'}` : 'Sin servicio', `${dia} ${d} de ${MESES[mm - 1]}`],
      ...lista.slice(0, 6).map(nm => ['•', nm]), ...(lista.length > 6 ? [[`+${lista.length - 6}`, 'más']] : [])];
    celdas += `<div class="hm-c ${k >= 2 ? 'osc' : ''} ${f === h ? 'hoy' : ''} ${f > h && lista.length ? 'fut' : ''}" style="background:${VIZ.calor[k]}" data-tip="${f}" tabindex="0" aria-label="${d}: ${lista.length} servicios">${d}</div>`;
  }
  return { html: `<div class="hm">${celdas}</div>`, datos, porDia };
}

/* ---- Gráfico 3: servicios por paciente en el mes (barras ordenadas) ---- */
function barrasPacientes(m) {
  const filas = DB.bitacoras.filter(b => b.periodo === m).map(b => ({ c: cliente(b.clienteId), n: fechasDe(b).length })).filter(x => x.c && x.n)
    .reduce((acc, x) => { const e = acc.find(a => a.c.id === x.c.id); e ? e.n += x.n : acc.push(x); return acc; }, []).sort((a, b) => b.n - a.n);
  const top = filas.slice(0, 8), resto = filas.slice(8), max = Math.max(1, ...filas.map(f => f.n));
  if (resto.length) top.push({ c: { id: '', paciente: `Otros (${resto.length})` }, n: resto.reduce((s, f) => s + f.n, 0) });
  return { filas: top, html: top.map(f => `
    <a class="pb-row" ${f.c.id ? `href="#/registros?m=${m}&c=${f.c.id}"` : ''} title="${esc(f.c.paciente)}">
      <span class="pb-name">${esc(f.c.paciente)}</span>
      <span class="pb-track"><span class="pb-bar" style="width:${(f.n / max * 100).toFixed(1)}%"></span></span>
      <span class="pb-val">${f.n}</span></a>`).join('') };
}

function viewDashboard(param = '') {
  const q = new URLSearchParams((param.split('?')[1]) || '');
  const actual = hoy().slice(0, 7);
  const mes = q.get('m') || mesPorDefecto();
  const rango = +(q.get('r') || 6);
  const ir = cambios => { const n = new URLSearchParams({ m: mes, r: rango, ...cambios }); location.hash = '#/?' + n; };
  window.__dashIr = ir;

  // Meses del histórico: termina en el mes siguiente al actual (proyección) o al seleccionado si es posterior
  const fin = [mesMas(actual, 1), mes].sort().pop();
  const primeroDatos = mesesConDatos().slice(-1)[0];
  let n = rango === 0 ? 12 : rango;
  if (rango === 0 && primeroDatos) { let k = 1, x = fin; while (x > primeroDatos && k < 36) { x = mesMas(x, -1); k++; } n = Math.max(6, k); }
  const meses = Array.from({ length: n }, (_, i) => mesMas(fin, i - n + 1)).map(m => {
    const d = datosMes(m); if (m > actual) d.proy = proyeccion(m); return d; });

  const dSel = datosMes(mes), dAnt = datosMes(mesMas(mes, -1));
  const delta = dSel.total - dAnt.total;
  const completos = DB.clientes.filter(anexosCompletos).length, pct = DB.clientes.length ? Math.round(completos / DB.clientes.length * 100) : 0;
  const pendientes = DB.bitacoras.filter(b => b.estado !== 'firmado' && estadoFirma(b).cls === 'b-warn');
  const sinAnexos = DB.clientes.filter(c => !anexosCompletos(c));
  const proximas = DB.bitacoras.filter(b => b.agendaFirma && b.estado !== 'firmado').sort((a, b) => a.agendaFirma.localeCompare(b.agendaFirma));
  const ahora = new Date();
  const fechaHoy = `${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][ahora.getDay()]} ${ahora.getDate()} de ${MESES[ahora.getMonth()]} de ${ahora.getFullYear()}`;
  const ICON = {
    cli: '<path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-8 1a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm8 1c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4zm-8 0c-.3 0-.7 0-1.1.1A4.7 4.7 0 0 1 9 17v3H1v-3c0-2.2 4.4-4 7-4z"/>',
    bit: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9zM8 13h8v2H8zm0 4h8v2H8z"/>',
    reg: '<path d="M3 5h2v2H3zm4 0h14v2H7zM3 11h2v2H3zm4 0h14v2H7zm-4 6h2v2H3zm4 0h14v2H7z"/>',
    age: '<path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14zM7 12h5v5H7z"/>',
  };
  const kpi = ({ href, icon, lbl, val, hint, tono = '', extra = '' }) => `
    <a class="kpi kpi-link ${tono}" href="${href}" title="Ir a ${lbl}">
      <div class="kpi-top"><span class="kpi-ico"><svg viewBox="0 0 24 24">${ICON[icon]}</svg></span><span class="kpi-go" aria-hidden="true">→</span></div>
      <div class="lbl">${lbl}</div><div class="val">${val}</div><div class="hint">${hint}</div>${extra}
    </a>`;
  const deltaTxt = dAnt.total || dSel.total
    ? `<span class="delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${delta > 0 ? '+' : ''}${delta}</span> vs ${mesCorto(mesMas(mes, -1))}` : 'sin datos del mes anterior';
  const calor = calorMes(mes), pb = barrasPacientes(mes);
  const opMeses = [...new Set([...mesesConDatos(), actual, mesMas(actual, 1), mes])].sort().reverse();

  app.innerHTML = `
    <div class="head dash-head"><div><h1>Hola 👋</h1><p class="sub" style="text-transform:none">${fechaHoy} · ${esc(DB.config.eps)}</p></div>
      <div class="row"><button class="btn" onclick="formCliente()">+ Cliente</button>
        <button class="btn" onclick="importarFormato()" title="Sube una bitácora PDF ya hecha: se leen el paciente y las fechas">⬆ Importar PDF</button>
        <a class="btn primary" href="#/bitacora/nueva?m=${mes}">+ Nueva bitácora</a></div></div>

    <div class="dash-filtros" role="group" aria-label="Filtros del dashboard">
      <div class="mes-pick"><button class="icon-btn" id="dPrev" aria-label="Mes anterior">‹</button>
        <select id="dMes" aria-label="Mes">${opMeses.map(x => `<option value="${x}" ${x === mes ? 'selected' : ''}>${periodoTxt(x)}${x === actual ? ' (actual)' : ''}</option>`).join('')}</select>
        <button class="icon-btn" id="dNext" aria-label="Mes siguiente">›</button></div>
      <div class="seg" role="radiogroup" aria-label="Histórico">${[[6, '6 meses'], [12, '12 meses'], [0, 'Todo']].map(([v, t]) => `<button role="radio" aria-checked="${rango === v}" class="${rango === v ? 'on' : ''}" data-r="${v}">${t}</button>`).join('')}</div>
    </div>

    <div class="kpis">
      ${kpi({ href: `#/registros?m=${mes}`, icon: 'reg', lbl: `Servicios · ${periodoTxt(mes)}`, val: nfmt(dSel.total), hint: `${deltaTxt}<br>${dSel.real} realizados · ${dSel.prog} programados` })}
      ${kpi({ href: `#/registros?m=${mes}`, icon: 'cli', lbl: 'Pacientes atendidos', val: dSel.pac, hint: `${DB.clientes.length} cliente${DB.clientes.length === 1 ? '' : 's'} registrado${DB.clientes.length === 1 ? '' : 's'}` })}
      ${kpi({ href: '#/clientes', icon: 'bit', lbl: 'Anexos completos', val: pct + '%', hint: `${completos} de ${DB.clientes.length} con firma e ID`,
        extra: `<div class="meter" role="img" aria-label="${pct}% con anexos completos"><span style="width:${pct}%"></span></div>` })}
      ${kpi({ href: '#/agenda', icon: 'age', lbl: 'Firmas pendientes', val: pendientes.length, tono: pendientes.length ? 'warn' : 'ok',
        hint: pendientes.length ? `${proximas.length} agendada${proximas.length === 1 ? '' : 's'}` : 'Todo al día ✓' })}
    </div>

    <div class="card">
      <div class="pac-head"><div><h2>Servicios por mes</h2><small class="muted">Histórico y proyección · toque un mes para verlo en detalle</small></div>
        <div class="viz-leg"><span><i style="background:${VIZ.real}"></i>Realizados</span><span><i style="background:${VIZ.prog}"></i>Programados</span><span><i class="rayas"></i>Proyección</span></div></div>
      <div id="gMeses" class="viz"></div>
      <p class="viz-nota">Realizados: fechas hasta hoy · Programados: fechas marcadas que aún no llegan · Proyección (~): promedio de servicios de los 3 meses anteriores; es una estimación, no un dato registrado.</p>
      <details class="viz-tabla"><summary>Ver como tabla</summary>
        <table class="list"><tr><th>Mes</th><th>Realizados</th><th>Programados</th><th>Total</th><th>Proyección</th><th>Pacientes</th></tr>
        ${meses.map(d => `<tr><td>${periodoTxt(d.m)}</td><td>${d.real}</td><td>${d.prog}</td><td><b>${d.total}</b></td><td>${d.proy != null ? '~' + d.proy : '—'}</td><td>${d.pac}</td></tr>`).join('')}</table></details>
    </div>

    <div class="grid2">
      <div class="card">
        <div class="pac-head"><div><h2>Actividad diaria · ${periodoTxt(mes)}</h2><small class="muted">Pacientes con servicio cada día</small></div>
          <div class="viz-leg">${['0', '1', '2', '3+'].map((t, i) => `<span><i style="background:${VIZ.calor[i]}"></i>${t}</span>`).join('')}</div></div>
        ${calor.html}
        <details class="viz-tabla"><summary>Ver como tabla</summary>
          ${Object.keys(calor.porDia).length ? `<table class="list"><tr><th>Fecha</th><th>Pacientes</th></tr>${Object.entries(calor.porDia).sort().map(([f, l]) => `<tr><td>${fechaDoc(f)}</td><td>${l.length} · ${l.map(esc).join(', ')}</td></tr>`).join('')}</table>` : '<div class="empty">Sin servicios en el mes</div>'}</details>
      </div>
      <div class="card">
        <div class="pac-head"><div><h2>Servicios por paciente</h2><small class="muted">${periodoTxt(mes)} · de mayor a menor</small></div><a class="btn sm" href="#/registros?m=${mes}">Registros →</a></div>
        ${pb.filas.length ? `<div class="pb">${pb.html}</div>` : '<div class="empty">Sin servicios en el mes</div>'}
      </div>
    </div>

    ${resumenMes(mes)}

    <div class="grid2">
      <div class="card"><div class="pac-head"><h2>Anexos pendientes</h2><a class="btn sm" href="#/clientes">Clientes →</a></div>
        ${sinAnexos.length ? `<table class="list">${sinAnexos.map(c => `<tr><td>${esc(nombreFirmante(c) || c.paciente)}<br><small class="muted">${esPaciente(c) ? 'Paciente' : 'Acudiente de ' + esc(c.paciente)} · falta ${faltantes(c).join(' y ')}</small></td>
          <td style="text-align:right;white-space:nowrap"><button class="btn sm primary" onclick="capturarFirma('${c.id}')">📎 Adjuntar</button></td></tr>`).join('')}</table>`
          : '<div class="empty">Todos los clientes tienen firma e ID ✓</div>'}
      </div>
      <div class="card"><div class="pac-head"><h2>Próximas firmas agendadas</h2><a class="btn sm" href="#/agenda">Agenda →</a></div>
        ${proximas.length ? `<table class="list">${proximas.slice(0, 6).map(b => { const c = cliente(b.clienteId); return `
          <tr class="click" onclick="location.hash='#/bitacora/${b.id}'"><td><b>${fechaLarga(b.agendaFirma)}</b></td>
          <td>${esc(nombreFirmante(c) || '—')}<br><small class="muted">${esc(c?.paciente || '')} · ${periodoTxt(b.periodo)}</small></td><td>${modoBadge(b)}</td></tr>`; }).join('')}</table>`
          : '<div class="empty">No hay firmas agendadas</div>'}
      </div>
    </div>`;

  const pintar = () => graficoMeses($('#gMeses'), meses, mes, m => ir({ m }));
  pintar();
  conectarTips(app.querySelector('.hm'), calor.datos);
  $('#dMes').onchange = e => ir({ m: e.target.value });
  $('#dPrev').onclick = () => ir({ m: mesMas(mes, -1) });
  $('#dNext').onclick = () => ir({ m: mesMas(mes, 1) });
  app.querySelectorAll('.seg [data-r]').forEach(bt => bt.onclick = () => ir({ r: bt.dataset.r }));
  // redibuja el gráfico al cambiar el ancho (rotar celular, abrir/cerrar menú fijo)
  window.__dashRO?.disconnect();
  window.__dashRO = new ResizeObserver(() => { if ($('#gMeses')) pintar(); });
  window.__dashRO.observe($('#gMeses'));
}

function tablaBitacoras(list, acciones = false) {
  if (!list.length) return '<div class="empty">Aún no hay bitácoras</div>';
  return `<table class="list"><tr><th>Paciente</th><th>Periodo</th><th>Servicios</th><th>Firma</th><th>Estado</th>${acciones ? '<th></th>' : ''}</tr>
    ${list.map(b => { const c = cliente(b.clienteId); const e = estadoFirma(b); return `
      <tr class="click" onclick="location.hash='#/bitacora/${b.id}'"><td><b>${esc(c?.paciente || '(cliente eliminado)')}</b><br><small class="muted">${esc(c?.docPaciente || '')}</small></td>
      <td>${periodoTxt(b.periodo)}</td><td>${fechasDe(b).length} servicios</td><td>${modoBadge(b)}</td>
      <td><span class="badge ${e.cls}">${e.txt}</span></td>
      ${acciones ? `<td style="text-align:right" onclick="event.stopPropagation()">
        <a class="btn sm" href="#/bitacora/${b.id}">✏️ Editar</a>
        <button class="btn sm" onclick="duplicarBitacora('${b.id}')">⧉ Duplicar</button>
        <button class="btn sm danger" onclick="eliminarBitacora('${b.id}')">🗑 Eliminar</button></td>` : ''}</tr>`; }).join('')}</table>`;
}
async function eliminarBitacora(id) {
  const b = DB.bitacoras.find(x => x.id === id), c = cliente(b?.clienteId);
  if (!confirm(`¿Eliminar la bitácora de ${c?.paciente || ''} (${periodoTxt(b.periodo)})? No se puede deshacer.`)) return;
  await api('DELETE', 'bitacoras/' + id); toast('Bitácora eliminada'); router();
}
function duplicarBitacora(id) {
  const b = DB.bitacoras.find(x => x.id === id), c = cliente(b.clienteId);
  const [y, m] = b.periodo.split('-').map(Number), sig = new Date(y, m, 1);
  const mSig = `${sig.getFullYear()}-${String(sig.getMonth() + 1).padStart(2, '0')}`;
  const md = modal(`<h2 style="margin-top:0">Duplicar bitácora</h2>
    <p class="sub">${esc(c?.paciente)} · ${periodoTxt(b.periodo)} → nueva bitácora con el mismo cliente, modo de firma y correcciones de ruta.</p>
    <div class="form"><label>Mes destino<input type="month" id="dm" value="${mSig}"></label>
      <label class="chk" style="align-self:end"><input type="checkbox" id="dd" checked> Copiar los mismos días hábiles (lun–vie del mes destino)</label></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="ok">Duplicar</button></div>`);
  $('#ok', md).onclick = async () => {
    const per = $('#dm', md).value; if (!per) return toast('Elija el mes');
    if (DB.bitacoras.some(x => x.clienteId === b.clienteId && x.periodo === per) && !confirm('Ya existe una bitácora de este cliente en ese mes. ¿Crear otra?')) return;
    const [yy, mm] = per.split('-').map(Number), n = new Date(yy, mm, 0).getDate();
    const fechas = $('#dd', md).checked ? Array.from({ length: n }, (_, i) => `${per}-${String(i + 1).padStart(2, '0')}`).filter(d => { const w = new Date(d + 'T12:00').getDay(); return w > 0 && w < 6; }) : [];
    // las correcciones se trasladan por tramo (ida/regreso) tomando la primera fila corregida como patrón
    const patron = {};
    for (const [k, v] of Object.entries(b.ajustes || {})) { const t = k.split('|')[1]; patron[t] ||= v; }
    const ajustes = {}; fechas.forEach(f => { for (const t of ['ida', 'reg']) if (patron[t]) ajustes[`${f}|${t}`] = { ...patron[t] }; });
    const nueva = await api('POST', 'bitacoras', { clienteId: b.clienteId, periodo: per, fechas, modoFirma: b.modoFirma, agendaFirma: '', estado: 'pendiente', ajustes, excluidas: [] });
    closeModal(); toast('Bitácora duplicada'); location.hash = '#/bitacora/' + nueva.id;
  };
}

/* ================= Clientes ================= */
function viewClientes() {
  app.innerHTML = `
    <div class="head"><div><h1>Clientes</h1><p class="sub">Paciente, quien firma, ruta fija y la firma que se anexa automáticamente a las bitácoras</p></div>
      <button class="btn primary" onclick="formCliente()">+ Nuevo cliente</button></div>
    <div class="card">${DB.clientes.length ? `<table class="list">
      <tr><th>Paciente</th><th>Firma a nombre de</th><th>Ruta</th><th>Firma · # ID</th><th></th></tr>
      ${DB.clientes.map(c => `<tr>
        <td><b>${esc(c.paciente)}</b><br><small class="muted">CC ${esc(c.docPaciente)}</small></td>
        <td>${esc(nombreFirmante(c) || '—')}<br><small class="muted">${esPaciente(c) ? 'Paciente' : 'Acudiente'}${docFirmante(c) ? ' · CC ' + esc(docFirmante(c)) : ''}</small></td>
        <td><small>${esc(c.origen)} → ${esc(c.ips)} → ${esc(c.regreso)}<br>${hora12(c.horaIda)} / ${hora12(c.horaRegreso)}</small></td>
        <td>${miniAnexos(c)}<br><small>${[c.firma?.original && `<a href="${c.firma.original}" target="_blank">anexo firma</a>`, c.firmaId?.original && `<a href="${c.firmaId.original}" target="_blank">anexo # ID</a>`].filter(Boolean).join(' · ')}</small></td>
        <td style="text-align:right;white-space:nowrap">
          <a class="btn sm" href="#/registros?c=${c.id}&m=todos">Registros</a>
          <button class="btn sm" onclick="capturarFirma('${c.id}')">📎 Firma e ID</button>
          <button class="btn sm" onclick="formCliente('${c.id}')">✏️ Editar</button>
          <button class="btn sm danger" onclick="eliminarCliente('${c.id}')">🗑</button>
          <a class="btn sm primary" href="#/bitacora/nueva?c=${c.id}">Bitácora</a></td></tr>`).join('')}
    </table>` : '<div class="empty">Crea tu primer cliente</div>'}</div>`;
}

function formCliente(id, prefill = {}, onSaved) {
  const ult = DB.clientes[DB.clientes.length - 1] || {};
  const c = id ? cliente(id) : { firmante: 'acudiente', origen: ult.origen || '', ips: ult.ips || '', regreso: ult.regreso || '', horaIda: ult.horaIda || '06:20', horaRegreso: ult.horaRegreso || '09:00', ...prefill };
  const f = (k, l, extra = '') => `<label>${l}<input name="${k}" value="${esc(c[k])}" ${extra}></label>`;
  const m = modal(`
    <h2 style="margin-top:0">${id ? 'Editar' : 'Nuevo'} cliente</h2>
    <form id="fc">
      <fieldset><legend>Paciente</legend><div class="form">
        ${f('paciente', 'Nombre completo', 'required')}${f('docPaciente', 'ID paciente', 'required inputmode="numeric"')}</div></fieldset>
      <fieldset><legend>Quién firma la bitácora</legend>
        <div class="radios" style="margin-bottom:12px">
          <label><input type="radio" name="firmante" value="acudiente" ${!esPaciente(c) ? 'checked' : ''}> Acudiente / tercero</label>
          <label><input type="radio" name="firmante" value="paciente" ${esPaciente(c) ? 'checked' : ''}> El mismo paciente</label>
        </div>
        <div class="form" id="acuFields">
          ${f('acudiente', 'Nombre del acudiente')}${f('docAcudiente', '# ID acudiente', 'inputmode="numeric"')}${f('telefono', 'Teléfono de contacto', 'inputmode="tel"')}</div></fieldset>
      <fieldset><legend>Ruta fija</legend><div class="form">
        ${f('origen', 'Dirección de recogida (ida)', 'required')}${f('ips', 'IPS destino', 'required')}
        ${f('regreso', 'Punto de regreso', 'required')}<span></span>
        ${f('horaIda', 'Hora ida', 'type="time" required')}${f('horaRegreso', 'Hora regreso', 'type="time" required')}</div></fieldset>
      <fieldset><legend>Firma</legend>
        <p class="muted" style="margin:0 0 10px">Adjunte la foto o escaneo de la firma: se le quita el fondo automáticamente y se guarda junto con el anexo original.</p>
        <div id="fw"></div></fieldset>
      <fieldset><legend># ID escrito a mano (va al lado de la firma)</legend>
        <p class="muted" style="margin:0 0 10px">Adjunte la foto del número de documento escrito por quien firma. Misma dinámica: se quita el fondo, se valida y se guarda con el original.</p>
        <div id="fwid"></div></fieldset>
      <div class="row" style="justify-content:space-between">
        <div>${id ? `<button type="button" class="btn danger" id="del">Eliminar</button>` : ''}</div>
        <div class="row"><button type="button" class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary">Guardar cliente</button></div>
      </div>
    </form>`, true);
  const w = FirmaWidget($('#fw', m), { actual: c.firma ? firmaSrc(c) : null });
  const docEnForm = () => { const pac = $('input[name=firmante]:checked', m)?.value === 'paciente'; const v = $(`input[name=${pac ? 'docPaciente' : 'docAcudiente'}]`, m)?.value.replace(/\D/g, ''); return v ? 'CC ' + v : ''; };
  const wid = FirmaWidget($('#fwid', m), { actual: c.firmaId ? idSrc(c) : null, clase: 'id', verificar: docEnForm });
  const toggleAcu = () => { const pac = $('input[name=firmante]:checked', m).value === 'paciente'; $$('#acuFields input[name=acudiente], #acuFields input[name=docAcudiente]', m).forEach(i => i.closest('label').hidden = pac); };
  $$('input[name=firmante]', m).forEach(r => r.onchange = toggleAcu); toggleAcu();

  $('#fc', m).onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    ['paciente', 'acudiente', 'origen', 'ips', 'regreso'].forEach(k => data[k] = (data[k] || '').trim().toUpperCase());
    ['docPaciente', 'docAcudiente'].forEach(k => data[k] = (data[k] || '').replace(/\D/g, ''));
    const firma = w.valor(), fid = wid.valor();
    if (firma?.error) return toast('Firma: ' + firma.error);
    if (fid?.error) return toast('# ID: ' + fid.error);
    if (firma) data.firma = firma;
    if (fid) data.firmaId = fid;
    const saved = id ? await api('PUT', 'clientes/' + id, data) : await api('POST', 'clientes', data);
    closeModal(); toast(firma || fid ? 'Cliente y anexos guardados' : 'Cliente guardado');
    if (onSaved) { await reload(); return onSaved(saved); }
    await router();
  };
  if (id) $('#del', m).onclick = async () => {
    if (!confirm('¿Eliminar cliente, su firma y sus bitácoras?')) return;
    await api('DELETE', 'clientes/' + id); closeModal(); toast('Cliente eliminado'); router();
  };
}

async function eliminarCliente(id) {
  const c = cliente(id), n = DB.bitacoras.filter(b => b.clienteId === id).length;
  if (!confirm(`¿Eliminar a ${c.paciente}? También se eliminan su firma, su # ID y ${n} bitácora(s). No se puede deshacer.`)) return;
  await api('DELETE', 'clientes/' + id); toast('Cliente eliminado'); router();
}

/* ================= Firma: adjuntar anexo (o dibujar) ================= */
function capturarFirma(id, onDone) {
  const c = cliente(id);
  const m = modal(`
    <h2 style="margin-top:0">Anexos de ${esc(nombreFirmante(c) || c.paciente)}</h2>
    <p class="sub">Se adjuntan, se les quita el fondo, se validan y se anexan en <b>FIRMA DEL PACIENTE O ACUDIENTE</b> y <b># ID PACIENTE O ACUDIENTE</b> de cada fila.</p>
    <label style="margin-bottom:14px">Número de documento de quien firma (referencia para verificar)<input id="docF" inputmode="numeric" value="${esc(docFirmante(c))}"></label>
    <fieldset><legend>1. Firma ${c.firma ? '<span class="badge b-ok">anexada</span>' : '<span class="badge b-warn">pendiente</span>'}</legend><div id="fw"></div>
      ${c.firma ? '<button class="btn sm danger" id="qF" style="margin-top:10px">Quitar firma</button>' : ''}</fieldset>
    <fieldset><legend>2. # ID escrito a mano ${c.firmaId ? '<span class="badge b-ok">anexado</span>' : '<span class="badge b-warn">pendiente</span>'}</legend><div id="fwid"></div>
      ${c.firmaId ? '<button class="btn sm danger" id="qI" style="margin-top:10px">Quitar # ID</button>' : ''}</fieldset>
    <div class="row" style="justify-content:flex-end;margin-top:6px">
      <button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="ok">Guardar anexos</button>
    </div>`, true);
  const docTxt = () => { const v = $('#docF', m).value.replace(/\D/g, ''); return v ? 'CC ' + v : ''; };
  const w = FirmaWidget($('#fw', m), { actual: c.firma ? firmaSrc(c) : null });
  const wid = FirmaWidget($('#fwid', m), { actual: c.firmaId ? idSrc(c) : null, clase: 'id', verificar: docTxt });
  const terminar = async msg => { closeModal(); toast(msg); if (onDone) { await reload(); onDone(); } else await router(); };
  if (c.firma) $('#qF', m).onclick = async () => { if (confirm('¿Quitar la firma?')) { await api('PUT', 'clientes/' + id, { firma: null }); terminar('Firma eliminada'); } };
  if (c.firmaId) $('#qI', m).onclick = async () => { if (confirm('¿Quitar el # ID?')) { await api('PUT', 'clientes/' + id, { firmaId: null }); terminar('# ID eliminado'); } };
  $('#ok', m).onclick = async () => {
    const firma = w.valor(), fid = wid.valor(), doc = $('#docF', m).value.replace(/\D/g, '');
    if (firma?.error) return toast('Firma: ' + firma.error);
    if (fid?.error) return toast('# ID: ' + fid.error);
    if (!doc) return toast('Escriba el número de documento de referencia');
    const campoDoc = esPaciente(c) ? 'docPaciente' : 'docAcudiente';
    if (!firma && !fid && doc === docFirmante(c)) return toast('Adjunte la firma y/o el # ID');
    const body = { [campoDoc]: doc };
    if (firma) body.firma = firma;
    if (fid) body.firmaId = fid;
    await api('PUT', 'clientes/' + id, body);
    const falta = faltantes({ firma: firma || c.firma, firmaId: fid || c.firmaId });
    terminar(falta.length ? `Guardado. Aún falta: ${falta.join(' y ')}` : 'Firma e ID guardados ✓');
  };
}

function cargarScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Sin conexión para ' + src)); document.head.appendChild(s);
  });
}

/* ================= Cargar formato PDF existente ================= */
function importarFormato() {
  const m = modal(`
    <h2 style="margin-top:0">Importar bitácora PDF</h2>
    <p class="sub">¿Ya tiene la bitácora hecha en Excel/PDF (ej. <code>TNA_901729817_NOMBRE.pdf</code>)? Súbala aquí y no tendrá que marcar las fechas a mano: se leen el <b>ID del paciente</b> y las <b>fechas de servicio</b>, y se crea la bitácora con la firma del cliente ya anexada. Si el paciente no existe, se crea con esos datos.</p>
    <label class="drop" id="drop">📄 Arrastra el PDF aquí o haz clic para elegirlo<input type="file" accept="application/pdf" hidden id="pdf"></label>
    <div id="res" style="margin-top:14px"></div>`);
  const inp = $('#pdf', m), drop = $('#drop', m);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) leer(e.dataTransfer.files[0]); };
  inp.onchange = () => inp.files[0] && leer(inp.files[0]);

  async function leer(file) {
    const res = $('#res', m);
    res.innerHTML = '<div class="empty">Leyendo PDF…</div>';
    try {
      await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      let texto = '';
      for (let i = 1; i <= pdf.numPages; i++) texto += ' ' + (await (await pdf.getPage(i)).getTextContent()).items.map(t => t.str).join(' ');
      const d = analizarFormato(texto, file.name);
      if (!d.fechas.length) { res.innerHTML = '<div class="empty">No encontré fechas en el PDF. Si es un escaneo (imagen) no se puede leer: créalo desde "Nueva bitácora".</div>'; return; }
      mostrar(d);
    } catch (e) { res.innerHTML = `<p class="err">No se pudo leer el PDF: ${esc(e.message)}</p>`; }
  }

  function mostrar(d) {
    const c = DB.clientes.find(x => x.docPaciente === d.docPaciente);
    const meses = [...new Set(d.fechas.map(f => f.slice(0, 7)))];
    $('#res', m).innerHTML = `
      <div class="card" style="margin:0">
        <p><b>Paciente:</b> ${esc(d.nombre || '—')} · <b>ID:</b> ${esc(d.docPaciente || '—')}</p>
        <p><b>${d.fechas.length} fechas</b> en ${meses.map(periodoTxt).join(', ')}: <small class="muted">${d.fechas.map(fechaDoc).join(', ')}</small></p>
        ${c ? `<p>Cliente encontrado: <b>${esc(c.paciente)}</b> ${firmaBadge(c)} ${anexosCompletos(c) ? '— la firma y el # ID se anexarán en todas las filas.' : '— falta ' + faltantes(c).join(' y ') + '; podrá adjuntarlo desde la bitácora.'}</p>`
          : '<p><span class="badge b-warn">Cliente no registrado</span> Se creará con estos datos y podrá anexarle la firma de una vez.</p>'}
        <div class="row" style="justify-content:flex-end"><button class="btn primary" id="crear">${c ? 'Crear bitácora' : 'Crear cliente y bitácora'}</button></div>
      </div>`;
    $('#crear', m).onclick = async () => {
      if (c) return crearBitacoras(c.id, d.fechas);
      formCliente(null, { paciente: d.nombre, docPaciente: d.docPaciente, ...(d.ruta || {}) }, saved => crearBitacoras(saved.id, d.fechas));
    };
  }
}

function analizarFormato(texto, archivo) {
  const t = texto.replace(/\s+/g, ' ');
  const fechas = [...new Set([...t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)].map(([, d, mo, y]) => `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`))].sort();
  const cuenta = {};
  for (const [n] of t.matchAll(/(?<![\w/])\d{6,11}(?![\w/])/g)) if (n !== DB.config.nit) cuenta[n] = (cuenta[n] || 0) + 1;
  const docPaciente = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  // Nombre: del archivo TNA_<NIT>_<NOMBRE>.pdf o del texto antes del ID
  let nombre = (/^TNA_\d+_(.+)\.pdf$/i.exec(archivo) || /^(.+?) - [A-ZÁÉÍÓÚa-záéíóú]+ \d{4}(?: \(\d+\))?\.pdf$/i.exec(archivo) || [])[1] || '';
  if (!nombre && docPaciente) nombre = (new RegExp(`\\d{4}\\s+([A-ZÁÉÍÓÚÑ ]{6,}?)\\s+${docPaciente}`).exec(t) || [])[1] || '';
  return { fechas, docPaciente, nombre: nombre.trim().toUpperCase() };
}

async function crearBitacoras(clienteId, fechas) {
  const porMes = {};
  fechas.forEach(f => (porMes[f.slice(0, 7)] ||= []).push(f));
  let ultima;
  for (const [periodo, fs] of Object.entries(porMes)) {
    const existe = DB.bitacoras.find(b => b.clienteId === clienteId && b.periodo === periodo);
    ultima = existe
      ? await api('PUT', 'bitacoras/' + existe.id, { fechas: [...new Set([...existe.fechas, ...fs])].sort(), modoFirma: 'digital' })
      : await api('POST', 'bitacoras', { clienteId, periodo, fechas: fs, modoFirma: 'digital', agendaFirma: '', estado: 'pendiente' });
  }
  closeModal(); toast('Bitácora creada desde el formato');
  location.hash = '#/bitacora/' + ultima.id;
}

/* ================= Registros por paciente y mes ================= */
const mesesConDatos = () => [...new Set(DB.bitacoras.map(b => b.periodo))].sort().reverse();
const mesPorDefecto = () => { const m = hoy().slice(0, 7), todos = mesesConDatos(); return todos.includes(m) ? m : (todos[0] || m); };
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function resumenMes(mes = mesPorDefecto()) {
  const bits = DB.bitacoras.filter(b => b.periodo === mes);
  if (!bits.length) return '';
  return `<div class="card"><div class="pac-head"><h2>Registros de ${periodoTxt(mes)}</h2><a class="btn sm" href="#/registros?m=${mes}">Ver lista completa →</a></div>
    <table class="list"><tr><th>Paciente</th><th>Servicios</th><th>Firma · # ID</th><th>Estado</th><th></th></tr>
    ${bits.map(b => { const c = cliente(b.clienteId), e = estadoFirma(b); return `<tr>
      <td><b>${esc(c?.paciente)}</b><br><small class="muted">CC ${esc(c?.docPaciente)} · firma ${esc(nombreFirmante(c) || '—')}</small></td>
      <td>${fechasDe(b).length} servicios · ${fechasDe(b).length * 2} filas</td>
      <td>${miniAnexos(c)}</td>
      <td><span class="badge ${e.cls}">${e.txt}</span></td>
      <td style="text-align:right"><a class="btn sm" href="#/registros?m=${mes}&c=${c.id}">Ver registros</a></td></tr>`; }).join('')}</table></div>`;
}

function viewRegistros(qs = '') {
  const p = new URLSearchParams(qs);
  const meses = mesesConDatos();
  const mes = p.get('m') || mesPorDefecto();
  const cid = p.get('c') || '';
  const buscar = (p.get('q') || '').toUpperCase();
  const ir = cambios => { const n = new URLSearchParams({ m: mes, c: cid, q: buscar, ...cambios }); [...n.keys()].forEach(k => !n.get(k) && n.delete(k)); location.hash = '#/registros?' + n; };
  window.__irReg = ir;

  let bits = DB.bitacoras.filter(b => (mes === 'todos' || b.periodo === mes) && (!cid || b.clienteId === cid));
  if (buscar) bits = bits.filter(b => { const c = cliente(b.clienteId); return `${c?.paciente} ${c?.docPaciente} ${c?.acudiente}`.toUpperCase().includes(buscar); });
  const porPac = {};
  bits.forEach(b => (porPac[b.clienteId] ||= []).push(b));
  const servicios = bits.reduce((s, b) => s + b.fechas.length, 0);
  const conFirma = bits.filter(b => b.modoFirma === 'digital' && anexosCompletos(cliente(b.clienteId))).reduce((s, b) => s + b.fechas.length, 0);

  const filasPac = (c, lista) => {
    let html = '';
    for (const b of lista.sort((x, y) => y.periodo.localeCompare(x.periodo))) {
      const firma = b.modoFirma === 'digital' && c.firma;
      if (mes === 'todos') html += `<tr class="mes-sep"><td colspan="6">${periodoTxt(b.periodo)} · ${b.fechas.length} servicios · <a href="#/bitacora/${b.id}">abrir bitácora</a></td></tr>`;
      const rows = filas(b);
      for (const f of fechasDe(b)) {
        const dia = DIAS[new Date(f + 'T12:00').getDay()];
        const ida = rows.find(r => r.key === `${f}|ida` && !r.excl), reg = rows.find(r => r.key === `${f}|reg` && !r.excl);
        const tramo = (r, t) => r ? `${t} ${esc(r.hora)}<div class="ruta">${esc(r.dir)} → ${esc(r.ips)}</div>` : `<span class="muted">${t}: sin servicio</span>`;
        html += `<tr>
          <td><b>${fechaDoc(f)}</b> <small class="muted">${dia}</small></td>
          <td>${tramo(ida, 'Ida')}</td>
          <td>${tramo(reg, 'Regreso')}</td>
          <td>${firma ? `<img class="mini" src="${firmaSrc(c)}" alt="firma">` : `<span class="badge ${b.modoFirma === 'escrita' ? 'b-esc' : 'b-warn'}">${b.modoFirma === 'escrita' ? 'A mano' : 'Sin firma'}</span>`}</td>
          <td>${b.modoFirma !== 'digital' ? '' : c.firmaId ? `<img class="mini" src="${idSrc(c)}" alt="# ID">` : `<span class="badge b-warn">Sin # ID</span>`}</td>
          <td style="text-align:right"><a class="btn sm" href="#/bitacora/${b.id}" title="Editar en la bitácora">✏️</a>
            <button class="btn sm danger" onclick="quitarFecha('${b.id}', '${f}')" title="Quitar esta fecha">🗑</button></td></tr>`;
      }
    }
    return html;
  };

  app.innerHTML = `
    <div class="head"><div><h1>Registros</h1><p class="sub">Servicios de cada paciente en lista, por mes</p></div>
      <div class="row"><button class="btn" onclick="importarFormato()" title="Sube una bitácora PDF ya hecha (TNA_…pdf): se leen el paciente y las fechas y se crea la bitácora con la firma anexada">⬆ Importar bitácora PDF</button></div></div>
    <div class="filtros">
      <label>Mes<select id="fm"><option value="todos" ${mes === 'todos' ? 'selected' : ''}>Todos los meses</option>
        ${[...new Set([...meses, mes === 'todos' ? null : mes].filter(Boolean))].sort().reverse().map(m => `<option value="${m}" ${m === mes ? 'selected' : ''}>${periodoTxt(m)}</option>`).join('')}</select></label>
      <label>Paciente<select id="fc"><option value="">Todos los pacientes</option>
        ${DB.clientes.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.paciente)}</option>`).join('')}</select></label>
      <label>Buscar<input id="fq" type="search" placeholder="Nombre, documento o acudiente" value="${esc(buscar)}"></label>
    </div>
    <div class="chips">
      <span class="chip"><b>${Object.keys(porPac).length}</b> ${Object.keys(porPac).length === 1 ? 'paciente' : 'pacientes'}</span>
      <span class="chip"><b>${servicios}</b> servicios</span>
      <span class="chip"><b>${servicios * 2}</b> filas (ida y regreso)</span>
      <span class="chip"><b>${conFirma}</b> con firma e ID anexados</span>
    </div>
    ${Object.keys(porPac).length ? Object.entries(porPac).map(([id, lista]) => { const c = cliente(id); const n = lista.reduce((s, b) => s + b.fechas.length, 0); return `
      <div class="card">
        <div class="pac-head">
          <div><h2>${esc(c.paciente)}</h2><small class="muted">CC ${esc(c.docPaciente)} · firma: ${esc(nombreFirmante(c) || '—')} ${docFirmante(c) ? '(CC ' + esc(docFirmante(c)) + ')' : ''} · ${n} servicios</small></div>
          <div class="row">${miniAnexos(c)}${anexosCompletos(c) ? '' : ` <button class="btn sm primary" onclick="capturarFirma('${c.id}')">📎 Adjuntar ${faltantes(c).join(' y ')}</button>`}
            <button class="btn sm" onclick="agregarFecha('${c.id}', '${mes === 'todos' ? '' : mes}')">+ Fecha</button>
            ${mes !== 'todos' && lista[0] ? `<a class="btn sm" href="#/bitacora/${lista[0].id}">Abrir / imprimir</a>` : ''}</div>
        </div>
        <table class="list reg"><tr><th>Fecha</th><th>Ida</th><th>Regreso</th><th>Firma</th><th># ID</th><th></th></tr>${filasPac(c, lista)}</table>
      </div>`; }).join('')
      : `<div class="card empty">No hay registros ${mes === 'todos' ? '' : 'en ' + periodoTxt(mes)}${cid ? ' para este paciente' : ''}.</div>`}`;

  $('#fm').onchange = e => ir({ m: e.target.value });
  $('#fc').onchange = e => ir({ c: e.target.value });
  let t; $('#fq').oninput = e => { clearTimeout(t); t = setTimeout(() => ir({ q: e.target.value.trim() }), 350); };
  if (p.has('q')) { const f = $('#fq'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}

async function quitarFecha(bid, f) {
  const b = DB.bitacoras.find(x => x.id === bid);
  if (!confirm(`¿Quitar el servicio del ${fechaDoc(f)} (ida y regreso)?`)) return;
  const fechas = b.fechas.filter(x => x !== f);
  if (!fechas.length && !confirm('Era la única fecha: la bitácora quedará vacía. ¿Eliminar también la bitácora?') ) return;
  if (!fechas.length) { await api('DELETE', 'bitacoras/' + bid); toast('Bitácora eliminada'); return router(); }
  const ajustes = Object.fromEntries(Object.entries(b.ajustes || {}).filter(([k]) => !k.startsWith(f)));
  const excluidas = (b.excluidas || []).filter(k => !k.startsWith(f));
  await api('PUT', 'bitacoras/' + bid, { fechas, ajustes, excluidas }); toast('Fecha quitada'); router();
}
function agregarFecha(cid, mes) {
  const c = cliente(cid);
  const md = modal(`<h2 style="margin-top:0">Agregar servicio</h2><p class="sub">${esc(c.paciente)} · se agregan ida y regreso con la ruta fija del cliente.</p>
    <label>Fecha del servicio<input type="date" id="nfch" value="${mes ? mes + '-01' : hoy()}"></label>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="ok">Agregar</button></div>`);
  $('#ok', md).onclick = async () => {
    const f = $('#nfch', md).value; if (!f) return toast('Elija la fecha');
    const per = f.slice(0, 7), b = DB.bitacoras.find(x => x.clienteId === cid && x.periodo === per);
    if (b?.fechas.includes(f)) return toast('Esa fecha ya está registrada');
    if (b) await api('PUT', 'bitacoras/' + b.id, { fechas: [...b.fechas, f].sort() });
    else await api('POST', 'bitacoras', { clienteId: cid, periodo: per, fechas: [f], modoFirma: 'digital', agendaFirma: '', estado: 'pendiente', ajustes: {}, excluidas: [] });
    closeModal(); toast(b ? 'Fecha agregada' : `Fecha agregada (nueva bitácora de ${periodoTxt(per)})`); router();
  };
}

/* ================= Bitácoras ================= */
function viewBitacoras() {
  const list = [...DB.bitacoras].sort((a, b) => b.periodo.localeCompare(a.periodo));
  app.innerHTML = `
    <div class="head"><div><h1>Bitácoras</h1><p class="sub">Una bitácora por cliente y mes · cada fecha genera las filas de ida y regreso</p></div>
      <div class="row"><button class="btn" onclick="importarFormato()" title="Sube una bitácora PDF ya hecha (TNA_…pdf): se leen el paciente y las fechas y se crea la bitácora con la firma anexada">⬆ Importar bitácora PDF</button><a class="btn primary" href="#/bitacora/nueva">+ Nueva bitácora</a></div></div>
    <div class="card">${tablaBitacoras(list, true)}</div>`;
}

function viewBitacora(param = '') {
  const [id, qs] = param.split('?');
  const nueva = id === 'nueva';
  if (nueva && !DB.clientes.length) { app.innerHTML = '<div class="card empty">Primero crea un cliente. <button class="btn primary" onclick="formCliente()">+ Cliente</button></div>'; return; }
  const pre = new URLSearchParams(qs || '').get('c');
  const mes = new URLSearchParams(qs || '').get('m') || hoy().slice(0, 7);
  const b = nueva ? { clienteId: pre || DB.clientes[0].id, periodo: mes, fechas: [], modoFirma: 'digital', agendaFirma: '', estado: 'pendiente' }
    : structuredClone(DB.bitacoras.find(x => x.id === id) || null);
  if (!b) { app.innerHTML = '<div class="card empty">Bitácora no encontrada</div>'; return; }
  b.ajustes ||= {}; b.excluidas ||= [];
  let editando = false, sucio = false;
  window.__bitOcupado = () => sucio || editando;

  app.innerHTML = `
    <div class="head page-tools"><div><h1>${nueva ? 'Nueva bitácora' : 'Bitácora'}</h1><p class="sub">Los campos fijos salen del cliente y de la configuración; la firma y el # ID se diligencian solos.<br>📄 Se descarga como <b id="archivo"></b></p></div>
      <div class="row">${nueva ? '' : '<button class="btn danger" id="del">Eliminar</button>'}
        <span id="sucio" class="badge b-warn" hidden>Cambios sin guardar</span>
        <button class="btn" id="save">Guardar</button><button class="btn primary" id="print">Imprimir / PDF</button></div></div>
    <div class="grid2 page-tools">
      <div class="card"><h2>Datos</h2><div class="form">
        <label class="full">Cliente<select id="cli">${DB.clientes.map(c => `<option value="${c.id}" ${c.id === b.clienteId ? 'selected' : ''}>${esc(c.paciente)} — firma: ${esc(nombreFirmante(c) || 'sin definir')}</option>`).join('')}</select></label>
        <label>Mes de la bitácora<input type="month" id="per" value="${b.periodo}"></label>
        <label>Firma en el documento<select id="modo">
          <option value="digital" ${b.modoFirma === 'digital' ? 'selected' : ''}>Automática (anexar firma del cliente)</option>
          <option value="escrita" ${b.modoFirma === 'escrita' ? 'selected' : ''}>A mano (imprimir en blanco)</option></select></label>
        <label>Agendar firma para<input type="date" id="ag" value="${b.agendaFirma || ''}"></label>
        <label>Estado<select id="est"><option value="pendiente">Pendiente</option><option value="firmado" ${b.estado === 'firmado' ? 'selected' : ''}>Firmado</option></select></label>
        <div class="full" id="firmaInfo"></div>
      </div></div>
      <div class="card">
        <div class="row" style="justify-content:space-between"><h2 style="margin:0">Fechas de servicio <span id="nf" class="badge b-dig"></span></h2>
          <div class="row"><button class="btn sm" id="hab" title="Marcar lunes a viernes del mes">Lun–Vie</button><button class="btn sm" id="none" title="Desmarcar todo el mes">Limpiar</button></div></div>
        <div class="cal-nav">
          <button class="icon-btn" id="prevM" aria-label="Mes anterior">‹</button>
          <b id="mesLbl"></b>
          <button class="icon-btn" id="nextM" aria-label="Mes siguiente">›</button>
          <button class="btn sm" id="hoyM">Hoy</button>
        </div>
        <div class="cal" id="cal"></div>
        <p class="muted" id="otros" style="font-size:12px;margin:10px 0 0" hidden></p>
      </div>
    </div>
    <div class="doc-tools page-tools">
      <button class="btn sm" id="editar">✏️ Editar documento</button>
      <button class="btn sm" id="reset" hidden>↺ Restablecer cambios</button>
      <span class="muted" id="editHint" hidden>Toque una celda para corregirla (Enter para terminar) · ✕ quita la fila · ↺ la restaura. Las celdas corregidas se marcan en amarillo (no sale al imprimir).</span>
    </div>
    <p class="doc-hint page-tools">↔ Desliza para ver el documento completo</p>
    <div class="doc-wrap" id="docWrap"></div>`;

  const marcarSucio = (v = true) => { sucio = v; $('#sucio').hidden = !v; };
  const nCambios = () => Object.values(b.ajustes).reduce((s, o) => s + Object.keys(o).length, 0) + b.excluidas.length;
  const pintarDoc = () => {
    $('#docWrap').innerHTML = renderDoc(b, true, editando);
    const n = nCambios();
    $('#reset').hidden = !n; $('#reset').textContent = `↺ Restablecer cambios (${n})`;
  };
  const sync = () => {
    b.clienteId = $('#cli').value; b.periodo = $('#per').value || mes; b.modoFirma = $('#modo').value;
    b.agendaFirma = $('#ag').value; b.estado = $('#est').value;
    b.fechas = [...new Set(b.fechas)].sort(); // se conservan también las de otros meses mientras navega
    const c = cliente(b.clienteId);
    $('#firmaInfo').innerHTML = b.modoFirma === 'digital'
      ? `<div class="row">${miniAnexos(c)} <small class="muted">${esc(nombreFirmante(c))} · CC ${esc(docFirmante(c))}</small>
          ${anexosCompletos(c) ? `<button class="btn sm" onclick="capturarFirma('${c.id}', window.__syncBit)">Cambiar</button>`
            : `<button class="btn sm primary" onclick="capturarFirma('${c.id}', window.__syncBit)">📎 Adjuntar ${faltantes(c).join(' y ')}</button>`}</div>`
      : '<small class="muted">Se imprime con FIRMA y # ID en blanco para que firmen a mano.</small>';
    renderCal(); pintarDoc();
    document.title = nombreArchivo(b); // así también funciona Ctrl+P y "Compartir → Imprimir" del celular
    $('#archivo').textContent = nombreArchivo(b) + '.pdf';
  };
  window.__syncBit = sync;

  const renderCal = () => {
    const [y, m] = b.periodo.split('-').map(Number), n = new Date(y, m, 0).getDate(), off = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const delMes = fechasDe(b), hoyIso = hoy();
    $('#mesLbl').textContent = periodoTxt(b.periodo);
    $('#nf').textContent = `${delMes.length} días · ${delMes.length * 2} filas`;
    $('#cal').innerHTML = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<div class="dow">${d}</div>`).join('') + '<div></div>'.repeat(off) +
      Array.from({ length: n }, (_, i) => { const iso = `${b.periodo}-${String(i + 1).padStart(2, '0')}`, wd = (off + i) % 7;
        return `<button data-d="${iso}" class="${b.fechas.includes(iso) ? 'on' : ''} ${wd > 4 ? 'we' : ''} ${iso === hoyIso ? 'hoy' : ''}" title="${iso === hoyIso ? 'Hoy' : ''}">${i + 1}</button>`; }).join('');
    const otros = b.fechas.filter(f => !f.startsWith(b.periodo));
    const meses = [...new Set(otros.map(f => f.slice(0, 7)))];
    $('#otros').hidden = !otros.length;
    $('#otros').textContent = otros.length ? `ⓘ También hay ${otros.length} fecha(s) marcadas en ${meses.map(periodoTxt).join(', ')}. Esta bitácora es de ${periodoTxt(b.periodo)} y solo guarda las de ese mes.` : '';
  };
  const irMes = delta => { const [y, m] = b.periodo.split('-').map(Number), d = new Date(y, m - 1 + delta, 1);
    $('#per').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; sync(); };
  $('#prevM').onclick = () => irMes(-1);
  $('#nextM').onclick = () => irMes(1);
  $('#hoyM').onclick = () => { $('#per').value = hoy().slice(0, 7); sync(); };
  $('#cal').onclick = e => { const d = e.target.dataset.d; if (!d) return; b.fechas = b.fechas.includes(d) ? b.fechas.filter(x => x !== d) : [...b.fechas, d]; marcarSucio(); sync(); };
  $('#hab').onclick = () => { const [y, m] = b.periodo.split('-').map(Number), n = new Date(y, m, 0).getDate();
    const lv = Array.from({ length: n }, (_, i) => `${b.periodo}-${String(i + 1).padStart(2, '0')}`).filter(d => { const w = new Date(d + 'T12:00').getDay(); return w > 0 && w < 6; });
    b.fechas = [...b.fechas.filter(f => !f.startsWith(b.periodo)), ...lv]; marcarSucio(); sync(); };
  $('#none').onclick = () => { b.fechas = b.fechas.filter(f => !f.startsWith(b.periodo)); marcarSucio(); sync(); };
  ['#cli', '#per', '#modo', '#ag', '#est'].forEach(s => $(s).onchange = () => { marcarSucio(); sync(); });

  // ----- Edición directa en el documento -----
  $('#editar').onclick = () => {
    editando = !editando;
    $('#editar').textContent = editando ? '✓ Terminar edición' : '✏️ Editar documento';
    $('#editar').classList.toggle('primary', editando);
    $('#editHint').hidden = !editando; pintarDoc();
  };
  $('#reset').onclick = () => { if (!confirm('¿Quitar todas las correcciones hechas en el documento?')) return; b.ajustes = {}; b.excluidas = []; marcarSucio(); pintarDoc(); };
  const wrap = $('#docWrap');
  wrap.onclick = e => {
    if (e.target.closest('.cell-btn')) return capturarFirma(b.clienteId, sync);
    const x = e.target.closest('[data-x]'), r = e.target.closest('[data-r]');
    if (x) { b.excluidas = [...new Set([...b.excluidas, x.dataset.x])]; marcarSucio(); pintarDoc(); }
    if (r) { b.excluidas = b.excluidas.filter(k => k !== r.dataset.r); marcarSucio(); pintarDoc(); }
  };
  wrap.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.isContentEditable) { e.preventDefault(); e.target.blur(); } });
  wrap.addEventListener('focusout', e => {
    const td = e.target.closest('[contenteditable][data-k]'); if (!td) return;
    const { k, f, base } = td.dataset;
    let v = td.innerText.replace(/\s+/g, ' ').trim();
    if (f === 'cant') v = v.replace(/\D/g, '');
    const prev = b.ajustes[k]?.[f];
    if (v === base) { if (b.ajustes[k]) { delete b.ajustes[k][f]; if (!Object.keys(b.ajustes[k]).length) delete b.ajustes[k]; } }
    else (b.ajustes[k] ||= {})[f] = v;
    if (prev !== b.ajustes[k]?.[f]) marcarSucio();
    td.textContent = v; td.classList.toggle('mod', v !== base);
    if (f === 'cant') $('#totalCant').textContent = totalCant(b);
    const n = nCambios(); $('#reset').hidden = !n; $('#reset').textContent = `↺ Restablecer cambios (${n})`;
  });

  const guardar = async () => {
    const delMes = fechasDe(b);
    if (!delMes.length) { toast('Selecciona al menos una fecha del mes ' + periodoTxt(b.periodo)); return false; }
    const otros = b.fechas.length - delMes.length;
    if (otros && !confirm(`Hay ${otros} fecha(s) marcadas en otros meses que NO se guardarán en esta bitácora de ${periodoTxt(b.periodo)}. ¿Continuar?`)) return false;
    const dup = DB.bitacoras.find(x => x.clienteId === b.clienteId && x.periodo === b.periodo && x.id !== b.id);
    if (dup && !confirm('Ya existe una bitácora de este cliente para ese mes. ¿Guardar otra?')) return false;
    // solo se guardan fechas y correcciones del mes de la bitácora
    const claves = new Set(delMes.flatMap(f => [`${f}|ida`, `${f}|reg`]));
    const ajustes = Object.fromEntries(Object.entries(b.ajustes).filter(([k]) => claves.has(k)));
    const excluidas = b.excluidas.filter(k => claves.has(k));
    const { id: _id, creado, ...resto } = b;
    const data = { ...resto, fechas: delMes, ajustes, excluidas };
    if (!b.id) { const s = await api('POST', 'bitacoras', data); b.id = s.id; history.replaceState(null, '', '#/bitacora/' + s.id); }
    else await api('PUT', 'bitacoras/' + b.id, data);
    b.fechas = delMes; b.ajustes = ajustes; b.excluidas = excluidas;
    marcarSucio(false); renderCal(); toast('Bitácora guardada'); return true;
  };
  $('#save').onclick = guardar;
  $('#print').onclick = async () => {
    if (!(await guardar())) return;
    const c = cliente(b.clienteId);
    if (b.modoFirma === 'digital' && !anexosCompletos(c) && !confirm(`Falta anexar ${faltantes(c).join(' y ')} del cliente: ${!c.firma ? 'la columna FIRMA saldrá en blanco' : 'en # ID saldrá el número digitado en vez del escrito a mano'}. ¿Imprimir igual?`)) return;
    if (editando) $('#editar').click(); // imprimir sin controles de edición
    document.title = nombreArchivo(b);
    window.print();
  };
  if (!nueva) $('#del').onclick = async () => { if (!confirm('¿Eliminar esta bitácora?')) return; await api('DELETE', 'bitacoras/' + b.id); location.hash = '#/bitacoras'; };
  sync();
}

/* ===== Render del documento (réplica del formato original) ===== */
const fechasDe = b => (b.fechas || []).filter(f => f.startsWith(b.periodo)).sort();
const CAMPOS_EDIT = ['dir', 'hora', 'ips', 'cod', 'desc', 'cant'];
// Filas de la bitácora: base (cliente + campos fijos) + correcciones hechas en el documento
function filas(b) {
  const c = cliente(b.clienteId), cfg = DB.config, out = [], aj = b.ajustes || {}, ex = new Set(b.excluidas || []);
  for (const f of fechasDe(b)) {
    const bases = [
      { key: `${f}|ida`, tramo: 'ida', fecha: f, dir: c.origen, hora: hora12(c.horaIda), ips: c.ips, cod: cfg.codigo, desc: cfg.descripcion, cant: '1' },
      { key: `${f}|reg`, tramo: 'reg', fecha: f, dir: c.ips, hora: hora12(c.horaRegreso), ips: c.regreso, cod: '', desc: '', cant: '' },
    ];
    for (const base of bases) out.push({ ...base, ...(aj[base.key] || {}), base, mod: aj[base.key] || {}, excl: ex.has(base.key) });
  }
  return out;
}
const totalCant = b => filas(b).filter(r => !r.excl).reduce((s, r) => s + (parseInt(r.cant, 10) || 0), 0);

// Variación natural y estable (misma fila → misma posición, también al imprimir)
function azar(semilla) {
  let h = 2166136261; for (const ch of semilla) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function anexoVariado(src, semilla, alt, { rot = 2, dy = 1, sc = [0.9, 1.04], pos = [0.04, 0.96] } = {}) {
  const r = azar(semilla), lerp = (a, b2) => a + (b2 - a) * r();
  const p = lerp(...pos), giro = lerp(-rot, rot), mov = lerp(-dy, dy), esc_ = lerp(...sc);
  return `<div class="var"><span style="flex:${p.toFixed(3)}"></span><img src="${src}" alt="${alt}" style="transform:translateY(${mov.toFixed(2)}px) rotate(${giro.toFixed(2)}deg) scale(${esc_.toFixed(3)})"><span style="flex:${(1 - p).toFixed(3)}"></span></div>`;
}

function renderDoc(b, editable = false, edicion = false) {
  const c = cliente(b.clienteId), cfg = DB.config;
  const auto = b.modoFirma === 'digital';
  const conFirma = auto && c.firma;
  const todas = filas(b), visibles = edicion ? todas : todas.filter(r => !r.excl);
  const celdaId = (r, i) => !auto ? '' : c.firmaId ? anexoVariado(idSrc(c), r.key + '|id|' + c.firmaId.archivo, '# ID', { rot: 1.5, sc: [0.92, 1.03], pos: [0.05, 0.95] })
    : c.firma ? esc(docFirmante(c)) // respaldo: número digitado mientras se anexa el escrito
    : (editable && i === 0 ? '<button class="cell-btn" type="button">📎 Adjuntar # ID</button>' : '');
  const celdaFirma = (r, i) => conFirma ? anexoVariado(firmaSrc(c), r.key + '|f|' + c.firma.archivo, 'firma')
    : (auto && editable && i === 0 ? '<button class="cell-btn" type="button">📎 Adjuntar firma</button>' : '');
  const cel = (r, f, cls = '') => {
    const v = esc(r[f]);
    if (!edicion || r.excl) return `<td class="${cls}">${v}</td>`;
    return `<td class="${cls} ed ${f in r.mod ? 'mod' : ''}" contenteditable="true" spellcheck="false" data-k="${r.key}" data-f="${f}" data-base="${esc(r.base[f])}">${v}</td>`;
  };
  const cols = [3.5, 6.5, 11, 7, 11.5, 6, 11.5, 7.5, 11, 4, 12, 8.5];
  // Paginación propia: cada hoja es una tabla completa (logo, título y encabezados) con 23 filas, como el formato original.
  // Así ningún navegador corta la tabla a mitad ni pierde los bordes del contorno al imprimir.
  const POR_HOJA = 23;
  let item = 0;
  const filaHtml = (r, i) => `<tr class="${r.excl ? 'excl' : ''}">
      <td class="c-item">${r.excl ? '—' : ++item}${edicion ? (r.excl ? `<button class="row-btn" data-r="${r.key}" title="Restaurar fila">↺</button>` : `<button class="row-btn" data-x="${r.key}" title="Quitar fila">✕</button>`) : ''}</td>
      <td class="c-fecha">${fechaDoc(r.fecha)}</td><td>${esc(c.paciente)}</td><td class="c-id">${esc(c.docPaciente)}</td>
      ${cel(r, 'dir')}${cel(r, 'hora')}${cel(r, 'ips')}${cel(r, 'cod', 'c-cod')}${cel(r, 'desc')}${cel(r, 'cant', 'c-cod')}
      <td class="c-firma">${r.excl ? '' : celdaFirma(r, i)}</td>
      <td class="c-acu">${r.excl ? '' : celdaId(r, i)}</td></tr>`;
  const cabecera = `<colgroup>${cols.map(w => `<col style="width:${w}%">`).join('')}</colgroup>
    <thead>
      <tr class="t-head"><td colspan="2" style="border-right:0"><img src="/logo.png" alt="Transportes UP"></td>
        <td colspan="10" class="titulo">${esc(cfg.titulo)} ${esc(cfg.eps)}</td></tr>
      <tr><th>ITEM</th><th>FECHA</th><th>PACIENTE</th><th>ID PACIENTE</th><th>DIRECCION</th><th>HORA</th><th>IPS</th>
        <th>CODIGO TECNOLOGIA</th><th>DESCRIPCIÓN TECNOLOGIA</th><th>CANT</th><th>FIRMA DEL PACIENTE O ACUDIENTE</th><th># ID PACIENTE O ACUDIENTE</th></tr>
    </thead>`;
  const hojas = [];
  for (let i = 0; i < visibles.length; i += POR_HOJA) hojas.push(visibles.slice(i, i + POR_HOJA).map((r, j) => [r, i + j]));
  if (!hojas.length) hojas.push([]);
  const totalHtml = `<tr class="total"><td colspan="9" style="text-align:left;padding-left:8px">TOTAL</td><td id="totalCant">${totalCant(b)}</td><td colspan="2"></td></tr>`;
  return `<div class="doc ${edicion ? 'editando' : ''}">${hojas.map((filasHoja, h) => `
    <section class="hoja">
      <table>${cabecera}
        <tbody>${filasHoja.length ? filasHoja.map(([r, i]) => filaHtml(r, i)).join('')
          : '<tr><td colspan="12" style="height:60px;font-size:12px">Selecciona fechas en el calendario</td></tr>'}
        ${h === hojas.length - 1 ? totalHtml : ''}</tbody>
      </table>
      <div class="pie">${h + 1}${hojas.length > 1 ? ` de ${hojas.length}` : ''}</div>
    </section>`).join('')}</div>`;
}

/* ================= Agenda ================= */
function viewAgenda() {
  const list = [...DB.bitacoras].sort((a, b) => (a.agendaFirma || '9999').localeCompare(b.agendaFirma || '9999'));
  const pend = list.filter(b => b.estado !== 'firmado'), hechas = list.filter(b => b.estado === 'firmado');
  const fila = b => { const c = cliente(b.clienteId), e = estadoFirma(b); return `<tr>
    <td><b>${fechaLarga(b.agendaFirma)}</b></td>
    <td>${esc(nombreFirmante(c) || '—')}<br><small class="muted">${esc(c?.paciente)}</small></td>
    <td>${periodoTxt(b.periodo)} · ${b.fechas.length} servicios</td>
    <td>${modoBadge(b)}</td><td><span class="badge ${e.cls}">${e.txt}</span></td>
    <td style="text-align:right;white-space:nowrap">
      <input type="date" value="${b.agendaFirma || ''}" onchange="agendar('${b.id}', this.value)" aria-label="Fecha de firma">
      ${b.agendaFirma ? `<button class="btn sm" onclick="agendar('${b.id}', '')" title="Quitar fecha agendada">✕</button>` : ''}
      ${b.modoFirma === 'digital' && !anexosCompletos(c) ? `<button class="btn sm" onclick="capturarFirma('${c.id}')">📎 Adjuntar ${faltantes(c).join(' y ')}</button>` : ''}
      ${b.estado !== 'firmado' ? `<button class="btn sm primary" onclick="marcar('${b.id}','firmado')">Marcar firmado</button>` : `<button class="btn sm" onclick="marcar('${b.id}','pendiente')">Reabrir</button>`}
      <a class="btn sm" href="#/bitacora/${b.id}">Abrir</a></td></tr>`; };
  app.innerHTML = `
    <div class="head"><div><h1>Agenda de firmas</h1><p class="sub">Programa cuándo se recoge la firma: automática con la firma adjunta o a mano en papel</p></div></div>
    <div class="card"><h2>Pendientes (${pend.length})</h2>${pend.length ? `<table class="list">${pend.map(fila).join('')}</table>` : '<div class="empty">Nada pendiente 🎉</div>'}</div>
    <div class="card"><h2>Firmadas (${hechas.length})</h2>${hechas.length ? `<table class="list">${hechas.map(fila).join('')}</table>` : '<div class="empty">—</div>'}</div>`;
}
async function agendar(id, fecha) { await api('PUT', 'bitacoras/' + id, { agendaFirma: fecha }); toast(fecha ? 'Firma agendada' : 'Fecha de agenda quitada'); router(); }
async function marcar(id, estado) { await api('PUT', 'bitacoras/' + id, { estado }); toast(estado === 'firmado' ? 'Marcada como firmada' : 'Reabierta'); router(); }

/* ================= Configuración (campos fijos) ================= */
function viewConfig() {
  const c = DB.config, f = (k, l) => `<label class="${k === 'titulo' || k === 'descripcion' ? 'full' : ''}">${l}<input name="${k}" value="${esc(c[k])}"></label>`;
  // Espacio usado (plan gratuito de Supabase: base de datos 500 MB, archivos 1 GB)
  const anexos = DB.clientes.flatMap(x => [x.firma, x.firmaId]).filter(Boolean);
  const bytesArchivos = anexos.reduce((s, a) => s + (a.bytes || 0), 0), sinDato = anexos.filter(a => !a.bytes).length;
  const { _info, ...datos } = DB; const bytesDatos = new Blob([JSON.stringify(datos)]).size;
  const MB = 1024 * 1024, fmt = n => n < MB ? (n / 1024).toFixed(1) + ' KB' : (n / MB).toFixed(2) + ' MB';
  const pct = (n, lim) => Math.max(0.5, Math.min(100, n / lim * 100));
  const porCliente = DB.clientes.length ? bytesArchivos / DB.clientes.length : 0;
  const cupo = porCliente ? Math.floor((1024 * MB) / porCliente) : 0;
  app.innerHTML = `
    <div class="head"><div><h1>Campos fijos</h1><p class="sub">Se repiten en todas las bitácoras. La ruta y horas de cada paciente están en su ficha de cliente.</p></div></div>
    <form class="card" id="fcfg"><div class="form">
      ${f('empresa', 'Empresa')}${f('nit', 'NIT')}${f('eps', 'EPS')}${f('codigo', 'Código tecnología')}
      ${f('titulo', 'Título del formato')}${f('descripcion', 'Descripción tecnología')}
    </div><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn primary">Guardar</button></div></form>
    <div class="card"><h2>Almacenamiento</h2>
      <p class="muted" style="margin:0 0 12px">Las firmas y los # ID se comprimen al adjuntarlos (WebP, máx. 600 px; original máx. 1400 px). Los PDF de las bitácoras no se guardan: se generan al imprimir.</p>
      <div class="esp"><div class="esp-top"><b>Firmas e # ID</b><span>${fmt(bytesArchivos)} de 1 GB</span></div>
        <div class="meter"><span style="width:${pct(bytesArchivos, 1024 * MB)}%"></span></div>
        <small class="muted">${anexos.length} anexo(s)${sinDato ? ` · ${sinDato} sin medir` : ''}${porCliente ? ` · ~${fmt(porCliente)} por cliente · alcanza para ~${cupo.toLocaleString('es-CO')} clientes` : ''}</small></div>
      <div class="esp"><div class="esp-top"><b>Datos (clientes y bitácoras)</b><span>${fmt(bytesDatos)} de 500 MB</span></div>
        <div class="meter"><span style="width:${pct(bytesDatos, 500 * MB)}%"></span></div></div>
      <small class="muted">Almacenamiento actual: <b>${esc(_info?.almacenamiento || 'archivo')}</b>${_info?.persistente === false ? ' (temporal)' : ''} · límites del plan gratuito de Supabase.</small>
    </div>`;
  $('#fcfg').onsubmit = async e => { e.preventDefault(); await api('PUT', 'config', Object.fromEntries(new FormData(e.target))); toast('Configuración guardada'); router(); };
}

/* ================= Tiempo real ================= */
// El servidor emite "datos" en cada cambio; se vuelve a pintar la vista sin recargar.
// Si la persona está trabajando (ventana abierta, escribiendo o bitácora sin guardar) se avisa en vez de pisar su trabajo.
const VIVO = {
  pendiente: false,
  ocupado() {
    const a = document.activeElement;
    return !$('#modal').hidden
      || (a && (a.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'search')))
      || !!window.__bitOcupado?.();
  },
  async refrescar() {
    VIVO.pendiente = false; $('#live').hidden = true;
    const y = window.scrollY;
    await router();
    window.scrollTo(0, y);
    toast('↻ Datos actualizados');
  },
  intentar() {
    if (!VIVO.pendiente) return;
    if (VIVO.ocupado()) { $('#live').hidden = false; return; }
    VIVO.refrescar();
  },
  estado(on) { const el = $('#vivo'); if (el) { el.innerHTML = on ? '<i>●</i><b>En vivo</b>' : '<i>○</i><b>Reconectando…</b>'; el.classList.toggle('off', !on); el.title = on ? 'Sincronizado en tiempo real' : 'Reconectando…'; } },
  version: 0,
  async conectar() {
    let info = { tiempoReal: 'sse', persistente: true };
    try { info = await (await fetch('/api/info')).json(); } catch {}
    VIVO.info = info;
    if (!info.persistente) { const d = $('#demo'); if (d) d.hidden = false; }
    if (info.tiempoReal === 'sse') return VIVO.sse();
    VIVO.sondeo();
  },
  // Local: conexión abierta (Server-Sent Events)
  sse() {
    const es = new EventSource('/api/eventos');
    let primera = true;
    es.addEventListener('hola', () => { VIVO.estado(true); if (!primera) { VIVO.pendiente = true; VIVO.intentar(); } primera = false; }); // al reconectar, sincroniza
    es.addEventListener('datos', e => {
      const d = JSON.parse(e.data); VIVO.version = d.version;
      if (d.origen === CLIENTE_ID) return; // cambio hecho por esta misma pestaña: ya está pintado
      VIVO.pendiente = true; VIVO.intentar();
    });
    es.onerror = () => VIVO.estado(false);
  },
  // Vercel / serverless: consulta liviana de la versión cada 5 s mientras la pestaña está visible
  sondeo() {
    const revisar = async () => {
      if (document.hidden) return;
      if (ACCESO.bloqueado) return;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (r.status === 401) { ACCESO.mostrar(); return; } // la sesión venció
        const { version } = await r.json();
        VIVO.estado(true);
        if (!VIVO.version) VIVO.version = version;
        else if (version !== VIVO.version) { VIVO.version = version; VIVO.pendiente = true; VIVO.intentar(); }
      } catch { VIVO.estado(false); }
    };
    revisar(); setInterval(revisar, 5000);
    document.addEventListener('visibilitychange', revisar);
  },
};
$('#liveBtn').onclick = () => { if (window.__bitOcupado?.() && !confirm('Tiene cambios sin guardar en esta bitácora. ¿Descartarlos y cargar los datos nuevos?')) return; VIVO.refrescar(); };
// al terminar de escribir en un campo, aplica lo pendiente si ya no está ocupado
document.addEventListener('focusout', () => setTimeout(() => VIVO.pendiente && !$('#live').hidden && !VIVO.ocupado() && VIVO.refrescar(), 300));
/* ================= Acceso (inicio de sesión) ================= */
// El servidor decide si se exige (siempre en Vercel; en local solo si APP_USUARIO/APP_CLAVE existen).
const ACCESO = {
  bloqueado: false,
  mostrar(aviso) {
    if (ACCESO.bloqueado) return;
    ACCESO.bloqueado = true;
    closeModal();
    document.documentElement.classList.add('sin-sesion');
    const sinConfig = /configure/i.test(aviso || '');
    const fotos = ACCESO.FOTOS;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="login" class="login" role="dialog" aria-modal="true" aria-labelledby="loginTit">
        <div class="login-fotos" aria-hidden="true">
          ${fotos.map((f, i) => `<div class="login-foto${i === 0 ? ' on' : ''}" data-src="/img/login/${f.archivo}" ${i === 0 ? `style="background-image:url('/img/login/${f.archivo}')"` : ''}></div>`).join('')}
          <div class="login-velo"></div>
          <div class="login-lema">
            <span class="ll-eti">Transporte especial · Salud Total EPS</span>
            <b>Bitácoras de servicio, sin papeleo</b>
            <p>Registre los servicios de cada paciente, anexe su firma y su documento una sola vez, y genere la bitácora mensual lista para imprimir o enviar en PDF.</p>
            <ul>
              <li>Pacientes con ruta y horarios fijos</li>
              <li>Firma e ID anexados automáticamente</li>
              <li>Agenda de firmas y tablero mensual</li>
            </ul>
          </div>
        </div>
        <div class="login-col">
        <form class="login-box" id="loginForm" autocomplete="on">
          <img src="/logo.png" alt="Transportes UP" class="login-logo">
          <h1 id="loginTit">Iniciar sesión</h1>
          <p class="login-sub">Acceso solo para personal autorizado.</p>
          ${sinConfig ? `<p class="login-err">${esc(aviso)}</p>` : ''}
          <label>Usuario<input name="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
          <label for="loginClave">Contraseña</label>
          <span class="login-pass">
            <input id="loginClave" name="clave" type="password" autocomplete="current-password" required aria-describedby="loginMayus">
            <button type="button" class="login-ver" aria-label="Mostrar contraseña" aria-pressed="false" title="Mostrar contraseña">
              <svg class="ojo-abierto" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg class="ojo-cerrado" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>
            </button>
          </span>
          <p class="login-mayus" id="loginMayus" hidden>⇪ Bloq Mayús está activado</p>
          <p class="login-err" id="loginErr" role="alert" hidden></p>
          <button class="btn primary" type="submit" ${sinConfig ? 'disabled' : ''}>Ingresar</button>
        </form>
        <footer class="login-soporte">
          <span class="ls-tit">¿Problemas para ingresar? Soporte técnico</span>
          <b>Carlos Carranza</b> <span class="ls-rol">· Vanttage Tech</span>
          <span class="ls-links">
            <a href="https://wa.me/573105080356?text=${encodeURIComponent('Hola Carlos, necesito soporte con la app de bitácoras de Transportes UP.')}" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.7 14.9L2 22l5.2-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>
              +57 310 508 0356</a>
            <a href="mailto:carforck@gmail.com?subject=${encodeURIComponent('Soporte · Bitácoras Transportes UP')}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 6l9 7 9-7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
              carforck@gmail.com</a>
            <a href="https://vanttagetech.com" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
              vanttagetech.com</a>
          </span>
          <a class="login-credito" href="https://commons.wikimedia.org/wiki/Category:Quality_images_of_Cartagena,_Colombia" target="_blank" rel="noopener">Fotos de Cartagena: Bernard Gagnon · CC BY-SA 4.0</a>
        </footer>
        </div>
      </div>`);
    const f = $('#loginForm'), err = $('#loginErr');
    $('.login-ver', f).onclick = e => {
      const i = f.clave, b = e.currentTarget, ver = i.type === 'password';
      const [a, z] = [i.selectionStart, i.selectionEnd];
      i.type = ver ? 'text' : 'password';
      b.setAttribute('aria-pressed', ver); b.classList.toggle('on', ver);
      b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña'); b.title = b.getAttribute('aria-label');
      i.focus(); try { i.setSelectionRange(a, z); } catch {}
    };
    const mayus = e => { if (e.getModifierState) $('#loginMayus').hidden = !e.getModifierState('CapsLock'); };
    f.clave.addEventListener('keydown', mayus); f.clave.addEventListener('keyup', mayus);
    f.clave.addEventListener('blur', () => $('#loginMayus').hidden = true);
    f.onsubmit = async e => {
      e.preventDefault();
      const b = $('button[type=submit]', f); b.disabled = true; b.textContent = 'Ingresando…'; err.hidden = true;
      try {
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(f))) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || 'No se pudo ingresar');
        location.reload(); // arranca limpio con la sesión
      } catch (x) { err.textContent = x.message; err.hidden = false; b.disabled = false; b.textContent = 'Ingresar'; f.clave.select(); }
    };
    if (matchMedia('(hover: hover)').matches) setTimeout(() => f.usuario.focus(), 50); // en celular no abre el teclado solo
    // Carrusel de fondo: carga las demás fotos después de la primera y las alterna con fundido
    const capas = $$('.login-foto');
    setTimeout(() => capas.forEach(c => { if (!c.style.backgroundImage) c.style.backgroundImage = `url('${c.dataset.src}')`; }), 1200);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let i = 0;
      ACCESO.timer = setInterval(() => {
        if (document.hidden) return;
        capas[i].classList.remove('on'); i = (i + 1) % capas.length; capas[i].classList.add('on');
      }, 7000);
    }
  },
  FOTOS: [
    { archivo: 'murallas.webp', lugar: 'Murallas y avenida Santander' },
    { archivo: 'calle-30.webp', lugar: 'Getsemaní · Calle 30' },
    { archivo: 'bocagrande.webp', lugar: 'Bocagrande' },
    { archivo: 'san-pedro-claver.webp', lugar: 'Iglesia de San Pedro Claver' },
  ],
  async salir() {
    if (!confirm('¿Cerrar la sesión en este dispositivo?')) return;
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  },
};

(async function iniciar() {
  let s = { requerida: false, autenticado: true };
  try { s = await (await fetch('/api/sesion', { cache: 'no-store' })).json(); } catch {}
  if (s.requerida && !s.autenticado) {
    let aviso = '';
    if (!s.configurada) aviso = 'Acceso bloqueado: configure APP_USUARIO y APP_CLAVE en el servidor.';
    return ACCESO.mostrar(aviso);
  }
  if (s.requerida) {
    const pie = $('.side-foot');
    pie?.insertAdjacentHTML('beforeend', `<button class="salir-btn" id="salirBtn" title="Cerrar sesión de ${esc(s.usuario || '')}">⎋ <span>Cerrar sesión</span></button>`);
    $('#salirBtn')?.addEventListener('click', ACCESO.salir);
  }
  VIVO.conectar();
  router();
})();
