# Instalación: cuentas, Google Sign-In, Mis viajes y PayPal

Este paquete contiene únicamente los archivos que cambiaron. No reemplaza el resto del sitio.

## Archivos que debes subir

- `backend/Codigo.gs`
- `backend/Cuentas.gs`
- `assets/js/booking.js`
- `assets/js/cuentas.js`

Los dos archivos `.gs` deben estar dentro del **mismo proyecto de Google Apps Script**. No los unas ni los publiques como proyectos separados.

## 1. Propiedades de Google Apps Script

En Apps Script abre **Configuración del proyecto → Propiedades del script** y crea:

| Propiedad | Valor |
|---|---|
| `SHEET_ID` | ID de la hoja de cálculo de reservas |
| `PAYPAL_CLIENT_ID` | Client ID de la aplicación PayPal |
| `PAYPAL_SECRET` | Secret de PayPal; nunca debe ir a GitHub |
| `PAYPAL_ENV` | `sandbox` para pruebas o `live` para cobros reales |
| `GOOGLE_CLIENT_ID` | Client ID web terminado en `.apps.googleusercontent.com` |
| `NOTIFY_EMAIL` | Opcional: correo que recibe cada nueva reserva |
| `VOUCHER_LOGO_URL` | Opcional: URL pública HTTPS del logo |

`AUTH_PEPPER` se crea automáticamente en el primer uso. **No lo borres después**, porque protege los hashes de contraseñas y sesiones.

## 2. Configurar Google Sign-In

1. En Google Cloud crea o selecciona un proyecto.
2. Configura la pantalla de consentimiento OAuth.
3. Crea un cliente OAuth de tipo **Aplicación web**.
4. En **Orígenes de JavaScript autorizados** agrega, según corresponda:
   - `https://latamexpeditions.com`
   - `https://www.latamexpeditions.com`
   - El dominio temporal de GitHub Pages, solo mientras lo uses para pruebas.
5. Copia el Client ID en `GOOGLE_CLIENT_ID` de Apps Script y también en `booking.googleClientId` de `assets/data/catalog.json`.

El backend comprueba audiencia, emisor, expiración, correo verificado, `sub` de Google y un nonce de un solo uso.

## 3. Configurar PayPal

1. En PayPal Developer crea primero una aplicación **Sandbox**.
2. Copia el Client ID y el Secret a las propiedades del script.
3. Coloca `PAYPAL_ENV=sandbox`.
4. Copia el mismo Client ID público en `booking.paypalClientId` de `assets/data/catalog.json`.
5. Haz una compra completa con una cuenta personal Sandbox.
6. Cuando todo esté validado, crea/usa las credenciales Live y cambia simultáneamente:
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_SECRET`
   - `PAYPAL_ENV=live`
   - `booking.paypalClientId` en el catálogo

El Secret de PayPal debe permanecer únicamente en las propiedades privadas de Apps Script.

## 4. Publicar el backend

En Apps Script:

1. **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. Ejecutar como: **Yo**.
4. Quién tiene acceso: **Cualquier usuario**.
5. Copia la URL que termina en `/exec`.

Cada vez que cambies `Codigo.gs` o `Cuentas.gs`, abre **Gestionar implementaciones**, edita la implementación y selecciona **Nueva versión**.

## 5. Completar `assets/data/catalog.json`

Edita solamente estos tres valores dentro de `booking`:

```json
{
  "paypalClientId": "TU_CLIENT_ID_PUBLICO_DE_PAYPAL",
  "endpoint": "https://script.google.com/macros/s/TU_IMPLEMENTACION/exec",
  "googleClientId": "TU_CLIENT_ID_DE_GOOGLE.apps.googleusercontent.com"
}
```

No coloques `PAYPAL_SECRET`, contraseñas ni claves privadas en este JSON.

## 6. Primera comprobación

Desde el editor de Apps Script ejecuta, en este orden:

1. `pruebaDeInstalacion()`
2. `pruebaDeCuentas()`
3. `pruebaDeGoogle()`

La primera ejecución solicitará permisos para Sheets, correo y conexiones externas.

El sistema crea o adapta automáticamente estas hojas:

- `Reservas`
- `Ordenes PayPal`
- `Usuarios`
- `Sesiones`
- `Errores`, cuando ocurra una incidencia

No borra las filas existentes. Las cuentas antiguas migran su hash de contraseña al iniciar sesión y las sesiones antiguas pasan de token visible a token protegido.

## 7. Cómo funciona “Mis viajes”

Una reserva aparece en la cuenta cuando el correo del usuario coincide exactamente con el correo usado como titular durante el pago. Después de una compra:

- Si el cliente ya inició sesión con ese correo, verá la reserva en `mis-viajes.html`.
- Si todavía no tiene cuenta, debe registrarse con el mismo correo.
- También puede consultar sin cuenta mediante código de reserva + apellido en `mi-reserva.html`.

## 8. Pruebas mínimas antes de producción

- Registrar una cuenta con correo y contraseña.
- Cerrar sesión e iniciar sesión nuevamente.
- Entrar con Google en `login.html` y `registro.html`.
- Intentar un login incorrecto cinco veces y comprobar el bloqueo temporal.
- Pagar una reserva Sandbox y verificar las hojas `Ordenes PayPal` y `Reservas`.
- Recargar o repetir la captura y comprobar que no se duplica la reserva.
- Ver la compra en “Mis viajes” usando el mismo correo.
- Consultar y reenviar el voucher usando código + apellido.
- Probar que un apellido incorrecto no permite consultar ni reenviar.

## Ajustes recomendados para una segunda etapa

1. Añadir recuperación de contraseña y verificación del correo para cuentas locales.
2. Incorporar webhooks de PayPal para conciliación automática si el cliente cierra la pestaña o se pierde la respuesta.
3. Mover autenticación a Firebase Auth, Auth0 o Supabase cuando crezca el volumen o se almacenen documentos sensibles.
4. Evitar mantener precios duplicados a largo plazo: actualmente deben coincidir `catalog.json` y las tablas de `Codigo.gs`.
5. Corregir los textos de registro que prometen “favoritos” y “propuestas” si esas funciones todavía no se implementarán.
6. Añadir política de retención y eliminación de datos personales de pasajeros.
