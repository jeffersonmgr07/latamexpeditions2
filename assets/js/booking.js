/**
 * Latam Expeditions — motor de reserva
 *
 * Modal de tres pasos, al estilo de las OTAs:
 *   Paso 1  Fecha, número de viajeros y contacto del titular
 *   Paso 2  Datos de cada pasajero (nombre, documento, nacionalidad, nacimiento)
 *   Paso 3  Resumen, política de cancelación y pago con PayPal
 *
 * El pago NO se confirma en el navegador. El botón de PayPal pide al backend
 * (Google Apps Script) que cree la orden, y tras la aprobación le pide que la
 * capture. Solo el backend conoce el secreto de PayPal y solo él decide si una
 * reserva es válida. Este archivo nunca marca una reserva como pagada por su
 * cuenta.
 *
 * Se carga únicamente en las páginas que tienen un botón [data-book].
 */
(function () {
  'use strict';

  const $ = (s, sc) => (sc || document).querySelector(s);
  const $$ = (s, sc) => Array.from((sc || document).querySelectorAll(s));
  const BASE = document.documentElement.dataset.base || './';

  const trigger = $('[data-book]');
  if (!trigger) return;

  /* ------------------------------------------------------------- Estado */

  let CONFIG = null;
  const PRODUCT = {
    slug: trigger.dataset.book,
    kind: trigger.dataset.bookKind || 'experience',
    title: trigger.dataset.bookTitle || '',
    price: parseFloat(trigger.dataset.bookPrice || '0'),
    country: trigger.dataset.bookCountry || '',
    duration: trigger.dataset.bookDuration || '',
    tiers: JSON.parse(trigger.dataset.bookTiers || 'null')
  };
  const state = { date: '', travelers: 2, holder: {}, pax: [], total: 0, due: 0,
                  mode: 'deposito', tier: null, requestKey: '' };
  // Si el producto tiene categorías de hotel, se arranca en la más económica.
  if (PRODUCT.tiers && PRODUCT.tiers.length) state.tier = PRODUCT.tiers[0].code;
  let step = 1;
  let paypalButtons = null;
  let pagoEnProceso = false;

  /* ------------------------------------------------------- Cálculo del cobro */

  /**
   * Importe a cobrar ahora.
   *
   * Los tours de bajo importe se cobran completos, que es lo que hacen las OTAs
   * con actividades baratas: un depósito de 30 USD sobre un tour de 25 no tiene
   * sentido. Por encima del umbral se cobra el porcentaje configurado,
   * redondeado siempre al alza a la decena para no mostrar cifras como 63,40.
   */
  function calcularCobro(total) {
    const c = CONFIG;
    if (total <= c.payFullBelow) return { due: round2(total), mode: 'completo' };
    let due = Math.ceil((total * c.depositPercent) / 100 / c.depositRoundTo) * c.depositRoundTo;
    due = Math.max(c.depositMin, Math.min(due, c.depositMax));
    return { due: Math.min(due, round2(total)), mode: 'deposito' };
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const money = (n) => `USD ${n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


  function nuevaClaveSolicitud() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID().replace(/-/g, '');
    }
    const aleatorio = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}${aleatorio}`.slice(0, 64);
  }

  /** Precio por persona: el de la categoría elegida, o el base si no hay. */
  function precioUnitario() {
    if (!PRODUCT.tiers || !state.tier) return PRODUCT.price;
    const t = PRODUCT.tiers.find((x) => x.code === state.tier);
    return t ? t.pricePerPerson : PRODUCT.price;
  }

  function recalcular() {
    state.total = round2(precioUnitario() * state.travelers);
    const r = calcularCobro(state.total);
    state.due = r.due;
    state.mode = r.mode;
  }

  /* ---------------------------------------------------------------- Modal */

  function construirModal() {
    const wrap = document.createElement('div');
    wrap.className = 'booking-modal';
    wrap.id = 'bookingModal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'bookingTitle');
    wrap.innerHTML = `
      <div class="booking-box">
        <div class="booking-head">
          <div>
            <h2 id="bookingTitle">Reservar ${escapar(PRODUCT.title)}</h2>
            <p>${escapar(PRODUCT.country)} · ${escapar(PRODUCT.duration)}</p>
          </div>
          <button type="button" class="close-modal" data-close-booking aria-label="Cerrar reserva">&times;</button>
        </div>

        <ol class="booking-steps">
          <li data-step-label="1" aria-current="step">Fecha y viajeros</li>
          <li data-step-label="2">Datos de pasajeros</li>
          <li data-step-label="3">Pago</li>
        </ol>

        <div class="booking-body">
          <div class="booking-error" id="bookingError" role="alert"></div>

          <!-- Paso 1 -->
          <section class="booking-step is-active" data-step="1">
            <div class="form-grid">
              <div class="grid-2" style="gap:16px">
                <div class="form-field">
                  <label for="bkDate">Fecha del tour</label>
                  <input type="date" id="bkDate" required />
                  <small>Con al menos ${CONFIG.minLeadDays} días de antelación.</small>
                  <span class="form-error">Elige una fecha válida.</span>
                </div>
                <div class="form-field">
                  <label for="bkTravelers">Número de viajeros</label>
                  <input type="number" id="bkTravelers" min="1" max="${CONFIG.maxTravelers}" value="2" required />
                  <span class="form-error">Entre 1 y ${CONFIG.maxTravelers} viajeros.</span>
                </div>
              </div>
              <div class="grid-2" style="gap:16px">
                <div class="form-field">
                  <label for="bkEmail">Correo del titular</label>
                  <input type="email" id="bkEmail" required autocomplete="email" />
                  <small>Aquí enviaremos la confirmación y el voucher.</small>
                  <span class="form-error">Introduce un correo válido.</span>
                </div>
                <div class="form-field">
                  <label for="bkPhone">Teléfono o WhatsApp</label>
                  <input type="tel" id="bkPhone" required autocomplete="tel" />
                  <span class="form-error">Necesitamos un teléfono de contacto.</span>
                </div>
              </div>
              <div class="form-field">
                <label for="bkNotes">Comentarios (opcional)</label>
                <textarea id="bkNotes" rows="2" placeholder="Alergias, movilidad reducida, hotel de recojo, celebraciones…"></textarea>
              </div>
            </div>
          </section>

          <!-- Paso 1b: categoría de hotel, solo en paquetes -->
          <section class="booking-step" data-step="15">
            <p class="form-note" style="margin:0 0 18px">
              Todas las categorías incluyen los mismos servicios, traslados y excursiones.
              Lo único que cambia es el hotel.
            </p>
            <div class="tier-list" id="bkTiers"></div>
            <p class="tier-note">Hoteles indicados o similares de la misma categoría, según disponibilidad en tus fechas.</p>
          </section>

          <!-- Paso 2 -->
          <section class="booking-step" data-step="2">
            <p class="form-note" style="margin:0 0 18px">
              Los nombres deben coincidir exactamente con el documento con el que viajan.
              Varios ingresos, como el de Machu Picchu, se emiten a nombre del pasajero y no admiten cambios.
            </p>
            <div id="bkPaxList"></div>
          </section>

          <!-- Paso 3 -->
          <section class="booking-step" data-step="3">
            <div class="booking-summary">
              <div class="fact-row"><span>Experiencia</span><strong>${escapar(PRODUCT.title)}</strong></div>
              <div class="fact-row"><span>Fecha</span><strong id="bkSumDate">—</strong></div>
              <div class="fact-row"><span>Viajeros</span><strong id="bkSumPax">—</strong></div>
              <div class="fact-row" ${PRODUCT.tiers ? '' : 'hidden'}><span>Categoría de hotel</span><strong id="bkSumTier">—</strong></div>
              <div class="fact-row"><span>Precio por persona</span><strong id="bkSumUnit">—</strong></div>
              <div class="booking-total"><span>Total del tour</span><strong id="bkSumTotal">—</strong></div>
            </div>

            <div class="booking-pay">
              <div class="booking-pay__amount">
                <span id="bkPayLabel">Pagas ahora</span>
                <strong id="bkPayAmount">—</strong>
              </div>
              <p class="booking-pay__note" id="bkPayNote"></p>
              <div id="paypalButtons"></div>
              <div class="booking-fallback" id="bkFallback" hidden>
                No hemos podido cargar la pasarela de pago.
                <a href="https://wa.me/51900608980" target="_blank" rel="noopener noreferrer">Escríbenos por WhatsApp</a>
                y cerramos la reserva contigo.
              </div>
            </div>

            <div class="policy-box">
              <strong>Cancelación gratuita hasta 24 horas antes</strong>
              Si cancelas con más de 24 horas de antelación te devolvemos el importe completo.
              Con menos de 24 horas o en caso de no presentarte, el pago no es reembolsable.
              Si somos nosotros quienes cancelamos por causas operativas o meteorológicas,
              te devolvemos el 100 % o reprogramamos sin coste, a tu elección.
              <a href="${BASE}legal.html#cancelacion" target="_blank" rel="noopener">Ver política completa</a>
            </div>
          </section>

          <!-- Confirmación -->
          <section class="booking-step" data-step="4">
            <div class="booking-done">
              <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
              <h3>Reserva confirmada</h3>
              <p>Hemos recibido tu pago. Tu código de reserva es:</p>
              <div class="booking-code" id="bkCode">—</div>
              <p>Te hemos enviado la confirmación y el travel voucher a <strong id="bkDoneEmail"></strong>.
                 Si no lo ves en unos minutos, revisa la carpeta de spam.</p>
              <p id="bkDoneBalance"></p>
              <p id="bkDoneAccount"></p>
            </div>
          </section>

          <div class="booking-actions" id="bkActions">
            <button type="button" class="btn-outline" id="bkBack" hidden>Atrás</button>
            <button type="button" class="btn-primary" id="bkNext" style="margin-left:auto">Continuar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    return wrap;
  }

  const escapar = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------- Formularios de pasajeros */

  function pintarPasajeros() {
    const list = $('#bkPaxList');
    const n = state.travelers;
    const docs = CONFIG.documentTypes.map((t) => `<option>${t}</option>`).join('');
    list.innerHTML = Array.from({ length: n }, (_, i) => `
      <div class="pax-card" data-pax="${i}">
        <h4><span>${i + 1}</span> ${i === 0 ? 'Titular de la reserva' : `Pasajero ${i + 1}`}</h4>
        <div class="pax-grid">
          <div class="form-field">
            <label for="pxName${i}">Nombres y apellidos</label>
            <input type="text" id="pxName${i}" data-f="name" required />
            <span class="form-error">Tal como figura en el documento.</span>
          </div>
          <div class="form-field">
            <label for="pxNat${i}">Nacionalidad</label>
            <input type="text" id="pxNat${i}" data-f="nationality" required />
            <span class="form-error">Indica la nacionalidad.</span>
          </div>
          <div class="form-field">
            <label for="pxDocType${i}">Tipo de documento</label>
            <select id="pxDocType${i}" data-f="docType">${docs}</select>
          </div>
          <div class="form-field">
            <label for="pxDoc${i}">Número de documento</label>
            <input type="text" id="pxDoc${i}" data-f="docNumber" required />
            <span class="form-error">Necesitamos el número de documento.</span>
          </div>
          <div class="form-field">
            <label for="pxBirth${i}">Fecha de nacimiento</label>
            <input type="date" id="pxBirth${i}" data-f="birth" required />
            <span class="form-error">Indica la fecha de nacimiento.</span>
          </div>
        </div>
      </div>`).join('');
  }

  function pintarCategorias() {
    const cont = $('#bkTiers');
    if (!cont || !PRODUCT.tiers) return;
    const base = PRODUCT.tiers[0].pricePerPerson;
    cont.innerHTML = PRODUCT.tiers.map((t) => {
      const delta = t.pricePerPerson - base;
      return `
      <label class="tier">
        <input type="radio" name="tier" value="${t.code}" ${t.code === state.tier ? 'checked' : ''} />
        <span class="tier__head">
          <span class="tier__name">${escapar(t.name)}<span class="tier__stars">${escapar(t.stars)}</span></span>
          <span class="tier__price">${money(t.pricePerPerson)}
            <small>${delta > 0 ? '+' + money(delta) + ' por persona' : 'precio base'}</small>
          </span>
        </span>
        <p class="tier__hotels">${escapar(t.hotels.join(' · '))}</p>
      </label>`;
    }).join('');

    cont.addEventListener('change', (e) => {
      if (e.target.name !== 'tier') return;
      state.tier = e.target.value;
      recalcular();
    });
  }

  /* ----------------------------------------------------------- Validación */

  function validarCampo(input) {
    const field = input.closest('.form-field');
    const ok = input.checkValidity();
    if (field) field.classList.toggle('has-error', !ok);
    input.setAttribute('aria-invalid', String(!ok));
    return ok;
  }

  function validarPaso(n) {
    const section = $(`.booking-step[data-step="${n}"]`);
    let valid = true;
    let first = null;
    $$('input, select, textarea', section).forEach((input) => {
      if (!validarCampo(input) && valid) { first = input; valid = false; }
    });

    if (n === 1 && valid) {
      const date = new Date($('#bkDate').value + 'T00:00:00');
      const limit = new Date();
      limit.setDate(limit.getDate() + CONFIG.minLeadDays);
      limit.setHours(0, 0, 0, 0);
      if (date < limit) {
        mostrarError(`Necesitamos al menos ${CONFIG.minLeadDays} días de antelación para confirmar los servicios. Para fechas más próximas, escríbenos por WhatsApp.`);
        $('#bkDate').closest('.form-field').classList.add('has-error');
        return false;
      }
    }
    if (first) first.focus();
    if (!valid) mostrarError('Revisa los campos marcados en rojo.');
    return valid;
  }

  function guardarPaso1() {
    state.date = $('#bkDate').value;
    state.travelers = parseInt($('#bkTravelers').value, 10);
    state.holder = {
      email: $('#bkEmail').value.trim(),
      phone: $('#bkPhone').value.trim(),
      notes: $('#bkNotes').value.trim()
    };
    recalcular();
  }

  function guardarPaso2() {
    state.pax = $$('.pax-card').map((card) => {
      const p = {};
      $$('[data-f]', card).forEach((input) => { p[input.dataset.f] = input.value.trim(); });
      return p;
    });
  }

  function pintarResumen() {
    const fecha = new Date(state.date + 'T00:00:00');
    $('#bkSumDate').textContent = fecha.toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' });
    $('#bkSumPax').textContent = state.travelers === 1 ? '1 viajero' : `${state.travelers} viajeros`;
    $('#bkSumUnit').textContent = money(precioUnitario());
    $('#bkSumTotal').textContent = money(state.total);
    const filaTier = $('#bkSumTier');
    if (filaTier && PRODUCT.tiers) {
      const t = PRODUCT.tiers.find((x) => x.code === state.tier);
      filaTier.textContent = t ? `${t.name} (${t.stars})` : '—';
      filaTier.closest('.fact-row').hidden = false;
    }
    $('#bkPayAmount').textContent = money(state.due);

    if (state.mode === 'completo') {
      $('#bkPayLabel').textContent = 'Pago total';
      $('#bkPayNote').textContent = 'Al ser un importe reducido, se abona completo ahora. No queda saldo pendiente.';
    } else {
      const saldo = round2(state.total - state.due);
      $('#bkPayLabel').textContent = 'Reserva ahora';
      $('#bkPayNote').textContent = `Pagas ${money(state.due)} para confirmar la reserva. El saldo de ${money(saldo)} se abona el día del tour o antes, como prefieras.`;
    }
  }

  /* --------------------------------------------------------------- PayPal */

  function cargarPayPal() {
    return new Promise((resolve, reject) => {
      if (window.paypal) return resolve(window.paypal);
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(CONFIG.paypalClientId)}` +
        `&currency=${CONFIG.currency}&intent=capture&components=buttons&locale=es_ES`;
      script.onload = () => resolve(window.paypal);
      script.onerror = () => reject(new Error('No se pudo cargar el SDK de PayPal'));
      document.head.appendChild(script);
    });
  }

  /** Payload que se envía al backend. Nunca incluye importes de confianza:
   *  el backend recalcula el precio desde su propia copia del catálogo. */
  function payloadReserva() {
    return {
      requestKey: state.requestKey,
      slug: PRODUCT.slug,
      kind: PRODUCT.kind,
      title: PRODUCT.title,
      date: state.date,
      travelers: state.travelers,
      tier: state.tier,
      holder: state.holder,
      passengers: state.pax,
      quotedTotal: state.total,
      quotedDue: state.due,
      mode: state.mode,
      currency: CONFIG.currency,
      language: document.documentElement.lang || 'es'
    };
  }

  async function llamarBackend(action, data) {
    if (!CONFIG.endpoint || CONFIG.endpoint.startsWith('PEGAR_AQUI')) {
      throw new Error('El sistema de reservas aún no está conectado con Google Apps Script.');
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 60000) : null;
    try {
      const response = await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, data }),
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || 'Error desconocido del servidor');
      return json;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('La confirmación está tardando demasiado. No vuelvas a pagar; revisa tu correo o escríbenos.');
      }
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function montarBotonesPago() {
    const contenedor = $('#paypalButtons');
    contenedor.innerHTML = '<div class="booking-loading">Cargando pasarela de pago…</div>';
    $('#bkFallback').hidden = true;

    if (!CONFIG.paypalClientId || CONFIG.paypalClientId.startsWith('PEGAR_AQUI')) {
      contenedor.innerHTML = '';
      $('#bkFallback').hidden = false;
      mostrarError('La pasarela de pago aún no está configurada. Falta el Client ID de PayPal.');
      return;
    }
    if (!CONFIG.endpoint || CONFIG.endpoint.startsWith('PEGAR_AQUI')) {
      contenedor.innerHTML = '';
      $('#bkFallback').hidden = false;
      mostrarError('El sistema de reservas aún no está conectado con Google Apps Script.');
      return;
    }

    try {
      const paypal = await cargarPayPal();
      contenedor.innerHTML = '';
      if (paypalButtons && typeof paypalButtons.close === 'function') {
        try { await paypalButtons.close(); } catch (e) { /* instancia anterior */ }
      }

      paypalButtons = paypal.Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'pay', height: 46 },

        createOrder: async () => {
          limpiarError();
          const r = await llamarBackend('createOrder', payloadReserva());
          return r.orderId;
        },

        onApprove: async (data) => {
          if (pagoEnProceso) return;
          pagoEnProceso = true;
          $('#bkActions').hidden = true;
          contenedor.innerHTML = '<div class="booking-loading">Confirmando el pago…</div>';
          try {
            // El servidor recupera los datos guardados al crear la orden. El
            // navegador ya no puede sustituir el producto después de pagar.
            const r = await llamarBackend('captureOrder', { orderId: data.orderID });
            mostrarConfirmacion(r);
          } catch (err) {
            mostrarError(err.message || 'No pudimos confirmar el pago. No vuelvas a pagar.');
            contenedor.innerHTML = '';
            $('#bkFallback').hidden = false;
          } finally {
            pagoEnProceso = false;
          }
        },

        onError: (err) => {
          console.error('[PayPal]', err);
          if (!pagoEnProceso) {
            mostrarError('No se pudo abrir PayPal. No se ha realizado ningún cargo. Vuelve a intentarlo o escríbenos por WhatsApp.');
            $('#bkActions').hidden = false;
          }
        },

        onCancel: () => {
          mostrarError('Has cancelado el pago. Tu reserva no se ha confirmado y no se ha realizado ningún cargo.');
        }
      });

      if (typeof paypalButtons.isEligible === 'function' && !paypalButtons.isEligible()) {
        throw new Error('PayPal no está disponible en este navegador');
      }
      await paypalButtons.render('#paypalButtons');
    } catch (error) {
      console.error(error);
      contenedor.innerHTML = '';
      $('#bkFallback').hidden = false;
      mostrarError('No hemos podido cargar la pasarela de pago. Puedes reservar por WhatsApp.');
    }
  }

  function mostrarConfirmacion(respuesta) {
    $('#bkCode').textContent = respuesta.bookingCode || '—';
    $('#bkDoneEmail').textContent = state.holder.email;
    const saldo = Number(respuesta.balance || 0);
    $('#bkDoneBalance').textContent = saldo > 0
      ? `Saldo pendiente: ${money(saldo)}, a abonar antes o el día del tour.`
      : 'La reserva quedó pagada por completo.';

    let usuario = null;
    try { usuario = JSON.parse(localStorage.getItem('latamExpeditionsUser') || 'null'); } catch (e) { /* sin acceso */ }
    const cuenta = $('#bkDoneAccount');
    if (cuenta) {
      if (usuario && String(usuario.email || '').toLowerCase() === state.holder.email.toLowerCase()) {
        cuenta.innerHTML = `<a href="${BASE}mis-viajes.html">Ver esta reserva en Mis viajes</a>`;
      } else {
        cuenta.innerHTML = `Crea una cuenta con <strong>${escapar(state.holder.email)}</strong> para ver esta y tus próximas reservas en <a href="${BASE}registro.html">Mis viajes</a>.`;
      }
    }

    irAPaso(4);
    $('#bkActions').hidden = true;
    limpiarError();
  }

  /* -------------------------------------------------------- Navegación UI */

  function irAPaso(n) {
    step = n;
    $$('.booking-step').forEach((s) => s.classList.toggle('is-active', +s.dataset.step === n));
    $$('.booking-steps li').forEach((li) => {
      const i = +li.dataset.stepLabel;
      li.classList.toggle('is-done', i < n);
      i === n ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current');
    });
    $('#bkBack').hidden = n === 1 || n === 4;
    $('#bkNext').hidden = n >= 3 && n !== 15;
    // El paso 15 (categoría) se muestra bajo la etiqueta del paso 1.
    if (n === 15) {
      $$('.booking-steps li').forEach((li) => {
        const i = +li.dataset.stepLabel;
        li.classList.toggle('is-done', i < 1);
        i === 1 ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current');
      });
    }
    $('.booking-steps').hidden = n === 4;
    $('.booking-box').scrollIntoView({ block: 'start', behavior: 'smooth' });
    limpiarError();
  }

  const mostrarError = (msg) => {
    const box = $('#bookingError');
    box.textContent = msg;
    box.classList.add('is-visible');
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const limpiarError = () => $('#bookingError').classList.remove('is-visible');

  function completarDesdeCuenta() {
    let user = null;
    try { user = JSON.parse(localStorage.getItem('latamExpeditionsUser') || 'null'); } catch (e) { /* modo privado */ }
    if (!user) return;
    const email = $('#bkEmail');
    const phone = $('#bkPhone');
    if (email && !email.value && user.email) email.value = user.email;
    if (phone && !phone.value && user.phone) phone.value = user.phone;
  }

  /* ------------------------------------------------------------- Arranque */

  async function init() {
    try {
      const response = await fetch(`${BASE}assets/data/catalog.json`, { cache: 'no-store' });
      CONFIG = (await response.json()).booking;
    } catch (error) {
      console.error('[booking] No se pudo cargar la configuración', error);
      return;
    }

    const modal = construirModal();
    let lastFocused = null;

    const abrir = () => {
      lastFocused = document.activeElement;
      recalcular();
      completarDesdeCuenta();
      modal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      $('#bkDate').focus();
    };
    const cerrar = () => {
      modal.classList.remove('is-open');
      document.body.style.overflow = '';
      if (lastFocused) lastFocused.focus();
    };

    trigger.addEventListener('click', abrir);
    $$('[data-close-booking]', modal).forEach((b) => b.addEventListener('click', cerrar));
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open') && step !== 4) cerrar();
    });

    // Fecha mínima seleccionable en el calendario nativo.
    const min = new Date();
    min.setDate(min.getDate() + CONFIG.minLeadDays);
    $('#bkDate').min = min.toISOString().slice(0, 10);

    $('#bkNext').addEventListener('click', async () => {
      if (!validarPaso(step)) return;
      if (step === 1) {
        guardarPaso1();
        if (PRODUCT.tiers && PRODUCT.tiers.length > 1) {
          pintarCategorias();
          irAPaso(15);
        } else {
          pintarPasajeros();
          irAPaso(2);
        }
      } else if (step === 15) {
        recalcular();
        pintarPasajeros();
        irAPaso(2);
      } else if (step === 2) {
        guardarPaso2();
        state.requestKey = nuevaClaveSolicitud();
        pintarResumen();
        irAPaso(3);
        await montarBotonesPago();
      }
    });

    $('#bkBack').addEventListener('click', () => {
      if (step === 2 && PRODUCT.tiers && PRODUCT.tiers.length > 1) return irAPaso(15);
      if (step === 15) return irAPaso(1);
      irAPaso(Math.max(1, step - 1));
    });

    // Limpia el error de un campo en cuanto se corrige.
    modal.addEventListener('input', (e) => {
      const field = e.target.closest('.form-field');
      if (field && field.classList.contains('has-error') && e.target.checkValidity()) {
        field.classList.remove('has-error');
        e.target.setAttribute('aria-invalid', 'false');
      }
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
