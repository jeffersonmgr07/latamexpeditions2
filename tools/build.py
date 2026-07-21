#!/usr/bin/env python3
"""Generador estático de Latam Expeditions.

Uso:  python3 tools/build.py

Lee assets/data/catalog.json y genera todas las páginas HTML del sitio a partir
de las plantillas de tools/partials.py. Para añadir una experiencia, un paquete
o un destino basta con editar el JSON y volver a ejecutar este script: la
cabecera, el pie, el SEO y los datos estructurados se propagan solos.
"""
from __future__ import annotations

import json
import pathlib
import datetime

import partials as P

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "assets/data/catalog.json").read_text(encoding="utf-8"))
SITE = DATA["site"]
DOMAIN = SITE["domain"]
TODAY = datetime.date.today().isoformat()

PAGES: list[tuple[str, str]] = []  # (ruta relativa, prioridad) para el sitemap

# País -> slug sin acentos, para que los filtros de la URL coincidan siempre.
COUNTRY_SLUG = {d["name"]: d["slug"] for d in DATA["destinations"]}


def write(path: str, html: str, priority: str | None = "0.7") -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html, encoding="utf-8")
    if priority:
        PAGES.append((path, priority))
    print(f"  ✓ {path}")


def price_label(item) -> str:
    value = item.get("priceFrom")
    return f'{item.get("currency", "USD")} {value:,.2f}' if value else "Consultar"


def picture(img: str, alt: str, base: str = "", lazy: bool = True,
            width: int = 1200, height: int = 900, css_class: str = "", style: str = "") -> str:
    """<picture> con WebP y respaldo JPG.

    Los navegadores modernos descargan el WebP (≈60 % más ligero) y el resto
    recibe el JPG original, sin necesidad de JavaScript.
    """
    stem = img.rsplit(".", 1)[0]
    loading = 'loading="lazy" decoding="async"' if lazy else 'fetchpriority="high" decoding="async"'
    cls = f' class="{css_class}"' if css_class else ""
    sty = f' style="{style}"' if style else ""
    return (
        f'<picture>'
        f'<source srcset="{base}assets/img/{stem}.webp" type="image/webp" />'
        f'<img src="{base}assets/img/{img}" alt="{alt}" width="{width}" height="{height}" '
        f'{loading}{cls}{sty} />'
        f'</picture>'
    )


# --------------------------------------------------------------------------- #
# Componentes de tarjeta
# --------------------------------------------------------------------------- #

def trip_card(item, kind: str, base: str = "", lazy: bool = True) -> str:
    """Tarjeta de experiencia o paquete."""
    if kind == "experience":
        href = f"{base}experiencias/{item['slug']}.html"
        tag = item["styleLabel"]
        tags = f'{item["style"]} {COUNTRY_SLUG.get(item["country"], "")}'
        cta = "Ver experiencia"
    else:
        href = f"{base}paquetes/{item['slug']}.html"
        tag = item["nights"]
        tags = COUNTRY_SLUG.get(item["country"], "")
        cta = "Ver paquete"

    return f"""<article class="trip-card" data-tags="{tags}">
          <div class="trip-card__media">
            {picture(item['img'], item['alt'], base, lazy)}
            <span class="tag">{tag}</span>
          </div>
          <div class="trip-card__body">
            <div class="meta"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> {item['country']} · {item['region']}</div>
            <h3>{item['title']}</h3>
            <p>{item['excerpt']}</p>
            <div class="price-row">
              <div class="price"><small>Desde</small><strong>{price_label(item)}</strong></div>
              <a class="card-btn" href="{href}">{cta}<span class="visually-hidden">: {item['title']}</span></a>
            </div>
          </div>
        </article>"""


def dest_card(item, base: str = "") -> str:
    return f"""<a class="dest-card" href="{base}experiencias.html?destino={item['slug']}" data-tags="{item['slug']}">
          {picture(item['img'], item['alt'], base)}
          <div class="dest-card__body">
            <h3>{item['name']}</h3>
            <p>{item['summary']}</p>
            <span class="dest-card__season"><i class="fa-regular fa-calendar" aria-hidden="true"></i> Mejor época: {item['best']}</span>
          </div>
        </a>"""


def style_feature(item, base: str = "") -> str:
    return f"""<article class="style-feature" data-tags="{item['slug']}">
          {picture(item['img'], f"Viaje de estilo {item['name'].lower()} en Latinoamérica", base)}
          <div class="style-feature__body">
            <i class="fa-solid {item['icon']}" aria-hidden="true"></i>
            <h3>{item['name']}</h3>
            <p>{item['description']}</p>
            <a class="card-btn" href="{base}experiencias.html?estilo={item['slug']}">Ver viajes<span class="visually-hidden"> de estilo {item['name']}</span></a>
          </div>
        </article>"""


def page_hero(title: str, text: str, crumbs) -> str:
    return f"""  <section class="page-hero">
    <div class="page-hero__inner">
      {P.breadcrumb(crumbs)}
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  </section>
"""


def filter_bar(options, label="Filtrar por") -> str:
    buttons = '<button type="button" class="filter-btn" data-filter="all" aria-pressed="true">Todos</button>'
    buttons += "".join(
        f'<button type="button" class="filter-btn" data-filter="{value}" aria-pressed="false">{text}</button>'
        for value, text in options
    )
    return f"""    <div class="filters" role="group" aria-label="{label}">{buttons}</div>
    <p class="results-count" id="resultsCount" role="status"></p>
"""


# --------------------------------------------------------------------------- #
# Páginas
# --------------------------------------------------------------------------- #

def build_index() -> None:
    experiences = DATA["experiences"]
    packages = DATA["packages"]
    styles = DATA["styles"]
    featured = [d for d in DATA["destinations"] if d.get("featured")]

    ld = P.jsonld({
        "@context": "https://schema.org",
        "@type": "TravelAgency",
        "name": SITE["name"],
        "url": DOMAIN,
        "description": SITE["description"],
        "email": SITE["email"],
        "telephone": SITE["phoneRaw"],
        "image": f"{DOMAIN}/assets/img/latam-hero-01.jpg",
        "areaServed": [d["name"] for d in DATA["destinations"]],
        "sameAs": [],
    }) + P.jsonld({
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": SITE["name"],
        "url": DOMAIN,
        "inLanguage": "es",
        "potentialAction": {
            "@type": "SearchAction",
            "target": {"@type": "EntryPoint", "urlTemplate": f"{DOMAIN}/experiencias.html?destino={{search_term_string}}"},
            "query-input": "required name=search_term_string",
        },
    })

    style_options = "".join(f'<option value="{s["slug"]}">{s["name"]}</option>' for s in DATA["styles"])
    dest_options = "".join(f'<option value="{d["slug"]}">{d["name"]}</option>' for d in DATA["destinations"])

    cards_exp = "\n        ".join(trip_card(e, "experience", lazy=(i > 2)) for i, e in enumerate(experiences))
    cards_pack = "\n        ".join(trip_card(p, "package") for p in packages)
    cards_style = "".join(
        f'<article class="style-card"><i class="fa-solid {s["icon"]}" aria-hidden="true"></i>'
        f'<h3>{s["name"]}</h3><p>{s["summary"]}</p></article>'
        for s in styles
    )
    big, *rest = featured
    dest_block = f"""<article class="destination-large">
          {picture(big['img'], big['alt'])}
          <div class="destination-content"><h3>{big['name']}</h3><p>{big['summary']}</p></div>
        </article>
        <div class="destination-stack">""" + "".join(
        f"""<article>
            {picture(d['img'], d['alt'])}
            <div class="destination-content"><h3>{d['name']}</h3><p>{d['summary']}</p></div>
          </article>""" for d in rest
    ) + "</div>"

    html = P.head(
        title="Latam Expeditions | Viajes y paquetes a medida por Latinoamérica",
        description="Diseñamos viajes por Perú, Colombia, Chile, Argentina, Brasil, México y toda Latinoamérica: experiencias seleccionadas, paquetes flexibles y asesoría local especializada.",
        canonical="index.html",
        extra='  <link rel="preload" as="image" href="assets/img/latam-hero-01.jpg" fetchpriority="high" />\n' + ld,
    )
    html += P.header()
    html += f"""  <main id="contenido">
    <section class="hero" aria-labelledby="heroTitle">
      <div class="hero__content">
        <span class="eyebrow" data-i18n="hero.eyebrow">Descubre Latinoamérica con expertos locales</span>
        <h1 id="heroTitle" data-i18n="hero.title">Viajes memorables por Latinoamérica, diseñados para ti</h1>
        <p data-i18n="hero.subtitle">Explora destinos icónicos, culturas vivas y paisajes únicos con itinerarios que se ajustan a tu ritmo, tu presupuesto y tu forma de viajar.</p>

        <form class="search-card" id="tripSearchForm" role="search" aria-label="Buscador de viajes">
          <div class="search-field">
            <label for="searchDestination" data-i18n="search.destination">¿A dónde quieres viajar?</label>
            <select id="searchDestination" name="destination">
              <option value="">Todos los destinos</option>{dest_options}
            </select>
          </div>
          <div class="search-field">
            <label for="searchType" data-i18n="search.type">Estilo de viaje</label>
            <select id="searchType" name="travelType">
              <option value="">Cualquier estilo</option>{style_options}
            </select>
          </div>
          <div class="search-field">
            <label for="searchDate" data-i18n="search.date">Fecha estimada</label>
            <input type="month" id="searchDate" name="date" />
          </div>
          <button class="search-btn" type="submit">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <span>Buscar viajes</span>
          </button>
        </form>
        <p class="hero-note" data-i18n="hero.note">Rutas personalizadas según tu país, temporada y estilo de viaje</p>
      </div>
    </section>

{P.trust_bar()}
    <section class="section" id="experiencias" aria-labelledby="expTitle">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Experiencias destacadas</p>
          <h2 id="expTitle">Vive Latinoamérica día a día</h2>
        </div>
        <p>Actividades y excursiones seleccionadas por nuestro equipo local, listas para reservar o para integrar en un viaje a medida.</p>
      </div>
      <div class="cards-grid">
        {cards_exp}
      </div>
      <p style="margin-top:32px"><a class="btn-outline" href="experiencias.html">Ver todas las experiencias <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></p>
    </section>

    <section class="section" id="paquetes" aria-labelledby="packTitle">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Paquetes flexibles</p>
          <h2 id="packTitle">Viajes completos, ajustables a tu medida</h2>
        </div>
        <p>Itinerarios de varios días con traslados, guías y actividades incluidas. Eliges el hotel, la fecha y el ritmo.</p>
      </div>
      <div class="cards-grid">
        {cards_pack}
      </div>
      <p style="margin-top:32px"><a class="btn-outline" href="paquetes.html">Ver todos los paquetes <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></p>
    </section>

    <section class="section" id="estilos" aria-labelledby="styleTitle">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Estilos de viaje</p>
          <h2 id="styleTitle">Elige cómo quieres vivir Latinoamérica</h2>
        </div>
        <p>Aventura, playa, cultura, naturaleza, familia, romance, gastronomía o lujo flexible: cada estilo define el ritmo y los servicios de tu itinerario.</p>
      </div>
      <div class="style-grid">{cards_style}</div>
      <p style="margin-top:32px"><a class="btn-outline" href="estilos-viaje.html">Explorar estilos de viaje <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></p>
    </section>

    <section class="builder-band" id="asesoria" aria-labelledby="builderTitle">
      <div class="builder-band__inner">
        <div>
          <h2 id="builderTitle">Diseñamos tu viaje en <span>tres pasos</span></h2>
          <p>Un asesor especializado en tu destino te acompaña desde la primera consulta hasta el regreso a casa.</p>
          <p style="margin-top:24px"><a class="btn-primary" href="contacto.html">Solicitar una propuesta gratuita</a></p>
        </div>
        <div class="steps">
          <div class="step"><strong>1</strong><h3>Cuéntanos tu idea</h3><p>Destino, fechas aproximadas, número de viajeros y qué te gustaría vivir.</p></div>
          <div class="step"><strong>2</strong><h3>Recibe tu propuesta</h3><p>Itinerario detallado con hoteles, servicios y precio cerrado en 48 horas.</p></div>
          <div class="step"><strong>3</strong><h3>Viaja acompañado</h3><p>Guías locales, traslados coordinados y soporte 24/7 durante todo el viaje.</p></div>
        </div>
      </div>
    </section>

    <section class="section" id="destinos" aria-labelledby="destTitle">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Destinos Latam</p>
          <h2 id="destTitle">Países que conocemos a fondo</h2>
        </div>
        <p>Operamos en once países de la región con equipos y proveedores locales verificados en cada destino.</p>
      </div>
      <div class="destinations">{dest_block}</div>
      <p style="margin-top:32px"><a class="btn-outline" href="destinos.html">Ver todos los destinos <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></p>
    </section>
  </main>

{P.country_modal()}"""
    html += P.footer()
    write("index.html", html, "1.0")


def build_experiences() -> None:
    style_options = [(s["slug"], s["name"]) for s in DATA["styles"]]
    cards = "\n        ".join(trip_card(e, "experience", lazy=(i > 2)) for i, e in enumerate(DATA["experiences"]))

    ld = P.jsonld({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Experiencias en Latinoamérica",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": e["title"],
             "url": f"{DOMAIN}/experiencias/{e['slug']}.html"}
            for i, e in enumerate(DATA["experiences"])
        ],
    })

    html = P.head(
        title="Experiencias en Latinoamérica | Latam Expeditions",
        description="Excursiones y experiencias seleccionadas en Perú, Colombia, Chile, Argentina, Bolivia, Brasil, Ecuador, Venezuela y México. Filtra por estilo de viaje y reserva con asesoría local.",
        canonical="experiencias.html",
        image="assets/img/peru-machu-picchu-01.jpg",
        extra=ld,
    )
    html += P.header()
    html += '  <main id="contenido">\n'
    html += page_hero(
        "Experiencias por Latinoamérica",
        "Actividades guiadas, excursiones de día completo y rutas de varios días operadas por equipos locales. Filtra por estilo de viaje para encontrar la tuya.",
        [("Inicio", "index.html"), ("Experiencias", None)],
    )
    html += f"""    <section class="section" data-filterable>
{filter_bar(style_options, "Filtrar experiencias por estilo de viaje")}      <div class="cards-grid">
        {cards}
      </div>
      <p class="empty-state" id="emptyState" hidden>No hay experiencias con ese filtro. <a href="contacto.html">Cuéntanos qué buscas</a> y la diseñamos a medida.</p>
    </section>
  </main>

{P.country_modal()}"""
    html += P.footer()
    write("experiencias.html", html, "0.9")


def build_packages() -> None:
    countries = sorted({p["country"] for p in DATA["packages"]})
    options = [(COUNTRY_SLUG.get(c, c.lower()), c) for c in countries]
    cards = "\n        ".join(trip_card(p, "package", lazy=(i > 2)) for i, p in enumerate(DATA["packages"]))

    ld = P.jsonld({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Paquetes de viaje por Latinoamérica",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": p["title"],
             "url": f"{DOMAIN}/paquetes/{p['slug']}.html"}
            for i, p in enumerate(DATA["packages"])
        ],
    })

    html = P.head(
        title="Paquetes de viaje por Latinoamérica | Latam Expeditions",
        description="Paquetes de 4 a 7 días por Perú, Colombia, Chile, Argentina, Bolivia y Brasil, con traslados, guías y actividades incluidas. Hotel y fechas a tu elección.",
        canonical="paquetes.html",
        image="assets/img/paquete-peru-4d3n-01.jpg",
        extra=ld,
    )
    html += P.header()
    html += '  <main id="contenido">\n'
    html += page_hero(
        "Paquetes de viaje",
        "Itinerarios completos de varios días con traslados, guías y actividades incluidas. Eliges la categoría de hotel, las fechas y el ritmo del viaje.",
        [("Inicio", "index.html"), ("Paquetes", None)],
    )
    html += f"""    <section class="section" data-filterable>
{filter_bar(options, "Filtrar paquetes por país")}      <div class="cards-grid">
        {cards}
      </div>
      <p class="empty-state" id="emptyState" hidden>No hay paquetes con ese filtro. <a href="contacto.html">Solicita un itinerario a medida</a>.</p>
    </section>

    <section class="builder-band">
      <div class="builder-band__inner">
        <div>
          <h2>¿Ninguno encaja? <span>Lo diseñamos</span></h2>
          <p>Combinamos destinos, ajustamos duraciones y adaptamos el presupuesto. Cuéntanos tu idea y recibirás una propuesta detallada en 48 horas.</p>
          <p style="margin-top:24px"><a class="btn-primary" href="contacto.html">Solicitar propuesta a medida</a></p>
        </div>
        <div class="steps">
          <div class="step"><strong>1</strong><h3>Sin costo</h3><p>La primera propuesta y sus ajustes no tienen ningún cargo.</p></div>
          <div class="step"><strong>2</strong><h3>Precio cerrado</h3><p>Todo detallado por escrito: qué incluye y qué no.</p></div>
          <div class="step"><strong>3</strong><h3>Soporte 24/7</h3><p>Un asesor disponible durante todo tu viaje.</p></div>
        </div>
      </div>
    </section>
  </main>

{P.country_modal()}"""
    html += P.footer()
    write("paquetes.html", html, "0.9")


def build_destinations() -> None:
    cards = "\n        ".join(dest_card(d) for d in DATA["destinations"])
    ld = P.jsonld({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Destinos de Latam Expeditions",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": d["name"]}
            for i, d in enumerate(DATA["destinations"])
        ],
    })

    html = P.head(
        title="Destinos en Latinoamérica | Latam Expeditions",
        description="Once países de Latinoamérica con equipos locales: Perú, Colombia, Chile, Argentina, Brasil, Bolivia, Ecuador, México, Costa Rica, Uruguay y Venezuela. Consulta la mejor época para viajar a cada uno.",
        canonical="destinos.html",
        image="assets/img/destino-peru-01.jpg",
        extra=ld,
    )
    html += P.header()
    html += '  <main id="contenido">\n'
    html += page_hero(
        "Destinos en Latinoamérica",
        "Operamos en once países con proveedores y guías locales verificados. Cada ficha incluye las regiones principales y la mejor época del año para visitarlas.",
        [("Inicio", "index.html"), ("Destinos", None)],
    )
    html += f"""    <section class="section">
      <div class="grid-3">
        {cards}
      </div>
    </section>

    <section class="builder-band">
      <div class="builder-band__inner">
        <div>
          <h2>¿Quieres combinar <span>varios países</span>?</h2>
          <p>Perú y Bolivia, Chile y Argentina, Colombia y Ecuador: diseñamos rutas multidestino con vuelos internos y traslados coordinados.</p>
          <p style="margin-top:24px"><a class="btn-primary" href="contacto.html">Diseñar ruta multidestino</a></p>
        </div>
        <div class="steps">
          <div class="step"><strong>1</strong><h3>Logística resuelta</h3><p>Vuelos internos, buses y traslados fronterizos coordinados.</p></div>
          <div class="step"><strong>2</strong><h3>Un solo contacto</h3><p>El mismo asesor te acompaña en todos los países.</p></div>
          <div class="step"><strong>3</strong><h3>Sin tiempos muertos</h3><p>Itinerarios pensados para aprovechar cada día.</p></div>
        </div>
      </div>
    </section>
  </main>

{P.country_modal()}"""
    html += P.footer()
    write("destinos.html", html, "0.9")


def build_styles() -> None:
    cards = "\n        ".join(style_feature(s) for s in DATA["styles"])
    html = P.head(
        title="Estilos de viaje | Latam Expeditions",
        description="Aventura, playa, familia, romántico, cultura, naturaleza, gastronomía y lujo flexible: elige el estilo que define tu viaje por Latinoamérica y encuentra experiencias afines.",
        canonical="estilos-viaje.html",
        image="assets/img/estilo-aventura-01.jpg",
    )
    html += P.header()
    html += '  <main id="contenido">\n'
    html += page_hero(
        "Estilos de viaje",
        "El estilo define el ritmo, los hoteles y el tipo de actividades de tu itinerario. Elige el tuyo y te mostramos las experiencias que mejor encajan.",
        [("Inicio", "index.html"), ("Estilos de viaje", None)],
    )
    html += f"""    <section class="section">
      <div class="grid-3">
        {cards}
      </div>
    </section>
  </main>

{P.country_modal()}"""
    html += P.footer()
    write("estilos-viaje.html", html, "0.8")


def build_experience_details() -> None:
    for item in DATA["experiences"]:
        includes = "".join(
            f'<li><i class="fa-solid fa-check" aria-hidden="true"></i><span>{x}</span></li>'
            for x in item["includes"]
        )
        excludes = "".join(
            f'<li><i class="fa-solid fa-xmark" aria-hidden="true"></i><span>{x}</span></li>'
            for x in item["notIncludes"]
        )
        highlights = "".join(
            f'<li><i class="fa-solid fa-star" aria-hidden="true"></i><span>{x}</span></li>'
            for x in item["highlights"]
        )
        related = [e for e in DATA["experiences"] if e["slug"] != item["slug"]][:3]
        related_cards = "\n        ".join(trip_card(e, "experience", base="../") for e in related)

        ld_obj = {
            "@context": "https://schema.org",
            "@type": "TouristTrip",
            "name": item["title"],
            "description": item["description"],
            "url": f"{DOMAIN}/experiencias/{item['slug']}.html",
            "image": f"{DOMAIN}/assets/img/{item['img']}",
            "touristType": item["styleLabel"],
            "itinerary": {"@type": "Place", "name": f"{item['region']}, {item['country']}"},
            "provider": {"@type": "TravelAgency", "name": SITE["name"], "url": DOMAIN},
        }
        if item.get("priceFrom"):
            ld_obj["offers"] = {
                "@type": "Offer", "price": item["priceFrom"], "priceCurrency": item["currency"],
                "availability": "https://schema.org/InStock",
                "url": f"{DOMAIN}/experiencias/{item['slug']}.html",
            }
        ld = P.jsonld(ld_obj) + P.jsonld({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Inicio", "item": f"{DOMAIN}/index.html"},
                {"@type": "ListItem", "position": 2, "name": "Experiencias", "item": f"{DOMAIN}/experiencias.html"},
                {"@type": "ListItem", "position": 3, "name": item["title"]},
            ],
        })


        html = P.head(
            title=f"{item['title']} | Experiencia en {item['country']} | Latam Expeditions",
            description=item["description"][:158],
            canonical=f"experiencias/{item['slug']}.html",
            base="../",
            image=f"assets/img/{item['img']}",
            extra=ld,
        )
        html += P.header(base="../")
        html += f"""  <main id="contenido">
    <section class="page-hero detail-hero" style="--detail-image:url('../assets/img/{item['img']}')">
      <div class="page-hero__inner">
        {P.breadcrumb([("Inicio", "index.html"), ("Experiencias", "experiencias.html"), (item["title"], None)], base="../")}
        <span class="eyebrow">{item['styleLabel']} · {item['duration']}</span>
        <h1>{item['title']}</h1>
        <p>{item['excerpt']}</p>
      </div>
    </section>

    <section class="section">
      <div class="detail-grid">
        <div>
          <div class="detail-card" style="margin-bottom:24px">
            <h2>Sobre esta experiencia</h2>
            <p style="color:var(--latam-muted);font-weight:600;line-height:1.7;margin:0 0 22px">{item['description']}</p>
            <ul class="detail-list">{highlights}</ul>
          </div>
          <div class="detail-card" style="margin-bottom:24px">
            <h2>Qué incluye</h2>
            <ul class="detail-list">{includes}</ul>
          </div>
          <div class="detail-card">
            <h2>No incluye</h2>
            <ul class="detail-list detail-list--x">{excludes}</ul>
          </div>
        </div>

        <aside class="detail-aside">
          <div class="detail-card">
            <div class="price-block">
              <small>Precio desde</small>
              <strong>{price_label(item)}</strong>
            </div>
            <div class="fact-row"><span>Destino</span><strong>{item['region']}, {item['country']}</strong></div>
            <div class="fact-row"><span>Duración</span><strong>{item['duration']}</strong></div>
            <div class="fact-row"><span>Estilo</span><strong>{item['styleLabel']}</strong></div>
            <div class="fact-row"><span>Idiomas</span><strong>Español · Inglés</strong></div>
            <div class="cta-stack" style="margin-top:22px">
              <a class="btn-primary" href="../contacto.html?experiencia={item['slug']}">Solicitar cotización</a>
              <a class="btn-outline" href="https://wa.me/{SITE['whatsapp']}?text={('Hola, quiero información sobre ' + item['title']).replace(' ', '%20')}" target="_blank" rel="noopener noreferrer">
                <i class="fab fa-whatsapp" aria-hidden="true"></i> Consultar por WhatsApp
              </a>
            </div>
            <p class="form-note" style="margin-top:16px;text-align:center">Respuesta en menos de 24 horas hábiles.</p>
          </div>
        </aside>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="section-heading">
        <div><p class="section-kicker">También te puede interesar</p><h2>Otras experiencias</h2></div>
      </div>
      <div class="cards-grid">
        {related_cards}
      </div>
    </section>
  </main>

{P.country_modal()}"""
        html += P.footer(base="../")
        write(f"experiencias/{item['slug']}.html", html, "0.8")


def build_package_details() -> None:
    for item in DATA["packages"]:
        itinerary = "".join(f"<li>{day}</li>" for day in item["itinerary"])
        includes = "".join(
            f'<li><i class="fa-solid fa-check" aria-hidden="true"></i><span>{x}</span></li>'
            for x in item["includes"]
        )
        ld = P.jsonld({
            "@context": "https://schema.org",
            "@type": "TouristTrip",
            "name": item["title"],
            "description": item["excerpt"],
            "url": f"{DOMAIN}/paquetes/{item['slug']}.html",
            "image": f"{DOMAIN}/assets/img/{item['img']}",
            "itinerary": {"@type": "Place", "name": f"{item['region']}, {item['country']}"},
            "provider": {"@type": "TravelAgency", "name": SITE["name"], "url": DOMAIN},
        })

        html = P.head(
            title=f"{item['title']} {item['nights']} | Paquete en {item['country']} | Latam Expeditions",
            description=f"Paquete {item['nights']} en {item['country']}: {item['excerpt']}",
            canonical=f"paquetes/{item['slug']}.html",
            base="../",
            image=f"assets/img/{item['img']}",
            extra=ld,
        )
        html += P.header(base="../")
        html += f"""  <main id="contenido">
    <section class="page-hero">
      <div class="page-hero__inner">
        {P.breadcrumb([("Inicio", "index.html"), ("Paquetes", "paquetes.html"), (item["title"], None)], base="../")}
        <span class="eyebrow" style="margin-top:14px">{item['nights']} · {item['country']}</span>
        <h1>{item['title']}</h1>
        <p>{item['excerpt']}</p>
      </div>
    </section>

    <section class="section">
      <div class="detail-grid">
        <div>
          <div class="detail-card" style="margin-bottom:24px">
            <h2>Itinerario día a día</h2>
            <ol class="itinerary">{itinerary}</ol>
          </div>
          <div class="detail-card">
            <h2>Qué incluye</h2>
            <ul class="detail-list">{includes}</ul>
          </div>
        </div>

        <aside class="detail-aside">
          <div class="detail-card">
            {picture(item['img'], item['alt'], '../', style='border-radius:20px;margin-bottom:20px')}
            <div class="price-block">
              <small>Precio desde</small>
              <strong>{price_label(item)}</strong>
            </div>
            <div class="fact-row"><span>Duración</span><strong>{item['nights']}</strong></div>
            <div class="fact-row"><span>Destino</span><strong>{item['region']}, {item['country']}</strong></div>
            <div class="fact-row"><span>Hotel</span><strong>A elección</strong></div>
            <div class="cta-stack" style="margin-top:22px">
              <a class="btn-primary" href="../contacto.html?paquete={item['slug']}">Solicitar cotización</a>
              <a class="btn-outline" href="https://wa.me/{SITE['whatsapp']}?text={('Hola, quiero información sobre el paquete ' + item['title']).replace(' ', '%20')}" target="_blank" rel="noopener noreferrer">
                <i class="fab fa-whatsapp" aria-hidden="true"></i> Consultar por WhatsApp
              </a>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </main>

{P.country_modal()}"""
        html += P.footer(base="../")
        write(f"paquetes/{item['slug']}.html", html, "0.7")


def build_contact() -> None:
    dest_options = "".join(f'<option value="{d["name"]}">{d["name"]}</option>' for d in DATA["destinations"])
    style_options = "".join(f'<option value="{s["name"]}">{s["name"]}</option>' for s in DATA["styles"])

    faqs = [
        ("¿Cuánto cuesta pedir una propuesta?",
         "Nada. Elaborar el itinerario, ajustarlo y cotizarlo es un servicio gratuito. Solo pagas cuando decides confirmar el viaje."),
        ("¿En cuánto tiempo recibo mi itinerario?",
         "Enviamos una primera propuesta detallada en un máximo de 48 horas hábiles desde tu consulta."),
        ("¿Puedo modificar un paquete publicado?",
         "Sí. Todos nuestros paquetes son una base: puedes cambiar hoteles, añadir días, quitar excursiones o combinar países."),
        ("¿Qué pasa si necesito cambiar las fechas?",
         "Gestionamos cambios y postergaciones según las condiciones de cada proveedor. Te informamos por escrito de cualquier diferencia tarifaria antes de aplicarla."),
        ("¿Los precios incluyen vuelos internacionales?",
         "No por defecto. Los precios publicados corresponden a servicios en destino. Podemos cotizar vuelos por separado si lo necesitas."),
        ("¿Con quién hablo durante el viaje?",
         "Tendrás el contacto directo de tu asesor y un número de emergencia disponible 24/7 durante toda tu estancia."),
    ]
    faq_html = "".join(
        f'<details class="detail-card" style="margin-bottom:14px"><summary style="cursor:pointer;font-family:Montserrat,sans-serif;font-weight:800;color:var(--latam-green);font-size:17px">{q}</summary>'
        f'<p style="color:var(--latam-muted);font-weight:600;line-height:1.65;margin:14px 0 0">{a}</p></details>'
        for q, a in faqs
    )
    ld = P.jsonld({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q,
             "acceptedAnswer": {"@type": "Answer", "text": a}}
            for q, a in faqs
        ],
    })

    html = P.head(
        title="Contacto y asesoría de viaje | Latam Expeditions",
        description="Solicita una propuesta de viaje gratuita por Latinoamérica. Respuesta en 48 horas hábiles, asesoría local especializada y soporte 24/7 durante tu viaje.",
        canonical="contacto.html",
        extra=ld,
    )
    html += P.header()
    html += '  <main id="contenido">\n'
    html += page_hero(
        "Diseñemos tu viaje",
        "Cuéntanos qué te gustaría vivir y un asesor especializado en tu destino te enviará una propuesta detallada, sin costo ni compromiso.",
        [("Inicio", "index.html"), ("Contacto", None)],
    )
    html += f"""    <section class="section">
      <div class="detail-grid">
        <div class="detail-card">
          <h2>Solicita tu propuesta</h2>
          <div class="form-success" data-success>
            <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
            ¡Gracias! Hemos recibido tu consulta. Un asesor te escribirá en menos de 48 horas hábiles.
          </div>
          <form class="form-grid" data-validate style="margin-top:18px">
            <div class="grid-2" style="gap:16px">
              <div class="form-field">
                <label for="name">Nombre y apellido</label>
                <input type="text" id="name" name="name" required autocomplete="name" />
                <span class="form-error">Indícanos tu nombre completo.</span>
              </div>
              <div class="form-field">
                <label for="email">Correo electrónico</label>
                <input type="email" id="email" name="email" required autocomplete="email" />
                <span class="form-error">Introduce un correo electrónico válido.</span>
              </div>
            </div>
            <div class="grid-2" style="gap:16px">
              <div class="form-field">
                <label for="phone">Teléfono o WhatsApp</label>
                <input type="tel" id="phone" name="phone" autocomplete="tel" />
                <small>Opcional. Acelera la respuesta.</small>
              </div>
              <div class="form-field">
                <label for="travelers">Número de viajeros</label>
                <input type="number" id="travelers" name="travelers" min="1" max="40" value="2" required />
                <span class="form-error">Indica cuántas personas viajan.</span>
              </div>
            </div>
            <div class="grid-2" style="gap:16px">
              <div class="form-field">
                <label for="destination">Destino de interés</label>
                <select id="destination" name="destination" required>
                  <option value="">Selecciona un destino</option>{dest_options}
                  <option value="Varios países">Varios países / aún no lo sé</option>
                </select>
                <span class="form-error">Elige un destino o indica que aún no lo sabes.</span>
              </div>
              <div class="form-field">
                <label for="style">Estilo de viaje</label>
                <select id="style" name="style">
                  <option value="">Sin preferencia</option>{style_options}
                </select>
              </div>
            </div>
            <div class="grid-2" style="gap:16px">
              <div class="form-field">
                <label for="date">Fecha aproximada</label>
                <input type="month" id="date" name="date" />
              </div>
              <div class="form-field">
                <label for="budget">Presupuesto por persona</label>
                <select id="budget" name="budget">
                  <option value="">Prefiero no indicarlo</option>
                  <option>Hasta USD 1.000</option>
                  <option>USD 1.000 – 2.500</option>
                  <option>USD 2.500 – 5.000</option>
                  <option>Más de USD 5.000</option>
                </select>
              </div>
            </div>
            <div class="form-field">
              <label for="message">Cuéntanos sobre tu viaje</label>
              <textarea id="message" name="message" rows="5" required placeholder="Qué te gustaría ver, con quién viajas, si tienes días fijos, si hay algo que quieras evitar…"></textarea>
              <span class="form-error">Cuéntanos brevemente qué buscas.</span>
            </div>
            <div class="form-field">
              <label style="display:flex;gap:10px;align-items:flex-start;font-weight:600;color:var(--latam-muted)">
                <input type="checkbox" required style="width:auto;margin-top:3px" />
                <span>He leído y acepto la <a href="legal.html#privacidad" style="color:var(--latam-green);font-weight:800">política de privacidad</a>.</span>
              </label>
              <span class="form-error">Debes aceptar la política de privacidad para continuar.</span>
            </div>
            <button class="btn-primary" type="submit">Enviar consulta</button>
            <p class="form-note">Al enviar, tus datos se usan únicamente para responder a esta consulta. No compartimos información con terceros.</p>
          </form>
        </div>

        <aside class="detail-aside">
          <div class="detail-card">
            <h2>Habla con nosotros</h2>
            <div class="cta-stack">
              <a class="btn-outline" href="https://wa.me/{SITE['whatsapp']}" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp" aria-hidden="true"></i> WhatsApp</a>
              <a class="btn-outline" href="tel:{SITE['phoneRaw']}"><i class="fa-solid fa-phone" aria-hidden="true"></i> {SITE['phone']}</a>
              <a class="btn-outline" href="mailto:{SITE['email']}"><i class="fa-solid fa-envelope" aria-hidden="true"></i> Escribir un correo</a>
            </div>
            <div class="fact-row" style="margin-top:20px"><span>Lunes a viernes</span><strong>09:00 – 19:00</strong></div>
            <div class="fact-row"><span>Sábados</span><strong>09:00 – 14:00</strong></div>
            <div class="fact-row"><span>Emergencias en viaje</span><strong>24/7</strong></div>
          </div>
        </aside>
      </div>
    </section>

    <section class="section" id="faq" style="padding-top:0">
      <div class="section-heading">
        <div><p class="section-kicker">Preguntas frecuentes</p><h2>Antes de escribirnos</h2></div>
      </div>
      {faq_html}
    </section>
  </main>

{P.country_modal()}"""
    html += P.footer()
    write("contacto.html", html, "0.8")


def build_about() -> None:
    html = P.head(
        title="Sobre nosotros | Latam Expeditions",
        description="Somos una agencia especializada exclusivamente en Latinoamérica, con equipos locales en once países y un compromiso con el turismo responsable.",
        canonical="nosotros.html",
    )
    html += P.header()
    html += '  <main id="contenido">\n'
    html += page_hero(
        "Latinoamérica es todo lo que hacemos",
        "No vendemos el mundo entero. Nos especializamos en una región y la conocemos a fondo, con equipos propios y proveedores verificados en cada país.",
        [("Inicio", "index.html"), ("Sobre nosotros", None)],
    )
    html += """    <section class="section">
      <div class="grid-3">
        <div class="detail-card">
          <h2>Especialización real</h2>
          <p style="color:var(--latam-muted);font-weight:600;line-height:1.65">Cada asesor trabaja con dos o tres países como máximo. Conocen los hoteles, las temporadas, los tiempos reales de traslado y los detalles que no aparecen en un buscador.</p>
        </div>
        <div class="detail-card" id="compromiso">
          <h2>Nuestro compromiso</h2>
          <p style="color:var(--latam-muted);font-weight:600;line-height:1.65">Precio cerrado por escrito, con lo que incluye y lo que no. Sin cargos sorpresa. Si algo cambia durante el viaje, lo resolvemos nosotros y te informamos antes.</p>
        </div>
        <div class="detail-card" id="sostenibilidad">
          <h2>Turismo responsable</h2>
          <p style="color:var(--latam-muted);font-weight:600;line-height:1.65">Priorizamos operadores locales, guías de las comunidades donde trabajamos y alojamientos con prácticas verificables de gestión de residuos y consumo de agua.</p>
        </div>
      </div>
    </section>

    <section class="builder-band">
      <div class="builder-band__inner">
        <div>
          <h2>Los números <span>importan</span></h2>
          <p>Pero lo que más valoramos es que nuestros viajeros vuelvan y nos recomienden.</p>
        </div>
        <div class="steps">
          <div class="step"><strong>11</strong><h3>Países</h3><p>Con equipo y proveedores locales verificados.</p></div>
          <div class="step"><strong>48h</strong><h3>Respuesta</h3><p>Tiempo máximo para tu primera propuesta.</p></div>
          <div class="step"><strong>24/7</strong><h3>Soporte</h3><p>Asistencia real durante todo el viaje.</p></div>
        </div>
      </div>
    </section>
  </main>

""" + P.country_modal()
    html += P.footer()
    write("nosotros.html", html, "0.6")


def build_legal() -> None:
    sections = [
        ("terminos", "Términos y condiciones", [
            "Las tarifas publicadas son referenciales, están expresadas en dólares estadounidenses y pueden variar según disponibilidad, temporada y tipo de cambio vigente al momento de la confirmación.",
            "La reserva se considera confirmada únicamente tras la recepción del pago acordado y el envío de la confirmación escrita por parte de Latam Expeditions.",
            "El viajero es responsable de contar con la documentación migratoria, visados y vacunas exigidos por cada país de destino.",
            "Recomendamos contratar un seguro de asistencia en viaje con cobertura médica y de cancelación. En algunos destinos es obligatorio.",
        ]),
        ("privacidad", "Política de privacidad", [
            "Los datos personales que nos facilitas a través de los formularios se utilizan exclusivamente para elaborar y responder tu solicitud de viaje.",
            "No cedemos, vendemos ni compartimos tus datos con terceros ajenos a la prestación del servicio contratado.",
            "Puedes solicitar el acceso, la rectificación o la eliminación de tus datos escribiendo a reservas@latamexpeditions.com.",
            "Conservamos la información durante el tiempo necesario para atender tu consulta y cumplir las obligaciones legales aplicables.",
        ]),
        ("cookies", "Política de cookies", [
            "Este sitio utiliza almacenamiento local del navegador para recordar tu país de origen y tu idioma preferido. No son cookies y no se comparten con nadie.",
            "Para mostrarte precios y salidas relevantes, al entrar consultamos tu país aproximado a través de un servicio externo de geolocalización por IP. No guardamos tu dirección IP ni la asociamos a tu persona.",
            "No utilizamos cookies de publicidad ni de seguimiento de terceros.",
            "Puedes borrar esta información en cualquier momento desde la configuración de tu navegador.",
        ]),
        ("reclamaciones", "Libro de reclamaciones", [
            "Conforme a la normativa de protección al consumidor, ponemos a disposición un canal formal de reclamos.",
            "Puedes presentar tu reclamo escribiendo a reservas@latamexpeditions.com indicando tu número de reserva y el detalle del hecho.",
            "Responderemos en un plazo máximo de 30 días calendario desde la recepción del reclamo.",
        ]),
    ]
    blocks = "".join(
        f'<div class="detail-card" id="{sid}" style="margin-bottom:20px"><h2>{title}</h2>'
        + "".join(f'<p style="color:var(--latam-muted);font-weight:600;line-height:1.7">{p}</p>' for p in paras)
        + "</div>"
        for sid, title, paras in sections
    )
    html = P.head(
        title="Información legal | Latam Expeditions",
        description="Términos y condiciones, política de privacidad, política de cookies y libro de reclamaciones de Latam Expeditions.",
        canonical="legal.html",
        robots="index, follow",
    )
    html += P.header()
    html += '  <main id="contenido">\n'
    html += page_hero(
        "Información legal",
        "Condiciones de contratación, tratamiento de datos personales y canales de reclamo.",
        [("Inicio", "index.html"), ("Legal", None)],
    )
    html += f'    <section class="section">{blocks}\n      <p class="form-note">Última actualización: {TODAY}. Este contenido es una plantilla base y debe ser revisado por un asesor legal antes de su publicación definitiva.</p>\n    </section>\n  </main>\n\n'
    html += P.country_modal()
    html += P.footer()
    write("legal.html", html, "0.3")


def build_auth() -> None:
    aside = """    <aside class="auth-aside">
      <a class="brand" href="index.html" style="color:#fff" aria-label="Latam Expeditions, ir al inicio">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">Latam<span>Expeditions</span></span>
      </a>
      <h2>Tu próximo viaje, siempre a mano</h2>
      <p>Crea tu cuenta para guardar experiencias favoritas, seguir el estado de tus consultas y acceder a tus documentos de viaje.</p>
      <ul>
        <li><i class="fa-solid fa-heart" aria-hidden="true"></i><span>Guarda experiencias y paquetes que te interesan</span></li>
        <li><i class="fa-solid fa-file-lines" aria-hidden="true"></i><span>Consulta tus propuestas e itinerarios</span></li>
        <li><i class="fa-solid fa-bell" aria-hidden="true"></i><span>Recibe avisos de temporada y disponibilidad</span></li>
      </ul>
    </aside>
"""
    # Login
    html = P.head(
        title="Iniciar sesión | Latam Expeditions",
        description="Accede a tu cuenta de Latam Expeditions para consultar tus propuestas de viaje, guardar favoritos y descargar tus documentos.",
        canonical="login.html",
        robots="noindex, follow",
    )
    html += f"""  <main class="auth-layout" id="contenido">
{aside}    <div class="auth-main">
      <div class="auth-card">
        <a href="index.html" style="color:var(--latam-green);font-weight:800"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Volver al inicio</a>
        <h1>Iniciar sesión</h1>
        <p>Accede para guardar favoritos, revisar tus consultas y continuar diseñando tu viaje.</p>
        <div class="form-success" data-success>Sesión iniciada correctamente (demostración).</div>
        <form class="form-grid" data-validate>
          <div class="form-field">
            <label for="loginEmail">Correo electrónico</label>
            <input type="email" id="loginEmail" name="email" required autocomplete="email" />
            <span class="form-error">Introduce un correo electrónico válido.</span>
          </div>
          <div class="form-field">
            <label for="loginPassword">Contraseña</label>
            <input type="password" id="loginPassword" name="password" required minlength="8" autocomplete="current-password" />
            <span class="form-error">La contraseña debe tener al menos 8 caracteres.</span>
          </div>
          <button class="btn-primary" type="submit">Ingresar</button>
        </form>
        <p class="auth-alt">¿Aún no tienes cuenta? <a href="registro.html">Regístrate</a></p>
      </div>
    </div>
  </main>

  <script src="assets/js/main.js" defer></script>
</body>
</html>
"""
    write("login.html", html, None)

    # Registro
    html = P.head(
        title="Crear cuenta | Latam Expeditions",
        description="Crea tu cuenta en Latam Expeditions para guardar tus viajes favoritos y hacer seguimiento de tus propuestas.",
        canonical="registro.html",
        robots="noindex, follow",
    )
    html += f"""  <main class="auth-layout" id="contenido">
{aside}    <div class="auth-main">
      <div class="auth-card">
        <a href="index.html" style="color:var(--latam-green);font-weight:800"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Volver al inicio</a>
        <h1>Crear cuenta</h1>
        <p>Regístrate para guardar tus viajes favoritos y hacer seguimiento de tus propuestas.</p>
        <div class="form-success" data-success>Cuenta creada correctamente (demostración).</div>
        <form class="form-grid" data-validate>
          <div class="form-field">
            <label for="regName">Nombre y apellido</label>
            <input type="text" id="regName" name="name" required autocomplete="name" />
            <span class="form-error">Indícanos tu nombre completo.</span>
          </div>
          <div class="form-field">
            <label for="regEmail">Correo electrónico</label>
            <input type="email" id="regEmail" name="email" required autocomplete="email" />
            <span class="form-error">Introduce un correo electrónico válido.</span>
          </div>
          <div class="form-field">
            <label for="regPassword">Contraseña</label>
            <input type="password" id="regPassword" name="password" required minlength="8" autocomplete="new-password" />
            <small>Mínimo 8 caracteres.</small>
            <span class="form-error">La contraseña debe tener al menos 8 caracteres.</span>
          </div>
          <div class="form-field">
            <label style="display:flex;gap:10px;align-items:flex-start;font-weight:600;color:var(--latam-muted)">
              <input type="checkbox" required style="width:auto;margin-top:3px" />
              <span>Acepto los <a href="legal.html#terminos" style="color:var(--latam-green);font-weight:800">términos</a> y la <a href="legal.html#privacidad" style="color:var(--latam-green);font-weight:800">política de privacidad</a>.</span>
            </label>
            <span class="form-error">Debes aceptar los términos para continuar.</span>
          </div>
          <button class="btn-primary" type="submit">Crear cuenta</button>
        </form>
        <p class="auth-alt">¿Ya tienes cuenta? <a href="login.html">Inicia sesión</a></p>
      </div>
    </div>
  </main>

  <script src="assets/js/main.js" defer></script>
</body>
</html>
"""
    write("registro.html", html, None)


def build_404() -> None:
    html = P.head(
        title="Página no encontrada | Latam Expeditions",
        description="La página que buscas no existe o ha cambiado de dirección.",
        canonical="404.html",
        robots="noindex, follow",
    )
    html += P.header()
    html += """  <main id="contenido">
    <section class="error-page">
      <div>
        <h1>404</h1>
        <h2>Esta ruta no aparece en el mapa</h2>
        <p>La página que buscas no existe o ha cambiado de dirección. Puedes volver al inicio o explorar nuestros destinos.</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <a class="btn-primary" href="index.html">Volver al inicio</a>
          <a class="btn-outline" href="destinos.html">Ver destinos</a>
        </div>
      </div>
    </section>
  </main>

"""
    html += P.footer()
    write("404.html", html, None)


def build_meta_files() -> None:
    urls = "".join(
        f"  <url>\n    <loc>{DOMAIN}/{path}</loc>\n    <lastmod>{TODAY}</lastmod>\n"
        f"    <changefreq>weekly</changefreq>\n    <priority>{priority}</priority>\n  </url>\n"
        for path, priority in sorted(PAGES, key=lambda p: -float(p[1]))
    )
    (ROOT / "sitemap.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n',
        encoding="utf-8",
    )
    print("  ✓ sitemap.xml")

    (ROOT / "robots.txt").write_text(
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /login.html\n"
        "Disallow: /registro.html\n"
        "Disallow: /tools/\n\n"
        f"Sitemap: {DOMAIN}/sitemap.xml\n",
        encoding="utf-8",
    )
    print("  ✓ robots.txt")

    manifest = {
        "name": SITE["name"],
        "short_name": "Latam Exp.",
        "description": SITE["description"],
        "start_url": "/index.html",
        "display": "standalone",
        "background_color": "#fbfdfb",
        "theme_color": "#0a3d2c",
        "lang": "es",
        "icons": [{"src": "/assets/img/favicon.svg", "sizes": "any", "type": "image/svg+xml"}],
    }
    (ROOT / "site.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("  ✓ site.webmanifest")

    favicon = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="14" fill="#063f2a"/>'
        '<rect x="20" y="14" width="10" height="36" fill="none" stroke="#f7c600" stroke-width="7"/>'
        '<rect x="38" y="14" width="8" height="36" rx="4" fill="#f7c600"/>'
        "</svg>"
    )
    (ROOT / "assets/img/favicon.svg").write_text(favicon, encoding="utf-8")
    print("  ✓ assets/img/favicon.svg")


def main() -> None:
    print("Generando Latam Expeditions…")
    build_index()
    build_experiences()
    build_packages()
    build_destinations()
    build_styles()
    build_experience_details()
    build_package_details()
    build_contact()
    build_about()
    build_legal()
    build_auth()
    build_404()
    build_meta_files()
    print(f"\nListo: {len(PAGES)} páginas en el sitemap.")


if __name__ == "__main__":
    main()
