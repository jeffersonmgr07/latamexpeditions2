/**
 * Latam Expeditions — cuentas, sesión y consulta de reservas
 *
 * Se carga en login.html, registro.html, mis-viajes.html y mi-reserva.html.
 * Habla con el mismo Apps Script que gestiona los pagos.
 *
 * Sobre el token de sesión: se guarda en localStorage. Es lo que permite
 * seguir con la sesión abierta al volver, y es aceptable porque el token solo
 * da acceso a ver tus propias reservas, nunca a pagar ni a cambiar datos de
 * cobro. Aun así caduca a los 30 días en el servidor.
 */
(function () {
  'use strict';

  const $ = (s, sc) => (sc || document).querySelector(s);
  const $$ = (s, sc) => Array.from((sc || document).querySelectorAll(s));
  const BASE = document.documentElement.dataset.base || './';
  const KEY_TOKEN = 'latamExpeditionsToken';
  const KEY_USER = 'latamExpeditionsUser';

  let ENDPOINT = null;
  let GOOGLE_CLIENT_ID = null;

  /* ------------------------------------------------------------- Sesión */

  const sesion = {
    get token() {
      try { return localStorage.getItem(KEY_TOKEN); } catch (e) { return null; }
    },
    get user() {
      try { return JSON.parse(localStorage.getItem(KEY_USER) || 'null'); } catch (e) { return null; }
    },
    guardar(token, user) {
      try {
        localStorage.setItem(KEY_TOKEN, token);
        localStorage.setItem(KEY_USER, JSON.stringify(user));
      } catch (e) { /* modo privado */ }
    },
    borrar() {
      try {
        localStorage.removeItem(KEY_TOKEN);
        localStorage.removeItem(KEY_USER);
      } catch (e) { /* modo privado */ }
    }
  };

  /* ----------------------------------------------------------- Backend */

  async function llamar(action, data) {
    if (!ENDPOINT || ENDPOINT.startsWith('PEGAR_AQUI')) {
      throw new Error('El sistema de cuentas aún no está configurado. Escríbenos por WhatsApp.');
    }
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, data })
    });
    if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Error desconocido');
    return json;
  }

  /* ------------------------------------------------------------ Avisos */

  function error(contenedor, mensaje) {
    const box = $(contenedor);
    if (!box) return;
    box.textContent = mensaje;
    box.classList.add('is-visible');
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function limpiarError(contenedor) {
    const box = $(contenedor);
    if (box) box.classList.remove('is-visible');
  }

  function cargando(boton, activo, textoOriginal) {
    boton.disabled = activo;
    boton.textContent = activo ? 'Un momento…' : textoOriginal;
  }

  /* ------------------------------------------------------------ Formato */

  const money = (n) => `USD ${Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fechaLarga = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) ? iso
      : d.toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' });
  };
  const escapar = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Días que faltan para el viaje. Negativo si ya pasó. */
  function diasHasta(iso) {
    const d = new Date(iso + 'T00:00:00');
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Math.round((d - hoy) / 86400000);
  }

  /* ------------------------------------------------------------- Login */

  function initLogin() {
    const form = $('#loginForm');
    if (!form) return;

    // Si ya hay sesión, no tiene sentido mostrar el formulario.
    if (sesion.token) { window.location.href = `${BASE}mis-viajes.html`; return; }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarError('#authError');
      const boton = $('button[type="submit"]', form);
      const texto = boton.textContent;

      if (!form.checkValidity()) { form.reportValidity(); return; }

      cargando(boton, true, texto);
      try {
        const r = await llamar('login', {
          email: $('#loginEmail').value.trim(),
          password: $('#loginPassword').value,
          device: navigator.userAgent
        });
        sesion.guardar(r.token, r.user);
        const destino = new URLSearchParams(window.location.search).get('volver');
        window.location.href = destino || `${BASE}mis-viajes.html`;
      } catch (err) {
        error('#authError', err.message);
        cargando(boton, false, texto);
      }
    });
  }

  /* ---------------------------------------------------------- Registro */

  function initRegistro() {
    const form = $('#registerForm');
    if (!form) return;
    if (sesion.token) { window.location.href = `${BASE}mis-viajes.html`; return; }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarError('#authError');
      const boton = $('button[type="submit"]', form);
      const texto = boton.textContent;

      if (!form.checkValidity()) { form.reportValidity(); return; }

      cargando(boton, true, texto);
      try {
        const r = await llamar('register', {
          email: $('#regEmail').value.trim(),
          name: $('#regName').value.trim(),
          phone: $('#regPhone') ? $('#regPhone').value.trim() : '',
          password: $('#regPassword').value,
          device: navigator.userAgent
        });
        sesion.guardar(r.token, r.user);
        window.location.href = `${BASE}mis-viajes.html`;
      } catch (err) {
        error('#authError', err.message);
        cargando(boton, false, texto);
      }
    });
  }

  /* -------------------------------------------------------- Mis viajes */

  function tarjetaViaje(r, pasado) {
    const dias = diasHasta(r.date);
    const aviso = pasado
      ? ''
      : dias === 0 ? '<span class="trip-badge trip-badge--soon">Hoy</span>'
      : dias === 1 ? '<span class="trip-badge trip-badge--soon">Mañana</span>'
      : dias <= 7 ? `<span class="trip-badge trip-badge--soon">En ${dias} días</span>`
      : '';

    const saldo = r.balance > 0
      ? `<div class="fact-row"><span>Saldo pendiente</span><strong>${money(r.balance)}</strong></div>`
      : '';

    return `
      <article class="trip-item${pasado ? ' is-past' : ''}">
        <div class="trip-item__head">
          <div>
            <span class="trip-code">${escapar(r.code)}</span>
            <h3>${escapar(r.title)}</h3>
            <p class="trip-date">${fechaLarga(r.date)}${aviso}</p>
          </div>
          <span class="trip-status trip-status--${escapar(String(r.status).toLowerCase())}">${escapar(r.status)}</span>
        </div>
        <div class="trip-item__facts">
          <div class="fact-row"><span>Viajeros</span><strong>${r.travelers}</strong></div>
          ${r.tier && r.tier !== '—' ? `<div class="fact-row"><span>Categoría</span><strong>${escapar(r.tier)}</strong></div>` : ''}
          <div class="fact-row"><span>Total</span><strong>${money(r.total)}</strong></div>
          <div class="fact-row"><span>Pagado</span><strong>${money(r.paid)}</strong></div>
          ${saldo}
        </div>
      </article>`;
  }

  async function initMisViajes() {
    const cont = $('#tripsRoot');
    if (!cont) return;

    if (!sesion.token) {
      window.location.href = `${BASE}login.html?volver=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    const nombre = sesion.user && sesion.user.name ? sesion.user.name.split(' ')[0] : '';
    const saludo = $('#tripsGreeting');
    if (saludo && nombre) saludo.textContent = `Hola, ${nombre}`;

    try {
      const r = await llamar('myTrips', { token: sesion.token });

      $('#tripsLoading').hidden = true;
      $('#tripsContent').hidden = false;

      const prox = $('#tripsUpcoming');
      const pas = $('#tripsPast');

      prox.innerHTML = r.upcoming.length
        ? r.upcoming.map((x) => tarjetaViaje(x, false)).join('')
        : `<div class="empty-state">
             <p>Todavía no tienes viajes reservados.</p>
             <a class="btn-primary" href="${BASE}experiencias.html">Explorar experiencias</a>
           </div>`;

      pas.innerHTML = r.past.length
        ? r.past.map((x) => tarjetaViaje(x, true)).join('')
        : '<p class="form-note">Aquí aparecerán tus viajes una vez realizados.</p>';

      $('#tripsCountUpcoming').textContent = r.upcoming.length;
      $('#tripsCountPast').textContent = r.past.length;

    } catch (err) {
      // Token caducado o inválido: se limpia y se pide entrar de nuevo.
      if (/sesión/i.test(err.message)) {
        sesion.borrar();
        window.location.href = `${BASE}login.html`;
        return;
      }
      $('#tripsLoading').hidden = true;
      error('#authError', err.message);
    }
  }

  function initLogout() {
    $$('[data-logout]').forEach((b) => {
      b.addEventListener('click', async () => {
        const token = sesion.token;
        sesion.borrar();
        try { if (token) await llamar('logout', { token }); } catch (e) { /* da igual */ }
        window.location.href = `${BASE}index.html`;
      });
    });
  }

  /* ------------------------------------------------------- Mi reserva */

  async function initMiReserva() {
    const form = $('#lookupForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarError('#authError');
      $('#lookupResult').hidden = true;
      const boton = $('button[type="submit"]', form);
      const texto = boton.textContent;

      if (!form.checkValidity()) { form.reportValidity(); return; }

      cargando(boton, true, texto);
      try {
        const r = await llamar('findBooking', {
          code: $('#lookupCode').value.trim(),
          lastName: $('#lookupName').value.trim()
        });
        pintarReserva(r.booking);
        cargando(boton, false, texto);
      } catch (err) {
        error('#authError', err.message);
        cargando(boton, false, texto);
      }
    });

    const reenviar = $('#resendBtn');
    if (reenviar) {
      reenviar.addEventListener('click', async () => {
        const texto = reenviar.textContent;
        cargando(reenviar, true, texto);
        try {
          const r = await llamar('resendVoucher', { code: $('#lookupCode').value.trim() });
          reenviar.textContent = `Enviado a ${r.sentTo}`;
          reenviar.disabled = true;
        } catch (err) {
          error('#authError', err.message);
          cargando(reenviar, false, texto);
        }
      });
    }
  }

  function pintarReserva(b) {
    const pasajeros = (b.passengerList || [])
      .map((p, i) => `<li><span>${i + 1}</span>${escapar(p)}</li>`).join('');
    const saldo = b.balance > 0
      ? `<div class="fact-row"><span>Saldo pendiente</span><strong>${money(b.balance)}</strong></div>`
      : '';

    $('#lookupResultBody').innerHTML = `
      <div class="trip-item__head">
        <div>
          <span class="trip-code">${escapar(b.code)}</span>
          <h3>${escapar(b.title)}</h3>
          <p class="trip-date">${fechaLarga(b.date)}</p>
        </div>
        <span class="trip-status trip-status--${escapar(String(b.status).toLowerCase())}">${escapar(b.status)}</span>
      </div>
      <div class="trip-item__facts">
        <div class="fact-row"><span>Titular</span><strong>${escapar(b.holderName)}</strong></div>
        <div class="fact-row"><span>Viajeros</span><strong>${b.travelers}</strong></div>
        ${b.tier && b.tier !== '—' ? `<div class="fact-row"><span>Categoría</span><strong>${escapar(b.tier)}</strong></div>` : ''}
        <div class="fact-row"><span>Total</span><strong>${money(b.total)}</strong></div>
        <div class="fact-row"><span>Pagado</span><strong>${money(b.paid)}</strong></div>
        ${saldo}
      </div>
      ${pasajeros ? `<div class="pax-summary"><h4>Pasajeros</h4><ol>${pasajeros}</ol></div>` : ''}`;

    $('#lookupResult').hidden = false;
    $('#lookupResult').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ------------------------------------------------- Entrar con Google */

  /**
   * Google Identity Services.
   *
   * El botón lo dibuja Google, no nosotros: es requisito de sus condiciones de
   * marca y además se traduce y adapta solo. Cuando el usuario lo pulsa, Google
   * nos devuelve un JWT firmado que enviamos a Apps Script para que lo valide.
   *
   * Aquí no se decide nada: este código no puede saber si el token es legítimo.
   * Esa comprobación la hace el servidor, que además verifica que el token fue
   * emitido para nuestra aplicación y no para otra.
   */
  function initGoogle() {
    const contenedores = $$('[data-google-signin]');
    if (!contenedores.length) return;

    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('PEGAR_AQUI')) {
      // Sin configurar: se oculta el bloque entero para no mostrar un botón roto.
      $$('[data-google-block]').forEach((n) => { n.hidden = true; });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!window.google || !window.google.accounts) return;

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: manejarCredencialGoogle,
        cancel_on_tap_outside: true,
        context: window.location.pathname.includes('registro') ? 'signup' : 'signin'
      });

      contenedores.forEach((div) => {
        window.google.accounts.id.renderButton(div, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: window.location.pathname.includes('registro') ? 'signup_with' : 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          locale: 'es',
          width: Math.min(div.offsetWidth || 380, 400)
        });
      });
    };
    script.onerror = () => {
      $$('[data-google-block]').forEach((n) => { n.hidden = true; });
      console.warn('[google] No se pudo cargar Identity Services');
    };
    document.head.appendChild(script);
  }

  async function manejarCredencialGoogle(respuesta) {
    limpiarError('#authError');
    const bloque = $('[data-google-block]');
    if (bloque) bloque.style.opacity = '.5';

    try {
      const r = await llamar('googleLogin', {
        credential: respuesta.credential,
        device: navigator.userAgent
      });
      sesion.guardar(r.token, r.user);
      const destino = new URLSearchParams(window.location.search).get('volver');
      window.location.href = destino || `${BASE}mis-viajes.html`;
    } catch (err) {
      error('#authError', err.message);
      if (bloque) bloque.style.opacity = '1';
    }
  }

  /* ------------------------------------------- Estado de sesión en el menú */

  function initEstadoSesion() {
    const user = sesion.user;
    if (!user) return;
    // La cabecera pasa de "Iniciar sesión" a mostrar el nombre.
    $$('[data-auth-label]').forEach((n) => { n.textContent = user.name.split(' ')[0]; });
    $$('[data-auth-in]').forEach((n) => { n.hidden = false; });
    $$('[data-auth-out]').forEach((n) => { n.hidden = true; });
  }

  /* --------------------------------------------------------- Arranque */

  async function init() {
    try {
      const r = await fetch(`${BASE}assets/data/catalog.json`, { cache: 'force-cache' });
      const cfg = (await r.json()).booking;
      ENDPOINT = cfg.endpoint;
      GOOGLE_CLIENT_ID = cfg.googleClientId;
    } catch (e) {
      console.warn('[cuentas] No se pudo cargar la configuración');
    }
    initEstadoSesion();
    initGoogle();
    initLogout();
    initLogin();
    initRegistro();
    initMisViajes();
    initMiReserva();
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
