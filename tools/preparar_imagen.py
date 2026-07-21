#!/usr/bin/env python3
"""Prepara una imagen para el sitio: recorte 3:2, redimensión y WebP.

Uso:
    python3 tools/preparar_imagen.py foto.jpg peru-nuevo-tour-01

Acepta cualquier proporción de entrada y recorta al centro. Genera
assets/img/<nombre>.jpg y assets/img/<nombre>.webp.
"""
import pathlib, sys
from PIL import Image

ANCHO, ALTO = 1200, 800  # 3:2

def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    origen = pathlib.Path(sys.argv[1])
    nombre = sys.argv[2].removesuffix(".jpg").removesuffix(".webp")
    destino = pathlib.Path(__file__).resolve().parent.parent / "assets/img"

    if not origen.exists():
        print(f"No encuentro {origen}")
        sys.exit(1)

    im = Image.open(origen).convert("RGB")
    w, h = im.size

    if h / w > ALTO / ANCHO:          # demasiado alta: recortar arriba y abajo
        nuevo_h = int(w * ALTO / ANCHO)
        top = (h - nuevo_h) // 2
        im = im.crop((0, top, w, top + nuevo_h))
    else:                              # demasiado ancha: recortar los lados
        nuevo_w = int(h * ANCHO / ALTO)
        left = (w - nuevo_w) // 2
        im = im.crop((left, 0, left + nuevo_w, h))

    if im.size[0] < ANCHO:
        print(f"AVISO: la original es de solo {w}x{h}. Se verá borrosa. Busca una más grande.")

    im = im.resize((ANCHO, ALTO), Image.LANCZOS)
    im.save(destino / f"{nombre}.jpg", "JPEG", quality=86, optimize=True)
    im.save(destino / f"{nombre}.webp", "WEBP", quality=82, method=6)

    kb_j = (destino / f"{nombre}.jpg").stat().st_size / 1024
    kb_w = (destino / f"{nombre}.webp").stat().st_size / 1024
    print(f"Listo: {nombre}.jpg ({kb_j:.0f} KB) y {nombre}.webp ({kb_w:.0f} KB)")
    print(f"Ahora añade \"img\": \"{nombre}.jpg\" en assets/data/catalog.json y ejecuta tools/build.py")

if __name__ == "__main__":
    main()
