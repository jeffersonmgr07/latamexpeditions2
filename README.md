# Latam Expeditions

Sitio web estático de una agencia de viajes especializada en Latinoamérica.
Desplegado en GitHub Pages sobre el dominio `latamexpeditions.com`.

---

## Cómo está organizado

```
├── index.html              Portada
├── destinos.html           Los 11 países donde operamos
├── experiencias.html       Catálogo de experiencias, con filtros
├── paquetes.html           Catálogo de paquetes, con filtros
├── estilos-viaje.html      Los 8 estilos de viaje
├── contacto.html           Formulario de propuesta + preguntas frecuentes
├── nosotros.html           Quiénes somos
├── legal.html              Términos, privacidad, cookies, reclamaciones
├── login.html              Acceso a cuenta (maqueta)
├── registro.html           Alta de cuenta (maqueta)
├── 404.html                Página de error
├── experiencias/           9 fichas de detalle (generadas)
├── paquetes/               6 fichas de detalle (generadas)
│
├── assets/
│   ├── css/main.css        Hoja de estilos única de todo el sitio
│   ├── js/main.js          JavaScript único de todo el sitio
│   ├── img/                Imágenes en .jpg y .webp
│   └── data/
│       ├── catalog.json    ← Fuente de verdad del contenido
│       └── i18n/           Traducciones de interfaz (8 idiomas)
│
├── tools/
│   ├── build.py            Generador de páginas
│   └── partials.py         Cabecera, pie, modal y plantilla de <head>
│
├── sitemap.xml             Generado
├── robots.txt              Generado
└── site.webmanifest        Generado
```

---

## Cómo añadir o cambiar contenido

**No edites los HTML a mano.** Se regeneran y perderías los cambios.

1. Abre `assets/data/catalog.json`.
2. Añade o modifica la entrada en `experiences`, `packages`, `destinations` o `styles`.
3. Ejecuta el generador:

```bash
python3 tools/build.py
```

Se regenerarán todas las páginas afectadas, más el sitemap, con la cabecera,
el pie, los metadatos SEO y los datos estructurados ya aplicados.

**Para una experiencia nueva necesitas:** una imagen en `assets/img/` (1200×900,
en `.jpg` y `.webp`) y una entrada en el JSON con `slug`, `title`, `country`,
`region`, `style`, `duration`, `img`, `alt`, `excerpt`, `description`,
`includes`, `notIncludes` y `highlights`.

**Para convertir una imagen nueva a WebP:**

```bash
python3 -c "from PIL import Image; im=Image.open('assets/img/NOMBRE.jpg').convert('RGB'); im.save('assets/img/NOMBRE.webp','WEBP',quality=82,method=6)"
```

### Cambiar diseño o comportamiento

- **Estilos** → `assets/css/main.css` (afecta a todo el sitio).
- **Comportamiento** → `assets/js/main.js` (afecta a todo el sitio).
- **Cabecera, pie, menús** → `tools/partials.py`, luego `python3 tools/build.py`.

---

## Ver el sitio en local

```bash
python3 -m http.server 8000
```

Y abre `http://localhost:8000`. Hace falta un servidor: el sistema de idiomas
usa `fetch()`, que no funciona abriendo el archivo directamente con `file://`.

---

## País del visitante

Se detecta por IP al entrar (`get.geojs.io`, con `ipwho.is` de respaldo) y se
muestra una barra discreta con opción a cambiar. El modal de selección solo se
abre si el visitante lo pide.

Para desactivar la detección y volver al modal manual, en `assets/js/main.js`:

```js
const GEO_ENABLED = false;
```

Ten en cuenta que la detección envía la IP del visitante a un tercero. Está
mencionado en `legal.html`, sección de privacidad.

---

## Idiomas

El español es el idioma base del marcado. Los demás se cargan desde
`assets/data/i18n/<código>/ui-translations.json` cuando el visitante cambia el
selector de la cabecera, y la elección se recuerda en el navegador.

Idiomas activos: `es`, `en`, `pt`, `fr`, `de`, `it`, `ja`, `zh`.

**Para traducir un texto nuevo:** añade `data-i18n="seccion.clave"` al elemento
en `tools/partials.py` o `tools/build.py`, y la clave correspondiente a los
ocho archivos JSON. Para atributos existen `data-i18n-placeholder` y
`data-i18n-aria-label`.

---

## Despliegue

GitHub Pages sirve la rama principal directamente. Al hacer push de los
cambios, el sitio se actualiza. El archivo `CNAME` mantiene el dominio
personalizado; no lo borres.

Recuerda ejecutar `python3 tools/build.py` **antes** de hacer commit si tocaste
el catálogo o las plantillas.

---

## Pendiente antes de producción

- [ ] Los formularios de contacto, login y registro son maquetas: no envían
      datos a ningún sitio. Conectar a un servicio (Formspree, Netlify Forms,
      o un backend propio).
- [ ] Revisar `legal.html` con un asesor legal antes de publicarlo.
- [ ] Sustituir las imágenes de banco por fotografía propia de los viajes.
- [ ] Confirmar los precios "Consultar" con tarifas reales cuando estén cerradas.
- [ ] Añadir analítica respetuosa con la privacidad si se necesita medición.
- [ ] Cargar los tours reales desde `plantilla-tours-latamexpeditions.xlsx`.
- [ ] Integrar PayPal (requiere mover el hosting a Netlify o Vercel).
