/**
 * Latam Expeditions — cuentas, sesiones y consulta de reservas
 * ===========================================================
 *
 * Segundo archivo del mismo proyecto de Apps Script. Pégalo junto a Codigo.gs,
 * en el mismo proyecto: comparten CONFIG, la hoja de cálculo y doPost.
 *
 * Qué añade:
 *   · Registro y login con correo y contraseña
 *   · Sesiones con token que caduca a los 30 días
 *   · "Mis viajes": reservas futuras y pasadas del usuario
 *   · "Mi reserva": consulta pública por código + apellido, sin cuenta
 *
 * ---------------------------------------------------------------------------
 * HONESTIDAD SOBRE LA SEGURIDAD
 * ---------------------------------------------------------------------------
 * Este sistema es razonable para lo que hace: que alguien vea SUS PROPIAS
 * reservas. Guarda las contraseñas cifradas con salt y 1.000 iteraciones de
 * SHA-256, nunca en claro, y los tokens de sesión caducan.
 *
 * Lo que NO es: un sistema bancario. Apps Script no ofrece rate limiting real,
 * y una hoja de cálculo no es una base de datos con control de concurrencia.
 * Si algún día guardas datos de pago o documentos escaneados, migra a un
 * proveedor de identidad de verdad (Firebase Auth, Auth0, Supabase).
 *
 * Recomendación práctica: añade "Entrar con Google" cuando puedas. Es más
 * seguro, más cómodo y te quita el problema de gestionar contraseñas. Está
 * explicado al final de CUENTAS-Y-RESERVAS.md.
 */

/* ========================================================================== */
/*  Constantes                                                                */
/* ========================================================================== */

const AUTH = {
  iteraciones: 1000,          // Coste de cifrado. Más = más lento y más seguro.
  diasSesion: 30,
  minPassword: 8,
  maxIntentos: 5,             // Intentos fallidos antes de bloquear temporalmente
  minutosBloqueo: 15
};

const HOJA_USUARIOS = 'Usuarios';
const HOJA_SESIONES = 'Sesiones';

const CAB_USUARIOS = ['Email', 'Nombre', 'Teléfono', 'Hash', 'Salt',
                      'Fecha registro', 'Último acceso', 'Estado', 'Intentos', 'Bloqueado hasta'];
const CAB_SESIONES = ['Token', 'Email', 'Creada', 'Expira', 'Dispositivo'];

/* ========================================================================== */
/*  Acceso a las hojas                                                        */
/* ========================================================================== */

function hoja(nombre, cabeceras) {
  const libro = SpreadsheetApp.openById(CONFIG.sheetId);
  let h = libro.getSheetByName(nombre);
  if (!h) {
    h = libro.insertSheet(nombre);
    h.appendRow(cabeceras);
    h.getRange(1, 1, 1, cabeceras.length)
      .setFontWeight('bold').setBackground('#0a3d2c').setFontColor('#ffffff');
    h.setFrozenRows(1);
  }
  return h;
}

const hojaUsuarios = () => hoja(HOJA_USUARIOS, CAB_USUARIOS);
const hojaSesiones = () => hoja(HOJA_SESIONES, CAB_SESIONES);

/** Devuelve {fila, datos} del usuario, o null. La fila es 1-indexada. */
function buscarUsuario(email) {
  const h = hojaUsuarios();
  const valores = h.getDataRange().getValues();
  const buscado = normalizarEmail(email);
  for (let i = 1; i < valores.length; i++) {
    if (normalizarEmail(valores[i][0]) === buscado) {
      return {
        fila: i + 1,
        email: valores[i][0],
        nombre: valores[i][1],
        telefono: valores[i][2],
        hash: valores[i][3],
        salt: valores[i][4],
        registro: valores[i][5],
        ultimoAcceso: valores[i][6],
        estado: valores[i][7],
        intentos: Number(valores[i][8]) || 0,
        bloqueadoHasta: valores[i][9]
      };
    }
  }
  return null;
}

const normalizarEmail = (s) => String(s || '').trim().toLowerCase();

/* ========================================================================== */
/*  Cifrado de contraseñas                                                    */
/* ========================================================================== */

/**
 * Deriva el hash de una contraseña.
 *
 * SHA-256 aplicado 1.000 veces sobre la contraseña combinada con un salt único
 * por usuario. El salt impide que dos personas con la misma contraseña tengan
 * el mismo hash, y las iteraciones encarecen los ataques por fuerza bruta.
 *
 * No es bcrypt ni Argon2 —Apps Script no los tiene— pero es infinitamente
 * mejor que guardar la contraseña en claro, que es lo que hace mucha gente.
 */
function derivarHash(password, salt) {
  let valor = salt + '|' + password;
  for (let i = 0; i < AUTH.iteraciones; i++) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, valor, Utilities.Charset.UTF_8);
    valor = Utilities.base64Encode(bytes);
  }
  return valor;
}

function generarSalt() {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Date.now() + Math.random())
  ).slice(0, 24);
}

function generarToken() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

/**
 * Comparación en tiempo constante.
 * Comparar con === permite deducir cuántos caracteres acertaste midiendo el
 * tiempo de respuesta. Con volúmenes pequeños es teórico, pero cuesta poco.
 */
function igualSeguro(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/* ========================================================================== */
/*  Registro                                                                  */
/* ========================================================================== */

function registrarUsuario(data) {
  const email = normalizarEmail(data.email);
  const nombre = String(data.name || '').trim();
  const password = String(data.password || '');

  if (!esCorreo(email)) throw new Error('Introduce un correo electrónico válido.');
  if (nombre.length < 3) throw new Error('Indícanos tu nombre completo.');
  if (password.length < AUTH.minPassword) {
    throw new Error('La contraseña debe tener al menos ' + AUTH.minPassword + ' caracteres.');
  }

  // Bloqueo para que dos registros simultáneos no creen el mismo usuario.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (buscarUsuario(email)) {
      throw new Error('Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.');
    }
    const salt = generarSalt();
    hojaUsuarios().appendRow([
      email, nombre, String(data.phone || '').trim(),
      derivarHash(password, salt), salt,
      new Date(), new Date(), 'ACTIVA', 0, ''
    ]);
  } finally {
    lock.releaseLock();
  }

  try { enviarBienvenida(email, nombre); } catch (e) { registrarError(e, 'enviarBienvenida'); }

  const token = crearSesion(email, data.device);
  return { ok: true, token: token, user: { email: email, name: nombre } };
}

/* ========================================================================== */
/*  Login                                                                     */
/* ========================================================================== */

function iniciarSesion(data) {
  const email = normalizarEmail(data.email);
  const password = String(data.password || '');
  const usuario = buscarUsuario(email);

  // Mensaje idéntico exista o no la cuenta: no revelamos qué correos están
  // registrados, que es información útil para quien prueba contraseñas.
  const generico = 'Correo o contraseña incorrectos.';
  if (!usuario) throw new Error(generico);
  if (usuario.estado !== 'ACTIVA') throw new Error('Esta cuenta está desactivada. Escríbenos.');

  if (usuario.bloqueadoHasta && new Date(usuario.bloqueadoHasta) > new Date()) {
    throw new Error('Demasiados intentos fallidos. Vuelve a probar en unos minutos.');
  }

  if (!igualSeguro(derivarHash(password, usuario.salt), usuario.hash)) {
    registrarIntentoFallido(usuario);
    throw new Error(generico);
  }

  const h = hojaUsuarios();
  h.getRange(usuario.fila, 7).setValue(new Date());   // Último acceso
  h.getRange(usuario.fila, 9).setValue(0);            // Intentos a cero
  h.getRange(usuario.fila, 10).setValue('');          // Desbloquear

  const token = crearSesion(email, data.device);
  return { ok: true, token: token, user: { email: email, name: usuario.nombre } };
}

function registrarIntentoFallido(usuario) {
  const h = hojaUsuarios();
  const intentos = usuario.intentos + 1;
  h.getRange(usuario.fila, 9).setValue(intentos);
  if (intentos >= AUTH.maxIntentos) {
    const hasta = new Date(Date.now() + AUTH.minutosBloqueo * 60000);
    h.getRange(usuario.fila, 10).setValue(hasta);
  }
}

/* ========================================================================== */
/*  Sesiones                                                                  */
/* ========================================================================== */

function crearSesion(email, dispositivo) {
  const token = generarToken();
  const expira = new Date(Date.now() + AUTH.diasSesion * 86400000);
  hojaSesiones().appendRow([token, normalizarEmail(email), new Date(), expira,
                            String(dispositivo || '').slice(0, 120)]);
  return token;
}

/** Devuelve el email del usuario con sesión válida, o lanza excepción. */
function emailDeSesion(token) {
  if (!token) throw new Error('Sesión no iniciada.');
  const valores = hojaSesiones().getDataRange().getValues();
  const ahora = new Date();
  for (let i = 1; i < valores.length; i++) {
    if (igualSeguro(valores[i][0], token)) {
      if (new Date(valores[i][3]) < ahora) throw new Error('Tu sesión ha caducado. Vuelve a entrar.');
      return normalizarEmail(valores[i][1]);
    }
  }
  throw new Error('Sesión no válida. Vuelve a entrar.');
}

function cerrarSesion(data) {
  const h = hojaSesiones();
  const valores = h.getDataRange().getValues();
  for (let i = valores.length - 1; i >= 1; i--) {
    if (igualSeguro(valores[i][0], data.token)) {
      h.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

/**
 * Borra sesiones caducadas. Configúralo como activador diario:
 * Activadores → Añadir activador → limpiarSesiones → Temporizador diario.
 */
function limpiarSesiones() {
  const h = hojaSesiones();
  const valores = h.getDataRange().getValues();
  const ahora = new Date();
  let borradas = 0;
  for (let i = valores.length - 1; i >= 1; i--) {
    if (new Date(valores[i][3]) < ahora) { h.deleteRow(i + 1); borradas++; }
  }
  console.log('Sesiones caducadas eliminadas: ' + borradas);
  return borradas;
}

/* ========================================================================== */
/*  Reservas del usuario                                                      */
/* ========================================================================== */

/** Índices de las columnas de la hoja Reservas, según CABECERAS de Codigo.gs. */
const COL = {
  registro: 0, codigo: 1, estado: 2, tour: 3, slug: 4, categoria: 5, fecha: 6,
  viajeros: 7, unitario: 8, total: 9, pagado: 10, saldo: 11, modo: 12,
  email: 13, telefono: 14, comentarios: 15, pasajeros: 16
};

function filaAReserva(fila) {
  const fechaTour = fila[COL.fecha];
  return {
    code: fila[COL.codigo],
    status: fila[COL.estado],
    title: fila[COL.tour],
    slug: fila[COL.slug],
    tier: fila[COL.categoria],
    date: fechaTour instanceof Date
      ? Utilities.formatDate(fechaTour, 'America/Lima', 'yyyy-MM-dd')
      : String(fechaTour),
    travelers: Number(fila[COL.viajeros]) || 0,
    total: Number(fila[COL.total]) || 0,
    paid: Number(fila[COL.pagado]) || 0,
    balance: Number(fila[COL.saldo]) || 0,
    passengers: String(fila[COL.pasajeros] || '')
  };
}

/** Separa en próximos y pasados comparando con hoy. */
function clasificarReservas(reservas) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const proximos = [], pasados = [];
  reservas.forEach(function (r) {
    const f = new Date(r.date + 'T00:00:00');
    (isNaN(f.getTime()) || f >= hoy ? proximos : pasados).push(r);
  });
  proximos.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  pasados.sort(function (a, b) { return a.date > b.date ? -1 : 1; });
  return { upcoming: proximos, past: pasados };
}

function misViajes(data) {
  const email = emailDeSesion(data.token);
  const usuario = buscarUsuario(email);
  const valores = hojaReservas().getDataRange().getValues();

  const mias = [];
  for (let i = 1; i < valores.length; i++) {
    if (normalizarEmail(valores[i][COL.email]) === email) mias.push(filaAReserva(valores[i]));
  }

  const clasificadas = clasificarReservas(mias);
  return {
    ok: true,
    user: { email: email, name: usuario ? usuario.nombre : '', phone: usuario ? usuario.telefono : '' },
    upcoming: clasificadas.upcoming,
    past: clasificadas.past
  };
}

/* ========================================================================== */
/*  Consulta pública de reserva                                               */
/* ========================================================================== */

/**
 * Busca una reserva por código y apellido, sin necesidad de cuenta.
 *
 * Es el patrón que usan las aerolíneas y las OTAs. El apellido actúa de
 * segundo factor: el código solo no basta, así que aunque alguien adivine un
 * código no ve datos ajenos. Por eso los códigos usan un sufijo aleatorio y
 * no son correlativos.
 */
function consultarReserva(data) {
  const codigo = String(data.code || '').trim().toUpperCase();
  const apellido = String(data.lastName || '').trim().toLowerCase();

  if (!codigo || !apellido) throw new Error('Necesitamos el código de reserva y el apellido del titular.');

  const valores = hojaReservas().getDataRange().getValues();
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][COL.codigo]).trim().toUpperCase() !== codigo) continue;

    // El titular es el primer pasajero de la cadena guardada.
    const pasajeros = String(valores[i][COL.pasajeros] || '');
    const titular = pasajeros.split('|')[0].split('(')[0].trim().toLowerCase();
    if (titular.indexOf(apellido) === -1) {
      throw new Error('El apellido no coincide con esta reserva. Revisa los datos.');
    }

    const r = filaAReserva(valores[i]);
    r.holderName = pasajeros.split('|')[0].split('(')[0].trim();
    r.passengerList = pasajeros.split('|').map(function (p) { return p.trim(); });
    return { ok: true, booking: r };
  }
  throw new Error('No encontramos ninguna reserva con ese código.');
}

/**
 * Reenvía el voucher al correo con el que se hizo la reserva.
 * Nunca a un correo que indique quien consulta: eso permitiría exfiltrar datos.
 */
function reenviarVoucher(data) {
  const codigo = String(data.code || '').trim().toUpperCase();
  const valores = hojaReservas().getDataRange().getValues();

  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][COL.codigo]).trim().toUpperCase() !== codigo) continue;
    const destino = valores[i][COL.email];
    MailApp.sendEmail({
      to: destino,
      subject: 'Tu reserva ' + codigo + ' · ' + valores[i][COL.tour],
      htmlBody: '<p>Hola,</p><p>Aquí tienes de nuevo el detalle de tu reserva <strong>' +
        codigo + '</strong> para <strong>' + valores[i][COL.tour] + '</strong> ' +
        'del ' + valores[i][COL.fecha] + '.</p>' +
        '<p>Si necesitas cualquier cambio, respóndenos a este correo o escríbenos por WhatsApp al ' +
        CONFIG.agency.phone + '.</p><p>' + CONFIG.agency.name + '</p>',
      name: CONFIG.agency.name,
      replyTo: CONFIG.agency.email
    });
    // Ocultamos el correo completo para no filtrarlo a quien consulta.
    return { ok: true, sentTo: enmascararCorreo(destino) };
  }
  throw new Error('No encontramos ninguna reserva con ese código.');
}

function enmascararCorreo(email) {
  const partes = String(email).split('@');
  if (partes.length !== 2) return '···';
  const usuario = partes[0];
  const visible = usuario.slice(0, 2);
  return visible + '···@' + partes[1];
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
        '<p style="color:#6b7772">Tu cuenta está lista. Desde tu perfil puedes consultar tus viajes ' +
        'reservados, revisar tus vouchers y ver el historial de lo que ya has recorrido con nosotros.</p>' +
        '<p style="margin-top:24px"><a href="' + CONFIG.agency.web + '/mis-viajes.html" ' +
        'style="background:#f2b705;color:#1a1400;padding:13px 24px;border-radius:8px;' +
        'text-decoration:none;font-weight:bold;display:inline-block">Ver mis viajes</a></p>' +
        '<p style="color:#6b7772;font-size:13px;margin-top:28px">Si no has creado esta cuenta, ' +
        'escríbenos a ' + CONFIG.agency.email + ' y la eliminamos.</p>' +
      '</div>',
    name: CONFIG.agency.name,
    replyTo: CONFIG.agency.email
  });
}

/* ========================================================================== */
/*  Comprobación                                                              */
/* ========================================================================== */

/** Ejecuta esta función para verificar que las cuentas funcionan. */
function pruebaDeCuentas() {
  const lineas = [];
  const email = 'prueba-' + Date.now() + '@ejemplo.com';

  try {
    hojaUsuarios(); hojaSesiones();
    lineas.push('  OK    Hojas Usuarios y Sesiones');
  } catch (e) { lineas.push('  FALLA Hojas: ' + e.message); }

  try {
    const t0 = Date.now();
    const salt = generarSalt();
    const hash = derivarHash('contrasena-de-prueba', salt);
    const ms = Date.now() - t0;
    lineas.push('  OK    Cifrado (' + AUTH.iteraciones + ' iteraciones en ' + ms + ' ms)');
    lineas.push(igualSeguro(derivarHash('contrasena-de-prueba', salt), hash)
      ? '  OK    Verificación de contraseña correcta'
      : '  FALLA La verificación no reproduce el hash');
    lineas.push(!igualSeguro(derivarHash('otra-cosa', salt), hash)
      ? '  OK    Contraseña incorrecta rechazada'
      : '  FALLA Acepta una contraseña incorrecta');
    if (ms > 3000) lineas.push('  AVISO El cifrado tarda mucho. Baja AUTH.iteraciones a 500.');
  } catch (e) { lineas.push('  FALLA Cifrado: ' + e.message); }

  try {
    const r = registrarUsuario({ email: email, name: 'Usuario De Prueba', password: 'clave-larga-123' });
    lineas.push('  OK    Registro y sesión (token de ' + r.token.length + ' caracteres)');
    const s = iniciarSesion({ email: email, password: 'clave-larga-123' });
    lineas.push('  OK    Login correcto');
    lineas.push(emailDeSesion(s.token) === email ? '  OK    Token válido' : '  FALLA Token no resuelve');
    misViajes({ token: s.token });
    lineas.push('  OK    Consulta de Mis viajes');
    cerrarSesion({ token: s.token });
    lineas.push('  OK    Cierre de sesión');
    lineas.push('');
    lineas.push('  Borra a mano la fila del usuario ' + email);
  } catch (e) { lineas.push('  FALLA Flujo de cuentas: ' + e.message); }

  const informe = 'COMPROBACIÓN DE CUENTAS\n\n' + lineas.join('\n');
  console.log(informe);
  return informe;
}
