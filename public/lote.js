/* Transportes UP — catálogos, validaciones, importación masiva de PDF y exportación por lote.
   Depende de app.js (DB, api, esc, modal, filas, renderDoc, cliente, hora12, periodoTxt, fechaDoc…). */

/* ================= Catálogos ================= */
// Códigos de tecnología vistos en las bitácoras de Salud Total (1ra entrega, oct 2026). Editables en "Campos fijos".
const CODIGOS_BASE = [
  { codigo: 'T340019709', descripcion: 'TRANSPORTE NO ASISTENCIAL URBANO BASICO (REDONDO) (POS)' },
  { codigo: 'P100622000', descripcion: 'TRANSPORTE TERRESTRE REDONDO URBANO (NO POS)' },
  { codigo: 'T340017400', descripcion: 'TRANSPORTE NO ASISTENCIAL TERRESTRE DE MUNICIPIOS ALEDAÑOS MENOS DE 30KM REDONDO - (POS)' },
  { codigo: 'T340017500', descripcion: 'TRANSPORTE NO ASISTENCIAL TERRESTRE DE MUNICIPIOS ALEDAÑOS DE 30KM A 60 KM REDONDO - (POS)' },
  { codigo: 'T340017600', descripcion: 'TRANSPORTE NO ASISTENCIAL TERRESTRE DE MUNICIPIOS ALEDAÑOS DE 60KM A 100KM REDONDO - (POS)' },
  { codigo: 'T340019714', descripcion: 'TRANSPORTE MUNICIPIOS ALEDAÑOS DE 30KM A 60 KM REDONDO VAN GRANDE / CON RAMPA (POS)' },
  { codigo: 'P100626000', descripcion: 'TRANSPORTE TERRESTRE MUNICIPIOS ALEDAÑOS DE 30KM A 60 KM REDONDO (NO POS)' },
];
// IPS: el mismo lugar aparece escrito de muchas formas; "claves" son palabras que deben aparecer TODAS (sin tildes).
// El orden importa: primero las más específicas.
const IPS_BASE = [
  { nombre: 'CISADDE · Pie de la Popa', claves: ['CISADDE', 'POPA'] },
  { nombre: 'CISADDE · San Fernando', claves: ['CISADDE', 'FERNANDO'] },
  { nombre: 'Sonia Valencia · Pie de la Popa', claves: ['VALENCIA', 'POPA'] },
  { nombre: 'Sonia Valencia (Rehab Int)', claves: ['VALENCIA'] },
  { nombre: 'Davita · Omniplaza', claves: ['DAVITA', 'OMNIPLAZA'] },
  { nombre: 'Davita · La Plazuela', claves: ['DAVITA', 'PLAZUELA'] },
  { nombre: 'Davita · Shopping Center', claves: ['DAVITA', 'SHOPP'] },
  { nombre: 'CMOVER · Ronda Real', claves: ['CMOVER'] },
  { nombre: 'Servimedas', claves: ['SERVIMEDAS'] },
];
const codigos = () => (DB.config.codigos?.length ? DB.config.codigos : CODIGOS_BASE);
const ipsCatalogo = () => (DB.config.ipsCatalogo?.length ? DB.config.ipsCatalogo : IPS_BASE);
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const descCodigo = cod => codigos().find(x => x.codigo === cod)?.descripcion || '';
const codigoDe = (b, c = cliente(b.clienteId)) => b.codigo || c?.codigo || DB.config.codigo || '';
const descDe = (b, c) => descCodigo(codigoDe(b, c)) || (codigoDe(b, c) === DB.config.codigo ? DB.config.descripcion : '') || '';
function ipsCanon(txt) {
  const t = sinTildes(txt);
  if (!t) return '—';
  return ipsCatalogo().find(i => i.claves.length && i.claves.every(k => t.includes(sinTildes(k))))?.nombre || 'Otra IPS';
}
const planBadge = p => p ? `<span class="badge ${p === 'PBS' ? 'b-dig' : 'b-esc'}">${esc(p)}</span>` : '';
const codBadge = b => `<span class="badge b-mute" title="${esc(descDe(b))}">${esc(codigoDe(b) || 'sin código')}</span>`;

/* ================= Horas y festivos ================= */
const pad2 = n => String(n).padStart(2, '0');
// "15:30:00", "12:30 pm", "09:00 AM", "12:30 p. m.", "1:O0 pm" (letra O) → { hhmm: '13:00', corregida, error }
function normalizarHora(txt) {
  const orig = String(txt || '').trim();
  if (!orig) return { hhmm: '', error: 'vacía' };
  const s = orig.replace(/(?<=[\d:])[oO]|[oO](?=[\d:])/g, '0').replace(/\s+/g, ' ');
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(?:([ap])\.?\s*m?\.?)?$/i.exec(s);
  if (!m) return { hhmm: '', error: 'formato' };
  let H = +m[1]; const M = +m[2], ap = m[3]?.toLowerCase();
  if (ap === 'p' && H < 12) H += 12;
  if (ap === 'a' && H === 12) H = 0;
  if (H > 23 || M > 59) return { hhmm: '', error: 'fuera de rango' };
  return { hhmm: `${pad2(H)}:${pad2(M)}`, corregida: s !== orig.replace(/\s+/g, ' ') };
}
const minutos = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Festivos de Colombia (Ley 51 de 1983 "Emiliani" + Semana Santa). Fechas ISO → nombre.
const _festivos = {};
function festivosCO(y) {
  if (_festivos[y]) return _festivos[y];
  const iso = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const lunes = d => { const w = d.getDay(); if (w !== 1) d.setDate(d.getDate() + ((8 - w) % 7)); return d; };
  // Domingo de Pascua (algoritmo de Meeus/Jones/Butcher)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  const pascua = new Date(y, mes - 1, dia), mas = n => { const x = new Date(pascua); x.setDate(x.getDate() + n); return x; };
  const r = {};
  [[1, 1, 'Año Nuevo'], [5, 1, 'Día del Trabajo'], [7, 20, 'Independencia'], [8, 7, 'Batalla de Boyacá'], [12, 8, 'Inmaculada Concepción'], [12, 25, 'Navidad']]
    .forEach(([mm, dd, n]) => r[iso(new Date(y, mm - 1, dd))] = n);
  [[1, 6, 'Reyes Magos'], [3, 19, 'San José'], [6, 29, 'San Pedro y San Pablo'], [8, 15, 'Asunción'], [10, 12, 'Día de la Raza'], [11, 1, 'Todos los Santos'], [11, 11, 'Independencia de Cartagena']]
    .forEach(([mm, dd, n]) => r[iso(lunes(new Date(y, mm - 1, dd)))] = n);
  r[iso(mas(-3))] = 'Jueves Santo'; r[iso(mas(-2))] = 'Viernes Santo';
  r[iso(mas(43))] = 'Ascensión'; r[iso(mas(64))] = 'Corpus Christi'; r[iso(mas(71))] = 'Sagrado Corazón';
  return (_festivos[y] = r);
}
const festivo = isoF => festivosCO(+isoF.slice(0, 4))[isoF] || '';

/* ================= Validaciones ================= */
// Devuelve [{ nivel: 'error'|'aviso'|'info', texto }]
function validarBitacora(b, c = cliente(b.clienteId)) {
  const out = [], add = (nivel, texto) => out.push({ nivel, texto });
  if (!c) return [{ nivel: 'error', texto: 'La bitácora no tiene cliente' }];
  const fechas = [...new Set(b.fechas || [])].sort();
  const fuera = fechas.filter(f => !f.startsWith(b.periodo));
  if (fuera.length) add('error', `${fuera.length} fecha(s) fuera de ${periodoTxt(b.periodo)}`);
  const cod = codigoDe(b, c);
  if (!cod) add('error', 'Sin código de tecnología');
  else if (!codigos().some(x => x.codigo === cod)) add('aviso', `El código ${cod} no está en el catálogo`);
  const desc = descDe(b, c);
  if (b.plan === 'PBS' && /NO POS/.test(desc)) add('aviso', 'Marcada PBS pero el código es NO POS');
  if (b.plan === 'NO PBS' && /\(POS\)/.test(desc) && !/NO POS/.test(desc)) add('aviso', 'Marcada NO PBS pero el código es POS');

  const fest = fechas.filter(festivo);
  if (fest.length) add('aviso', `Servicio en festivo: ${fest.map(f => `${fechaDoc(f)} (${festivo(f)})`).join(', ')}`);
  const dom = fechas.filter(f => new Date(f + 'T12:00').getDay() === 0 && !festivo(f));
  if (dom.length) add('aviso', `Servicio en domingo: ${dom.map(fechaDoc).join(', ')}`);
  const sab = fechas.filter(f => new Date(f + 'T12:00').getDay() === 6);
  if (sab.length) add('info', `${sab.length} servicio(s) en sábado`);

  // Horas por fecha (con las correcciones del documento)
  const rows = filas(b, c).filter(r => !r.excl);
  const porTramo = { ida: [], reg: [] }, malas = [];
  for (const r of rows) {
    const h = normalizarHora(r.hora);
    if (h.error) { malas.push(`${fechaDoc(r.fecha)} ${r.tramo === 'ida' ? 'ida' : 'regreso'} "${r.hora || 'vacía'}"`); continue; }
    porTramo[r.tramo].push({ fecha: r.fecha, min: minutos(h.hhmm), hhmm: h.hhmm, dir: r.dir });
  }
  if (malas.length) add('error', `Hora no válida: ${malas.slice(0, 4).join(', ')}${malas.length > 4 ? '…' : ''}`);
  const regAntes = porTramo.reg.filter(r => { const i = porTramo.ida.find(x => x.fecha === r.fecha); return i && r.min <= i.min; });
  if (regAntes.length) add('error', `Regreso igual o anterior a la ida: ${regAntes.map(r => fechaDoc(r.fecha)).join(', ')}`);
  const raras = [...porTramo.ida.filter(r => r.min < 4 * 60 || r.min > 21 * 60), ...porTramo.reg.filter(r => r.min < 5 * 60 || r.min > 21 * 60)];
  if (raras.length) add('aviso', `Horas poco comunes (antes de 4–5 a. m. o después de 9 p. m.): ${[...new Set(raras.map(r => `${fechaDoc(r.fecha)} ${hora12(r.hhmm)}`))].slice(0, 4).join(', ')}${raras.length > 4 ? '…' : ''}`);

  // Patrones de arrastre de Excel: valores que avanzan en un paso fijo día a día
  // "Escalera": al menos minPasos diferencias seguidas, iguales y distintas de cero (p. ej. 21, 22, 23, 24)
  const escalera = (vals, minPasos = 3) => {
    let mejor = 0, run = 0;
    for (let i = 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      run = d === 0 ? 0 : (i > 1 && d === vals[i - 1] - vals[i - 2] ? run + 1 : 1);
      mejor = Math.max(mejor, run);
    }
    return mejor >= minPasos;
  };
  for (const [t, nombre] of [['ida', 'ida'], ['reg', 'regreso']]) {
    const v = porTramo[t].map(r => r.min);
    // el cruce de medianoche (23:00 → 01:00) cuenta como continuación de la escalera
    let off = 0; const cont = v.map((x, i) => { if (i && x < v[i - 1] - 600) off += 1440; return x + off; });
    if (v.length >= 4 && new Set(v).size >= 4 && escalera(cont)) add('aviso', `Las horas de ${nombre} avanzan día a día en pasos fijos (¿arrastre de Excel?)`);
  }
  const nums = porTramo.ida.map(r => { const m = /(\d+)\s*$/.exec(r.dir || ''); return m ? +m[1] : null; });
  if (nums.length >= 4 && nums.every(n => n !== null) && new Set(nums).size >= 4 && escalera(nums)) add('aviso', 'La dirección de ida cambia de número cada día (¿arrastre de Excel?)');

  if (b.modoFirma === 'digital' && !anexosCompletos(c)) add('aviso', `Falta ${faltantes(c).join(' y ')} de quien firma`);
  if (fechas.length && fechas.length < 5) add('info', `Solo ${fechas.length} servicio(s): ${fechas.map(fechaDoc).join(', ')}`);
  return out;
}
const ICONO = { error: '⛔', aviso: '⚠️', info: 'ℹ️' };
const resumenAlertas = al => {
  const n = { error: 0, aviso: 0, info: 0 }; al.forEach(a => n[a.nivel]++);
  return n.error ? `<span class="badge b-err" title="${esc(al.map(a => a.texto).join('\n'))}">⛔ ${n.error}</span>` + (n.aviso ? ` <span class="badge b-warn">⚠️ ${n.aviso}</span>` : '')
    : n.aviso ? `<span class="badge b-warn" title="${esc(al.map(a => a.texto).join('\n'))}">⚠️ ${n.aviso}</span>` : '<span class="badge b-ok">OK</span>';
};
const listaAlertas = al => al.length ? `<ul class="alertas">${al.map(a => `<li class="al-${a.nivel}">${ICONO[a.nivel]} ${esc(a.texto)}</li>`).join('')}</ul>` : '<p class="muted" style="margin:0">✓ Sin observaciones</p>';

/* ================= Lectura de PDF por columnas ================= */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
async function cargarPdfjs() {
  await cargarScript(PDFJS);
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
const COLS = [['item', /^ITEM/], ['fecha', /^FECHA/], ['pac', /^PACIENTE$/], ['id', /^ID\b/], ['dir', /^DIRECCI/], ['hora', /^HORA/], ['ips', /^IPS/],
  ['cod', /^C[OÓ]DIGO/], ['desc', /^DESCRIPCI/], ['cant', /^CANT/], ['firma', /^FIRMA/], ['idacu', /^#/]];
// Lee la tabla de la bitácora: cada fila se ancla en el número de ITEM; cada texto va a la fila más cercana y a su columna por x.
async function leerTablaPDF(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const filasPdf = []; let limites = null;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p), alto = page.getViewport({ scale: 1 }).height;
    const items = (await page.getTextContent()).items.filter(t => t.str.trim()).map(t => {
      const h = Math.abs(t.transform[3]) || t.height || 8, y = alto - t.transform[5];
      return { s: t.str.trim(), x: t.transform[4], cx: t.transform[4] + t.width / 2, cy: y - h / 2, y };
    });
    const cabItem = items.find(t => /^ITEM$/i.test(t.s));
    if (cabItem) {
      const cab = items.filter(t => Math.abs(t.cy - cabItem.cy) < 25);
      const xs = COLS.map(([k, re]) => [k, cab.filter(t => re.test(t.s.toUpperCase())).sort((a, b) => a.cy - b.cy)[0]?.cx]).filter(([, x]) => x != null).sort((a, b) => a[1] - b[1]);
      if (xs.length >= 8) limites = xs.map(([k, x], i) => ({ k, hasta: i < xs.length - 1 ? (x + xs[i + 1][1]) / 2 : Infinity }));
    }
    if (!limites) throw new Error('No se encontró la tabla (encabezados ITEM, FECHA, PACIENTE…)');
    const colDe = x => limites.find(l => x < l.hasta).k;
    const inicio = cabItem ? cabItem.cy + 8 : 0;
    const cuerpo = items.filter(t => t.cy > inicio);
    const anclas = cuerpo.filter(t => colDe(t.cx) === 'item' && /^(\d+|TOTAL)$/i.test(t.s)).sort((a, b) => a.cy - b.cy);
    const R = anclas.map(a => ({ item: a.s.toUpperCase(), _cy: a.cy, _t: {} }));
    for (const t of cuerpo) {
      if (anclas.includes(t) || !R.length) continue;
      let i = 0; R.forEach((r, j) => { if (Math.abs(r._cy - t.cy) < Math.abs(R[i]._cy - t.cy)) i = j; });
      if (Math.abs(R[i]._cy - t.cy) > 40) continue;
      const k = colDe(t.cx); (R[i]._t[k] ||= []).push(t);
    }
    for (const r of R) {
      const o = { item: r.item };
      for (const [k, ts] of Object.entries(r._t)) o[k] = ts.sort((a, b) => a.cy - b.cy || a.x - b.x).map(t => t.s).join(' ').replace(/\s+/g, ' ').trim();
      filasPdf.push(o);
    }
  }
  return filasPdf;
}

const moda = arr => { const n = {}; let best = '', bn = 0; for (const v of arr) if (v) { n[v] = (n[v] || 0) + 1; if (n[v] > bn) { bn = n[v]; best = v; } } return best; };
// Convierte las filas leídas en cliente + bitácora(s), con correcciones por fecha y alertas de lectura
function interpretarBitacora(archivo, rows) {
  const lectura = [];
  let nombre = archivo.replace(/\.pdf$/i, '');
  const tna = /^TNA_(\d+)_(.+)$/i.exec(nombre); if (tna) nombre = tna[2];
  let plan = '';
  const suf = /\s+(NO\s*-?\s*PBS|PBS)\s*$/i.exec(nombre);
  if (suf) { plan = /NO/i.test(suf[1]) ? 'NO PBS' : 'PBS'; nombre = nombre.slice(0, suf.index); }
  nombre = nombre.replace(/\s+/g, ' ').trim().toUpperCase();

  const datos = rows.filter(r => r.item !== 'TOTAL' && /\d{1,2}\/\d{1,2}\/\d{4}/.test(r.fecha || ''));
  const totalPdf = parseInt(rows.find(r => r.item === 'TOTAL')?.cant, 10);
  const iso = s => { const [d, m, y] = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s).slice(1); return `${y}-${pad2(m)}-${pad2(d)}`; };
  // Ida / regreso: en cada fecha la ida es el tramo más temprano (no se usa la columna del código: algunas
  // plantillas lo ponen en la fila del regreso, y otras traen las dos filas en orden invertido).
  datos.forEach(r => { r.f = iso(r.fecha); r.n = parseInt(r.item, 10) || 0; r.min = normalizarHora(r.hora).hhmm; });
  const porFecha = {}; datos.forEach(r => (porFecha[r.f] ||= []).push(r));
  let invertidas = 0;
  for (const grupo of Object.values(porFecha)) {
    grupo.sort((a, b) => a.n - b.n);
    if (grupo.length === 1) { grupo[0].esIda = !!(grupo[0].cod || grupo[0].cant); continue; }
    const [a, b] = grupo, ordenHora = a.min && b.min ? (a.min <= b.min ? [a, b] : [b, a]) : [a, b];
    ordenHora[0].esIda = true; ordenHora[1].esIda = false;
    if (ordenHora[0] !== a) invertidas++;
    grupo.slice(2).forEach(r => { r.esIda = false; });
    const cod = grupo.map(r => r.cod).find(Boolean); if (cod && !ordenHora[0].cod) ordenHora[0].cod = cod; // el código es del servicio
  }
  if (invertidas) lectura.push({ nivel: 'info', texto: `En ${invertidas} fecha(s) el regreso venía antes que la ida en el PDF; se ordenaron` });
  const ida = datos.filter(r => r.esIda), reg = datos.filter(r => !r.esIda);
  const doc = moda(datos.map(r => (r.id || '').replace(/\D/g, '')));
  const codigo = moda(ida.map(r => (/[A-Z]\d{9}/.exec((r.cod || '').toUpperCase()) || [])[0]));
  if (!nombre) nombre = moda(datos.map(r => (r.pac || '').toUpperCase()));
  const otrosIds = [...new Set(datos.map(r => (r.id || '').replace(/\D/g, '')).filter(x => x && x !== doc))];
  if (otrosIds.length) lectura.push({ nivel: 'aviso', texto: `El PDF trae más de un ID de paciente (${otrosIds.length + 1})` });
  const codsDist = [...new Set(ida.map(r => (/[A-Z]\d{9}/.exec((r.cod || '').toUpperCase()) || [])[0]).filter(Boolean))];
  if (codsDist.length > 1) lectura.push({ nivel: 'aviso', texto: `Varios códigos en el mismo PDF (${codsDist.join(', ')}); se usa ${codigo}` });

  const hs = (lista) => lista.map(r => { const h = normalizarHora(r.hora); if (h.corregida) lectura.push({ nivel: 'aviso', texto: `Hora corregida: "${r.hora}" → ${hora12(h.hhmm)} (${fechaDoc(r.f)})` }); return { r, h }; });
  const hIda = hs(ida), hReg = hs(reg);
  const cli = {
    paciente: nombre, docPaciente: doc,
    origen: moda(ida.map(r => (r.dir || '').toUpperCase())), ips: moda(ida.map(r => (r.ips || '').toUpperCase())),
    regreso: moda(reg.map(r => (r.ips || '').toUpperCase())),
    horaIda: moda(hIda.map(x => x.h.hhmm)), horaRegreso: moda(hReg.map(x => x.h.hhmm)),
    codigo, firmante: 'acudiente', acudiente: '', docAcudiente: '', telefono: '',
  };
  // Correcciones por fecha: lo que no coincide con la ruta/horario fijo queda como ajuste de esa fila
  const ajustes = {};
  const ajustar = (key, campo, valor) => { (ajustes[key] ||= {})[campo] = valor; };
  for (const { r, h } of hIda) {
    const k = `${r.f}|ida`;
    if (h.hhmm !== cli.horaIda) ajustar(k, 'hora', h.hhmm ? hora12(h.hhmm) : r.hora || '');
    if ((r.dir || '').toUpperCase() !== cli.origen) ajustar(k, 'dir', (r.dir || '').toUpperCase());
    if ((r.ips || '').toUpperCase() !== cli.ips) ajustar(k, 'ips', (r.ips || '').toUpperCase());
  }
  for (const { r, h } of hReg) {
    const k = `${r.f}|reg`;
    if (h.hhmm !== cli.horaRegreso) ajustar(k, 'hora', h.hhmm ? hora12(h.hhmm) : r.hora || '');
    if ((r.dir || '').toUpperCase() !== cli.ips) ajustar(k, 'dir', (r.dir || '').toUpperCase());
    if ((r.ips || '').toUpperCase() !== cli.regreso) ajustar(k, 'ips', (r.ips || '').toUpperCase());
  }
  // Fechas con solo ida o solo regreso → se excluye el tramo que falta
  const excluidas = [];
  const fechas = [...new Set(datos.map(r => r.f))].sort();
  for (const f of fechas) {
    if (!ida.some(r => r.f === f)) excluidas.push(`${f}|ida`);
    if (!reg.some(r => r.f === f)) excluidas.push(`${f}|reg`);
  }
  if (excluidas.length) lectura.push({ nivel: 'info', texto: `${excluidas.length} tramo(s) sin su par (solo ida o solo regreso)` });
  if (!isNaN(totalPdf) && totalPdf !== ida.length) lectura.push({ nivel: 'aviso', texto: `El TOTAL del PDF (${totalPdf}) no coincide con los servicios leídos (${ida.length})` });
  if (!codigo) lectura.push({ nivel: 'error', texto: 'No se encontró el código de tecnología' });
  if (!doc) lectura.push({ nivel: 'error', texto: 'No se encontró el ID del paciente' });

  const porMes = {};
  fechas.forEach(f => (porMes[f.slice(0, 7)] ||= []).push(f));
  const bitacoras = Object.entries(porMes).map(([periodo, fs]) => {
    const claves = new Set(fs.flatMap(f => [`${f}|ida`, `${f}|reg`]));
    return { periodo, fechas: fs, codigo, plan, modoFirma: 'digital', agendaFirma: '', estado: 'pendiente',
      ajustes: Object.fromEntries(Object.entries(ajustes).filter(([k]) => claves.has(k))), excluidas: excluidas.filter(k => claves.has(k)) };
  });
  return { archivo, cliente: cli, bitacoras, lectura, servicios: ida.length };
}

/* ================= Importación masiva ================= */
function importarLote() {
  const m = modal(`
    <h2 style="margin-top:0">Importar bitácoras PDF</h2>
    <p class="sub">Suba uno o varios PDF (por ejemplo, toda la carpeta de una entrega: <code>TNA_901729817_NOMBRE.pdf</code>). De cada uno se leen el paciente, la ruta, las horas, el código y las fechas; se crean los clientes que no existan y se revisan festivos, horas raras y errores de arrastre de Excel <b>antes</b> de guardar.</p>
    <label class="drop" id="drop">📄 Arrastre aquí los PDF o haga clic para elegirlos<input type="file" accept="application/pdf" multiple hidden id="pdfs"></label>
    <div id="res" style="margin-top:14px"></div>`, true);
  const inp = $('#pdfs', m), drop = $('#drop', m);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); leer([...e.dataTransfer.files].filter(f => /\.pdf$/i.test(f.name))); };
  inp.onchange = () => leer([...inp.files]);

  let lote = [];
  async function leer(files) {
    if (!files.length) return;
    const res = $('#res', m);
    res.innerHTML = `<div class="empty"><div class="meter"><span id="prog" style="width:0%"></span></div><p id="progTxt">Preparando lector…</p></div>`;
    try { await cargarPdfjs(); } catch (e) { res.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    lote = [];
    for (const [i, f] of files.sort((a, b) => a.name.localeCompare(b.name)).entries()) {
      $('#progTxt', m).textContent = `Leyendo ${i + 1} de ${files.length}: ${f.name}`;
      $('#prog', m).style.width = `${((i + 1) / files.length) * 100}%`;
      try { lote.push(interpretarBitacora(f.name, await leerTablaPDF(f))); }
      catch (e) { lote.push({ archivo: f.name, falla: e.message }); }
    }
    mostrar();
  }

  function mostrar() {
    // Clientes: se reconocen por documento (también dentro del mismo lote, p. ej. PBS + NO PBS del mismo paciente)
    const refPorDoc = {};
    for (const it of lote) {
      if (it.falla) continue;
      const c = DB.clientes.find(x => x.docPaciente && x.docPaciente === it.cliente.docPaciente);
      it.existente = c || null;
      it.ref = c ? null : (refPorDoc[it.cliente.docPaciente] ||= 'r' + Object.keys(refPorDoc).length);
      const cTmp = c || { ...it.cliente, id: '__tmp', firma: null, firmaId: null };
      it.bitacoras.forEach(b => {
        // Bitácora previa del mismo paciente y mes: misma combinación código/plan, o una antigua sin código propio
        b._previa = c ? DB.bitacoras.find(x => x.clienteId === c.id && x.periodo === b.periodo && (!x.codigo || x.codigo === b.codigo) && (x.plan || '') === (b.plan || '')) : null;
        b._alertas = [...it.lectura, ...validarBitacora({ ...b, clienteId: cTmp.id }, cTmp)];
      });
    }
    const ok = lote.filter(x => !x.falla), nuevos = new Set(ok.filter(x => x.ref).map(x => x.ref)).size;
    const servicios = ok.reduce((s, x) => s + x.servicios, 0);
    const conErr = ok.filter(x => x.bitacoras.some(b => b._alertas.some(a => a.nivel === 'error'))).length;
    const conAv = ok.filter(x => x.bitacoras.some(b => b._alertas.some(a => a.nivel === 'aviso'))).length;
    $('#res', m).innerHTML = `
      <div class="chips">
        <span class="chip"><b>${ok.length}</b> de ${lote.length} PDF leídos</span>
        <span class="chip"><b>${nuevos}</b> clientes nuevos</span>
        <span class="chip"><b>${servicios}</b> servicios</span>
        <span class="chip">⛔ <b>${conErr}</b> con errores</span>
        <span class="chip">⚠️ <b>${conAv}</b> con avisos</span>
      </div>
      <div class="tabla-scroll"><table class="list imp">
        <tr><th><input type="checkbox" id="todos" checked aria-label="Seleccionar todos"></th><th>Paciente</th><th>Código</th><th>Periodo</th><th>Cliente</th><th>Revisión</th></tr>
        ${lote.map((it, i) => it.falla ? `<tr><td></td><td colspan="5"><b>${esc(it.archivo)}</b><br><span class="badge b-err">No se pudo leer</span> <small>${esc(it.falla)}</small></td></tr>`
          : it.bitacoras.map((b, j) => `<tr>
            <td><input type="checkbox" class="sel" data-i="${i}" data-j="${j}" ${b._alertas.some(a => a.nivel === 'error') || b._previa ? '' : 'checked'}></td>
            <td><b>${esc(it.cliente.paciente)}</b><br><small class="muted">CC ${esc(it.cliente.docPaciente)} · ${esc(ipsCanon(it.cliente.ips))}</small></td>
            <td>${esc(b.codigo || '—')} ${planBadge(b.plan)}</td>
            <td>${periodoTxt(b.periodo)}<br><small class="muted">${b.fechas.length} servicios</small></td>
            <td>${it.existente ? '<span class="badge b-dig">Existente</span>' : '<span class="badge b-ok">Nuevo</span>'}${b._previa ? `<br><span class="badge b-warn">Ya tiene bitácora de este mes (${fechasDe(b._previa).length} fechas)</span><br><small class="muted">Si la marca, se reemplaza por la del PDF</small>` : ''}</td>
            <td><details><summary>${resumenAlertas(b._alertas)}</summary>${listaAlertas(b._alertas)}</details></td></tr>`).join('')).join('')}
      </table></div>
      <p class="muted" style="font-size:12px">Quedan sin marcar las filas con ⛔ errores (revíselas en el PDF original) y las de pacientes que ya tienen bitácora ese mes (para no pisar lo que se hizo a mano). Los avisos no impiden importar; después puede corregir cada bitácora en "✏️ Editar documento".</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="imp">Importar seleccionados</button></div>`;
    const cuenta = () => { const n = $$('.sel:checked', m).length; $('#imp', m).textContent = `Importar ${n} bitácora${n === 1 ? '' : 's'}`; $('#imp', m).disabled = !n; };
    $$('.sel', m).forEach(x => x.onchange = cuenta);
    $('#todos', m).onchange = e => { $$('.sel', m).forEach(x => x.checked = e.target.checked); cuenta(); };
    cuenta();
    $('#imp', m).onclick = importar;
  }

  async function importar() {
    const btn = $('#imp', m); btn.disabled = true; btn.textContent = 'Importando…';
    const elegidas = $$('.sel:checked', m).map(x => [lote[+x.dataset.i], lote[+x.dataset.i].bitacoras[+x.dataset.j]]);
    const clientes = [], vistos = new Set(), bitacoras = [];
    for (const [it, b] of elegidas) {
      if (it.ref && !vistos.has(it.ref)) { vistos.add(it.ref); clientes.push({ ref: it.ref, datos: it.cliente }); }
      const { _previa, _alertas, ...datos } = b;
      bitacoras.push({ ...(it.existente ? { clienteId: it.existente.id } : { clienteRef: it.ref }), ...(_previa ? { id: _previa.id } : {}), datos });
    }
    try {
      const r = await api('POST', 'lote', { clientes, bitacoras });
      closeModal(); toast(`Importadas ${r.bitacoras.length} bitácoras · ${r.clientes.length} clientes nuevos`);
      const per = elegidas[0]?.[1].periodo;
      if (per) FILTRO.bitacoras = { ...FILTRO.bitacoras, m: per, p: 1 };
      if (location.hash === '#/bitacoras') router(); else location.hash = '#/bitacoras';
    } catch (e) { btn.disabled = false; btn.textContent = 'Reintentar'; toast('⚠️ ' + e.message); }
  }
}

/* ================= Exportación: PDF por bitácora y lote ZIP ================= */
// Nombre como lo usa la empresa: TNA_<NIT>_<PACIENTE>[ PBS| NO PBS].pdf
const nombreTNA = b => {
  const c = cliente(b.clienteId);
  return `TNA_${DB.config.nit || ''}_${c?.paciente || 'PACIENTE'}${b.plan ? ' ' + b.plan : ''}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
};
async function librerias(zip) {
  await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  if (zip) await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
}
// Dibuja la bitácora fuera de pantalla (mismo diseño que al imprimir) y la convierte en PDF carta horizontal
async function pdfBitacora(b) {
  const caja = document.createElement('div');
  caja.className = 'render-pdf';
  document.body.appendChild(caja);
  pintarDocAjustado(caja, b, false, false);
  try {
    await Promise.all($$('img', caja).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter', compress: true });
    const hojas = $$('.hoja', caja);
    for (const [i, h] of hojas.entries()) {
      const cv = await html2canvas(h, { scale: 1.7, backgroundColor: '#ffffff', logging: false });
      if (i) pdf.addPage();
      // Encajar en la página carta horizontal (11 × 8.5 in) con márgenes de 0.25 in, sin deformar
      const r = cv.height / cv.width, maxW = 10.5, maxH = 8;
      const [w, hh] = maxW * r <= maxH ? [maxW, maxW * r] : [maxH / r, maxH];
      pdf.addImage(cv.toDataURL('image/jpeg', 0.78), 'JPEG', (11 - w) / 2, 0.25, w, hh);
    }
    pdf.setProperties({ title: nombreTNA(b), creator: 'Transportes UP · Bitácoras' });
    return pdf.output('blob');
  } finally { caja.remove(); }
}
const descargarBlob = (blob, nombre) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
async function descargarPDF(id) { // id o la bitácora misma (p. ej. la que se está editando)
  const b = typeof id === 'object' ? id : DB.bitacoras.find(x => x.id === id); if (!b) return;
  toast('Generando PDF…');
  try { await librerias(false); descargarBlob(await pdfBitacora(b), nombreTNA(b) + '.pdf'); toast('PDF descargado'); }
  catch (e) { toast('⚠️ No se pudo generar el PDF: ' + e.message); }
}
function exportarLote(periodo) {
  const meses = [...new Set(DB.bitacoras.map(b => b.periodo))].sort().reverse();
  periodo ||= meses[0];
  const md = modal(`<h2 style="margin-top:0">Exportar lote</h2>
    <p class="sub">Genera un ZIP con un PDF por bitácora, nombrado como lo entrega la empresa (<code>TNA_${esc(DB.config.nit)}_NOMBRE[ PBS| NO PBS].pdf</code>), más un resumen en Excel (CSV).</p>
    <label>Mes<select id="xm">${meses.map(p => `<option value="${p}" ${p === periodo ? 'selected' : ''}>${periodoTxt(p)}</option>`).join('')}</select></label>
    <div id="xinfo" style="margin-top:12px"></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="xgo">Generar ZIP</button></div>`);
  const sel = () => DB.bitacoras.filter(b => b.periodo === $('#xm', md).value).sort((a, b) => (cliente(a.clienteId)?.paciente || '').localeCompare(cliente(b.clienteId)?.paciente || ''));
  const info = () => {
    const l = sel(), al = l.map(b => validarBitacora(b));
    const err = al.filter(a => a.some(x => x.nivel === 'error')).length, sinFirma = l.filter(b => b.modoFirma === 'digital' && !anexosCompletos(cliente(b.clienteId))).length;
    $('#xinfo', md).innerHTML = `<div class="chips"><span class="chip"><b>${l.length}</b> bitácoras</span><span class="chip"><b>${l.reduce((s, b) => s + fechasDe(b).length, 0)}</b> servicios</span>
      ${err ? `<span class="chip">⛔ <b>${err}</b> con errores</span>` : ''}${sinFirma ? `<span class="chip">⚠️ <b>${sinFirma}</b> sin firma o # ID</span>` : ''}</div>
      ${sinFirma ? '<p class="muted" style="font-size:12px;margin:6px 0 0">Las que no tienen firma o # ID salen con esas columnas vacías.</p>' : ''}`;
  };
  $('#xm', md).onchange = info; info();
  $('#xgo', md).onclick = async () => {
    const l = sel(), btn = $('#xgo', md); if (!l.length) return;
    btn.disabled = true;
    try {
      await librerias(true);
      const zip = new JSZip(), usados = {};
      const csv = [['Archivo', 'Paciente', 'ID paciente', 'Código', 'PBS/NO PBS', 'Servicios', 'IPS', 'Firma', '# ID', 'Alertas'].join(';')];
      for (const [i, b] of l.entries()) {
        btn.textContent = `PDF ${i + 1} de ${l.length}…`;
        let n = nombreTNA(b); if (usados[n]) n += ` (${++usados[n]})`; else usados[n] = 1;
        zip.file(n + '.pdf', await pdfBitacora(b));
        const c = cliente(b.clienteId), al = validarBitacora(b);
        csv.push([n + '.pdf', c?.paciente, c?.docPaciente, codigoDe(b), b.plan || '', fechasDe(b).filter(f => !(b.excluidas || []).includes(f + '|ida')).length, ipsCanon(c?.ips),
          c?.firma ? 'sí' : 'no', c?.firmaId ? 'sí' : 'no', al.filter(a => a.nivel !== 'info').map(a => a.texto).join(' | ')].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
      }
      zip.file(`RESUMEN ${periodoTxt(l[0].periodo).toUpperCase()}.csv`, '﻿' + csv.join('\r\n'));
      btn.textContent = 'Comprimiendo…';
      descargarBlob(await zip.generateAsync({ type: 'blob' }), `BITACORAS ${periodoTxt(l[0].periodo).toUpperCase()} (${l.length}).zip`);
      closeModal(); toast(`ZIP con ${l.length} bitácoras descargado`);
    } catch (e) { btn.disabled = false; btn.textContent = 'Reintentar'; toast('⚠️ ' + e.message); }
  };
}

/* ================= Paginación ================= */
function paginar(lista, pagina = 1, tam = 20) {
  const n = Math.max(1, Math.ceil(lista.length / tam)), p = Math.min(Math.max(1, +pagina || 1), n);
  return { items: lista.slice((p - 1) * tam, p * tam), p, n, total: lista.length, desde: lista.length ? (p - 1) * tam + 1 : 0, hasta: Math.min(p * tam, lista.length) };
}
// HTML del paginador; los botones llevan data-pg. Enlazar con: enlazarPaginador(raiz, p => …)
function paginadorHtml(pg, nombre = 'resultados') {
  if (pg.total === 0) return '';
  const nums = []; for (let i = 1; i <= pg.n; i++) if (i === 1 || i === pg.n || Math.abs(i - pg.p) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return `<nav class="paginador" aria-label="Paginación"><span class="muted">${pg.desde}–${pg.hasta} de ${pg.total} ${nombre}</span>
    ${pg.n > 1 ? `<span class="pg-btns"><button class="btn sm" data-pg="${pg.p - 1}" ${pg.p === 1 ? 'disabled' : ''} aria-label="Anterior">‹</button>
      ${nums.map(x => x === '…' ? '<span class="muted">…</span>' : `<button class="btn sm ${x === pg.p ? 'primary' : ''}" data-pg="${x}" ${x === pg.p ? 'aria-current="page"' : ''}>${x}</button>`).join('')}
      <button class="btn sm" data-pg="${pg.p + 1}" ${pg.p === pg.n ? 'disabled' : ''} aria-label="Siguiente">›</button></span>` : ''}</nav>`;
}
const enlazarPaginador = (raiz, ir) => $$('[data-pg]', raiz).forEach(b => b.onclick = () => { ir(+b.dataset.pg); window.scrollTo({ top: 0, behavior: 'smooth' }); });
