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

  const KEYS = { country: 'latamExpeditionsCountry', lang: 'latamExpeditionsLanguage' };

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

  /* --------------------------------------------------------- 5. Modal de país */

  function initCountryModal() {
    const modal = $('#countryModal');
    if (!modal) return;

    const label = $('#countryLabel');
    const saved = store.get(KEYS.country);
    let lastFocused = null;

    const open = () => {
      lastFocused = document.activeElement;
      modal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      const first = $('.close-modal, .country-option', modal);
      if (first) first.focus();
    };
    const close = () => {
      modal.classList.remove('is-open');
      document.body.style.overflow = '';
      if (lastFocused) lastFocused.focus();
    };

    if (saved && label) label.textContent = saved;
    // Solo se sugiere el país en la primera visita, para no interrumpir el resto.
    if (!saved) window.setTimeout(open, 1200);

    $$('[data-open-country]').forEach((node) => node.addEventListener('click', open));
    $$('[data-close-country]').forEach((node) => node.addEventListener('click', close));
    $$('.country-option', modal).forEach((button) => {
      button.addEventListener('click', () => {
        const country = button.dataset.country;
        store.set(KEYS.country, country);
        if (label) label.textContent = country;
        close();
      });
    });
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('is-open')) close();
    });

    // Retención de foco dentro del diálogo (accesibilidad WAI-ARIA).
    modal.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusables = $$('button, a[href], select, input', modal).filter((n) => n.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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

  function initFilters() {
    const container = $('[data-filterable]');
    if (!container) return;

    const buttons = $$('[data-filter]');
    const items = $$('[data-tags]', container);
    const counter = $('#resultsCount');
    const empty = $('#emptyState');

    function apply(filter) {
      let visible = 0;
      items.forEach((item) => {
        const tags = (item.dataset.tags || '').split(' ');
        const match = filter === 'all' || tags.includes(filter);
        item.hidden = !match;
        if (match) visible += 1;
      });
      buttons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
      });
      if (counter) {
        counter.textContent = visible === 1 ? '1 resultado' : `${visible} resultados`;
      }
      if (empty) empty.hidden = visible !== 0;
    }

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const filter = button.dataset.filter;
        apply(filter);
        const url = new URL(window.location.href);
        url.searchParams.delete('destino');
        filter === 'all' ? url.searchParams.delete('estilo') : url.searchParams.set('estilo', filter);
        window.history.replaceState({}, '', url);
      });
    });

    // Estado inicial desde la URL. Se aceptan ?estilo= y ?destino= para que
    // tanto las tarjetas de destino como el buscador del hero puedan enlazar
    // a un catálogo ya filtrado.
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('estilo') || params.get('destino');
    apply(requested && buttons.some((b) => b.dataset.filter === requested) ? requested : 'all');
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
    initCountryModal();
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
