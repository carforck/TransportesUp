#!/usr/bin/env python3
"""Optimiza los anexos YA guardados (firmas e # ID) para que pesen menos (plan gratuito).

- Firma / # ID limpios: PNG → WebP con transparencia, máx. 600 px de ancho, calidad 82.
- Original (soporte): máx. 1400 px, se guarda el más liviano entre WebP (70) y JPEG (72).
- Antes de tocar nada hace un respaldo completo de data/ en data/_respaldos/<fecha-hora>/.
- Actualiza las rutas y el peso (bytes) en data/db.json y sube la versión para que los
  navegadores abiertos se actualicen solos.

Uso:  python3 scripts/optimizar_anexos.py --prueba   (solo muestra qué haría)
      python3 scripts/optimizar_anexos.py            (aplica)
Requiere Pillow (pip install pillow). Herramienta local de mantenimiento: no se despliega.
"""
import io, json, os, shutil, sys
from datetime import datetime
from PIL import Image

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(RAIZ, 'data')
FIRMAS = os.path.join(DATA, 'firmas')
DB = os.path.join(DATA, 'db.json')
PRUEBA = '--prueba' in sys.argv
MAX_ANEXO, MAX_ORIGINAL = 600, 1400


def kb(n):
    return f'{n / 1024:.1f} KB'


def limpio_a_webp(ruta):
    im = Image.open(ruta).convert('RGBA')
    if im.width > MAX_ANEXO:
        im = im.resize((MAX_ANEXO, max(1, round(im.height * MAX_ANEXO / im.width))), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'WEBP', quality=82, method=6)
    return b.getvalue(), 'webp'


def original_liviano(ruta):
    im = Image.open(ruta).convert('RGB')
    lado = max(im.size)
    if lado > MAX_ORIGINAL:
        k = MAX_ORIGINAL / lado
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    w = io.BytesIO(); im.save(w, 'WEBP', quality=70, method=6)
    j = io.BytesIO(); im.save(j, 'JPEG', quality=72, optimize=True, progressive=True)
    return (w.getvalue(), 'webp') if w.tell() < j.tell() else (j.getvalue(), 'jpg')


def main():
    db = json.load(open(DB, encoding='utf-8'))
    total_antes = total_despues = 0
    cambios = []  # (anexo, campo, ruta_vieja, bytes_nuevos, ext_nueva)
    for c in db['clientes']:
        for campo in ('firma', 'firmaId'):
            a = c.get(campo)
            if not a:
                continue
            for k, fn in (('archivo', limpio_a_webp), ('original', original_liviano)):
                if not a.get(k):
                    continue
                vieja = os.path.join(FIRMAS, os.path.basename(a[k]))
                if not os.path.exists(vieja):
                    print(f'  ! no existe {a[k]}'); continue
                antes = os.path.getsize(vieja)
                nuevos, ext = fn(vieja)
                if len(nuevos) >= antes:  # no empeorar
                    print(f'  = {os.path.basename(vieja)}: {kb(antes)} (ya es liviano, se deja)')
                    total_antes += antes; total_despues += antes
                    continue
                total_antes += antes; total_despues += len(nuevos)
                print(f'  ✓ {c["paciente"][:28]:28} {campo:7} {k:8} {kb(antes):>9} → {kb(len(nuevos)):>9} ({ext})')
                cambios.append((a, k, vieja, nuevos, ext))

    ahorro = total_antes - total_despues
    print(f'\nTotal: {kb(total_antes)} → {kb(total_despues)}  (ahorro {kb(ahorro)}, {ahorro / max(total_antes, 1) * 100:.0f}%)')
    if PRUEBA or not cambios:
        print('Modo prueba: no se cambió nada.' if PRUEBA else 'Nada que optimizar.')
        return

    # Respaldo completo antes de escribir
    destino = os.path.join(DATA, '_respaldos', datetime.now().strftime('%Y%m%d-%H%M%S'))
    os.makedirs(destino)
    shutil.copy2(DB, destino)
    shutil.copytree(FIRMAS, os.path.join(destino, 'firmas'))
    print(f'Respaldo: {os.path.relpath(destino, RAIZ)}')

    borrar = []
    for a, k, vieja, nuevos, ext in cambios:
        base = os.path.splitext(os.path.basename(vieja))[0]
        nombre = f'{base}.{ext}'
        with open(os.path.join(FIRMAS, nombre), 'wb') as f:
            f.write(nuevos)
        if nombre != os.path.basename(vieja):
            borrar.append(vieja)
        a[k] = f'/firmas/{nombre}'
    # Recalcular el peso de cada anexo con lo que quedó en disco
    for c in db['clientes']:
        for campo in ('firma', 'firmaId'):
            a = c.get(campo)
            if a:
                a['bytes'] = sum(os.path.getsize(os.path.join(FIRMAS, os.path.basename(a[k])))
                                 for k in ('archivo', 'original') if a.get(k))
    db['version'] = db.get('version', 1) + 1
    tmp = DB + '.tmp'
    json.dump(db, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    os.replace(tmp, DB)
    for v in borrar:
        os.remove(v)
    print(f'Aplicado: {len(cambios)} archivo(s) optimizado(s), versión de datos {db["version"]}.')


if __name__ == '__main__':
    main()
