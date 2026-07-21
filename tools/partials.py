"""Fragmentos HTML reutilizables (cabecera, pie, modal, scripts).

Cada función devuelve una cadena HTML. El parámetro ``base`` es el prefijo de
ruta relativo a la raíz del sitio: "" para páginas raíz y "../" para páginas
dentro de subcarpetas como /experiencias/.
"""

NAV_ITEMS = [
    ("destinos.html", "Destinos", "nav.destinations"),
    ("experiencias.html", "Experiencias", "nav.experiences"),
    ("paquetes.html", "Paquetes", "nav.packages"),
    ("estilos-viaje.html", "Estilos de viaje", "nav.travelStyles"),
    ("contacto.html", "Contacto", "nav.contact"),
]

LANGS = [
    ("es", "ES"), ("en", "EN"), ("pt", "PT"), ("fr", "FR"),
    ("de", "DE"), ("it", "IT"), ("ja", "JA"), ("zh", "ZH"),
]

COUNTRIES = [
    ("🇵🇪", "Perú", "Salidas desde Lima y Cusco"),
    ("🇨🇴", "Colombia", "Salidas desde Bogotá y Medellín"),
    ("🇨🇱", "Chile", "Salidas desde Santiago"),
    ("🇦🇷", "Argentina", "Salidas desde Buenos Aires"),
    ("🇧🇴", "Bolivia", "Salidas desde La Paz"),
    ("🇧🇷", "Brasil", "Salidas desde São Paulo y Río"),
    ("🇪🇨", "Ecuador", "Salidas desde Quito y Guayaquil"),
    ("🇲🇽", "México", "Salidas desde Ciudad de México"),
    ("🇻🇪", "Venezuela", "Salidas desde Caracas"),
    ("🇺🇾", "Uruguay", "Salidas desde Montevideo"),
    ("🇨🇷", "Costa Rica", "Salidas desde San José"),
    ("🌎", "Otro país", "Tarifas internacionales"),
]


def head(*, title, description, canonical, base="", image="assets/img/latam-hero-01.jpg",
         extra="", robots=None):
    """<head> completo con SEO, Open Graph, favicon y precarga de recursos."""
    domain = "https://latamexpeditions.com"
    og_image = f"{domain}/{image}"
    robots_tag = f'\n  <meta name="robots" content="{robots}" />' if robots else ""
    return f"""<!DOCTYPE html>
<html lang="es" data-base="{base or './'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <meta name="description" content="{description}" />
  <link rel="canonical" href="{domain}/{canonical}" />{robots_tag}
  <meta name="theme-color" content="#0a3d2c" />
  <meta name="author" content="Latam Expeditions" />

  <meta property="og:site_name" content="Latam Expeditions" />
  <meta property="og:locale" content="es_ES" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{description}" />
  <meta property="og:url" content="{domain}/{canonical}" />
  <meta property="og:image" content="{og_image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="800" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{description}" />
  <meta name="twitter:image" content="{og_image}" />

  <link rel="icon" type="image/svg+xml" href="{base}assets/img/favicon.svg" />
  <link rel="apple-touch-icon" href="{base}assets/img/favicon.svg" />
  <link rel="manifest" href="{base}site.webmanifest" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" integrity="sha512-SnH5WK+bZxgPHs44uWIX+LLJAJ9/2PkPKZ5QiAj6Ta86w+fsb2TkcmfRyVX3pBnMFcV7oQPJkl9QevSCWr3W6A==" crossorigin="anonymous" referrerpolicy="no-referrer" />
  <link rel="stylesheet" href="{base}assets/css/main.css" />
{extra}</head>
<body>
  <a class="skip-link" href="#contenido">Saltar al contenido principal</a>
"""


def header(base=""):
    """Cabecera con navegación de escritorio, selector de idioma y menú móvil."""
    nav = "".join(
        f'<a href="{base}{href}" data-i18n="{key}">{label}</a>'
        for href, label, key in NAV_ITEMS
    )
    mobile = "".join(
        f'<a href="{base}{href}" data-close-nav data-i18n="{key}">{label}</a>'
        for href, label, key in NAV_ITEMS
    )
    langs = "".join(f'<option value="{code}">{label}</option>' for code, label in LANGS)
    return f"""  <header class="topbar">
    <div class="topbar__inner">
      <a class="brand" href="{base}index.html" aria-label="Latam Expeditions, ir al inicio">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">Latam<span>Expeditions</span></span>
      </a>

      <nav class="nav" aria-label="Navegación principal">{nav}</nav>

      <div class="header-actions">
        <button type="button" class="country-pill" data-open-country aria-haspopup="dialog">
          <i class="fa-solid fa-globe" aria-hidden="true"></i>
          <span id="countryLabel">Elegir país</span>
          <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </button>

        <label class="visually-hidden" for="languageSelect">Idioma del sitio</label>
        <select class="language-select" id="languageSelect">{langs}</select>

        <div class="login-menu">
          <button type="button" class="login-toggle" aria-haspopup="true" aria-expanded="false">
            <i class="fa-regular fa-user" aria-hidden="true"></i>
            <span data-i18n="nav.login" data-auth-label>Iniciar sesión</span>
          </button>
          <div class="login-dropdown" role="menu">
            <a href="{base}mis-viajes.html" role="menuitem" data-auth-in hidden><i class="fa-solid fa-suitcase-rolling" aria-hidden="true"></i> Mis viajes</a>
            <a href="{base}mi-reserva.html" role="menuitem"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Consultar reserva</a>
            <a href="{base}login.html" role="menuitem" data-auth-out><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Iniciar sesión</a>
            <a href="{base}registro.html" role="menuitem" data-auth-out><i class="fa-solid fa-user-plus" aria-hidden="true"></i> Crear cuenta</a>
            <button type="button" role="menuitem" data-logout data-auth-in hidden style="border:0;background:none;width:100%;text-align:left;cursor:pointer;font:inherit;display:flex;align-items:center;gap:9px;padding:11px 12px;border-radius:8px;font-weight:600;color:var(--latam-green);font-size:13.5px"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Cerrar sesión</button>
          </div>
        </div>

        <button type="button" class="nav-toggle" id="navToggle" aria-expanded="false" aria-controls="mobileNav" aria-label="Abrir menú de navegación">
          <i class="fa-solid fa-bars" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </header>

  {country_bar()}
  <div class="mobile-nav" id="mobileNav">
    <div class="mobile-nav__panel" role="dialog" aria-label="Menú de navegación" aria-modal="true">
      <div class="mobile-nav__head">
        <strong>Menú</strong>
        <button type="button" class="close-modal" data-close-nav aria-label="Cerrar menú">&times;</button>
      </div>
      {mobile}
      <a href="{base}mi-reserva.html" data-close-nav>Consultar mi reserva</a>
      <a href="{base}mis-viajes.html" data-close-nav data-auth-in hidden>Mis viajes</a>
      <a href="{base}login.html" class="mobile-nav__cta" data-close-nav data-auth-out>Iniciar sesión</a>
    </div>
  </div>
"""


def country_modal():
    """Diálogo de país. Ya no se abre solo: el país se detecta por IP y este
    modal aparece únicamente si el visitante pulsa "cambiar"."""
    options = "".join(
        f'<button type="button" class="country-option" data-country="{name}">'
        f'<span class="country-option__flag" aria-hidden="true">{flag}</span>'
        f'{name}<span>{note}</span></button>'
        for flag, name, note in COUNTRIES
    )
    return f"""  <div class="country-modal" id="countryModal" role="dialog" aria-modal="true" aria-labelledby="countryTitle">
    <div class="country-box">
      <div class="country-box__head">
        <div>
          <h2 id="countryTitle">¿Desde dónde viajas?</h2>
          <p>Ajustamos precios de referencia, salidas y recomendaciones según tu origen.</p>
        </div>
        <button type="button" class="close-modal" data-close-country aria-label="Cerrar selección de país">&times;</button>
      </div>
      <div class="country-grid">
        <label class="visually-hidden" for="countrySearch">Buscar país</label>
        <input type="search" class="country-search" id="countrySearch" placeholder="Buscar país…" style="grid-column:1/-1" />
        {options}
      </div>
    </div>
  </div>
"""


def country_bar():
    """Aviso discreto tras la detección automática. Reemplaza al modal que
    antes interrumpía la primera visita."""
    return """  <div class="country-bar" id="countryBar" role="status">
    <div class="country-bar__inner">
      <span class="country-bar__flag" id="countryBarFlag" aria-hidden="true">🌎</span>
      <span>Mostrando precios y salidas para <strong id="countryBarName">tu país</strong>.</span>
      <button type="button" data-change-country>Cambiar</button>
      <button type="button" class="country-bar__close" data-dismiss-bar aria-label="Ocultar aviso">&times;</button>
    </div>
  </div>
"""


def footer(base="", extra_scripts=""):
    """Pie de página con contacto, enlaces legales y métodos de pago."""
    return f"""  <footer class="footer footer-incarail">
    <div class="container">
      <div class="footer-top-grid">
        <div class="footer-brand">
          <div class="footer-logo-block">
            <div class="footer-logo-text">Latam <span>Expeditions</span></div>
            <p class="footer-tagline">Creamos viajes memorables por Latinoamérica con experiencias seleccionadas, asesoría personalizada y soporte antes, durante y después de tu aventura.</p>
          </div>
          <div class="footer-contact-box">
            <h3>Contáctanos</h3>
            <a href="tel:+51900608980" class="footer-pill"><i class="fas fa-phone" aria-hidden="true"></i><span>+51 900 608 980</span></a>
            <a href="https://wa.me/51900608980" class="footer-pill" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp" aria-hidden="true"></i><span>Habla con un asesor</span></a>
            <a href="mailto:reservas@latamexpeditions.com" class="footer-pill"><i class="fas fa-envelope" aria-hidden="true"></i><span>reservas@latamexpeditions.com</span></a>
          </div>
        </div>

        <div class="footer-links-grid">
          <details class="footer-accordion" open>
            <summary>Conócenos</summary>
            <div class="footer-link-col">
              <a href="{base}nosotros.html">Sobre nosotros</a>
              <a href="{base}nosotros.html#compromiso">Nuestro compromiso</a>
              <a href="{base}nosotros.html#sostenibilidad">Plan de sostenibilidad</a>
              <a href="{base}contacto.html">Red de oficinas</a>
            </div>
          </details>
          <details class="footer-accordion" open>
            <summary>Información útil</summary>
            <div class="footer-link-col">
              <a href="{base}contacto.html">Planifica tu viaje</a>
              <a href="{base}contacto.html">Viajes en grupo o privados</a>
              <a href="{base}destinos.html">Requisitos por país</a>
              <a href="{base}destinos.html">Mejor temporada para viajar</a>
            </div>
          </details>
          <details class="footer-accordion" open>
            <summary>Centro de ayuda</summary>
            <div class="footer-link-col">
              <a href="{base}mi-reserva.html">Consultar mi reserva</a>
              <a href="{base}mis-viajes.html">Mis viajes</a>
              <a href="{base}contacto.html#faq">Preguntas frecuentes</a>
              <a href="{base}contacto.html">Cambios y postergaciones</a>
              <a href="{base}contacto.html">Contactar a un asesor</a>
            </div>
          </details>
          <details class="footer-accordion" open>
            <summary>Legales</summary>
            <div class="footer-link-col">
              <a href="{base}legal.html#terminos">Términos y condiciones</a>
              <a href="{base}legal.html#privacidad">Política de privacidad</a>
              <a href="{base}legal.html#cookies">Política de cookies</a>
              <a href="{base}legal.html#reclamaciones">Libro de reclamaciones</a>
            </div>
          </details>
          <details class="footer-accordion" open>
            <summary>Empresas y socios</summary>
            <div class="footer-link-col">
              <a href="{base}contacto.html">Agencias y agentes</a>
              <a href="{base}contacto.html">Conviértete en proveedor</a>
              <a href="{base}contacto.html">Trabaja con nosotros</a>
            </div>
          </details>
          <details class="footer-accordion footer-payments" open>
            <summary>Métodos de pago</summary>
            <div class="payment-grid">
              <span><i class="fab fa-cc-visa" aria-hidden="true"></i> Visa</span>
              <span><i class="fab fa-cc-mastercard" aria-hidden="true"></i> Mastercard</span>
              <span><i class="fab fa-cc-amex" aria-hidden="true"></i> Amex</span>
              <span><i class="fab fa-cc-paypal" aria-hidden="true"></i> PayPal</span>
              <span><i class="fa-solid fa-building-columns" aria-hidden="true"></i> Transferencia</span>
              <span><i class="fa-solid fa-money-bill-wave" aria-hidden="true"></i> Efectivo</span>
            </div>
          </details>
        </div>
      </div>

      <div class="footer-bottom">
        <span>&copy; <span data-year>2026</span> Latam Expeditions. Todos los derechos reservados.</span>
        <span>Diseñado para viajeros que quieren descubrir Latinoamérica.</span>
      </div>
    </div>
  </footer>

  <a class="wa-float" href="https://wa.me/51900608980" target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp a un asesor">
    <i class="fab fa-whatsapp" aria-hidden="true"></i>
  </a>

  <script src="{base}assets/js/main.js" defer></script>
  <script src="{base}assets/js/cuentas.js" defer></script>
{extra_scripts}</body>
</html>
"""


def breadcrumb(items, base=""):
    """items: lista de (etiqueta, href|None). El último elemento es la página actual."""
    parts = []
    for label, href in items:
        if href:
            parts.append(f'<li><a href="{base}{href}">{label}</a></li>')
        else:
            parts.append(f'<li><span aria-current="page">{label}</span></li>')
    return f'<nav class="breadcrumb" aria-label="Ruta de navegación"><ol>{"".join(parts)}</ol></nav>'


def jsonld(data):
    import json
    return f'  <script type="application/ld+json">{json.dumps(data, ensure_ascii=False)}</script>\n'


def trust_bar():
    items = [
        ("fa-solid fa-user-shield", "Asesoría local", "Especialistas por país, no un buscador automático"),
        ("fa-solid fa-headset", "Soporte 24/7", "Acompañamiento antes, durante y después del viaje"),
        ("fa-solid fa-sliders", "Itinerarios flexibles", "Ajustamos hoteles, fechas y ritmo a tu medida"),
        ("fa-solid fa-lock", "Pago seguro", "Múltiples métodos y confirmación por escrito"),
    ]
    cells = "".join(
        f'<div class="trust-item"><i class="{icon}" aria-hidden="true"></i>'
        f'<div><strong>{title}</strong><span>{text}</span></div></div>'
        for icon, title, text in items
    )
    return f'  <section class="trust-bar" aria-label="Por qué viajar con nosotros"><div class="trust-bar__inner">{cells}</div></section>\n'
