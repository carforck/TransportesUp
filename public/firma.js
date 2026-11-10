/* Componente de firma: adjuntar el anexo (foto/escaneo) → se quita el fondo, se recorta y se valida.
   Alternativa: dibujarla en pantalla.
   Uso: const w = FirmaWidget(el, { actual }); const r = w.valor();
        r = null (sin cambios) | { error } | { tipo, data (PNG transparente), original (anexo) } */
(function () {
  const TIPOS = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  const MAX_SUBIDA = 15 * 1024 * 1024;
  const TINTAS = { original: null, azul: [13, 42, 138], negro: [20, 20, 20] };

  const cargarImagen = file => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen. ¿Es un archivo de imagen válido?')); i.src = URL.createObjectURL(file);
  });
  const lienzo = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // ---- Peso liviano (plan gratuito): WebP con transparencia, tamaño acotado ----
  const MAX_ANEXO = 600;     // px de ancho de la firma / # ID limpios (en el documento se ve a ~16 px de alto)
  const MAX_ORIGINAL = 1400; // px del lado mayor del anexo original que se guarda como soporte
  const bytesDe = dataUrl => Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
  const kb = n => n < 1024 ? n + ' B' : (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  // Exporta un lienzo con transparencia: WebP si el navegador lo soporta, si no PNG
  function exportarTransparente(cv) {
    const k = Math.min(1, MAX_ANEXO / cv.width);
    const c = k < 1 ? lienzo(Math.round(cv.width * k), Math.max(1, Math.round(cv.height * k))) : cv;
    if (k < 1) { const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cv, 0, 0, c.width, c.height); }
    const webp = c.toDataURL('image/webp', 0.82);
    return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
  }

  // Copia del anexo para guardar como soporte: máx. 1400 px, el más liviano entre WebP y JPEG
  function originalComoJpeg(img) {
    const s = Math.min(1, MAX_ORIGINAL / Math.max(img.naturalWidth, img.naturalHeight));
    const c = lienzo(Math.round(img.naturalWidth * s), Math.round(img.naturalHeight * s)), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
    const jpg = c.toDataURL('image/jpeg', 0.72), webp = c.toDataURL('image/webp', 0.7);
    return webp.startsWith('data:image/webp') && webp.length < jpg.length ? webp : jpg;
  }

  /* Quita el fondo:
     1) estima el fondo con un desenfoque fuerte (compensa sombras y luz desigual de la foto),
     2) cada píxel se compara contra su fondo local → qué tan "tinta" es,
     3) elimina manchas pequeñas sueltas (ruido, polvo, textura del papel),
     4) recorta al contenido y valida que realmente haya una firma. */
  function quitarFondo(img, { sensibilidad = 50, tinta = 'original', recorte = null } = {}) {
    // recorte opcional {x, y, w, h} en píxeles reales de la imagen: solo se procesa esa zona
    const r = recorte || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    const s = Math.min(1, 1600 / Math.max(r.w, r.h));
    const W = Math.max(1, Math.round(r.w * s)), H = Math.max(1, Math.round(r.h * s));
    const src = lienzo(W, H), sx = src.getContext('2d', { willReadFrequently: true });
    sx.fillStyle = '#fff'; sx.fillRect(0, 0, W, H); sx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, W, H);
    const px = sx.getImageData(0, 0, W, H).data;

    // Fondo local: reducir mucho + desenfocar + ampliar
    const bw = Math.max(8, Math.round(W / 24)), bh = Math.max(8, Math.round(H / 24));
    const small = lienzo(bw, bh), smx = small.getContext('2d');
    smx.filter = 'blur(2px)'; smx.drawImage(src, 0, 0, bw, bh);
    const bg = lienzo(W, H), bgx = bg.getContext('2d', { willReadFrequently: true });
    bgx.imageSmoothingQuality = 'high'; bgx.drawImage(small, 0, 0, W, H);
    const bp = bgx.getImageData(0, 0, W, H).data;

    // Umbrales según sensibilidad (0 = solo trazos muy oscuros, 100 = capta trazos tenues)
    const t0 = 0.30 - (sensibilidad / 100) * 0.24; // 0.30 … 0.06
    const t1 = t0 + 0.22;
    const N = W * H, alpha = new Float32Array(N), out = new Uint8ClampedArray(N * 4);
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      const L = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
      const Lb = Math.max(40, 0.299 * bp[p] + 0.587 * bp[p + 1] + 0.114 * bp[p + 2]);
      const d = 1 - Math.min(1, L / Lb);                    // oscuridad relativa al fondo
      const a = d <= t0 ? 0 : Math.min(1, (d - t0) / (t1 - t0));
      alpha[i] = a;
      const t = TINTAS[tinta];
      if (t) { out[p] = t[0]; out[p + 1] = t[1]; out[p + 2] = t[2]; }
      else { // color real de la tinta, normalizado contra el fondo y algo más intenso
        for (let k = 0; k < 3; k++) out[p + k] = Math.min(255, (px[p + k] / Math.max(40, bp[p + k])) * 255 * 0.75);
      }
      out[p + 3] = Math.round(a * 255);
    }

    // Validación previa: fondo oscuro o demasiada "tinta" → no es una firma sobre papel
    let fondoSum = 0, tintaIni = 0;
    for (let i = 0, p = 0; i < N; i++, p += 4) { fondoSum += 0.299 * bp[p] + 0.587 * bp[p + 1] + 0.114 * bp[p + 2]; if (alpha[i] >= 0.25) tintaIni++; }
    let oscuros = 0;
    for (let p = 0; p < px.length; p += 4) if (0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2] < 90) oscuros++;
    if (fondoSum / N < 120 || oscuros / N > 0.45 || tintaIni / N > 0.40)
      return { error: 'La imagen tiene el fondo oscuro o demasiado contenido (no parece solo una firma). Use una foto de la firma sobre papel blanco, recortada a la firma.' };

    // Quitar líneas rectas largas (renglones o bordes de tabla del formulario): tramos continuos
    // horizontales > 35% del ancho o verticales > 70% del alto. Una firma no tiene trazos rectos tan largos.
    const esTinta = i => alpha[i] >= 0.25;
    const borrar = i => { alpha[i] = 0; out[i * 4 + 3] = 0; };
    // Tolerante a inclinación: se sigue la línea en una banda de ±1 px.
    // Horizontales ≥ 35% del ancho; verticales ≥ 88% del alto (un "1" o una "l" no ocupan todo el alto).
    const minH = Math.round(W * 0.35), minV = Math.round(H * 0.88);
    const marcaL = new Uint8Array(N);
    const tintaBandaFila = (x, y) => { for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < H && esTinta(yy * W + x)) return true; } return false; };
    const tintaBandaCol = (x, y) => { for (let d = -1; d <= 1; d++) { const xx = x + d; if (xx >= 0 && xx < W && esTinta(y * W + xx)) return true; } return false; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W;) {
      if (!esTinta(y * W + x)) { x++; continue; }
      let e = x; while (e < W && tintaBandaFila(e, y)) e++;
      if (e - x >= minH) for (let k = x; k < e; k++) for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < H && esTinta(yy * W + k)) marcaL[yy * W + k] = 1; }
      x = e;
    }
    if (minV >= 20) for (let x = 0; x < W; x++) for (let y = 0; y < H;) {
      if (!esTinta(y * W + x)) { y++; continue; }
      let e = y; while (e < H && tintaBandaCol(x, e)) e++;
      if (e - y >= minV) for (let k = y; k < e; k++) for (let d = -1; d <= 1; d++) { const xx = x + d; if (xx >= 0 && xx < W && esTinta(k * W + xx)) marcaL[k * W + xx] = 1; }
      y = e;
    }
    // ensancha 2 px para llevarse el borde suave de la línea (sin tocar trazos firmes de la firma)
    for (let i = 0; i < N; i++) if (marcaL[i]) {
      borrar(i);
      const x = i % W;
      for (let d = 1; d <= 2; d++) {
        for (const k of [i - d * W, i + d * W]) if (k >= 0 && k < N && !marcaL[k] && alpha[k] < 0.85) borrar(k);
        if (x - d >= 0 && !marcaL[i - d] && alpha[i - d] < 0.85) borrar(i - d);
        if (x + d < W && !marcaL[i + d] && alpha[i + d] < 0.85) borrar(i + d);
      }
    }

    // Eliminar manchas sueltas (componentes conectados pequeños) — arreglos tipados, sin asignaciones por píxel
    const minPix = Math.max(12, Math.round(N * 0.00004));
    const visto = new Uint8Array(N), pila = new Int32Array(N), comp = new Int32Array(N), keep = new Uint8Array(N);
    let tinta_px = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let i = 0; i < N; i++) {
      if (visto[i] || alpha[i] < 0.25) continue;
      let top = 0, n = 0, cx0 = W, cy0 = H, cx1 = -1, cy1 = -1;
      pila[top++] = i; visto[i] = 1;
      while (top) {
        const j = pila[--top]; comp[n++] = j;
        const x = j % W, y = (j - x) / W;
        if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy; if (ny < 0 || ny >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx; if (nx < 0 || nx >= W || (dx === 0 && dy === 0)) continue;
            const k = ny * W + nx; if (!visto[k] && alpha[k] >= 0.25) { visto[k] = 1; pila[top++] = k; }
          }
        }
      }
      const ch_ = cy1 - cy0 + 1, cw_ = cx1 - cx0 + 1, borde = Math.max(3, H * 0.10);
      const restoDeLinea = ch_ <= Math.max(3, H * 0.025) && cw_ >= ch_ * 3 && (cy0 < borde || cy1 > H - 1 - borde);
      // Bordes de tabla pegados al borde del recorte: muy delgados y casi del alto/ancho completo
      const bordeV = cw_ <= Math.max(4, W * 0.025) && ch_ >= H * 0.80 && (cx0 <= 3 || cx1 >= W - 4);
      const bordeH = ch_ <= Math.max(4, H * 0.06) && cw_ >= W * 0.50 && (cy0 <= 3 || cy1 >= H - 4);
      if (n < minPix || restoDeLinea || bordeV || bordeH) { for (let q = 0; q < n; q++) out[comp[q] * 4 + 3] = 0; continue; }
      tinta_px += n;
      for (let q = 0; q < n; q++) keep[comp[q]] = 1;
      if (cx0 < x0) x0 = cx0; if (cx1 > x1) x1 = cx1; if (cy0 < y0) y0 = cy0; if (cy1 > y1) y1 = cy1;
    }
    // Píxeles tenues: solo se conservan si tocan un trazo real (borde suave de la tinta)
    for (let i = 0; i < N; i++) {
      if (keep[i] || !out[i * 4 + 3]) continue;
      const x = i % W, y = (i - x) / W; let toca = false;
      for (let dy = -1; dy <= 1 && !toca; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && keep[ny * W + nx]) { toca = true; break; }
      }
      if (!toca) out[i * 4 + 3] = 0;
    }

    // Validación
    const ratio = tinta_px / N;
    if (x1 < 0 || ratio < 0.0004) return { error: 'No se detectó ninguna firma en la imagen. Pruebe subiendo la sensibilidad o con una foto más nítida.' };
    const bwid = x1 - x0 + 1, bhei = y1 - y0 + 1;
    if (bwid < 30 || bhei < 10) return { error: 'Lo detectado es demasiado pequeño para ser una firma.' };

    // Recorte con margen y tamaño final razonable
    const full = lienzo(W, H); full.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
    const pad = Math.round(Math.max(bwid, bhei) * 0.04) + 4;
    const cx = Math.max(0, x0 - pad), cy = Math.max(0, y0 - pad), cw = Math.min(W, x1 + pad + 1) - cx, ch = Math.min(H, y1 + pad + 1) - cy;
    const fin = lienzo(cw, ch);
    fin.getContext('2d').drawImage(full, cx, cy, cw, ch, 0, 0, cw, ch);
    const aviso = ratio > 0.25 ? 'Se detectó bastante contenido; verifique que solo quede la firma.' : '';
    const data = exportarTransparente(fin);
    return { data, ancho: Math.min(cw, MAX_ANEXO), alto: Math.round(ch * Math.min(1, MAX_ANEXO / cw)), aviso, bytes: bytesDe(data) };
  }

  function recortarDibujo(cv) {
    const ctx = cv.getContext('2d'), { width: w, height: h } = cv, p = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (p[(y * w + x) * 4 + 3] > 20) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 - x0 < 30) return null;
    const pad = 6, out = lienzo(x1 - x0 + pad * 2, y1 - y0 + pad * 2);
    out.getContext('2d').drawImage(cv, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    return exportarTransparente(out);
  }

  const TEXTOS = {
    firma: { adjuntar: '📎 Adjuntar firma', dibujar: '✍️ Dibujar', drop: 'Arrastre aquí la foto o escaneo de la <b>firma</b>, o haga clic para elegirla',
      res: 'Firma sin fondo (así se guarda)', actual: 'Firma actual', ok: 'Firma detectada y fondo eliminado.', pad: 'Firme con el dedo, lápiz o mouse' },
    id: { adjuntar: '📎 Adjuntar documento', dibujar: '✍️ Escribir', drop: 'Arrastre aquí la foto o escaneo del <b>número de documento escrito a mano</b>, o haga clic para elegirla',
      res: '# ID sin fondo (así se guarda)', actual: '# ID actual', ok: 'Número detectado y fondo eliminado.', pad: 'Escriba el número con el dedo, lápiz o mouse' },
  };

  window.FirmaWidget = function (root, { actual = null, clase = 'firma', verificar = '' } = {}) {
    const T = TEXTOS[clase] || TEXTOS.firma;
    root.innerHTML = `
      <div class="tabs">
        <button type="button" class="btn on" data-t="escaneada">${T.adjuntar}</button>
        <button type="button" class="btn" data-t="diligenciada">${T.dibujar}</button>
      </div>
      <div data-p="escaneada">
        <label class="drop" data-drop>
          <span data-drop-txt>📄 ${T.drop}<br><small class="muted">PNG, JPG o WEBP · fondo claro</small></span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>
        </label>
        <div data-ajustes hidden>
          <div class="cmp">
            <figure><figcaption>Anexo original — <span class="muted">arrastre para recortar solo el contenido</span></figcaption>
              <div class="crop-wrap" data-cropwrap><img data-orig alt="Original" draggable="false"><div class="crop-box" data-cropbox hidden></div></div>
              <button type="button" class="btn sm" data-sincrop hidden style="margin-top:6px">Quitar recorte</button></figure>
            <figure><figcaption>${T.res}</figcaption><div class="transp"><img data-res alt="Firma procesada"></div></figure>
          </div>
          <div class="form" style="margin-top:10px">
            <label>Sensibilidad <span data-sv class="muted"></span><input type="range" min="0" max="100" value="50" data-sens></label>
            <label>Color de la tinta<select data-tinta><option value="original">Original</option><option value="azul">Azul</option><option value="negro">Negro</option></select></label>
          </div>
          <p data-estado class="estado"></p>
        </div>
      </div>
      <div data-p="diligenciada" hidden>
        <div class="sig-box"><canvas></canvas><div class="base"></div></div>
        <div class="row" style="margin-top:8px"><button type="button" class="btn sm" data-clr>Limpiar</button>
          <small class="muted">${T.pad}</small></div>
      </div>
      ${actual ? `<p class="muted" style="margin:12px 0 4px">${T.actual} (se conserva si no adjunta otra):</p><div class="transp" style="display:inline-block"><img class="sig-prev" src="${actual}" style="border:0;background:none"></div>` : ''}`;

    let tipo = 'escaneada', img = null, resultado = null, original = null, dirty = false, recorte = null;
    const q = s => root.querySelector(s);
    const tabs = root.querySelectorAll('.tabs button');
    tabs.forEach(b => b.onclick = () => {
      tipo = b.dataset.t; tabs.forEach(x => x.classList.toggle('on', x === b));
      root.querySelectorAll('[data-p]').forEach(p => p.hidden = p.dataset.p !== tipo);
      if (tipo === 'diligenciada') prepararPad();
    });

    // ----- Adjuntar -----
    const drop = q('[data-drop]'), inp = q('input[type=file]'), sens = q('[data-sens]'), tintaSel = q('[data-tinta]'), estado = q('[data-estado]');
    const procesar = () => {
      if (!img) return;
      q('[data-sv]').textContent = sens.value + '%';
      resultado = quitarFondo(img, { sensibilidad: +sens.value, tinta: tintaSel.value, recorte });
      const res = q('[data-res]');
      if (resultado.error) { res.hidden = true; estado.className = 'estado err'; estado.textContent = '✗ ' + resultado.error; }
      else {
        res.hidden = false; res.src = resultado.data;
        estado.className = 'estado ' + (resultado.aviso ? 'warn' : 'ok');
        const v = typeof verificar === 'function' ? verificar() : verificar;
        const peso = ` · Se guardará: ${kb(resultado.bytes)} + original ${kb(bytesDe(original || ''))}`;
        estado.textContent = (resultado.aviso ? '⚠ ' + resultado.aviso
          : `✓ ${T.ok} ${v ? `Verifique que se lea ${v}.` : 'Revise el resultado y guarde.'}`) + peso;
      }
    };
    let timer; const procesarDiferido = () => { clearTimeout(timer); timer = setTimeout(procesar, 120); };
    async function tomar(file) {
      if (!file) return;
      q('[data-ajustes]').hidden = false;
      estado.className = 'estado'; estado.textContent = 'Procesando…'; resultado = null;
      if (!TIPOS.includes(file.type)) { estado.className = 'estado err'; estado.textContent = '✗ Formato no soportado. Use PNG, JPG, WEBP o SVG.'; return; }
      if (file.size > MAX_SUBIDA) { estado.className = 'estado err'; estado.textContent = '✗ El archivo es muy grande (máx. 15 MB).'; return; }
      try {
        img = await cargarImagen(file); recorte = null; pintarCaja();
        q('[data-orig]').src = img.src;
        original = originalComoJpeg(img);
        q('[data-drop-txt]').innerHTML = `📄 <b>${file.name.replace(/[<>&]/g, '')}</b> — clic para cambiar`;
        setTimeout(procesar, 20);
      } catch (e) { estado.className = 'estado err'; estado.textContent = '✗ ' + e.message; }
    }
    inp.onchange = () => tomar(inp.files[0]);

    // ----- Recorte: arrastrar un recuadro sobre el original -----
    const wrap = q('[data-cropwrap]'), box = q('[data-cropbox]'), orig = q('[data-orig]'), sinCrop = q('[data-sincrop]');
    const pintarCaja = () => {
      if (!recorte || !img) { box.hidden = true; sinCrop.hidden = true; return; }
      const k = orig.clientWidth / img.naturalWidth, o = orig.offsetLeft, t = orig.offsetTop;
      Object.assign(box.style, { left: o + recorte.x * k + 'px', top: t + recorte.y * k + 'px', width: recorte.w * k + 'px', height: recorte.h * k + 'px' });
      box.hidden = false; sinCrop.hidden = false;
    };
    const fijarRecorte = rr => { recorte = rr; pintarCaja(); procesar(); };
    let ini = null;
    const enImg = e => { const b = orig.getBoundingClientRect(), k = img.naturalWidth / b.width;
      return [Math.max(0, Math.min(img.naturalWidth, (e.clientX - b.left) * k)), Math.max(0, Math.min(img.naturalHeight, (e.clientY - b.top) * k))]; };
    wrap.onpointerdown = e => { if (!img) return; e.preventDefault(); ini = enImg(e); wrap.setPointerCapture(e.pointerId); };
    wrap.onpointermove = e => { if (!ini) return; const [x, y] = enImg(e);
      recorte = { x: Math.min(ini[0], x), y: Math.min(ini[1], y), w: Math.abs(x - ini[0]), h: Math.abs(y - ini[1]) }; pintarCaja(); };
    wrap.onpointerup = () => { if (!ini) return; ini = null;
      if (!recorte || recorte.w < 15 || recorte.h < 8) recorte = null; pintarCaja(); procesar(); };
    sinCrop.onclick = () => fijarRecorte(null);
    window.addEventListener('resize', pintarCaja);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); tomar(e.dataTransfer.files[0]); };
    sens.oninput = procesarDiferido; tintaSel.onchange = procesar;

    // ----- Dibujar -----
    const cv = q('canvas'), ctx = cv.getContext('2d');
    let listo = false;
    function prepararPad() {
      const r = cv.getBoundingClientRect(); if (!r.width || listo) return;
      const dpr = window.devicePixelRatio || 1;
      cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.4; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#0D2A8A'; listo = true;
    }
    let drawing = false, last;
    const pt = e => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    cv.onpointerdown = e => { prepararPad(); drawing = true; dirty = true; last = pt(e); cv.setPointerCapture(e.pointerId); e.preventDefault(); };
    cv.onpointermove = e => { if (!drawing) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; };
    cv.onpointerup = cv.onpointercancel = () => drawing = false;
    q('[data-clr]').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); dirty = false; };

    return {
      // Recorte por código (x, y, w, h en píxeles de la imagen original)
      setRecorte(x, y, w, h) { if (img) fijarRecorte({ x, y, w, h }); },
      valor() {
        if (tipo === 'diligenciada') {
          if (!dirty) return null;
          const data = recortarDibujo(cv);
          return data ? { tipo, data } : { error: 'La firma dibujada es muy pequeña.' };
        }
        if (!img) return null;
        if (!resultado) return { error: 'La imagen aún se está procesando.' };
        if (resultado.error) return { error: resultado.error };
        return { tipo, data: resultado.data, original };
      },
    };
  };
})();
