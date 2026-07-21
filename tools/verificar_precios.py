#!/usr/bin/env python3
"""Comprueba que los precios del catálogo y del backend coincidan.

El backend recalcula el importe por su cuenta y rechaza cualquier reserva cuyo
precio no cuadre. Si los dos ficheros se desincronizan, esas reservas fallan.
Ejecuta este script antes de cada despliegue.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
catalogo = json.loads((ROOT / "assets/data/catalog.json").read_text(encoding="utf-8"))
gs = (ROOT / "backend/Codigo.gs").read_text(encoding="utf-8")

bloque = gs[gs.index("const PRECIOS"):gs.index("/* ====", gs.index("const PRECIOS"))]
backend = {k: float(v) for k, v in re.findall(r"'([a-z0-9-]+)':\s*([0-9.]+)", bloque)}

faltan, desajuste = [], []
for e in catalogo["experiences"] + catalogo["packages"]:
    if not e.get("priceFrom"):
        continue
    if e["slug"] not in backend:
        faltan.append(f"{e['slug']} (USD {e['priceFrom']:.2f})")
    elif abs(backend[e["slug"]] - e["priceFrom"]) > 0.01:
        desajuste.append(f"{e['slug']}: catálogo {e['priceFrom']:.2f} vs backend {backend[e['slug']]:.2f}")

if faltan:
    print("FALTAN en backend/Codigo.gs (esas reservas se rechazarán):")
    for f in faltan: print("  -", f)
if desajuste:
    print("DESAJUSTADOS:")
    for d in desajuste: print("  -", d)
if not faltan and not desajuste:
    print(f"OK — {len(backend)} precios sincronizados entre catálogo y backend.")
    sys.exit(0)
sys.exit(1)
