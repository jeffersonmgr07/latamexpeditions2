#!/usr/bin/env python3
"""Comprueba que los precios del catálogo y del backend coincidan.

El backend recalcula el importe por su cuenta y rechaza cualquier reserva cuyo
precio no cuadre. Si los dos ficheros se desincronizan, esas reservas fallan.
Ejecuta este script antes de cada despliegue.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
cat = json.loads((ROOT / "assets/data/catalog.json").read_text(encoding="utf-8"))
gs = (ROOT / "backend/Codigo.gs").read_text(encoding="utf-8")

def bloque(nombre):
    ini = gs.index(f"const {nombre} = {{")
    return gs[ini:gs.index("};", ini)]

exp_gs = {k: float(v) for k, v in re.findall(r"\'([a-z0-9-]+)\':\s*([0-9.]+)", bloque("PRECIOS"))}
paq_gs = {}
for m in re.finditer(r"\'([a-z0-9-]+)\':\s*\{([^}]+)\}", bloque("PRECIOS_PAQUETES")):
    paq_gs[m.group(1)] = {k: float(v) for k, v in re.findall(r"'(\w+)':\s*([0-9.]+)", m.group(2))}

problemas = []

for e in cat["experiences"]:
    if not e.get("priceFrom"):
        continue
    if e["slug"] not in exp_gs:
        problemas.append(f"FALTA experiencia {e['slug']} (USD {e['priceFrom']:.2f})")
    elif abs(exp_gs[e["slug"]] - e["priceFrom"]) > 0.01:
        problemas.append(f"DESAJUSTE {e['slug']}: catálogo {e['priceFrom']:.2f} vs backend {exp_gs[e['slug']]:.2f}")

for p in cat["packages"]:
    if p["slug"] not in paq_gs:
        problemas.append(f"FALTA paquete {p['slug']}")
        continue
    for t in p.get("hotelTiers", []):
        if t["code"] not in paq_gs[p["slug"]]:
            problemas.append(f"FALTA categoría {t['code']} de {p['slug']}")
        elif abs(paq_gs[p["slug"]][t["code"]] - t["pricePerPerson"]) > 0.01:
            problemas.append(
                f"DESAJUSTE {p['slug']}/{t['code']}: "
                f"catálogo {t['pricePerPerson']:.2f} vs backend {paq_gs[p['slug']][t['code']]:.2f}")

if problemas:
    print("Problemas encontrados (esas reservas se rechazarán):")
    for x in problemas:
        print("  -", x)
    sys.exit(1)

n_tiers = sum(len(v) for v in paq_gs.values())
print(f"OK — {len(exp_gs)} experiencias y {len(paq_gs)} paquetes ({n_tiers} categorías) sincronizados.")
