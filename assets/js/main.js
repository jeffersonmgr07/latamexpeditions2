/**
 * Latam Expeditions — script principal
 *
 * Módulos:
 *   1. Utilidades           4. Navegación móvil     7. Filtros de catálogo
 *   2. Almacenamiento       5. Modal de país        8. Formularios
 *   3. Internacionalización 6. Buscador             9. Footer / misc
 *
 * Todos los módulos son opcionales: si el elemento no existe en la página,
 * el módulo se omite silenciosamente. Un único archivo sirve a todo el sitio.
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 1. Utils */

  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

  /** Prefijo de ruta para páginas en subcarpetas (ej. /experiencias/x.html). */
  const BASE = document.documentElement.dataset.base || './';

  /* -------------------------------------------------------- 2. Almacenamiento */

  const store = {
    get(key) {
      try { return window.localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, value); } catch (e) { /* modo privado */ }
    }
  };

  const KEYS = {
    country: 'latamExpeditionsCountry',
    countrySource: 'latamExpeditionsCountrySource', // 'auto' | 'manual'
    barDismissed: 'latamExpeditionsCountryBarSeen',
    lang: 'latamExpeditionsLanguage'
  };

  /* ------------------------------------------------ Países que operamos */

  /** Código ISO 3166-1 alfa-2 → nombre mostrado y bandera. */
  const COUNTRIES = {
    PE: { name: 'Perú', flag: '🇵🇪' },
    CO: { name: 'Colombia', flag: '🇨🇴' },
    CL: { name: 'Chile', flag: '🇨🇱' },
    AR: { name: 'Argentina', flag: '🇦🇷' },
    BO: { name: 'Bolivia', flag: '🇧🇴' },
    BR: { name: 'Brasil', flag: '🇧🇷' },
    EC: { name: 'Ecuador', flag: '🇪🇨' },
    MX: { name: 'México', flag: '🇲🇽' },
    VE: { name: 'Venezuela', flag: '🇻🇪' },
    UY: { name: 'Uruguay', flag: '🇺🇾' },
    CR: { name: 'Costa Rica', flag: '🇨🇷' }
  };
  const FALLBACK_COUNTRY = { name: 'Otro país', flag: '🌎' };

  function countryByName(name) {
    const entry = Object.values(COUNTRIES).find((c) => c.name === name);
    return entry || FALLBACK_COUNTRY;
  }

  /* --------------------------------------------------- 3. Internacionalización */

  const SUPPORTED_LANGS = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'zh'];

  /** Devuelve un valor anidado con notación de puntos: get(obj, 'nav.experiences'). */
  function getPath(object, path) {
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), object);
  }

  function applyTranslations(dict) {
    $$('[data-i18n]').forEach((node) => {
      const value = getPath(dict, node.dataset.i18n);
      if (typeof value === 'string') node.textContent = value;
    });
    $$('[data-i18n-placeholder]').forEach((node) => {
      const value = getPath(dict, node.dataset.i18nPlaceholder);
      if (typeof value === 'string') node.placeholder = value;
    });
    $$('[data-i18n-aria-label]').forEach((node) => {
      const value = getPath(dict, node.dataset.i18nAriaLabel);
      if (typeof value === 'string') node.setAttribute('aria-label', value);
    });
  }

  async function loadLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) lang = 'es';
    document.documentElement.lang = lang;
    // El español es el idioma base del marcado: no requiere descarga.
    if (lang === 'es') return;
    try {
      const response = await fetch(`${BASE}assets/data/i18n/${lang}/ui-translations.json`, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      applyTranslations(await response.json());
    } catch (error) {
      console.warn('[i18n] No se pudo cargar el idioma "%s". Se mantiene español.', lang);
      document.documentElement.lang = 'es';
    }
  }

  function initLanguage() {
    const select = $('#languageSelect');
    const saved = store.get(KEYS.lang);
    const initial = saved || (navigator.language || 'es').slice(0, 2).toLowerCase();
    const lang = SUPPORTED_LANGS.includes(initial) ? initial : 'es';

    if (select) {
      select.value = lang;
      select.addEventListener('change', (event) => {
        store.set(KEYS.lang, event.target.value);
        loadLanguage(event.target.value);
      });
    }
    if (lang !== 'es') loadLanguage(lang);
  }

  /* ------------------------------------------------------ 4. Navegación móvil */

  function initMobileNav() {
    const toggle = $('#navToggle');
    const panel = $('#mobileNav');
    if (!toggle || !panel) return;

    const close = () => {
      panel.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      toggle.focus();
    };
    const open = () => {
      panel.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      const first = $('a, button', panel);
      if (first) first.focus();
    };

    toggle.addEventListener('click', () => {
      panel.classList.contains('is-open') ? close() : open();
    });
    $$('[data-close-nav]', panel).forEach((node) => node.addEventListener('click', close));
    panel.addEventListener('click', (event) => { if (event.target === panel) close(); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panel.classList.contains('is-open')) close();
    });
  }

  /* --------------------------------------------------- 5. País del visitante */

  /**
   * Detecta el país por IP y lo aplica sin interrumpir la lectura.
   *
   * Flujo:
   *   1. ¿Hay una elección manual guardada? Se respeta y no se consulta nada.
   *   2. Si no, se pregunta a un servicio de geolocalización por IP.
   *   3. Se aplica el país y se muestra una barra discreta con opción a cambiar.
   *   4. Si la detección falla, el sitio funciona igual con precios en USD.
   *
   * Nota de privacidad: la petición envía la IP del visitante a un tercero.
   * Es un servicio gratuito y sin cookies, pero conviene mencionarlo en la
   * política de privacidad. Si se prefiere evitarlo, basta con poner
   * GEO_ENABLED = false: se recupera el modal de selección manual.
   */
  const GEO_ENABLED = true;
  const GEO_ENDPOINTS = [
    { url: 'https://get.geojs.io/v1/ip/country.json', read: (d) => d.country },
    { url: 'https://ipwho.is/?fields=country_code', read: (d) => d.country_code }
  ];

  async function detectCountryCode() {
    for (const endpoint of GEO_ENDPOINTS) {
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 2500);
        const response = await fetch(endpoint.url, { signal: controller.signal });
        window.clearTimeout(timer);
        if (!response.ok) continue;
        const code = endpoint.read(await response.json());
        if (code && typeof code === 'string') return code.toUpperCase();
      } catch (error) {
        // Sin conexión, bloqueado por un adblocker o cuota agotada: se prueba
        // el siguiente servicio y, si tampoco responde, se sigue sin país.
      }
    }
    return null;
  }

  function initCountry() {
    const label = $('#countryLabel');
    const bar = $('#countryBar');
    const barName = $('#countryBarName');
    const barFlag = $('#countryBarFlag');
    const modal = $('#countryModal');

    function applyCountry(name, source) {
      const info = countryByName(name);
      store.set(KEYS.country, name);
      store.set(KEYS.countrySource, source);
      if (label) label.textContent = name;
      document.documentElement.dataset.country = name;
    }

    function showBar(name) {
      if (!bar || store.get(KEYS.barDismissed)) return;
      const info = countryByName(name);
      if (barName) barName.textContent = name;
      if (barFlag) barFlag.textContent = info.flag;
      bar.classList.add('is-visible');
    }

    function hideBar() {
      if (!bar) return;
      bar.classList.remove('is-visible');
      store.set(KEYS.barDismissed, '1');
    }

    /* --- Modal: ahora solo se abre cuando el usuario lo pide --- */

    let lastFocused = null;
    const openModal = () => {
      if (!modal) return;
      lastFocused = document.activeElement;
      modal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      const search = $('#countrySearch', modal);
      (search || $('.close-modal', modal)).focus();
    };
    const closeModal = () => {
      if (!modal) return;
      modal.classList.remove('is-open');
      document.body.style.overflow = '';
      if (lastFocused) lastFocused.focus();
    };

    $$('[data-open-country]').forEach((node) => node.addEventListener('click', openModal));

    if (modal) {
      $$('[data-close-country]').forEach((node) => node.addEventListener('click', closeModal));
      modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
      });

      $$('.country-option', modal).forEach((button) => {
        button.addEventListener('click', () => {
          applyCountry(button.dataset.country, 'manual');
          hideBar();
          closeModal();
        });
      });

      // Buscador dentro del modal: útil con once países y más si crece.
      const search = $('#countrySearch', modal);
      if (search) {
        search.addEventListener('input', () => {
          const query = search.value.trim().toLowerCase();
          $$('.country-option', modal).forEach((option) => {
            option.hidden = query !== '' && !option.dataset.country.toLowerCase().includes(query);
          });
        });
      }

      // Retención de foco dentro del diálogo (patrón WAI-ARIA).
      modal.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') return;
        const focusables = $$('button, a[href], select, input', modal)
          .filter((n) => n.offsetParent !== null && !n.hidden);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
    }

    if (bar) {
      const change = $('[data-change-country]', bar);
      const dismiss = $('[data-dismiss-bar]', bar);
      if (change) change.addEventListener('click', openModal);
      if (dismiss) dismiss.addEventListener('click', hideBar);
    }

    /* --- Arranque --- */

    const saved = store.get(KEYS.country);
    if (saved) {
      applyCountry(saved, store.get(KEYS.countrySource) || 'manual');
      return;
    }
    if (!GEO_ENABLED) {
      if (modal) window.setTimeout(openModal, 1200);
      return;
    }
    detectCountryCode().then((code) => {
      const match = code && COUNTRIES[code];
      if (!match) return; // Sin detección: precios en USD, sin molestar a nadie.
      applyCountry(match.name, 'auto');
      showBar(match.name);
    });
  }

  /* ------------------------------------------------------------- 6. Buscador */

  function initSearch() {
    const form = $('#tripSearchForm');
    if (!form) return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const params = new URLSearchParams();
      const destination = (data.get('destination') || '').trim();
      const style = (data.get('travelType') || '').trim();
      const date = (data.get('date') || '').trim();
      if (destination) params.set('destino', destination);
      if (style) params.set('estilo', style);
      if (date) params.set('fecha', date);
      window.location.href = `${BASE}experiencias.html${params.toString() ? '?' + params : ''}`;
    });
  }

  /* --------------------------------------------------- 7. Filtros de catálogo */

  /**
   * Filtrado por varias dimensiones a la vez.
   *
   * Cada grupo de botones ([data-filter-group]) filtra por una dimensión —país,
   * estilo, duración— y las dimensiones se combinan con Y lógico: "Colombia"
   * + "cultura" muestra solo las experiencias culturales de Colombia.
   *
   * Antes había un solo grupo y las tarjetas de destino enlazaban a
   * ?destino=colombia, que no coincidía con ningún botón de estilo y acababa
   * mostrando el catálogo entero. De ahí que al pulsar Colombia salieran 30
   * resultados empezando por Machu Picchu.
   */
  function initFilters() {
    const container = $('[data-filterable]');
    if (!container) return;

    const groups = $$('[data-filter-group]');
    const items = $$('[data-tags]', container);
    const counter = $('#resultsCount');
    const empty = $('#emptyState');
    const reset = $('#filterReset');

    // Estado: { pais: 'colombia', estilo: 'all', … }
    const active = {};
    groups.forEach((g) => { active[g.dataset.filterGroup] = 'all'; });

    function aplicar() {
      let visible = 0;
      items.forEach((item) => {
        const tags = (item.dataset.tags || '').split(' ');
        // Un ítem se muestra si supera TODOS los grupos activos.
        const match = Object.values(active).every((v) => v === 'all' || tags.includes(v));
        item.hidden = !match;
        if (match) visible += 1;
      });

      groups.forEach((group) => {
        const dim = group.dataset.filterGroup;
        $$('[data-filter]', group).forEach((btn) => {
          btn.setAttribute('aria-pressed', String(btn.dataset.filter === active[dim]));
        });
      });

      if (counter) {
        const filtros = Object.entries(active).filter(([, v]) => v !== 'all');
        const etiquetas = filtros.map(([, v]) => nombreLegible(v)).join(' · ');
        counter.textContent = visible === 0
          ? 'Ningún resultado'
          : `${visible} ${visible === 1 ? 'resultado' : 'resultados'}${etiquetas ? ' · ' + etiquetas : ''}`;
      }
      if (empty) empty.hidden = visible !== 0;
      if (reset) reset.hidden = Object.values(active).every((v) => v === 'all');

      sincronizarUrl();
    }

    /** Usa la etiqueta del propio botón, así no duplicamos nombres en el JS. */
    function nombreLegible(valor) {
      const btn = $(`[data-filter="${CSS.escape(valor)}"]`);
      return btn ? btn.textContent.trim() : valor;
    }

    function sincronizarUrl() {
      const url = new URL(window.location.href);
      groups.forEach((g) => {
        const dim = g.dataset.filterGroup;
        const param = g.dataset.filterParam || dim;
        active[dim] === 'all' ? url.searchParams.delete(param) : url.searchParams.set(param, active[dim]);
      });
      window.history.replaceState({}, '', url);
    }

    groups.forEach((group) => {
      const dim = group.dataset.filterGroup;
      $$('[data-filter]', group).forEach((btn) => {
        btn.addEventListener('click', () => {
          // Volver a pulsar el filtro activo lo desactiva.
          active[dim] = active[dim] === btn.dataset.filter ? 'all' : btn.dataset.filter;
          aplicar();
        });
      });
    });

    if (reset) {
      reset.addEventListener('click', () => {
        groups.forEach((g) => { active[g.dataset.filterGroup] = 'all'; });
        aplicar();
      });
    }

    // Estado inicial desde la URL: permite enlazar y compartir un filtro
    // concreto, y es lo que usan las tarjetas de destino.
    const params = new URLSearchParams(window.location.search);
    groups.forEach((group) => {
      const dim = group.dataset.filterGroup;
      const param = group.dataset.filterParam || dim;
      const pedido = params.get(param);
      if (pedido && $(`[data-filter="${CSS.escape(pedido)}"]`, group)) active[dim] = pedido;
    });
    aplicar();
  }

  /* ---------------------------------------------------------- 8. Formularios */

  function initForms() {
    $$('form[data-validate]').forEach((form) => {
      form.setAttribute('novalidate', '');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        let valid = true;

        $$('.form-field', form).forEach((field) => {
          const input = $('input, select, textarea', field);
          if (!input) return;
          const ok = input.checkValidity();
          field.classList.toggle('has-error', !ok);
          input.setAttribute('aria-invalid', String(!ok));
          if (!ok && valid) { input.focus(); valid = false; }
        });

        if (!valid) return;
        const success = $('[data-success]', form.parentElement) || $('[data-success]', form);
        if (success) {
          success.classList.add('is-visible');
          success.setAttribute('role', 'status');
          form.reset();
        }
      });

      $$('input, select, textarea', form).forEach((input) => {
        input.addEventListener('input', () => {
          const field = input.closest('.form-field');
          if (field && field.classList.contains('has-error') && input.checkValidity()) {
            field.classList.remove('has-error');
            input.setAttribute('aria-invalid', 'false');
          }
        });
      });
    });
  }

  /* ------------------------------------------------------- 9. Footer y varios */

  function initFooterAccordions() {
    const accordions = $$('.footer-accordion');
    if (!accordions.length) return;
    const sync = () => {
      const isDesktop = window.innerWidth >= 769;
      accordions.forEach((item) => { item.open = isDesktop; });
    };
    let timer;
    window.addEventListener('resize', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(sync, 150);
    });
    sync();
  }

  /** Marca el enlace de navegación correspondiente a la página actual. */
  function initActiveNav() {
    const current = window.location.pathname.split('/').pop() || 'index.html';
    $$('.nav a, .mobile-nav__panel a').forEach((link) => {
      const target = (link.getAttribute('href') || '').split('/').pop().split('#')[0];
      if (target && target === current) link.setAttribute('aria-current', 'page');
    });
  }

  function initYear() {
    $$('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });
  }

  /* ------------------------------------------------------------- Arranque */

  function init() {
    initLanguage();
    initMobileNav();
    initCountry();
    initSearch();
    initFilters();
    initForms();
    initFooterAccordions();
    initActiveNav();
    initYear();
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
