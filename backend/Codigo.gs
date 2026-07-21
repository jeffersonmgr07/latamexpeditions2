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
 *    → Añadir propiedad, y crea estas cuatro:
 *
 *       PAYPAL_CLIENT_ID      Tu Client ID
 *       PAYPAL_SECRET         Tu Secret          ← nunca lo pongas en el código
 *       PAYPAL_ENV            sandbox  (luego lo cambias a: live)
 *       SHEET_ID              El ID del paso 1
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
    web: 'www.latamexpeditions.com',
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
  // Perú
  'machu-picchu-full-day': 340.00,
  'valle-sagrado-clasico': 55.00,
  'montana-colores': 45.00,
  'lima-gastronomica': 75.00,
  'islas-ballestas-paracas': 40.00,
  // Colombia
  'cartagena-centro-getsemani': 25.00,
  'islas-rosario-baru': 65.00,
  'guatape-piedra-penol': 45.00,
  'comuna-13-medellin': 30.00,
  // Argentina
  'buenos-aires-city-tango': 110.00,
  'cataratas-iguazu-argentina': 70.00,
  'perito-moreno-calafate': 95.00,
  'mendoza-vinos': 90.00,
  // Ecuador
  'galapagos-4d-isla-santa-cruz': 790.00,
  'quito-mitad-del-mundo': 55.00,
  'cotopaxi-quilotoa': 70.00,
  // Brasil
  'rio-cristo-pan-de-azucar': 95.00,
  'favela-rocinha': 40.00,
  'iguazu-lado-brasileno': 65.00,
  // Bolivia
  'uyuni-3-dias': 230.00,
  'uyuni-full-day': 60.00,
  'la-paz-teleferico-luna': 45.00,
  // Chile
  'atacama-valle-luna': 75.00,
  'geiseres-tatio': 55.00,
  'torres-del-paine-full-day': 120.00,
  // México
  'chichen-itza-cenote': 95.00,
  'tulum-cenotes': 75.00,
  'xcaret-parque': 190.00,
  // Paquetes
  'peru-4d3n': 589.90
};

/* ========================================================================== */
/*  Punto de entrada HTTP                                                     */
/* ========================================================================== */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'createOrder') return json({ ok: true, orderId: crearOrden(body.data) });
    if (action === 'captureOrder') return json(capturarOrden(body.data));
    if (action === 'ping') return json({ ok: true, env: CONFIG.env, hora: new Date().toISOString() });

    return json({ ok: false, error: 'Acción no reconocida: ' + action });
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
  const publicos = ['Producto no disponible', 'El importe no coincide', 'Faltan datos',
                    'Demasiados viajeros', 'Fecha demasiado próxima', 'Fecha inválida'];
  return publicos.some(function (p) { return msg.indexOf(p) === 0; })
    ? msg
    : 'No hemos podido procesar la reserva. Escríbenos por WhatsApp y la cerramos contigo.';
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

/**
 * Recalcula el importe desde cero y comprueba que coincide con lo cotizado.
 * Aquí es donde se bloquea la manipulación de precios en el navegador.
 */
function validarYCalcular(data) {
  if (!data || !data.slug) throw new Error('Faltan datos de la reserva.');

  const precio = PRECIOS[data.slug];
  if (typeof precio !== 'number') throw new Error('Producto no disponible.');

  const viajeros = parseInt(data.travelers, 10);
  if (!(viajeros >= 1 && viajeros <= CONFIG.maxTravelers)) throw new Error('Demasiados viajeros.');

  if (!data.holder || !esCorreo(data.holder.email)) throw new Error('Faltan datos de contacto válidos.');
  if (!Array.isArray(data.passengers) || data.passengers.length !== viajeros) {
    throw new Error('Faltan datos de los pasajeros.');
  }
  for (let i = 0; i < data.passengers.length; i++) {
    const p = data.passengers[i];
    if (!p.name || !p.docNumber) throw new Error('Faltan datos de los pasajeros.');
  }

  const fecha = new Date(data.date + 'T00:00:00');
  if (isNaN(fecha.getTime())) throw new Error('Fecha inválida.');
  const limite = new Date();
  limite.setDate(limite.getDate() + CONFIG.minLeadDays);
  limite.setHours(0, 0, 0, 0);
  if (fecha < limite) throw new Error('Fecha demasiado próxima.');

  const total = redondear2(precio * viajeros);
  const cobro = calcularCobro(total);

  // Tolerancia de un céntimo por el redondeo de coma flotante del navegador.
  if (data.quotedDue !== undefined && Math.abs(Number(data.quotedDue) - cobro.due) > 0.01) {
    throw new Error('El importe no coincide. Recarga la página e inténtalo de nuevo.');
  }

  return { precio: precio, viajeros: viajeros, total: total, due: cobro.due, mode: cobro.mode, fecha: fecha };
}

function esCorreo(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/* ========================================================================== */
/*  PayPal                                                                    */
/* ========================================================================== */

function tokenPayPal() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('paypal_token');
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

  const body = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200) {
    throw new Error('PayPal rechazó las credenciales: ' + (body.error_description || ''));
  }

  // Se cachea algo menos de lo que dura, para no apurar el vencimiento.
  cache.put('paypal_token', body.access_token, Math.max(60, body.expires_in - 120));
  return body.access_token;
}

function crearOrden(data) {
  const c = validarYCalcular(data);

  const descripcion = (c.mode === 'completo' ? 'Pago total' : 'Depósito de reserva') +
    ' · ' + String(data.title || data.slug).slice(0, 60);

  const response = UrlFetchApp.fetch(CONFIG.apiBase + '/v2/checkout/orders', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + tokenPayPal() },
    payload: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: CONFIG.currency, value: c.due.toFixed(2) },
        description: descripcion,
        custom_id: data.slug,
        soft_descriptor: 'LATAMEXPED'
      }],
      application_context: {
        brand_name: CONFIG.agency.name,
        locale: 'es-ES',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW'
      }
    }),
    muteHttpExceptions: true
  });

  const body = JSON.parse(response.getContentText());
  if (response.getResponseCode() >= 300) {
    registrarError(new Error('Fallo al crear orden'), response.getContentText());
    throw new Error('No se pudo iniciar el pago.');
  }
  return body.id;
}

function capturarOrden(payload) {
  const orderId = payload.orderId;
  const data = payload.booking;
  const c = validarYCalcular(data);

  const response = UrlFetchApp.fetch(CONFIG.apiBase + '/v2/checkout/orders/' + orderId + '/capture', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + tokenPayPal() },
    payload: '{}',
    muteHttpExceptions: true
  });

  const body = JSON.parse(response.getContentText());
  if (response.getResponseCode() >= 300 || body.status !== 'COMPLETED') {
    registrarError(new Error('Captura no completada'), response.getContentText());
    throw new Error('El pago no se completó. No se ha realizado ningún cargo.');
  }

  // Comprobación final: lo que PayPal dice haber cobrado debe ser lo que
  // nosotros calculamos. Si no coincide, se registra para revisión manual.
  const captura = body.purchase_units[0].payments.captures[0];
  const cobrado = parseFloat(captura.amount.value);
  if (Math.abs(cobrado - c.due) > 0.01) {
    registrarError(new Error('Importe capturado distinto al calculado'),
      'esperado=' + c.due + ' cobrado=' + cobrado + ' orden=' + orderId);
  }

  const codigo = generarCodigo(data.slug);
  const reserva = {
    code: codigo,
    orderId: orderId,
    captureId: captura.id,
    paidAmount: cobrado,
    total: c.total,
    balance: redondear2(c.total - cobrado),
    mode: c.mode,
    payerEmail: (body.payer && body.payer.email_address) || '',
    data: data,
    calc: c
  };

  // Si algo falla al guardar o enviar, el pago ya está hecho: nunca se lanza
  // una excepción a partir de aquí, se registra y se sigue.
  try { guardarEnHoja(reserva); } catch (err) { registrarError(err, 'guardarEnHoja'); }
  try { enviarVoucher(reserva); } catch (err) { registrarError(err, 'enviarVoucher'); }
  try { avisarAgencia(reserva); } catch (err) { registrarError(err, 'avisarAgencia'); }

  return { ok: true, bookingCode: codigo, paid: cobrado, balance: reserva.balance };
}

/* ========================================================================== */
/*  Código de reserva                                                         */
/* ========================================================================== */

/** Formato LTX-AAMMDD-XXXX, con sufijo aleatorio para que no sea adivinable. */
function generarCodigo() {
  const hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyMMdd');
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1
  let sufijo = '';
  for (let i = 0; i < 4; i++) {
    sufijo += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
  }
  return 'LTX-' + hoy + '-' + sufijo;
}

/* ========================================================================== */
/*  Hoja de cálculo                                                           */
/* ========================================================================== */

const CABECERAS = ['Fecha registro', 'Código', 'Estado', 'Tour', 'Slug', 'Fecha del tour',
  'Viajeros', 'Precio unitario', 'Total', 'Pagado', 'Saldo', 'Modo',
  'Email titular', 'Teléfono', 'Comentarios', 'Pasajeros',
  'Order ID PayPal', 'Capture ID', 'Email pagador'];

function hojaReservas() {
  const libro = SpreadsheetApp.openById(CONFIG.sheetId);
  let hoja = libro.getSheetByName('Reservas');
  if (!hoja) {
    hoja = libro.insertSheet('Reservas');
    hoja.appendRow(CABECERAS);
    hoja.getRange(1, 1, 1, CABECERAS.length).setFontWeight('bold').setBackground('#0a3d2c').setFontColor('#ffffff');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function guardarEnHoja(r) {
  const pax = r.data.passengers.map(function (p) {
    return p.name + ' (' + p.docType + ' ' + p.docNumber + ', ' + p.nationality + ', nac. ' + p.birth + ')';
  }).join(' | ');

  hojaReservas().appendRow([
    new Date(), r.code, 'PAGADA', r.data.title, r.data.slug, r.data.date,
    r.calc.viajeros, r.calc.precio, r.total, r.paidAmount, r.balance, r.mode,
    r.data.holder.email, r.data.holder.phone, r.data.holder.notes || '', pax,
    r.orderId, r.captureId, r.payerEmail
  ]);
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

  ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_ENV', 'SHEET_ID'].forEach(function (k) {
    PROPS.getProperty(k) ? ok('Propiedad ' + k) : mal('Falta la propiedad ' + k);
  });

  try {
    hojaReservas();
    ok('Acceso a la hoja de reservas');
  } catch (e) { mal('Hoja de cálculo: ' + e.message); }

  try {
    tokenPayPal();
    ok('Credenciales de PayPal (' + CONFIG.env + ')');
  } catch (e) { mal('PayPal: ' + e.message); }

  lineas.push('');
  lineas.push('  Cálculo del cobro:');
  [25, 60, 75, 190, 340, 790, 3200].forEach(function (t) {
    const c = calcularCobro(t);
    lineas.push('    Total USD ' + t + '  ->  cobra USD ' + c.due + '  (' + c.mode + ')');
  });

  lineas.push('');
  lineas.push('  Productos con precio cargado: ' + Object.keys(PRECIOS).length);
  if (CONFIG.env !== 'live') {
    lineas.push('');
    lineas.push('  AVISO: estás en SANDBOX. Cambia PAYPAL_ENV a "live" para cobrar de verdad.');
  }

  const informe = 'COMPROBACIÓN DE INSTALACIÓN\n\n' + lineas.join('\n');
  console.log(informe);
  return informe;
}
