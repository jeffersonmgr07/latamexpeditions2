/**
 * Latam Expeditions — cuentas, Google Sign-In y consulta de reservas
 * ==================================================================
 *
 * Este archivo pertenece al mismo proyecto de Apps Script que Codigo.gs.
 * Usa la misma hoja de cálculo, las mismas propiedades y el mismo doPost.
 *
 * Incluye:
 *   · Registro e inicio de sesión con correo y contraseña.
 *   · Inicio de sesión con Google Identity Services.
 *   · Sesiones de 30 días con el token almacenado como hash en Sheets.
 *   · Área "Mis viajes" vinculada al correo de la reserva.
 *   · Consulta pública por código + apellido y reenvío de voucher.
 *
 * Propiedad adicional obligatoria para Google:
 *   GOOGLE_CLIENT_ID = xxx.apps.googleusercontent.com
 */

/* ========================================================================== */
/*  Configuración                                                             */
/* ========================================================================== */

const AUTH = {
  versionHash: 'v2',
  iteraciones: 1200,
  iteracionesLegacy: 1000,
  diasSesion: 30,
  minPassword: 8,
  maxPassword: 128,
  maxIntentos: 5,
  minutosBloqueo: 15,
  minutosNonceGoogle: 10
};

const HOJA_USUARIOS = 'Usuarios';
const HOJA_SESIONES = 'Sesiones';

const CAB_USUARIOS = [
  'Email', 'Nombre', 'Teléfono', 'Hash', 'Salt', 'Fecha registro',
  'Último acceso', 'Estado', 'Intentos', 'Bloqueado hasta',
  'Proveedor', 'Foto', 'Google sub'
];
const CAB_SESIONES = ['Token hash', 'Email', 'Creada', 'Expira', 'Dispositivo'];

/* ========================================================================== */
/*  Acceso y migración de hojas                                               */
/* ========================================================================== */

function hojaCuenta(nombre, cabeceras) {
  const libro = SpreadsheetApp.openById(CONFIG.sheetId);
  let h = libro.getSheetByName(nombre);
  if (!h) {
    h = libro.insertSheet(nombre);
    h.appendRow(cabeceras);
    h.getRange(1, 1, 1, cabeceras.length)
      .setFontWeight('bold').setBackground('#0a3d2c').setFontColor('#ffffff');
    h.setFrozenRows(1);
    return h;
  }

  // Añade las columnas nuevas sin borrar ni mover los datos existentes.
  const ancho = Math.max(h.getLastColumn(), cabeceras.length);
  const actuales = h.getRange(1, 1, 1, ancho).getValues()[0];
  cabeceras.forEach(function (cabecera, i) {
    if (!actuales[i] || (nombre === HOJA_SESIONES && i === 0 && actuales[i] === 'Token')) {
      h.getRange(1, i + 1).setValue(cabecera);
    }
  });
  h.getRange(1, 1, 1, cabeceras.length)
    .setFontWeight('bold').setBackground('#0a3d2c').setFontColor('#ffffff');
  h.setFrozenRows(1);
  return h;
}

function hojaUsuarios() { return hojaCuenta(HOJA_USUARIOS, CAB_USUARIOS); }
function hojaSesiones() { return hojaCuenta(HOJA_SESIONES, CAB_SESIONES); }

function normalizarEmail(valor) {
  return String(valor || '').trim().toLowerCase();
}

function buscarUsuario(email) {
  const h = hojaUsuarios();
  const valores = h.getDataRange().getValues();
  const buscado = normalizarEmail(email);
  for (let i = 1; i < valores.length; i++) {
    if (normalizarEmail(valores[i][0]) === buscado) return filaAUsuario(valores[i], i + 1);
  }
  return null;
}

function buscarUsuarioPorGoogleSub(sub) {
  const buscado = String(sub || '').trim();
  if (!buscado) return null;
  const h = hojaUsuarios();
  const valores = h.getDataRange().getValues();
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][12] || '').trim() === buscado) return filaAUsuario(valores[i], i + 1);
  }
  return null;
}

function filaAUsuario(fila, numeroFila) {
  return {
    fila: numeroFila,
    email: normalizarEmail(fila[0]),
    nombre: String(fila[1] || ''),
    telefono: String(fila[2] || ''),
    hash: String(fila[3] || ''),
    salt: String(fila[4] || ''),
    registro: fila[5],
    ultimoAcceso: fila[6],
    estado: String(fila[7] || 'ACTIVA'),
    intentos: Number(fila[8]) || 0,
    bloqueadoHasta: fila[9],
    proveedor: String(fila[10] || 'password'),
    foto: String(fila[11] || ''),
    googleSub: String(fila[12] || '')
  };
}

function usuarioPublico(usuario) {
  return {
    email: usuario.email,
    name: usuario.nombre,
    phone: usuario.telefono || '',
    picture: usuario.foto || '',
    provider: usuario.proveedor || 'password'
  };
}

/* ========================================================================== */
/*  Contraseñas                                                               */
/* ========================================================================== */

function pepperAuth() {
  let pepper = PROPS.getProperty('AUTH_PEPPER');
  if (!pepper) {
    pepper = generarTokenSeguro();
    PROPS.setProperty('AUTH_PEPPER', pepper);
  }
  return pepper;
}

/** Hash versionado para poder migrar cuentas antiguas sin invalidarlas. */
function derivarHash(password, salt) {
  let valor = String(salt) + '|' + String(password) + '|' + pepperAuth();
  for (let i = 0; i < AUTH.iteraciones; i++) {
    const bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      valor,
      Utilities.Charset.UTF_8
    );
    valor = Utilities.base64Encode(bytes);
  }
  return AUTH.versionHash + '$' + AUTH.iteraciones + '$' + valor;
}

/** Compatibilidad con hashes creados por la versión anterior. */
function derivarHashLegacy(password, salt) {
  let valor = String(salt) + '|' + String(password);
  for (let i = 0; i < AUTH.iteracionesLegacy; i++) {
    const bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      valor,
      Utilities.Charset.UTF_8
    );
    valor = Utilities.base64Encode(bytes);
  }
  return valor;
}

function verificarPassword(password, usuario) {
  if (!usuario.hash || !usuario.salt) return { ok: false, migrar: false };
  if (usuario.hash.indexOf(AUTH.versionHash + '$') === 0) {
    return { ok: igualSeguro(derivarHash(password, usuario.salt), usuario.hash), migrar: false };
  }
  const okLegacy = igualSeguro(derivarHashLegacy(password, usuario.salt), usuario.hash);
  return { ok: okLegacy, migrar: okLegacy };
}

function generarSalt() {
  return Utilities.base64Encode(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + '|' + Date.now() + '|' + Math.random()
    )
  ).slice(0, 24);
}

function generarTokenSeguro() {
  return Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function igualSeguro(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diferencia = 0;
  for (let i = 0; i < x.length; i++) diferencia |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diferencia === 0;
}

function validarPassword(password) {
  if (password.length < AUTH.minPassword) {
    throw new Error('La contraseña debe tener al menos ' + AUTH.minPassword + ' caracteres.');
  }
  if (password.length > AUTH.maxPassword) {
    throw new Error('La contraseña es demasiado larga. Usa como máximo ' + AUTH.maxPassword + ' caracteres.');
  }
}

/* ========================================================================== */
/*  Registro e inicio de sesión                                               */
/* ========================================================================== */

function registrarUsuario(data) {
  data = data || {};
  const email = normalizarEmail(data.email);
  const nombre = textoPlano(data.name, 120);
  const telefono = textoPlano(data.phone, 50);
  const password = String(data.password || '');

  if (!esCorreo(email)) throw new Error('Introduce un correo electrónico válido.');
  if (nombre.length < 3) throw new Error('Indícanos tu nombre completo.');
  validarPassword(password);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (buscarUsuario(email)) {
      throw new Error('Ya existe una cuenta con este correo. Inicia sesión o usa Google.');
    }
    const salt = generarSalt();
    hojaUsuarios().appendRow([
      textoHoja(email), textoHoja(nombre), textoHoja(telefono),
      derivarHash(password, salt), salt,
      new Date(), new Date(), 'ACTIVA', 0, '', 'password', '', ''
    ]);
  } finally {
    lock.releaseLock();
  }

  try { enviarBienvenida(email, nombre); } catch (e) { registrarError(e, 'enviarBienvenida'); }

  const usuario = buscarUsuario(email);
  const token = crearSesion(email, data.device);
  return { ok: true, token: token, user: usuarioPublico(usuario) };
}

function iniciarSesion(data) {
  data = data || {};
  const email = normalizarEmail(data.email);
  const password = String(data.password || '');
  const usuario = buscarUsuario(email);
  const generico = 'Correo o contraseña incorrectos.';

  if (!usuario) throw new Error(generico);
  if (usuario.estado !== 'ACTIVA') throw new Error('Esta cuenta está desactivada. Escríbenos.');
  if (!usuario.hash) {
    throw new Error('Esta cuenta se creó con Google. Pulsa “Continuar con Google” para entrar.');
  }
  if (usuario.bloqueadoHasta && new Date(usuario.bloqueadoHasta) > new Date()) {
    throw new Error('Demasiados intentos fallidos. Vuelve a probar en unos minutos.');
  }

  const comprobacion = verificarPassword(password, usuario);
  if (!comprobacion.ok) {
    registrarIntentoFallido(usuario);
    throw new Error(generico);
  }

  const h = hojaUsuarios();
  h.getRange(usuario.fila, 7).setValue(new Date());
  h.getRange(usuario.fila, 9).setValue(0);
  h.getRange(usuario.fila, 10).setValue('');
  if (comprobacion.migrar) {
    h.getRange(usuario.fila, 4).setValue(derivarHash(password, usuario.salt));
  }

  const actualizado = buscarUsuario(email);
  const token = crearSesion(email, data.device);
  return { ok: true, token: token, user: usuarioPublico(actualizado) };
}

function registrarIntentoFallido(usuario) {
  const h = hojaUsuarios();
  const intentos = usuario.intentos + 1;
  h.getRange(usuario.fila, 9).setValue(intentos);
  if (intentos >= AUTH.maxIntentos) {
    h.getRange(usuario.fila, 10).setValue(
      new Date(Date.now() + AUTH.minutosBloqueo * 60000)
    );
  }
}

/* ========================================================================== */
/*  Sesiones                                                                  */
/* ========================================================================== */

function hashTokenSesion(token) {
  const bytes = Utilities.computeHmacSha256Signature(String(token), pepperAuth());
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function crearSesion(email, dispositivo) {
  const token = generarTokenSeguro();
  const expira = new Date(Date.now() + AUTH.diasSesion * 86400000);
  hojaSesiones().appendRow([
    hashTokenSesion(token), normalizarEmail(email), new Date(), expira,
    textoHoja(textoPlano(dispositivo, 180))
  ]);
  return token;
}

function buscarSesion(token) {
  if (!token) throw new Error('Sesión no iniciada.');
  const h = hojaSesiones();
  const valores = h.getDataRange().getValues();
  const tokenHash = hashTokenSesion(token);

  for (let i = 1; i < valores.length; i++) {
    const guardado = String(valores[i][0] || '');
    const coincideHash = igualSeguro(guardado, tokenHash);
    const coincideLegacy = !coincideHash && igualSeguro(guardado, token);
    if (!coincideHash && !coincideLegacy) continue;

    if (new Date(valores[i][3]) < new Date()) {
      h.deleteRow(i + 1);
      throw new Error('Tu sesión ha caducado. Vuelve a entrar.');
    }

    // Migra sesiones antiguas que guardaban el token en claro.
    if (coincideLegacy) h.getRange(i + 1, 1).setValue(tokenHash);
    return { fila: i + 1, email: normalizarEmail(valores[i][1]) };
  }
  throw new Error('Sesión no válida. Vuelve a entrar.');
}

function emailDeSesion(token) {
  return buscarSesion(token).email;
}

function cerrarSesion(data) {
  const token = data && data.token;
  if (!token) return { ok: true };
  const h = hojaSesiones();
  const valores = h.getDataRange().getValues();
  const tokenHash = hashTokenSesion(token);
  for (let i = valores.length - 1; i >= 1; i--) {
    const guardado = String(valores[i][0] || '');
    if (igualSeguro(guardado, tokenHash) || igualSeguro(guardado, token)) {
      h.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

function limpiarSesiones() {
  const h = hojaSesiones();
  const valores = h.getDataRange().getValues();
  const ahora = new Date();
  let borradas = 0;
  for (let i = valores.length - 1; i >= 1; i--) {
    if (new Date(valores[i][3]) < ahora) {
      h.deleteRow(i + 1);
      borradas++;
    }
  }
  console.log('Sesiones caducadas eliminadas: ' + borradas);
  return borradas;
}

/* ========================================================================== */
/*  Google Identity Services                                                 */
/* ========================================================================== */

function crearNonceGoogle() {
  const nonce = generarTokenSeguro();
  CacheService.getScriptCache().put(
    'google_nonce_' + hashTokenSesion(nonce),
    '1',
    AUTH.minutosNonceGoogle * 60
  );
  return nonce;
}

function consumirNonceGoogle(nonce) {
  const limpio = String(nonce || '').trim();
  if (!limpio) throw new Error('La verificación de Google ha caducado. Recarga la página.');
  const cache = CacheService.getScriptCache();
  const key = 'google_nonce_' + hashTokenSesion(limpio);
  if (cache.get(key) !== '1') {
    throw new Error('La verificación de Google ha caducado. Recarga la página.');
  }
  cache.remove(key);
  return limpio;
}

function entrarConGoogle(data) {
  data = data || {};
  const clientId = PROPS.getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw new Error('El acceso con Google no está configurado.');

  const credential = String(data.credential || '');
  if (!credential) throw new Error('No hemos recibido la credencial de Google.');
  const nonce = consumirNonceGoogle(data.nonce);
  const perfil = verificarTokenGoogle(credential, clientId, nonce);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let usuario;
  try {
    usuario = buscarUsuarioPorGoogleSub(perfil.sub);

    if (!usuario) {
      usuario = buscarUsuario(perfil.email);
      if (usuario && usuario.hash && !correoGoogleAutoritativo(perfil)) {
        throw new Error('Para vincular este correo con Google, entra primero con tu contraseña.');
      }
    }

    const h = hojaUsuarios();
    if (!usuario) {
      hojaUsuarios().appendRow([
        textoHoja(perfil.email), textoHoja(perfil.name || perfil.email.split('@')[0]), '',
        '', '', new Date(), new Date(), 'ACTIVA', 0, '',
        'google', textoHoja(perfil.picture || ''), textoHoja(perfil.sub)
      ]);
      usuario = buscarUsuarioPorGoogleSub(perfil.sub);
      try {
        enviarBienvenida(usuario.email, usuario.nombre);
      } catch (e) {
        registrarError(e, 'bienvenida google');
      }
    } else {
      if (usuario.estado !== 'ACTIVA') throw new Error('Esta cuenta está desactivada. Escríbenos.');
      h.getRange(usuario.fila, 7).setValue(new Date());
      h.getRange(usuario.fila, 9).setValue(0);
      h.getRange(usuario.fila, 10).setValue('');
      if (perfil.name && !usuario.nombre) h.getRange(usuario.fila, 2).setValue(textoHoja(perfil.name));
      if (perfil.picture) h.getRange(usuario.fila, 12).setValue(textoHoja(perfil.picture));
      h.getRange(usuario.fila, 13).setValue(textoHoja(perfil.sub));
      h.getRange(usuario.fila, 11).setValue(usuario.hash ? 'password+google' : 'google');
      usuario = buscarUsuarioPorGoogleSub(perfil.sub);
    }
  } finally {
    lock.releaseLock();
  }

  const token = crearSesion(usuario.email, data.device);
  return { ok: true, token: token, user: usuarioPublico(usuario) };
}

function verificarTokenGoogle(credential, clientId, nonceEsperado) {
  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential),
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error('La sesión de Google no es válida. Vuelve a intentarlo.');
  }

  let p;
  try { p = JSON.parse(response.getContentText()); }
  catch (e) { throw new Error('La sesión de Google no es válida. Vuelve a intentarlo.'); }

  if (String(p.aud || '') !== clientId || (p.azp && String(p.azp) !== clientId)) {
    registrarError(
      new Error('Token de Google con audiencia incorrecta'),
      'aud=' + p.aud + ' azp=' + p.azp
    );
    throw new Error('La sesión de Google no es válida. Vuelve a intentarlo.');
  }
  if (p.iss !== 'accounts.google.com' && p.iss !== 'https://accounts.google.com') {
    throw new Error('La sesión de Google no es válida. Vuelve a intentarlo.');
  }
  if (Number(p.exp || 0) * 1000 <= Date.now()) {
    throw new Error('La sesión de Google ha caducado. Vuelve a intentarlo.');
  }
  if (String(p.email_verified) !== 'true') {
    throw new Error('Tu correo de Google no está verificado.');
  }
  if (!p.sub || !esCorreo(normalizarEmail(p.email))) {
    throw new Error('Google no nos ha devuelto una identidad válida.');
  }
  if (!p.nonce || !igualSeguro(String(p.nonce), String(nonceEsperado))) {
    throw new Error('La verificación de Google ha caducado. Recarga la página.');
  }

  return {
    sub: String(p.sub),
    email: normalizarEmail(p.email),
    name: textoPlano(p.name || '', 120),
    picture: String(p.picture || '').slice(0, 1000),
    hd: String(p.hd || '')
  };
}

/** Gmail y cuentas de Workspace son autoritativas para la dirección indicada. */
function correoGoogleAutoritativo(perfil) {
  return /@gmail\.com$/i.test(perfil.email) || Boolean(perfil.hd);
}

/* ========================================================================== */
/*  Reservas del usuario                                                      */
/* ========================================================================== */

const COL = {
  registro: 0, codigo: 1, estado: 2, tour: 3, slug: 4, categoria: 5, fecha: 6,
  viajeros: 7, unitario: 8, total: 9, pagado: 10, saldo: 11, modo: 12,
  email: 13, telefono: 14, comentarios: 15, pasajeros: 16
};

function filaAReserva(fila) {
  const fechaTour = fila[COL.fecha];
  return {
    code: String(fila[COL.codigo] || ''),
    status: String(fila[COL.estado] || ''),
    title: String(fila[COL.tour] || ''),
    slug: String(fila[COL.slug] || ''),
    tier: String(fila[COL.categoria] || ''),
    date: fechaTour instanceof Date
      ? Utilities.formatDate(fechaTour, 'America/Lima', 'yyyy-MM-dd')
      : String(fechaTour || ''),
    travelers: Number(fila[COL.viajeros]) || 0,
    total: Number(fila[COL.total]) || 0,
    paid: Number(fila[COL.pagado]) || 0,
    balance: Number(fila[COL.saldo]) || 0,
    passengers: String(fila[COL.pasajeros] || '')
  };
}

function clasificarReservas(reservas) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const proximos = [];
  const pasados = [];
  reservas.forEach(function (r) {
    const fecha = new Date(r.date + 'T00:00:00');
    (isNaN(fecha.getTime()) || fecha >= hoy ? proximos : pasados).push(r);
  });
  proximos.sort(function (a, b) { return a.date.localeCompare(b.date); });
  pasados.sort(function (a, b) { return b.date.localeCompare(a.date); });
  return { upcoming: proximos, past: pasados };
}

function misViajes(data) {
  const email = emailDeSesion(data && data.token);
  const usuario = buscarUsuario(email);
  const valores = hojaReservas().getDataRange().getValues();
  const mias = [];

  for (let i = 1; i < valores.length; i++) {
    if (normalizarEmail(valores[i][COL.email]) === email) mias.push(filaAReserva(valores[i]));
  }

  const clasificadas = clasificarReservas(mias);
  return {
    ok: true,
    user: usuario ? usuarioPublico(usuario) : { email: email, name: '', phone: '', picture: '', provider: '' },
    upcoming: clasificadas.upcoming,
    past: clasificadas.past
  };
}

/* ========================================================================== */
/*  Consulta pública de reserva                                               */
/* ========================================================================== */

function normalizarNombre(valor) {
  return String(valor || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function apellidoCoincide(nombreCompleto, apellidoIngresado) {
  const partesNombre = normalizarNombre(nombreCompleto).split(' ').filter(Boolean);
  const partesApellido = normalizarNombre(apellidoIngresado).split(' ').filter(Boolean);
  if (!partesApellido.length) return false;
  return partesApellido.every(function (parte) { return partesNombre.indexOf(parte) !== -1; });
}

function buscarReservaPublica(codigo, apellido) {
  const valores = hojaReservas().getDataRange().getValues();
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][COL.codigo] || '').trim().toUpperCase() !== codigo) continue;

    const pasajeros = String(valores[i][COL.pasajeros] || '');
    const titular = pasajeros.split('|')[0].split('(')[0].trim();
    if (!apellidoCoincide(titular, apellido)) {
      throw new Error('El apellido no coincide con esta reserva. Revisa los datos.');
    }
    return { fila: valores[i], titular: titular, pasajeros: pasajeros };
  }
  throw new Error('No encontramos ninguna reserva con ese código.');
}

function consultarReserva(data) {
  const codigo = String(data && data.code || '').trim().toUpperCase();
  const apellido = textoPlano(data && data.lastName, 80);
  if (!codigo || !apellido) {
    throw new Error('Necesitamos el código de reserva y el apellido del titular.');
  }

  const encontrada = buscarReservaPublica(codigo, apellido);
  const r = filaAReserva(encontrada.fila);
  r.holderName = encontrada.titular;
  r.passengerList = encontrada.pasajeros.split('|').map(function (p) { return p.trim(); }).filter(Boolean);
  return { ok: true, booking: r };
}

function reenviarVoucher(data) {
  const codigo = String(data && data.code || '').trim().toUpperCase();
  const apellido = textoPlano(data && data.lastName, 80);
  if (!codigo || !apellido) {
    throw new Error('Necesitamos el código de reserva y el apellido del titular.');
  }

  const encontrada = buscarReservaPublica(codigo, apellido);
  const fila = encontrada.fila;
  const destino = normalizarEmail(fila[COL.email]);
  if (!esCorreo(destino)) throw new Error('No encontramos un correo válido para esta reserva.');

  MailApp.sendEmail({
    to: destino,
    subject: 'Tu reserva ' + codigo + ' · ' + fila[COL.tour],
    htmlBody:
      '<p>Hola,</p><p>Aquí tienes de nuevo el detalle de tu reserva <strong>' +
      escaparHtml(codigo) + '</strong> para <strong>' + escaparHtml(fila[COL.tour]) +
      '</strong> del ' + escaparHtml(fila[COL.fecha]) + '.</p>' +
      '<p>Si necesitas ayuda, responde a este correo o escríbenos por WhatsApp al ' +
      escaparHtml(CONFIG.agency.phone) + '.</p><p>' + escaparHtml(CONFIG.agency.name) + '</p>',
    name: CONFIG.agency.name,
    replyTo: CONFIG.agency.email
  });
  return { ok: true, sentTo: enmascararCorreo(destino) };
}

function enmascararCorreo(email) {
  const partes = String(email).split('@');
  if (partes.length !== 2) return '···';
  return partes[0].slice(0, 2) + '···@' + partes[1];
}

/* ========================================================================== */
/*  Correo de bienvenida                                                      */
/* ========================================================================== */

function enviarBienvenida(email, nombre) {
  MailApp.sendEmail({
    to: email,
    subject: 'Bienvenido a ' + CONFIG.agency.name,
    htmlBody:
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#121a16;line-height:1.6">' +
        '<div style="text-transform:uppercase;letter-spacing:.12em;font-size:14px;font-weight:bold;color:#0a3d2c;margin-bottom:20px">' +
          'Latam Expeditions</div>' +
        '<h1 style="font-size:21px;margin:0 0 14px">Hola, ' + escaparHtml(nombre) + '</h1>' +
        '<p style="color:#6b7772">Tu cuenta está lista. Desde tu perfil puedes consultar tus viajes reservados y su historial.</p>' +
        '<p style="margin-top:24px"><a href="' + CONFIG.agency.web + '/mis-viajes.html" ' +
        'style="background:#f2b705;color:#1a1400;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Ver mis viajes</a></p>' +
        '<p style="color:#6b7772;font-size:13px;margin-top:28px">Si no has creado esta cuenta, escríbenos a ' +
        escaparHtml(CONFIG.agency.email) + '.</p>' +
      '</div>',
    name: CONFIG.agency.name,
    replyTo: CONFIG.agency.email
  });
}

/* ========================================================================== */
/*  Comprobaciones                                                            */
/* ========================================================================== */

function pruebaDeCuentas() {
  const lineas = [];
  try {
    hojaUsuarios();
    hojaSesiones();
    lineas.push('  OK    Hojas Usuarios y Sesiones');
  } catch (e) {
    lineas.push('  FALLA Hojas: ' + e.message);
  }

  try {
    const salt = generarSalt();
    const hash = derivarHash('contrasena-de-prueba', salt);
    lineas.push(igualSeguro(derivarHash('contrasena-de-prueba', salt), hash)
      ? '  OK    Hash de contraseña'
      : '  FALLA Hash de contraseña');
    lineas.push(!igualSeguro(derivarHash('otra-clave', salt), hash)
      ? '  OK    Contraseña incorrecta rechazada'
      : '  FALLA Contraseña incorrecta aceptada');
  } catch (e) {
    lineas.push('  FALLA Hash: ' + e.message);
  }

  try {
    const token = generarTokenSeguro();
    lineas.push(hashTokenSesion(token) !== token
      ? '  OK    Tokens de sesión se almacenan como hash'
      : '  FALLA Token sin proteger');
  } catch (e) {
    lineas.push('  FALLA Sesiones: ' + e.message);
  }

  const informe = 'COMPROBACIÓN DE CUENTAS\n\n' + lineas.join('\n');
  console.log(informe);
  return informe;
}

function pruebaDeGoogle() {
  const id = PROPS.getProperty('GOOGLE_CLIENT_ID');
  const lineas = [];
  if (!id) {
    lineas.push('  FALTA GOOGLE_CLIENT_ID en Propiedades del script.');
  } else {
    lineas.push('  OK    GOOGLE_CLIENT_ID configurado');
    lineas.push(id.indexOf('.apps.googleusercontent.com') > -1
      ? '  OK    Formato de Client ID válido'
      : '  AVISO Revisa el formato del Client ID');
  }

  try {
    const r = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=invalido',
      { muteHttpExceptions: true }
    );
    lineas.push(r.getResponseCode() !== 200
      ? '  OK    Google rechaza tokens inválidos'
      : '  FALLA Token inválido aceptado');
  } catch (e) {
    lineas.push('  FALLA Conexión con Google: ' + e.message);
  }

  const informe = 'COMPROBACIÓN DE GOOGLE SIGN-IN\n\n' + lineas.join('\n');
  console.log(informe);
  return informe;
}
