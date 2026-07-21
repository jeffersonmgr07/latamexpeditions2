/**
 * Latam Expeditions — backend de reservas en Google Apps Script
 * ============================================================
 *
 * Hace tres cosas:
 *   1. Crea órdenes de PayPal con un importe que calcula ÉL, no el navegador.
 *   2. Captura el pago y solo entonces da la reserva por buena.
 *   3. Guarda la reserva en una hoja de cálculo y envía voucher y aviso.
 *
 * Por qué el importe se calcula aquí
 * ----------------------------------
 * Cualquiera puede abrir la consola del navegador y cambiar el precio antes de
 * enviarlo. Por eso el navegador manda QUÉ tour y CUÁNTOS viajeros, y este
 * script busca el precio en su propia tabla y calcula el total. Si lo que
 * cotizó el navegador no coincide, la reserva se rechaza.
 *
 * ----------------------------------------------------------------------------
 * INSTALACIÓN (una sola vez, unos 15 minutos)
 * ----------------------------------------------------------------------------
 *
 * 1. Crea una hoja de cálculo nueva en Google Sheets. Llámala
 *    "Reservas Latam Expeditions". Copia su ID de la URL: es el tramo largo
 *    entre /d/ y /edit.
 *
 * 2. En esa hoja: Extensiones → Apps Script. Borra lo que haya y pega
 *    este archivo completo.
 *
 * 3. Ve a Configuración del proyecto (el engranaje) → Propiedades del script
 *    → Añadir propiedad, y crea estas propiedades:
 *
 *       PAYPAL_CLIENT_ID      Tu Client ID
 *       PAYPAL_SECRET         Tu Secret          ← nunca lo pongas en el código
 *       PAYPAL_ENV            sandbox  (luego lo cambias a: live)
 *       SHEET_ID              El ID del paso 1
 *       GOOGLE_CLIENT_ID       Client ID web de Google Identity Services
 *
 *    Opcionales:
 *       NOTIFY_EMAIL          Tu correo para recibir avisos de cada reserva
 *       VOUCHER_LOGO_URL      URL del logo que saldrá en el voucher
 *
 * 4. Implementar → Nueva implementación → tipo "Aplicación web":
 *       Ejecutar como:        Yo
 *       Quién tiene acceso:   Cualquier usuario
 *    Copia la URL que termina en /exec.
 *
 * 5. Pega esa URL en assets/data/catalog.json, en booking.endpoint.
 *    Pega tu Client ID en booking.paypalClientId.
 *
 * 6. Ejecuta una vez la función pruebaDeInstalacion() desde el editor para
 *    comprobar que todo responde antes de aceptar pagos reales.
 *
 * IMPORTANTE: cada vez que edites este archivo tienes que volver a
 * Implementar → Gestionar implementaciones → editar → Nueva versión.
 * Si no, sigue corriendo la versión anterior.
 */

/* ========================================================================== */
/*  Configuración                                                             */
/* ========================================================================== */

const PROPS = PropertiesService.getScriptProperties();

const CONFIG = {
  get clientId() { return PROPS.getProperty('PAYPAL_CLIENT_ID'); },
  get secret() { return PROPS.getProperty('PAYPAL_SECRET'); },
  get env() { return PROPS.getProperty('PAYPAL_ENV') || 'sandbox'; },
  get sheetId() { return PROPS.getProperty('SHEET_ID'); },
  get notifyEmail() { return PROPS.getProperty('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail(); },
  get logoUrl() { return PROPS.getProperty('VOUCHER_LOGO_URL') || ''; },
  get apiBase() {
    return this.env === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  },

  // Reglas de cobro. Deben coincidir con booking en catalog.json.
  depositPercent: 20,
  depositRoundTo: 10,
  depositMin: 30,
  depositMax: 500,
  payFullBelow: 60,
  currency: 'USD',
  maxTravelers: 12,
  minLeadDays: 3,

  agency: {
    name: 'Latam Expeditions',
    email: 'reservas@latamexpeditions.com',
    phone: '+51 900 608 980',
    whatsapp: '51900608980',
    web: 'https://latamexpeditions.com',
    agent: 'Jefferson García'
  }
};

/**
 * Precios oficiales por persona, en USD.
 *
 * Esta es la única fuente de verdad para cobrar. Cuando cambies un precio en
 * assets/data/catalog.json, cámbialo también aquí y vuelve a implementar.
 * Si un slug no está en esta tabla, la reserva se rechaza: es deliberado,
 * evita que alguien invente un producto.
 */
const PRECIOS = {
  'machu-picchu-full-day': 340.00,
  'valle-sagrado-clasico': 55.00,
  'montana-colores': 45.00,
  'lima-gastronomica': 75.00,
  'islas-ballestas-paracas': 40.00,
  'cartagena-centro-getsemani': 25.00,
  'islas-rosario-baru': 65.00,
  'guatape-piedra-penol': 45.00,
  'comuna-13-medellin': 30.00,
  'buenos-aires-city-tango': 110.00,
  'cataratas-iguazu-argentina': 70.00,
  'perito-moreno-calafate': 95.00,
  'mendoza-vinos': 90.00,
  'galapagos-4d-isla-santa-cruz': 790.00,
  'quito-mitad-del-mundo': 55.00,
  'cotopaxi-quilotoa': 70.00,
  'rio-cristo-pan-de-azucar': 95.00,
  'favela-rocinha': 40.00,
  'iguazu-lado-brasileno': 65.00,
  'uyuni-3-dias': 230.00,
  'uyuni-full-day': 60.00,
  'la-paz-teleferico-luna': 45.00,
  'atacama-valle-luna': 75.00,
  'geiseres-tatio': 55.00,
  'torres-del-paine-full-day': 120.00,
  'chichen-itza-cenote': 95.00,
  'tulum-cenotes': 75.00,
  'xcaret-parque': 190.00
};

/**
 * Paquetes: precio por persona según categoría de hotel.
 * El navegador manda el código de categoría (3e, 4e, 5e) y el servidor busca
 * aquí el precio. Una categoría inexistente rechaza la reserva.
 */
const PRECIOS_PAQUETES = {
  'peru-cusco-4d3n': { '3e': 590.00, '4e': 770.00, '5e': 1030.00 },
  'peru-sur-7d6n': { '3e': 1180.00, '4e': 1530.00, '5e': 2060.00 },
  'colombia-caribe-4d3n': { '3e': 480.00, '4e': 620.00, '5e': 840.00 },
  'colombia-completo-7d6n': { '3e': 1290.00, '4e': 1680.00, '5e': 2260.00 },
  'argentina-ba-iguazu-5d4n': { '3e': 890.00, '4e': 1160.00, '5e': 1560.00 },
  'argentina-patagonia-7d6n': { '3e': 1650.00, '4e': 2140.00, '5e': 2890.00 },
  'bolivia-uyuni-4d3n': { '3e': 620.00, '4e': 810.00, '5e': 1080.00 },
  'chile-atacama-5d4n': { '3e': 980.00, '4e': 1270.00, '5e': 1720.00 },
  'chile-patagonia-6d5n': { '3e': 1450.00, '4e': 1880.00, '5e': 2540.00 },
  'ecuador-galapagos-5d4n': { '3e': 1390.00, '4e': 1810.00, '5e': 2430.00 },
  'brasil-rio-4d3n': { '3e': 620.00, '4e': 810.00, '5e': 1080.00 },
  'brasil-rio-iguazu-6d5n': { '3e': 1180.00, '4e': 1530.00, '5e': 2060.00 },
  'mexico-riviera-5d4n': { '3e': 790.00, '4e': 1030.00, '5e': 1380.00 }
};

/* ========================================================================== */
/*  Punto de entrada HTTP                                                     */
/* ========================================================================== */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Faltan datos de la solicitud.');
    }
    if (e.postData.contents.length > 120000) {
      throw new Error('La solicitud es demasiado grande.');
    }

    const body = JSON.parse(e.postData.contents);
    const action = String(body.action || '');
    const data = body.data || {};

    // --- Reservas y pago (Codigo.gs) ---
    if (action === 'createOrder') return json({ ok: true, orderId: crearOrden(data) });
    if (action === 'captureOrder') return json(capturarOrden(data));

    // --- Cuentas y consultas (Cuentas.gs) ---
    if (action === 'authNonce') return json({ ok: true, nonce: crearNonceGoogle() });
    if (action === 'register') return json(registrarUsuario(data));
    if (action === 'login') return json(iniciarSesion(data));
    if (action === 'googleLogin') return json(entrarConGoogle(data));
    if (action === 'logout') return json(cerrarSesion(data));
    if (action === 'myTrips') return json(misViajes(data));
    if (action === 'findBooking') return json(consultarReserva(data));
    if (action === 'resendVoucher') return json(reenviarVoucher(data));

    if (action === 'ping') return json({ ok: true, env: CONFIG.env, hora: new Date().toISOString() });

    return json({ ok: false, error: 'Acción no reconocida.' });
  } catch (error) {
    registrarError(error, e && e.postData ? e.postData.contents : '');
    return json({ ok: false, error: mensajeSeguro(error) });
  }
}

function doGet() {
  return ContentService
    .createTextOutput('Latam Expeditions — backend de reservas activo. Usa POST.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** No exponemos detalles internos al navegador. */
function mensajeSeguro(error) {
  const msg = String(error && error.message ? error.message : error);
  const publicos = [
    // Reservas
    'Producto no disponible', 'El importe no coincide', 'Faltan datos',
    'Demasiados viajeros', 'Fecha demasiado próxima', 'Fecha inválida',
    'La solicitud es demasiado grande', 'La orden de pago', 'No se pudo iniciar el pago',
    'El pago no se completó', 'El pago fue recibido', 'No encontramos la orden de pago',
    // Cuentas
    'Introduce un correo', 'Indícanos tu nombre', 'La contraseña debe',
    'Ya existe una cuenta', 'Correo o contraseña', 'Esta cuenta está desactivada',
    'Demasiados intentos', 'Sesión no iniciada', 'Sesión no válida',
    'Tu sesión ha caducado', 'Necesitamos el código', 'El apellido no coincide',
    'No encontramos ninguna reserva', 'Para vincular este correo',
    // Google
    'El acceso con Google no está configurado', 'La sesión de Google',
    'No hemos recibido la credencial', 'Tu correo de Google',
    'Google no nos ha devuelto', 'La verificación de Google ha caducado'
  ];
  return publicos.some(function (p) { return msg.indexOf(p) === 0; })
    ? msg
    : 'No hemos podido completar la operación. Escríbenos por WhatsApp para ayudarte.';
}

/* ========================================================================== */
/*  Cálculo y validación                                                      */
/* ========================================================================== */

function redondear2(n) { return Math.round(n * 100) / 100; }

function calcularCobro(total) {
  if (total <= CONFIG.payFullBelow) return { due: redondear2(total), mode: 'completo' };
  let due = Math.ceil((total * CONFIG.depositPercent) / 100 / CONFIG.depositRoundTo) * CONFIG.depositRoundTo;
  due = Math.max(CONFIG.depositMin, Math.min(due, CONFIG.depositMax));
  return { due: Math.min(due, redondear2(total)), mode: 'deposito' };
}

function textoPlano(valor, maximo) {
  return String(valor == null ? '' : valor)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximo || 250);
}

function textoMultilinea(valor, maximo) {
  return String(valor == null ? '' : valor)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maximo || 1000);
}

function requestKeySeguro(valor) {
  const key = String(valor || '').trim();
  if (/^[A-Za-z0-9_-]{16,80}$/.test(key)) return key;
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

/**
 * Recalcula el importe desde cero, valida y normaliza todos los datos.
 * El objeto normalizado es el único que se guarda junto a la orden de PayPal.
 */
function validarYCalcular(data) {
  if (!data || !data.slug) throw new Error('Faltan datos de la reserva.');

  const slug = textoPlano(data.slug, 100).toLowerCase();
  const precio = resolverPrecio({ slug: slug, tier: data.tier });

  const viajeros = parseInt(data.travelers, 10);
  if (!(viajeros >= 1 && viajeros <= CONFIG.maxTravelers)) throw new Error('Demasiados viajeros.');

  const holder = data.holder || {};
  const email = String(holder.email || '').trim().toLowerCase().slice(0, 254);
  const telefono = textoPlano(holder.phone, 50);
  if (!esCorreo(email) || telefono.length < 5) throw new Error('Faltan datos de contacto válidos.');

  if (!Array.isArray(data.passengers) || data.passengers.length !== viajeros) {
    throw new Error('Faltan datos de los pasajeros.');
  }

  const pasajeros = data.passengers.map(function (entrada) {
    const p = entrada || {};
    const limpio = {
      name: textoPlano(p.name, 120),
      nationality: textoPlano(p.nationality, 60),
      docType: textoPlano(p.docType, 30),
      docNumber: textoPlano(p.docNumber, 50),
      birth: textoPlano(p.birth, 10)
    };
    if (limpio.name.length < 3 || !limpio.nationality || !limpio.docType || !limpio.docNumber) {
      throw new Error('Faltan datos de los pasajeros.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio.birth) || isNaN(new Date(limpio.birth + 'T00:00:00').getTime())) {
      throw new Error('Faltan datos de los pasajeros.');
    }
    return limpio;
  });

  const fechaTexto = textoPlano(data.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaTexto)) throw new Error('Fecha inválida.');
  const fecha = new Date(fechaTexto + 'T00:00:00');
  if (isNaN(fecha.getTime())) throw new Error('Fecha inválida.');
  const limite = new Date();
  limite.setDate(limite.getDate() + CONFIG.minLeadDays);
  limite.setHours(0, 0, 0, 0);
  if (fecha < limite) throw new Error('Fecha demasiado próxima.');

  const total = redondear2(precio * viajeros);
  const cobro = calcularCobro(total);

  if (data.quotedDue !== undefined && Math.abs(Number(data.quotedDue) - cobro.due) > 0.01) {
    throw new Error('El importe no coincide. Recarga la página e inténtalo de nuevo.');
  }

  const tier = data.tier ? textoPlano(data.tier, 10) : '';
  const booking = {
    requestKey: requestKeySeguro(data.requestKey),
    slug: slug,
    kind: textoPlano(data.kind || (PRECIOS_PAQUETES[slug] ? 'package' : 'experience'), 20),
    title: textoPlano(data.title || slug, 120),
    date: fechaTexto,
    travelers: viajeros,
    tier: tier || null,
    holder: {
      email: email,
      phone: telefono,
      notes: textoMultilinea(holder.notes, 1200)
    },
    passengers: pasajeros,
    language: textoPlano(data.language || 'es', 10)
  };

  return { precio: precio, viajeros: viajeros, total: total, due: cobro.due, mode: cobro.mode,
           fecha: fecha, booking: booking };
}

/** Devuelve el precio por persona oficial del producto solicitado. */
function resolverPrecio(data) {
  if (typeof PRECIOS[data.slug] === 'number') return PRECIOS[data.slug];

  const tiers = PRECIOS_PAQUETES[data.slug];
  if (tiers) {
    const tier = data.tier;
    if (!tier || typeof tiers[tier] !== 'number') {
      throw new Error('Producto no disponible. Elige una categoría de hotel válida.');
    }
    return tiers[tier];
  }
  throw new Error('Producto no disponible.');
}

function esCorreo(s) {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/* ========================================================================== */
/*  PayPal                                                                    */
/* ========================================================================== */

function tokenPayPal() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('paypal_token_' + CONFIG.env);
  if (guardado) return guardado;

  if (!CONFIG.clientId || !CONFIG.secret) {
    throw new Error('Faltan credenciales de PayPal en las propiedades del script.');
  }

  const response = UrlFetchApp.fetch(CONFIG.apiBase + '/v1/oauth2/token', {
    method: 'post',
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(CONFIG.clientId + ':' + CONFIG.secret)
    },
    payload: { grant_type: 'client_credentials' },
    muteHttpExceptions: true
  });

  let body = {};
  try { body = JSON.parse(response.getContentText()); } catch (e) { /* respuesta no JSON */ }
  if (response.getResponseCode() !== 200 || !body.access_token) {
    throw new Error('PayPal rechazó las credenciales.');
  }

  cache.put('paypal_token_' + CONFIG.env, body.access_token, Math.max(60, Number(body.expires_in || 300) - 120));
  return body.access_token;
}

function solicitudPayPal(ruta, metodo, payload, requestId) {
  const headers = { Authorization: 'Bearer ' + tokenPayPal(), Prefer: 'return=representation' };
  if (requestId) headers['PayPal-Request-Id'] = requestId;

  const opciones = {
    method: String(metodo || 'get').toLowerCase(),
    contentType: 'application/json',
    headers: headers,
    muteHttpExceptions: true
  };
  if (payload !== undefined) opciones.payload = JSON.stringify(payload);

  const response = UrlFetchApp.fetch(CONFIG.apiBase + ruta, opciones);
  const raw = response.getContentText();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = { raw: raw }; }
  return { code: response.getResponseCode(), body: body, raw: raw };
}

function huellaReserva(booking, calc) {
  const base = JSON.stringify({ booking: booking, total: calc.total, due: calc.due, mode: calc.mode });
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, base, Utilities.Charset.UTF_8)
  ).replace(/=+$/g, '');
}

function idSolicitudPayPal(tipo, clave) {
  const hash = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(clave || ''),
      Utilities.Charset.UTF_8
    )
  ).replace(/=+$/g, '').slice(0, 32);
  // PayPal admite un máximo de 38 caracteres para PayPal-Request-Id.
  const codigoTipo = tipo === 'capture' ? 'P' : (tipo === 'create' ? 'C' : 'X');
  return ('LTX' + codigoTipo + '-' + hash).slice(0, 38);
}

function crearOrden(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
  const c = validarYCalcular(data);
  const booking = c.booking;
  const fingerprint = huellaReserva(booking, c);
  const existente = buscarOrdenPorRequestKey(booking.requestKey);

  if (existente) {
    if (existente.fingerprint !== fingerprint) {
      throw new Error('La orden de pago ya no coincide con la reserva. Vuelve al paso anterior y genera un pago nuevo.');
    }
    if (existente.orderId) return existente.orderId;
  }

  const descripcion = (c.mode === 'completo' ? 'Pago total' : 'Depósito de reserva') +
    ' · ' + booking.title.slice(0, 60);
  const requestId = idSolicitudPayPal('create', booking.requestKey);

  const resultado = solicitudPayPal('/v2/checkout/orders', 'post', {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: { currency_code: CONFIG.currency, value: c.due.toFixed(2) },
      description: descripcion,
      custom_id: booking.requestKey,
      soft_descriptor: 'LATAMEXPED'
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: CONFIG.agency.name,
          locale: 'es-ES',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW'
        }
      }
    }
  }, requestId);

  if (resultado.code >= 300 || !resultado.body.id) {
    registrarError(new Error('Fallo al crear orden PayPal'), resultado.raw);
    throw new Error('No se pudo iniciar el pago. Inténtalo nuevamente.');
  }

  guardarOrdenPendiente({
    orderId: resultado.body.id,
    requestKey: booking.requestKey,
    fingerprint: fingerprint,
    amount: c.due,
    currency: CONFIG.currency,
    booking: booking,
    calc: { precio: c.precio, viajeros: c.viajeros, total: c.total, due: c.due, mode: c.mode }
  });

  return resultado.body.id;

  } finally {
    lock.releaseLock();
  }
}

function capturarOrden(payload) {
  const orderId = textoPlano(payload && payload.orderId, 40);
  if (!/^[A-Z0-9]+$/.test(orderId)) throw new Error('La orden de pago no es válida.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let orden = buscarOrdenPayPal(orderId);
    if (!orden) throw new Error('No encontramos la orden de pago. Vuelve a iniciar el pago.');

    if (orden.estado === 'CAPTURADA' && orden.codigoReserva) {
      return {
        ok: true,
        bookingCode: orden.codigoReserva,
        paid: Number(orden.amount),
        balance: redondear2(Number(orden.total) - Number(orden.amount)),
        duplicate: true
      };
    }

    actualizarOrdenPayPal(orden.fila, { estado: 'CAPTURANDO', error: '' });

    const requestId = idSolicitudPayPal('capture', orden.requestKey);
    let resultado = solicitudPayPal('/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', 'post', {}, requestId);

    // Si la respuesta se perdió o PayPal indica que ya fue capturada, consultamos
    // el estado actual de la orden y continuamos sin cobrar una segunda vez.
    if (resultado.code >= 300 || resultado.body.status !== 'COMPLETED') {
      const consulta = solicitudPayPal('/v2/checkout/orders/' + encodeURIComponent(orderId), 'get');
      if (consulta.code < 300 && consulta.body.status === 'COMPLETED') {
        resultado = consulta;
      } else {
        actualizarOrdenPayPal(orden.fila, { estado: 'PENDIENTE', error: resultado.raw.slice(0, 1000) });
        registrarError(new Error('Captura no completada'), resultado.raw);
        throw new Error('El pago no se completó. No vuelvas a intentarlo si PayPal muestra un cargo; escríbenos con la orden ' + orderId + '.');
      }
    }

    const captura = extraerCapturaPayPal(resultado.body);
    if (!captura || captura.status !== 'COMPLETED') {
      actualizarOrdenPayPal(orden.fila, { estado: 'REVISION', error: 'Sin captura COMPLETED' });
      throw new Error('El pago fue recibido, pero requiere revisión manual. No vuelvas a pagar. Orden: ' + orderId + '.');
    }

    const cobrado = Number(captura.amount && captura.amount.value);
    const moneda = captura.amount && captura.amount.currency_code;
    const customId = resultado.body.purchase_units && resultado.body.purchase_units[0]
      ? resultado.body.purchase_units[0].custom_id : '';

    if (Math.abs(cobrado - Number(orden.amount)) > 0.01 || moneda !== orden.currency ||
        (customId && customId !== orden.requestKey)) {
      actualizarOrdenPayPal(orden.fila, {
        estado: 'REVISION', captureId: captura.id,
        error: 'Mismatch importe/moneda/custom_id'
      });
      registrarError(new Error('Pago PayPal no coincide con orden interna'),
        JSON.stringify({ orderId: orderId, esperado: orden.amount, cobrado: cobrado,
                         monedaEsperada: orden.currency, moneda: moneda,
                         requestKey: orden.requestKey, customId: customId }));
      throw new Error('El pago fue recibido, pero requiere revisión manual. No vuelvas a pagar. Orden: ' + orderId + '.');
    }

    const dataGuardada = JSON.parse(orden.bookingJson);
    const booking = dataGuardada.booking;
    const calc = dataGuardada.calc;
    const reserva = {
      code: orden.codigoReserva || generarCodigo(),
      orderId: orderId,
      captureId: captura.id,
      paidAmount: cobrado,
      total: Number(calc.total),
      balance: redondear2(Number(calc.total) - cobrado),
      mode: calc.mode,
      payerEmail: (resultado.body.payer && resultado.body.payer.email_address) || '',
      data: booking,
      calc: calc
    };

    try {
      const guardada = guardarEnHoja(reserva);
      reserva.code = guardada.code;
    } catch (err) {
      actualizarOrdenPayPal(orden.fila, {
        estado: 'PAGO_SIN_REGISTRO', captureId: captura.id,
        error: String(err).slice(0, 1000)
      });
      registrarError(err, 'Pago capturado sin poder guardar reserva. orderId=' + orderId);
      throw new Error('El pago fue recibido, pero hubo un problema al registrar tu reserva. No vuelvas a pagar. Orden: ' + orderId + '.');
    }

    actualizarOrdenPayPal(orden.fila, {
      estado: 'CAPTURADA', codigoReserva: reserva.code,
      captureId: captura.id, error: ''
    });

    try { enviarVoucher(reserva); } catch (err) { registrarError(err, 'enviarVoucher'); }
    try { avisarAgencia(reserva); } catch (err) { registrarError(err, 'avisarAgencia'); }

    return { ok: true, bookingCode: reserva.code, paid: cobrado, balance: reserva.balance };
  } finally {
    lock.releaseLock();
  }
}

function extraerCapturaPayPal(body) {
  try {
    const units = body.purchase_units || [];
    for (let i = 0; i < units.length; i++) {
      const captures = units[i].payments && units[i].payments.captures || [];
      if (captures.length) return captures[0];
    }
  } catch (e) { /* respuesta incompleta */ }
  return null;
}

/* ========================================================================== */
/*  Código de reserva                                                         */
/* ========================================================================== */

/** Formato LTX-AAMMDD-XXXX, con sufijo aleatorio para que no sea adivinable. */
function generarCodigo() {
  const hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyMMdd');
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let intento = 0; intento < 20; intento++) {
    let sufijo = '';
    for (let i = 0; i < 5; i++) sufijo += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
    const codigo = 'LTX-' + hoy + '-' + sufijo;
    if (!existeCodigoReserva(codigo)) return codigo;
  }
  throw new Error('No se pudo generar un código de reserva único.');
}

/* ========================================================================== */
/*  Hojas de cálculo                                                          */
/* ========================================================================== */

const CABECERAS = ['Fecha registro', 'Código', 'Estado', 'Tour', 'Slug', 'Categoría', 'Fecha del tour',
  'Viajeros', 'Precio unitario', 'Total', 'Pagado', 'Saldo', 'Modo',
  'Email titular', 'Teléfono', 'Comentarios', 'Pasajeros',
  'Order ID PayPal', 'Capture ID', 'Email pagador'];

const HOJA_ORDENES_PAYPAL = 'Ordenes PayPal';
const CAB_ORDENES_PAYPAL = ['Creada', 'Actualizada', 'Order ID', 'Estado', 'Request Key',
  'Fingerprint', 'Importe', 'Moneda', 'Total reserva', 'Reserva JSON',
  'Código reserva', 'Capture ID', 'Error'];
const OP = { creada: 0, actualizada: 1, orderId: 2, estado: 3, requestKey: 4,
  fingerprint: 5, amount: 6, currency: 7, total: 8, bookingJson: 9,
  codigoReserva: 10, captureId: 11, error: 12 };

function hojaReservas() {
  const libro = SpreadsheetApp.openById(CONFIG.sheetId);
  let h = libro.getSheetByName('Reservas');
  if (!h) {
    h = libro.insertSheet('Reservas');
    h.appendRow(CABECERAS);
    h.getRange(1, 1, 1, CABECERAS.length).setFontWeight('bold').setBackground('#0a3d2c').setFontColor('#ffffff');
    h.setFrozenRows(1);
  }
  return h;
}

function hojaOrdenesPayPal() {
  const libro = SpreadsheetApp.openById(CONFIG.sheetId);
  let h = libro.getSheetByName(HOJA_ORDENES_PAYPAL);
  if (!h) {
    h = libro.insertSheet(HOJA_ORDENES_PAYPAL);
    h.appendRow(CAB_ORDENES_PAYPAL);
    h.getRange(1, 1, 1, CAB_ORDENES_PAYPAL.length)
      .setFontWeight('bold').setBackground('#0a3d2c').setFontColor('#ffffff');
    h.setFrozenRows(1);
  }
  return h;
}

function guardarOrdenPendiente(o) {
  const existente = buscarOrdenPorRequestKey(o.requestKey);
  if (existente) {
    if (existente.fingerprint !== o.fingerprint) throw new Error('La orden de pago ya no coincide con la reserva.');
    return existente;
  }
  hojaOrdenesPayPal().appendRow([
    new Date(), new Date(), o.orderId, 'PENDIENTE', o.requestKey, o.fingerprint,
    o.amount, o.currency, o.calc.total,
    JSON.stringify({ booking: o.booking, calc: o.calc }), '', '', ''
  ]);
  return buscarOrdenPayPal(o.orderId);
}

function filaAOrdenPayPal(fila, numeroFila) {
  return {
    fila: numeroFila,
    creada: fila[OP.creada], actualizada: fila[OP.actualizada], orderId: String(fila[OP.orderId] || ''),
    estado: String(fila[OP.estado] || ''), requestKey: String(fila[OP.requestKey] || ''),
    fingerprint: String(fila[OP.fingerprint] || ''), amount: Number(fila[OP.amount] || 0),
    currency: String(fila[OP.currency] || ''), total: Number(fila[OP.total] || 0),
    bookingJson: String(fila[OP.bookingJson] || ''), codigoReserva: String(fila[OP.codigoReserva] || ''),
    captureId: String(fila[OP.captureId] || ''), error: String(fila[OP.error] || '')
  };
}

function buscarOrdenPayPal(orderId) {
  const valores = hojaOrdenesPayPal().getDataRange().getValues();
  for (let i = valores.length - 1; i >= 1; i--) {
    if (String(valores[i][OP.orderId]) === String(orderId)) return filaAOrdenPayPal(valores[i], i + 1);
  }
  return null;
}

function buscarOrdenPorRequestKey(requestKey) {
  const valores = hojaOrdenesPayPal().getDataRange().getValues();
  for (let i = valores.length - 1; i >= 1; i--) {
    if (String(valores[i][OP.requestKey]) === String(requestKey)) return filaAOrdenPayPal(valores[i], i + 1);
  }
  return null;
}

function actualizarOrdenPayPal(fila, cambios) {
  const h = hojaOrdenesPayPal();
  h.getRange(fila, OP.actualizada + 1).setValue(new Date());
  if (Object.prototype.hasOwnProperty.call(cambios, 'estado')) h.getRange(fila, OP.estado + 1).setValue(cambios.estado);
  if (Object.prototype.hasOwnProperty.call(cambios, 'codigoReserva')) h.getRange(fila, OP.codigoReserva + 1).setValue(cambios.codigoReserva);
  if (Object.prototype.hasOwnProperty.call(cambios, 'captureId')) h.getRange(fila, OP.captureId + 1).setValue(cambios.captureId);
  if (Object.prototype.hasOwnProperty.call(cambios, 'error')) h.getRange(fila, OP.error + 1).setValue(cambios.error);
}

function existeCodigoReserva(codigo) {
  const h = hojaReservas();
  const filas = h.getLastRow() - 1;
  if (filas <= 0) return false;
  const valores = h.getRange(2, 2, filas, 1).getValues();
  return valores.some(function (r) { return String(r[0]) === codigo; });
}

function buscarReservaPorPago(orderId, captureId) {
  const valores = hojaReservas().getDataRange().getValues();
  for (let i = 1; i < valores.length; i++) {
    if ((orderId && String(valores[i][17]) === orderId) ||
        (captureId && String(valores[i][18]) === captureId)) {
      return { fila: i + 1, code: String(valores[i][1]) };
    }
  }
  return null;
}

function textoHoja(valor) {
  const s = String(valor == null ? '' : valor);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** Guarda una sola reserva por Order ID/Capture ID, aunque la captura se reintente. */
function guardarEnHoja(r) {
  const existente = buscarReservaPorPago(r.orderId, r.captureId);
  if (existente) return { code: existente.code, duplicate: true };

  const pax = r.data.passengers.map(function (p) {
    return p.name + ' (' + p.docType + ' ' + p.docNumber + ', ' + p.nationality + ', nac. ' + p.birth + ')';
  }).join(' | ');

  hojaReservas().appendRow([
    new Date(), r.code, 'PAGADA', textoHoja(r.data.title), r.data.slug, r.data.tier || '—', r.data.date,
    r.calc.viajeros, r.calc.precio, r.total, r.paidAmount, r.balance, r.mode,
    textoHoja(r.data.holder.email), textoHoja(r.data.holder.phone), textoHoja(r.data.holder.notes || ''), textoHoja(pax),
    r.orderId, r.captureId, textoHoja(r.payerEmail)
  ]);
  return { code: r.code, duplicate: false };
}

function registrarError(error, contexto) {
  try {
    const libro = SpreadsheetApp.openById(CONFIG.sheetId);
    let hoja = libro.getSheetByName('Errores');
    if (!hoja) {
      hoja = libro.insertSheet('Errores');
      hoja.appendRow(['Fecha', 'Error', 'Traza', 'Contexto']);
      hoja.getRange(1, 1, 1, 4).setFontWeight('bold');
    }
    hoja.appendRow([new Date(), String(error), (error && error.stack) || '', String(contexto).slice(0, 4000)]);
  } catch (e) {
    console.error('No se pudo registrar el error:', error, e);
  }
}

/* ========================================================================== */
/*  Correos                                                                   */
/* ========================================================================== */

function enviarVoucher(r) {
  const asunto = 'Reserva confirmada ' + r.code + ' · ' + r.data.title;
  MailApp.sendEmail({
    to: r.data.holder.email,
    subject: asunto,
    htmlBody: htmlVoucher(r),
    name: CONFIG.agency.name,
    replyTo: CONFIG.agency.email
  });
}

function avisarAgencia(r) {
  const pax = r.data.passengers.map(function (p, i) {
    return (i + 1) + '. ' + p.name + ' — ' + p.docType + ' ' + p.docNumber +
           ' — ' + p.nationality + ' — nac. ' + p.birth;
  }).join('\n');

  MailApp.sendEmail({
    to: CONFIG.notifyEmail,
    subject: '[Reserva] ' + r.code + ' · ' + r.data.title + ' · ' + r.data.date,
    body: [
      'NUEVA RESERVA PAGADA',
      '',
      'Código:        ' + r.code,
      'Tour:          ' + r.data.title,
      'Fecha:         ' + r.data.date,
      'Viajeros:      ' + r.calc.viajeros,
      '',
      'Total:         USD ' + r.total.toFixed(2),
      'Pagado ahora:  USD ' + r.paidAmount.toFixed(2) + ' (' + r.mode + ')',
      'Saldo:         USD ' + r.balance.toFixed(2),
      '',
      'Contacto:      ' + r.data.holder.email + ' / ' + r.data.holder.phone,
      'Comentarios:   ' + (r.data.holder.notes || '(ninguno)'),
      '',
      'PASAJEROS',
      pax,
      '',
      'PayPal order:  ' + r.orderId,
      'PayPal capture:' + r.captureId
    ].join('\n')
  });
}

/* ========================================================================== */
/*  Travel voucher                                                            */
/* ========================================================================== */

const NOMBRE_CATEGORIA = { '3e': 'Turista (3*)', '4e': 'Primera (4*)', '5e': 'Lujo (5*)' };

function htmlVoucher(r) {
  const a = CONFIG.agency;
  const d = r.data;
  const fecha = Utilities.formatDate(new Date(d.date + 'T12:00:00'), 'America/Lima', 'dd/MM/yyyy');
  const emitido = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy');

  const filasPax = d.passengers.map(function (p) {
    return '<tr>' +
      td(p.name) + td(p.docType) + td(p.docNumber) + td(p.nationality) + td(p.birth) +
      '</tr>';
  }).join('');

  const saldo = r.balance > 0
    ? '<tr><td style="padding:6px 0;color:#6b7772">Saldo pendiente</td>' +
      '<td style="padding:6px 0;text-align:right;font-weight:600">USD ' + r.balance.toFixed(2) + '</td></tr>'
    : '';

  const logo = CONFIG.logoUrl
    ? '<img src="' + CONFIG.logoUrl + '" alt="' + a.name + '" style="height:40px;margin-bottom:14px">'
    : '<div style="font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:.12em;' +
      'font-size:15px;font-weight:bold;color:#0a3d2c;margin-bottom:14px">Latam Expeditions</div>';

  return '' +
  '<div style="font-family:Arial,Helvetica,sans-serif;max-width:660px;margin:0 auto;color:#121a16;font-size:14px;line-height:1.6">' +
    '<div style="border:1px solid #e8ebe9;border-radius:10px;overflow:hidden">' +

      '<div style="padding:26px 28px;border-bottom:1px solid #f1f3f2">' +
        logo +
        '<div style="color:#6b7772;font-size:12.5px">' +
          a.web + ' · ' + a.phone + ' · ' + a.email +
        '</div>' +
      '</div>' +

      '<div style="padding:26px 28px;background:#fafaf8;border-bottom:1px solid #f1f3f2">' +
        '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b7772;margin-bottom:6px">Travel voucher</div>' +
        '<div style="font-size:24px;font-weight:bold;letter-spacing:.06em;color:#0a3d2c">' + r.code + '</div>' +
        '<div style="color:#6b7772;font-size:12.5px;margin-top:6px">Emitido el ' + emitido + '</div>' +
      '</div>' +

      '<div style="padding:26px 28px">' +
        '<h2 style="margin:0 0 18px;font-size:17px;color:#121a16">' + escaparHtml(d.title) + '</h2>' +
        '<table style="width:100%;border-collapse:collapse;font-size:13.5px">' +
          fila('Fecha del servicio', fecha) +
          fila('Titular de la reserva', escaparHtml(d.passengers[0].name)) +
          fila('Cantidad de pasajeros', String(r.calc.viajeros)) +
          (d.tier ? fila('Categoría de hotel', escaparHtml(NOMBRE_CATEGORIA[d.tier] || d.tier)) : '') +
          fila('Idioma', 'Español') +
          fila('Contacto', escaparHtml(d.holder.phone)) +
        '</table>' +
      '</div>' +

      '<div style="padding:0 28px 26px">' +
        '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b7772;margin-bottom:10px">Pasajeros de la reserva</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12.5px">' +
          '<tr style="background:#fafaf8">' +
            th('Nombre completo') + th('Tipo doc.') + th('Nro. documento') + th('Nacionalidad') + th('F. nacimiento') +
          '</tr>' + filasPax +
        '</table>' +
      '</div>' +

      '<div style="padding:0 28px 26px">' +
        '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b7772;margin-bottom:10px">Detalle de pago</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:13.5px">' +
          '<tr><td style="padding:6px 0;color:#6b7772">Total del servicio</td>' +
            '<td style="padding:6px 0;text-align:right">USD ' + r.total.toFixed(2) + '</td></tr>' +
          '<tr><td style="padding:6px 0;color:#6b7772">Pagado por PayPal</td>' +
            '<td style="padding:6px 0;text-align:right;font-weight:600;color:#0a3d2c">USD ' + r.paidAmount.toFixed(2) + '</td></tr>' +
          saldo +
        '</table>' +
      '</div>' +

      '<div style="padding:0 28px 26px">' +
        '<div style="border:1px solid #e8ebe9;border-radius:8px;padding:16px 18px;font-size:12.5px;color:#6b7772;line-height:1.65">' +
          '<strong style="color:#121a16;display:block;margin-bottom:6px">Antes de tu viaje</strong>' +
          'Preséntate en el punto de encuentro con 15 minutos de antelación y lleva el documento original ' +
          'con el que hiciste la reserva. Varios ingresos se emiten a nombre del pasajero y no admiten cambios.<br><br>' +
          '<strong style="color:#121a16;display:block;margin-bottom:6px">Cancelación</strong>' +
          'Gratuita hasta 24 horas antes del inicio del servicio. Con menos de 24 horas o en caso de ' +
          'no presentarte, el importe no es reembolsable.' +
        '</div>' +
      '</div>' +

      '<div style="padding:22px 28px;background:#0a3d2c;color:#ffffff">' +
        '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:8px">Asistencia durante el viaje</div>' +
        '<div style="font-weight:bold">' + a.agent + '</div>' +
        '<div style="opacity:.85;font-size:13px">' + a.phone + ' · WhatsApp disponible 24/7</div>' +
      '</div>' +

    '</div>' +
    '<div style="text-align:center;color:#6b7772;font-size:11.5px;margin:16px 0">' +
      'Este voucher es tu comprobante de reserva. Consérvalo hasta finalizar el servicio.' +
    '</div>' +
  '</div>';
}

function fila(k, v) {
  return '<tr><td style="padding:7px 0;color:#6b7772;width:190px">' + k + '</td>' +
         '<td style="padding:7px 0;font-weight:600">' + v + '</td></tr>';
}
function th(t) {
  return '<th style="text-align:left;padding:9px 8px;border-bottom:1px solid #e8ebe9;' +
         'font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7772">' + t + '</th>';
}
function td(t) {
  return '<td style="padding:9px 8px;border-bottom:1px solid #f1f3f2">' + escaparHtml(t || '—') + '</td>';
}
function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ========================================================================== */
/*  Comprobación de instalación                                               */
/* ========================================================================== */

/**
 * Ejecuta esta función desde el editor antes de aceptar pagos reales.
 * Comprueba propiedades, acceso a la hoja, credenciales de PayPal y el
 * cálculo del depósito, sin cobrar nada.
 */
function pruebaDeInstalacion() {
  const lineas = [];
  const ok = function (t) { lineas.push('  OK   ' + t); };
  const mal = function (t) { lineas.push('  FALLA ' + t); };

  ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_ENV', 'SHEET_ID', 'GOOGLE_CLIENT_ID'].forEach(function (k) {
    PROPS.getProperty(k) ? ok('Propiedad ' + k) : mal('Falta la propiedad ' + k);
  });

  try {
    hojaReservas();
    hojaOrdenesPayPal();
    hojaUsuarios();
    hojaSesiones();
    ok('Acceso a Reservas, Ordenes PayPal, Usuarios y Sesiones');
  } catch (e) { mal('Hoja de cálculo: ' + e.message); }

  try {
    tokenPayPal();
    ok('Credenciales de PayPal (' + CONFIG.env + ')');
  } catch (e) { mal('PayPal: ' + e.message); }

  const googleId = PROPS.getProperty('GOOGLE_CLIENT_ID') || '';
  if (googleId && googleId.indexOf('.apps.googleusercontent.com') > -1) {
    ok('Formato de GOOGLE_CLIENT_ID');
  } else {
    mal('GOOGLE_CLIENT_ID no tiene el formato esperado');
  }

  lineas.push('');
  lineas.push('  Cálculo del cobro:');
  [25, 60, 75, 190, 340, 790, 3200].forEach(function (t) {
    const c = calcularCobro(t);
    lineas.push('    Total USD ' + t + '  ->  cobra USD ' + c.due + '  (' + c.mode + ')');
  });

  lineas.push('');
  lineas.push('  Productos con precio cargado: ' + Object.keys(PRECIOS).length);
  if (['sandbox', 'live'].indexOf(CONFIG.env) === -1) {
    mal('PAYPAL_ENV debe ser sandbox o live');
  }
  if (CONFIG.env !== 'live') {
    lineas.push('');
    lineas.push('  AVISO: estás en SANDBOX. Cambia PAYPAL_ENV a "live" para cobrar de verdad.');
  }

  const informe = 'COMPROBACIÓN DE INSTALACIÓN\n\n' + lineas.join('\n');
  console.log(informe);
  return informe;
}
