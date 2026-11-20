/* Transportes UP — catálogos, validaciones y exportación por lote.
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
  { codigo: 'T340019712', descripcion: 'TRANSPORTE MUNICIPIOS ALEDAÑOS MENOS DE 30 KM REDONDO VAN GRANDE / CON RAMPA (POS)' }, // visto en radicados de septiembre
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
// "15:30:00", "12:30 pm", "09:00 AM", "12:30 p. m.", "1:O0 pm" (letra O) → { hhmm: '13:00', corregida, ambigua, error }
// ambigua: "1:30" sin a. m./p. m. ni segundos y hora 1–6 (en estas bitácoras casi siempre es de la tarde)
function normalizarHora(txt) {
  const orig = String(txt || '').trim();
  if (!orig) return { hhmm: '', error: 'vacía' };
  const s = orig.replace(/(?<=[\d:])[oO]|[oO](?=[\d:])/g, '0').replace(/\s+/g, ' ');
  const m = /^(\d{1,2})[:.](\d{2})(:\d{2})?\s*(?:([ap])\.?\s*m?\.?)?$/i.exec(s);
  if (!m) return { hhmm: '', error: 'formato' };
  let H = +m[1]; const M = +m[2], ap = m[4]?.toLowerCase();
  if (ap === 'p' && H < 12) H += 12;
  if (ap === 'a' && H === 12) H = 0;
  if (H > 23 || M > 59) return { hhmm: '', error: 'fuera de rango' };
  return { hhmm: `${pad2(H)}:${pad2(M)}`, corregida: s !== orig.replace(/\s+/g, ' '), ambigua: !ap && !m[3] && H >= 1 && H < 7 };
}
const minutos = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const hhmmDe = min => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;
// Minutos para comparar/ordenar (null si no es hora válida): una hora ambigua ("1:30") se toma como p. m.
// Solo para decidir ida/regreso y validar; el documento conserva el texto original.
const minComparable = h => (h.error ? null : minutos(h.hhmm) + (h.ambigua ? 720 : 0));
// Fecha ISO que existe en el calendario (descarta 2026-02-31, mes 13…)
function fechaValida(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f || ''); if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}
const soloDigitos = s => String(s || '').replace(/\D/g, '');

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
// Memoria por objeto bitácora de DB (DB se reemplaza entero en cada reload, así que se invalida sola).
// No se usa con objetos temporales (importación, editor con structuredClone) ni con otro cliente.
const _validaciones = new WeakMap();
function validarBitacora(b, c = cliente(b.clienteId)) {
  const cachear = DB.bitacoras.includes(b) && c === cliente(b.clienteId);
  if (cachear && _validaciones.has(b)) return _validaciones.get(b);
  const out = _validar(b, c);
  if (cachear) _validaciones.set(b, out);
  return out;
}
function _validar(b, c) {
  const out = [], add = (nivel, texto) => out.push({ nivel, texto });
  if (!c) return [{ nivel: 'error', texto: 'La bitácora no tiene cliente' }];
  const todas = [...new Set([...(b.fechas || []), ...Object.values(b.rutasExtra || {}).flat()])].sort(); // todas las rutas
  const idsRutas = new Set(rutasDe(c).map(r => r.id));
  const huerfanas = Object.keys(b.rutasExtra || {}).filter(r => !idsRutas.has(r) && (b.rutasExtra[r] || []).length);
  if (huerfanas.length) add('aviso', `${huerfanas.length === 1 ? 'Una ruta' : huerfanas.length + ' rutas'} de esta bitácora ya no existe${huerfanas.length === 1 ? '' : 'n'} en el paciente: sus días no salen en el documento`);
  for (const r of rutasDe(c).filter(r => r.codigo && fechasRuta(b, r.id).length && !codigos().some(x => x.codigo === r.codigo))) add('aviso', `El código ${r.codigo} de la ruta "${r.nombre || r.ips}" no está en el catálogo`);
  const malasF = todas.filter(f => !fechaValida(f));
  if (malasF.length) add('error', `Fecha(s) que no existen: ${malasF.slice(0, 4).join(', ')}${malasF.length > 4 ? '…' : ''}`);
  const fechas = todas.filter(fechaValida);
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
    const min = minComparable(h); // "1:30" sin a. m./p. m. → 1:30 p. m.
    porTramo[r.tramo].push({ fecha: r.fecha, ruta: r.ruta || 'p', min, hhmm: hhmmDe(min), dir: r.dir });
  }
  if (malas.length) add('error', `Hora no válida: ${malas.slice(0, 4).join(', ')}${malas.length > 4 ? '…' : ''}`);
  const regAntes = porTramo.reg.filter(r => { const i = porTramo.ida.find(x => x.fecha === r.fecha && x.ruta === r.ruta); return i && r.min <= i.min; });
  if (regAntes.length) add('error', `Regreso igual o anterior a la ida: ${[...new Set(regAntes.map(r => fechaDoc(r.fecha)))].join(', ')}`);
  // Dos rutas el mismo día: la ida de la segunda no debe empezar antes del regreso de la primera
  const cruces = [...new Set(porTramo.ida.map(r => r.fecha))].filter(f => {
    const idas = porTramo.ida.filter(r => r.fecha === f).sort((x, y) => x.min - y.min);
    return idas.some((r, i) => { if (!i) return false; const reg = porTramo.reg.find(x => x.fecha === f && x.ruta === idas[i - 1].ruta); return reg && r.min < reg.min; });
  });
  if (cruces.length) add('aviso', `Rutas del mismo día que se cruzan de hora: ${cruces.map(fechaDoc).join(', ')}`);
  const raras = [...porTramo.ida.filter(r => r.min < 4 * 60 || r.min > 21 * 60), ...porTramo.reg.filter(r => r.min < 5 * 60 || r.min > 21 * 60)];
  if (raras.length) add('aviso', `Horas poco comunes (antes de 4–5 a. m. o después de 9 p. m.): ${[...new Set(raras.map(r => `${fechaDoc(r.fecha)} ${hora12(r.hhmm)}`))].slice(0, 4).join(', ')}${raras.length > 4 ? '…' : ''}`);
  // Desde aquí, los patrones de arrastre se miran solo en la ruta principal (mezclar rutas daría falsas alarmas)
  porTramo.ida = porTramo.ida.filter(r => r.ruta === 'p'); porTramo.reg = porTramo.reg.filter(r => r.ruta === 'p');

  // Patrones de arrastre de Excel: valores que avanzan en un paso fijo día a día
  // "Escalera": la racha más larga de diferencias seguidas, iguales y que cumplen pasoOk (p. ej. 21, 22, 23, 24 → 3 pasos de +1)
  const escalera = (vals, pasoOk) => {
    let mejor = 0, run = 0;
    for (let i = 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      run = !pasoOk(d) ? 0 : (i > 1 && d === vals[i - 1] - vals[i - 2] ? run + 1 : 1);
      mejor = Math.max(mejor, run);
    }
    return mejor;
  };
  for (const [t, nombre] of [['ida', 'ida'], ['reg', 'regreso']]) {
    const v = porTramo[t].map(r => r.min);
    // el cruce de medianoche (23:00 → 01:00) cuenta como continuación de la escalera
    let off = 0; const cont = v.map((x, i) => { if (i && x < v[i - 1] - 600) off += 1440; return x + off; });
    // Paso pequeño y constante (≤ 15 min, 3+ pasos); un paso mayor (citas reprogramadas) solo si se repite 4+ veces seguidas
    const arrastre = escalera(cont, d => d !== 0 && Math.abs(d) <= 15) >= 3 || escalera(cont, d => d !== 0) >= 4;
    if (v.length >= 4 && new Set(v).size >= 4 && arrastre) add('aviso', `Las horas de ${nombre} avanzan día a día en pasos fijos (¿arrastre de Excel?)`);
  }
  // Último número de la dirección, esté donde esté ("CRA 5 # 21-34 BARRIO" → 34); escalera de +1 en 3+ pasos
  const nums = porTramo.ida.map(r => { const m = /(\d+)\D*$/.exec(r.dir || ''); return m ? +m[1] : NaN; });
  if (nums.filter(n => !isNaN(n)).length >= 4 && escalera(nums, d => d === 1) >= 3) add('aviso', 'La dirección de ida cambia de número cada día (¿arrastre de Excel?)');

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
    await afinarAnexos(caja);
    await Promise.all($$('img', caja).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter', compress: true });
    const hojas = $$('.hoja', caja);
    for (const [i, h] of hojas.entries()) {
      const cv = await html2canvas(h, { scale: 1.5, backgroundColor: '#ffffff', logging: false });
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
    $('#xinfo', md).innerHTML = `<div class="chips"><span class="chip"><b>${l.length}</b> bitácoras</span><span class="chip"><b>${l.reduce((s, b) => s + nServicios(b), 0)}</b> servicios</span>
      ${err ? `<span class="chip">⛔ <b>${err}</b> con errores</span>` : ''}${sinFirma ? `<span class="chip">⚠️ <b>${sinFirma}</b> sin firma o # ID</span>` : ''}</div>
      ${sinFirma ? '<p class="muted" style="font-size:12px;margin:6px 0 0">Las que no tienen firma o # ID salen con esas columnas vacías.</p>' : ''}`;
  };
  $('#xm', md).onchange = info; info();
  $('#xgo', md).onclick = async () => {
    const l = sel(), btn = $('#xgo', md); if (!l.length) return;
    btn.disabled = true;
    try {
      await librerias(true);
      const zip = new JSZip(), usados = new Set();
      // CSV: comillas dobles escapadas y ' delante de lo que Excel tomaría como fórmula (= + - @)
      const celda = v => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
      const csv = [['Archivo', 'Paciente', 'ID paciente', 'Código', 'PBS/NO PBS', 'Servicios', 'IPS', 'Firma', '# ID', 'Alertas'].join(';')];
      for (const [i, b] of l.entries()) {
        if (!btn.isConnected) return; // se cerró el modal: se cancela
        btn.textContent = `PDF ${i + 1} de ${l.length}…`;
        // Nombre único en el ZIP (A, A, "A (2)" → A, A (2), A (2) (2)); sin distinguir mayúsculas, como Windows
        let n = nombreTNA(b);
        for (let k = 2; usados.has(n.toLowerCase()); k++) n = `${nombreTNA(b)} (${k})`;
        usados.add(n.toLowerCase());
        zip.file(n + '.pdf', await pdfBitacora(b));
        const c = cliente(b.clienteId), al = validarBitacora(b);
        csv.push([n + '.pdf', c?.paciente, c?.docPaciente, codigoDe(b), b.plan || '', filas(b).filter(r => r.tramo === 'ida' && !r.excl).length, ipsCanon(c?.ips),
          c?.firma ? 'sí' : 'no', c?.firmaId ? 'sí' : 'no', al.filter(a => a.nivel !== 'info').map(a => a.texto).join(' | ')].map(celda).join(';'));
      }
      zip.file(`RESUMEN ${periodoTxt(l[0].periodo).toUpperCase()}.csv`, '﻿' + csv.join('\r\n'));
      if (!btn.isConnected) return;
      btn.textContent = 'Comprimiendo…';
      descargarBlob(await zip.generateAsync({ type: 'blob', streamFiles: true }), `BITACORAS ${periodoTxt(l[0].periodo).toUpperCase()} (${l.length}).zip`);
      if (btn.isConnected) closeModal();
      toast(`ZIP con ${l.length} bitácoras descargado`);
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
