# Dental Coworking — Panel administrativo

Gestión clínica odontológica con automatización de WhatsApp.
3 consultorios · 12 odontólogos · comisión 40/60 · precios en USD, cobro en Bs.

---

## 1. Credenciales de acceso

Las contraseñas están **hasheadas con Argon2id en PostgreSQL**. Estas son las
que genera el seed:

| Rol | Correo | Contraseña |
|---|---|---|
| Super Admin | `admin@dentalcoworking.com.ve` | `SuperAdmin2026!` |
| Asistente | `recepcion@dentalcoworking.com.ve` | `Asistente2026!` |
| Odontóloga | `gabriela.ferreira@dentalcoworking.com.ve` | `Odontologa2026!` |

Cada rol aterriza en una pantalla distinta: Super Admin → `/dashboard`,
Asistente → `/inicio`, Odontólogo → `/agenda`.

### Qué ve cada rol

| Sección | Super Admin | Asistente | Odontólogo |
|---|:--:|:--:|:--:|
| `/inicio` — panel del turno | ✅ | ✅ | — |
| `/dashboard` — finanzas | ✅ | 🔒 | 🔒 |
| `/agenda` — citas + cobros | ✅ | ✅ | su calendario; agenda para sí misma, sin importes |
| `/caja` — cierre del día | ✅ | ✅ | 🔒 |
| `/whatsapp` — monitor IA | ✅ | ✅ | 🔒 |
| `/pacientes` | ✅ | ✅ | 🔒 |
| `/pacientes/{id}/expediente` — historia clínica | ✅ | ✅ | 🔒 |
| `/tasa-cambio` | ✅ | ✅ | 🔒 |
| `/tarifas` — precios por odontólogo | ✅ aprueba | precios aprobados, sin reparto | sólo las suyas, propone |
| `/facturas` — facturación | ✅ | ✅ | 🔒 |
| `/horarios` — cambios de horario | ✅ aprueba | ✅ aprueba | los suyos, propone |
| `/instrumental` — su material | ✅ el de todos | 🔒 | el suyo |
| `/cambiar-clave` — su propia contraseña | ✅ | ✅ | ✅ |
| `/odontologos` | ✅ CRUD y comisiones | listado, sin dinero | 🔒 |
| `/tratamientos`, `/consultorios`, `/configuracion` | ✅ | 🔒 | 🔒 |
| Barra superior: buscador, mensajes, notificaciones | ✅ | ✅ | — |
| Sidebar: tarjeta «Precios en USD» | ✅ | ✅ | — |

Al odontólogo no se le pintan esos controles porque las tres cosas llevan a
secciones que su rol no abre (`/pacientes`, `/whatsapp`, `/tasa-cambio`), y
los avisos hablan de pacientes de toda la clínica. **No se ocultan con CSS: no
se consultan**, así que esos datos no llegan a su navegador.

> **Qué ve recepción del dinero de los odontólogos: nada.** Entra en
> `/odontologos` y en `/tarifas` porque necesita saber **a quién** y **a
> cuánto** — para agendar, derivar a un cirujano, cotizar y facturar. Lo que
> no ve es el REPARTO: qué porcentaje se queda la clínica y cuánto le
> corresponde a cada quien. Eso es una negociación entre la clínica y cada
> persona, y no hace falta para el mostrador.
>
> No está oculto con CSS ni con condicionales en la vista: **su rama de cada
> página construye las filas campo a campo y esos números no se consultan**.
> Lo que no viaja no se lee abriendo las herramientas del navegador.
>
> `/instrumental` sí rompe la escalera de roles: lo abren el odontólogo (es su
> material) y el administrador, pero no recepción. Para eso existe
> `hiddenForRoles` en `NavLink` — sin él habría que elegir entre esconderle la
> página al odontólogo o enseñarle a recepción un enlace que la rebota.

> Para cambiarlas, edita `MOCK_CREDENTIALS` en
> [`backend/src/mock/data.ts`](backend/src/mock/data.ts) y vuelve a ejecutar
> `npm run db:seed`. El hash se recalcula solo.

### `/agenda` son dos pantallas distintas

La ruta es la misma; lo que se sirve depende del rol, porque el trabajo es
otro.

**Recepción y administración** ven la tabla de toda la clínica: alta,
reprogramación, cambio de estado y cobro.

**El odontólogo** ve un **calendario semanal de sus propias citas**, y puede
agendarse citas a sí mismo con el botón «Agendar» (ver «La doctora agenda sus
propias citas»). Lo que no puede es cobrar ni cambiar estados.

De cada cita muestra hora, paciente, tratamiento, consultorio, origen y si
está confirmada, en formato de 12 horas (`8 am`, `12 m`, `3 pm`). Se navega
entre semanas con `?semana=YYYY-MM-DD` y al pinchar una cita se abre el
detalle con las notas de recepción.

Tres cosas que **no** tiene, a propósito:

- **Ningún importe.** No es que la columna esté oculta: la consulta
  (`listDentistAgenda`) no selecciona `agreedPriceCents`, así que el precio no
  sale de Postgres. Un dato que no viaja no se puede leer abriendo las
  herramientas del navegador. El odontólogo cobra por liquidación mensual, no
  por cita.
- **Ningún control de estado.** Confirmar, cancelar o marcar una inasistencia
  implica hablar con el paciente, y eso es de recepción. Aquí el estado sólo se
  lee: *Confirmada*, *Por confirmar*, *Atendida*, *Cancelada*, *No asistió*.

  Agendar sí puede, y no es contradictorio: crear una cita suya es organizar su
  propio trabajo; cambiarle el estado a una existente implica una conversación
  con el paciente que la lleva recepción.

- **El teléfono del paciente.** Lo pidió la clínica: quien llama para
  confirmar o reprogramar es recepción. Igual que con el precio, no se oculta
  en la pantalla — `listDentistAgenda` no lo selecciona, así que no sale de
  Postgres.

---

## 2. Archivo `.env.local`

Crea `.env.local` en la raíz con este contenido. **Ya existe uno generado con
secretos aleatorios**; si necesitas rehacerlo:

```bash
# --- Base de datos -------------------------------------------------------
DATABASE_URL="postgresql://dental:dental@127.0.0.1:5432/dental_coworking?schema=public"

# --- Autenticación -------------------------------------------------------
# Genera uno nuevo con:  openssl rand -base64 32
AUTH_SECRET="<32+ caracteres aleatorios>"
APP_ORIGIN="http://localhost:3000"

# --- Automatización (n8n / bot de WhatsApp) ------------------------------
# Genera uno nuevo con:  openssl rand -hex 32
AUTOMATION_HMAC_SECRET="<64 caracteres hex>"
AUTOMATION_SIGNATURE_TOLERANCE_SECONDS="300"

# --- Salida hacia WhatsApp -----------------------------------------------
# Webhook de n8n al que el panel envía los mensajes que escribe un agente.
# Vacío = los mensajes se guardan pero NO se entregan (la UI lo avisa).
WHATSAPP_OUTBOUND_WEBHOOK_URL=""

# Webhook al que se AVISA cuando alguien enciende o apaga la IA de un chat.
# Es sólo un aviso: el bot se entera igual porque consulta el estado del chat
# en cada mensaje. Vacío = sin aviso inmediato, nada más.
WHATSAPP_EVENTS_WEBHOOK_URL=""

# --- Correo al personal (n8n) --------------------------------------------
# Webhook de n8n que ENVÍA EL CORREO al dar de alta a un odontólogo con
# cuenta de acceso. El panel no habla con Gmail: la credencial vive en n8n.
# Vacío = el odontólogo se crea igual pero NO recibe la clave; la UI lo avisa.
STAFF_EMAIL_WEBHOOK_URL=""

# --- Origen de datos -----------------------------------------------------
# "db" = PostgreSQL real (lo normal). "mock" = arrays en memoria, sin DB.
DATA_SOURCE="db"

# --- Negocio -------------------------------------------------------------
DEFAULT_CLINIC_COMMISSION_PERCENT="40"
CLINIC_TIMEZONE="America/Caracas"

# --- Red -----------------------------------------------------------------
# Cuántos proxies inversos de confianza hay delante. En local, 0. Detrás de
# EasyPanel / Traefik / nginx, 1. Ver «Despliegue en EasyPanel».
TRUSTED_PROXY_HOPS="0"
```

`.env.local` está en `.gitignore`. **Nunca lo commitees.**

---

## 3. Puesta en marcha

```bash
# 1. Dependencias
npm install
npx prisma generate --schema backend/prisma/schema.prisma

# 2. Base de datos (si aún no existe)
psql -U postgres -c "CREATE ROLE dental LOGIN PASSWORD 'dental' CREATEDB;"
psql -U postgres -c "CREATE DATABASE dental_coworking OWNER dental;"
psql -U postgres -d dental_coworking -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
psql -U postgres -d dental_coworking -c "CREATE EXTENSION IF NOT EXISTS unaccent;"

# 3. Migraciones + datos
npm run db:deploy
npm run db:seed

# 4. Arrancar
npm run dev
```

Abrir <http://localhost:3000>.

> `btree_gist` es **obligatoria**: sin ella no se pueden crear los constraints
> que impiden la doble reserva de consultorio.


---

## 3bis. Despliegue en EasyPanel

El panel y n8n van en el **mismo servidor**, cada uno en su servicio. Eso
cambia tres cosas respecto a desarrollo.

### Los servicios

| Servicio | Qué es | Puerto interno |
|---|---|---|
| `panel` | Esta aplicación (App → Dockerfile) | 3000 |
| `n8n` | La automatización | 5678 |
| `postgres` | Base de datos (una por servicio) | 5432 |

Sólo `panel` y `n8n` necesitan dominio público. **Postgres no se expone**: si
EasyPanel te ofrece publicarlo, no lo hagas.

### Se hablan por dentro, no por internet

Dentro del proyecto, los servicios se alcanzan por su nombre. Las llamadas
entre el panel y n8n **no deben salir a internet y volver**:

```bash
# En n8n → llamar al panel
PANEL_URL="http://panel:3000"

# En el panel → llamar a n8n
WHATSAPP_OUTBOUND_WEBHOOK_URL="http://n8n:5678/webhook/whatsapp-saliente"
WHATSAPP_EVENTS_WEBHOOK_URL="http://n8n:5678/webhook/panel-eventos"
STAFF_EMAIL_WEBHOOK_URL="http://n8n:5678/webhook/correo-personal"
```

Tres motivos: no dependes del DNS ni del certificado para algo que ocurre a
diez centímetros; no pagas el viaje de ida y vuelta en cada mensaje; y el
tráfico con datos de pacientes no sale de la máquina.

`http://` sin TLS es correcto **aquí**: es la red interna del proyecto, no
alcanzable desde fuera. La firma HMAC sigue aplicándose igual — protege contra
cualquier otro contenedor del mismo servidor, no sólo contra internet.

### Variables del servicio `panel`

```bash
DATABASE_URL="postgresql://USUARIO:CLAVE@postgres:5432/dental_coworking"
AUTH_SECRET="<openssl rand -base64 32>"
APP_ORIGIN="https://panel.tudominio.com"     # el PÚBLICO, no el interno
AUTOMATION_HMAC_SECRET="<openssl rand -hex 32>"
AUTOMATION_SIGNATURE_TOLERANCE_SECONDS="300"
WHATSAPP_OUTBOUND_WEBHOOK_URL="http://n8n:5678/webhook/whatsapp-saliente"
WHATSAPP_EVENTS_WEBHOOK_URL="http://n8n:5678/webhook/panel-eventos"
STAFF_EMAIL_WEBHOOK_URL="http://n8n:5678/webhook/correo-personal"
DATA_SOURCE="db"
DEFAULT_CLINIC_COMMISSION_PERCENT="40"
CLINIC_TIMEZONE="America/Caracas"
NODE_ENV="production"

# ⚠️ IMPRESCINDIBLE detrás de EasyPanel — ver abajo
TRUSTED_PROXY_HOPS="1"
```

`APP_ORIGIN` es el dominio **público**: se usa para validar el `Origin` de las
Server Actions, y quien las envía es el navegador, no un contenedor.

### `TRUSTED_PROXY_HOPS`: no lo dejes en blanco

EasyPanel pone Traefik delante. Un proxy inverso **añade** la IP que ve al
final de `X-Forwarded-For`, no la reescribe. Así que si alguien manda la
cabecera a mano, lo que llega es:

```
X-Forwarded-For: 1.2.3.4, 203.0.113.9
                 ↑ lo puso él        ↑ la real, la puso Traefik
```

Leer el primer valor —lo natural— es leer justo el que controla el atacante.
Con el limitador de intentos de login eso significa **contraseñas ilimitadas**:
basta cambiar ese número en cada intento.

La variable dice cuántos proxies de confianza hay delante, y de ahí se cuenta
desde el final:

| Montaje | Valor |
|---|---|
| EasyPanel / Traefik / nginx | `1` |
| Cloudflare por delante de EasyPanel | `2` |
| Proceso expuesto sin proxy | `0` (se ignora la cabecera entera) |

Puesto de más, todo el tráfico parece venir de una sola IP y una persona agota
el cupo de todas. Puesto de menos, el limitador se salta con una cabecera.

### Paso a paso

**1. Subir el código a un repositorio.** EasyPanel compila desde Git.

```bash
git init
git add .
git commit -m "Panel de gestión clínica"
git remote add origin git@github.com:TU-USUARIO/dental-coworking.git
git push -u origin main
```

`.env.local` está en `.gitignore` — comprueba que no aparece en `git status`
antes del primer commit.

**2. Generar los secretos.** En tu máquina, no en el servidor:

```bash
echo "AUTH_SECRET=$(openssl rand -base64 32)"
echo "AUTOMATION_HMAC_SECRET=$(openssl rand -hex 32)"
```

Guárdalos: el segundo tiene que ser **idéntico** en el panel y en n8n.

**3. Crear los servicios** en EasyPanel (Project → + Service):

| Tipo | Nombre | Notas |
|---|---|---|
| Postgres | `postgres` | Apunta la contraseña que genera |
| App | `panel` | Source: tu repo · Build: **Dockerfile** |
| App | `n8n` | Imagen `n8nio/n8n`, puerto 5678 |

En `panel` → Domains, añade tu dominio y activa HTTPS. En `panel` → Advanced,
pon el healthcheck en `/api/health`.

**4. Las extensiones de Postgres**, antes del primer despliegue. En EasyPanel:
servicio `postgres` → Console:

```bash
psql -U postgres -d dental_coworking -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
psql -U postgres -d dental_coworking -c "CREATE EXTENSION IF NOT EXISTS unaccent;"
```

`btree_gist` no es opcional: sin ella fallan las migraciones que crean los
constraints contra la doble reserva.

**5. Las variables del servicio `panel`** (Environment). Sustituye lo que está
entre `<>`:

```bash
DATABASE_URL=postgres://postgres:<CLAVE>@postgres:5432/dental_coworking
AUTH_SECRET=<el del paso 2>
AUTOMATION_HMAC_SECRET=<el del paso 2>
APP_ORIGIN=https://<tu-dominio>
AUTOMATION_SIGNATURE_TOLERANCE_SECONDS=300
WHATSAPP_OUTBOUND_WEBHOOK_URL=http://n8n:5678/webhook/whatsapp-saliente
WHATSAPP_EVENTS_WEBHOOK_URL=http://n8n:5678/webhook/panel-eventos
STAFF_EMAIL_WEBHOOK_URL=http://n8n:5678/webhook/correo-personal
DATA_SOURCE=db
DEFAULT_CLINIC_COMMISSION_PERCENT=40
CLINIC_TIMEZONE=America/Caracas
NODE_ENV=production
TRUSTED_PROXY_HOPS=1
```

**6. Deploy.** Las migraciones se aplican solas al arrancar el contenedor. En
los logs debe verse:

```
N migrations found in prisma/migrations
✓ Ready in ...ms
```

**7. Crear las cuentas de acceso.** Sin esto el panel arranca pero **nadie
puede entrar**: el login responde `CredentialsSignin`, que es lo que devuelve
el sistema cuando el correo no existe en la base.

Desde `panel` → Console:

```bash
node scripts/crear-usuarios.mjs
```

Crea las tres cuentas de la sección 1. Es **idempotente**: ejecutarlo otra vez
no duplica nada — actualiza la contraseña, desbloquea la cuenta y cierra las
sesiones abiertas. Sirve igual para el primer arranque que para recuperar el
acceso cuando alguien olvide su clave.

Para poner tus propias credenciales desde el principio:

```bash
ADMIN_EMAIL="tu@correo.com" \
ADMIN_PASSWORD="una-contraseña-larga" \
ADMIN_NAME="Tu Nombre" \
  node scripts/crear-usuarios.mjs
```

Acepta lo mismo con los prefijos `ASSISTANT_` y `DENTIST_`, y `*_PHONE` para
el WhatsApp del personal — es lo que permite al bot reconocer quién le
escribe. Mínimo 12 caracteres; con menos, el script se niega.

> **`npm run db:seed` no funciona en el servidor.** Ese seed está en
> TypeScript y necesita `tsx`, que es dependencia de desarrollo y no viaja a
> la imagen de producción. Además carga 30 pacientes y 600 citas de mentira,
> que en un servidor real hay que limpiar después. Para datos de demostración,
> úsalo en local.

**8. Comprobar:**

```bash
curl https://<tu-dominio>/api/health          # {"status":"ok"}
```

Y entra al panel con las credenciales de la sección 1.

### Si algo falla

| Síntoma | Causa casi segura |
|---|---|
| El contenedor reinicia en bucle | Las migraciones fallan: falta `btree_gist`, o `DATABASE_URL` apunta mal |
| `Variables de entorno inválidas` en los logs | Falta una variable, o un secreto tiene menos de 32 caracteres |
| `CredentialsSignin` en los logs al iniciar sesión | La base no tiene usuarios. Ejecuta el paso 7 |
| Entras al login, metes la clave y vuelve al login | Estás entrando por `http://`. En producción la cookie de sesión es `__Secure-` y **sólo viaja por HTTPS** — es a propósito. Activa el certificado |
| n8n recibe `401` del panel | El `AUTOMATION_HMAC_SECRET` no es idéntico en los dos, o el reloj del servidor está desfasado más de 300 s |
| El bot no responde a nadie | Mira el monitor: si el chat tiene la IA apagada, es correcto que calle |

### Antes del primer arranque

En el servicio de Postgres, una vez:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

`btree_gist` no es opcional: sin ella no se crean los constraints que impiden
la doble reserva de consultorio, y las migraciones fallan.

Las migraciones se aplican solas al arrancar el contenedor (`migrate deploy`
en el `CMD` del Dockerfile). Si fallan, el contenedor no levanta — a propósito:
es preferible a servir con el esquema desfasado.

El seed **no** se ejecuta solo. Para la primera carga, desde la consola del
servicio: `npm run db:seed`. En una clínica real, sáltatelo y crea el usuario
administrador a mano.

### Sonda de salud

`GET /api/health` → `200` si la aplicación y la base responden, `503` si la
base no. Configúralo como healthcheck del servicio; no devuelve versión ni
detalles del error, así que puede quedar público sin dar información.

### Lo que conviene NO exponer

`/api/automation/*` sólo lo llama n8n, y n8n está dentro. Si tu Traefik permite
reglas por ruta, bloquea ese prefijo desde fuera: la firma HMAC ya lo protege,
pero un endpoint que nadie de fuera necesita es un endpoint que nadie de fuera
debería poder tocar.

---

## 4. El flujo del dinero: mostrador → finanzas

Es la conexión que une los dos roles:

```
Recepción (asistente)                    Administrador
─────────────────────                    ─────────────
/agenda → botón «Cobrar»
   ↓
   monto en USD + medio de pago
   ↓
   el SERVIDOR calcula:
     · reparto 40/60 con la comisión
       vigente del odontólogo
     · importe en Bs a la tasa del día
     · congela ambos en el pago
   ↓
   la cita pasa a COMPLETED
   ↓
/caja → cierre del turno    ────────→    /dashboard → ingresos
                                          /odontologos → liquidación
```

Nada de esto se acepta del formulario: ni el reparto, ni la tasa, ni el
estado de la cita. El navegador envía intención (cuánto y cómo se pagó); el
servidor decide las consecuencias contables.

### Medios de pago: una sola lista para todo

En **`/configuracion` → Medios de pago** (sólo Super Admin) se define cómo
cobra la clínica: pago móvil, transferencia, Zelle, efectivo, punto de venta.
Cada entrada lleva el texto que se le dicta al paciente (banco, teléfono, RIF)
y su categoría contable.

Esa lista alimenta **dos sitios a la vez**:

- El **bot de WhatsApp**, vía `catalog.paymentMethods`. Cuando el paciente
  pregunta «¿cómo pago?», el bot lee esto — no lleva ningún dato bancario
  escrito dentro del flujo de n8n. Si la clínica cambia de banco, se cambia
  aquí y la siguiente conversación ya usa lo nuevo.
- El **selector de cobro** de recepción, en la agenda y en caja. Tener dos
  listas distintas llevaría a registrar «Transferencia» un pago hecho por
  Zelle, y el arqueo dejaría de reflejar la realidad.

> Los datos que trae el seed son **de ejemplo**. Sustitúyelos por los reales
> antes de conectar el bot: si no, mandará a los pacientes a pagar a una
> cuenta que no existe.

Dos conceptos que conviene no mezclar:

| | Qué es | Cuántos |
|---|---|---|
| **Categoría contable** (`kind`) | Efectivo, tarjeta, transferencia, seguro | Cuatro, fijos. Es lo que agrupa el cierre de caja |
| **Medio concreto** | «Pago móvil Banesco», «Zelle» | Los que haga falta. Es lo que el paciente necesita oír |

Al cobrar se guardan los dos: `method` clasifica para la contabilidad y
`methodLabel` deja constancia de cómo se pagó de verdad. La etiqueta se
**copia** en el cobro, no se referencia: si mañana se borra ese medio, el cobro
de ayer debe seguir diciendo cómo se pagó.

---

## 5. Moneda: precios en USD, cobro en bolívares

Decisión central del sistema, y conviene entenderla antes de tocar nada:

- **Los precios se almacenan en centavos de USD.** Con la inflación
  venezolana, una lista de precios en bolívares habría que reescribirla cada
  semana.
- **Se muestran y cobran en Bs** a la tasa del BCV del momento.
- **Cada pago congela su tasa** (`Payment.exchangeRate` + `Payment.amountBs`).
  Cuando la tasa cambie mañana, la contabilidad de ayer no se mueve.

La tasa viene de **[DolarAPI](https://ve.dolarapi.com)** y se guarda en la
tabla `exchange_rates`:

- Se refresca como mucho **una vez por hora** (el BCV publica una vez al día).
- Si DolarAPI se cae, el sistema **sigue operando** con la última tasa
  conocida y la marca como desactualizada en la interfaz.
- Pantalla de control en **`/tasa-cambio`**, con historial y actualización
  manual.

---

## 6. Estructura

```
dental-coworking/
├── app/                        ← SOLO RUTEO (archivos delgados)
│   ├── (admin)/                    layout + guard de sesión
│   │   ├── dashboard/              finanzas (Super Admin)
│   │   ├── agenda/                 tabla (recepción) o calendario (odontólogo)
│   │   ├── whatsapp/               monitor + toggle de IA
│   │   ├── pacientes/              CRUD + búsqueda
│   │   ├── odontologos/            CRUD + comisiones
│   │   ├── tratamientos/           precios
│   │   ├── tasa-cambio/            control cambiario
│   │   ├── consultorios/           salas
│   │   └── configuracion/          ajustes de negocio
│   ├── actions/                    Server Actions
│   └── api/
│       ├── automation/             endpoints para n8n (HMAC)
│       └── export/finanzas/        informe CSV
│
├── backend/                    ← TODO LO DE SERVIDOR
│   ├── prisma/schema.prisma        esquema
│   ├── prisma/migrations/          incl. constraints EXCLUDE
│   └── src/
│       ├── domain/money.ts         reparto 40/60 + conversión a Bs
│       ├── domain/clinic-calendar.ts  días y horas en la zona de la clínica
│       ├── auth/                   Argon2id, NextAuth, guards, HMAC
│       ├── services/               agenda, tasa de cambio, avisos
│       ├── repositories/           abstracción mock ↔ Prisma
│       └── validators/             esquemas Zod
│
├── frontend/                   ← TODO LO DE UI
│   ├── styles/globals.css          sistema de diseño (azul)
│   ├── components/                 layout, iconos SVG, motion
│   └── features/                   una carpeta por sección
│
└── middleware.ts               ← gate de borde + validación de Origin
```

**Regla que sostiene la separación:** `frontend/` nunca importa de `backend/`
salvo tipos (`import type`) y funciones puras de formato.

---

## 7. Seguridad

| Control | Implementación |
|---|---|
| Contraseñas | Argon2id (perfil OWASP): 19 MiB · t=2 |
| Enumeración de usuarios | Hash señuelo → el login tarda igual exista o no la cuenta |
| Fuerza bruta | Rate limit por email+IP · bloqueo tras 5 fallos |
| Sesiones | JWT firmado · cookie `httpOnly` · `SameSite=lax` · `__Secure-` en prod |
| CSRF | NextAuth + validación de Origin en Server Actions y middleware |
| SQL Injection | Prisma parametriza siempre · `$queryRawUnsafe` prohibido |
| XSS | Escapado de React · cero `dangerouslySetInnerHTML` · CSP restrictiva |
| Doble reserva | Constraints `EXCLUDE USING gist` en Postgres |
| Integridad contable | `CHECK (clinicShare + dentistShare = amount)` |
| Auditoría | `audit_logs` de solo inserción, con trigger anti-UPDATE |

**Nota sobre la CSP en desarrollo:** el modo dev de Next.js necesita
`'unsafe-eval'` (react-refresh compila con `eval`). Está permitido **sólo**
cuando `NODE_ENV !== 'production'`; el build de producción mantiene la
directiva estricta. Ver [`next.config.mjs`](next.config.mjs).

---

## 8. Integración con n8n

Tres endpoints con autenticación HMAC-SHA256 sobre el cuerpo crudo:

```
X-Automation-Key-Id:    dck_live_xxxxxxxx
X-Automation-Timestamp: 1786000000              (epoch en SEGUNDOS)
X-Automation-Signature: HMAC-SHA256("{ts}.{body}", AUTOMATION_HMAC_SECRET)
```

| Endpoint | Uso |
|---|---|
| `POST /api/automation/availability` | El bot consulta huecos antes de proponer |
| `POST /api/automation/catalog` | Precios, horarios, tratamientos, personal **y medios de pago** |
| `POST /api/automation/conversation` | ¿Está la IA encendida en este chat? Y quién escribe |
| `POST /api/automation/messages` | Espeja el mensaje en el monitor (idempotente por `wamid`) |
| `POST /api/automation/handoff` | El bot se calla y pide un humano |
| `POST /api/automation/appointments` | Agenda la cita (idempotente) |
| `POST /api/automation/payments` | Reporta el cobro *(persistencia pendiente)* |

### Salida: el panel → n8n → WhatsApp

Cuando un agente responde desde `/whatsapp`, el panel hace un POST a
`WHATSAPP_OUTBOUND_WEBHOOK_URL` **firmado con el mismo HMAC**, para que n8n lo
relaye:

```json
{
  "conversationId": "c...",
  "messageId": "c...",
  "to": "+584141234567",
  "body": "Buenas tardes, le confirmo su cita."
}
```

El panel no habla con Meta directamente a propósito: n8n ya tiene las
credenciales y la sesión de WhatsApp. Duplicar esa integración significaría
mantener dos caminos de salida y dos juegos de credenciales.

**Escribir apaga la IA de ese chat automáticamente.** Es el comportamiento
estándar de cualquier bandeja con bot: si la IA sigue activa, contestará en
paralelo y contradirá al agente delante del paciente. Se reactiva con el
toggle.

El código exacto para el nodo Code de n8n está en
[`backend/src/auth/automation-key.ts`](backend/src/auth/automation-key.ts).

**Regla del contrato:** el cliente envía intención, no consecuencias. No se
aceptan `endsAt` ni `agreedPriceCents` — los calcula el servidor a partir del
tratamiento.

---

## 9. Estado

**Operativo y verificado**

- PostgreSQL real con 601 citas, 328 pagos, 30 pacientes, 12 odontólogos
- Login con Argon2id contra la base de datos
- CRUD completo: pacientes, odontólogos, precios, consultorios, citas
- Dashboard financiero con importes duales USD/Bs
- Exportación CSV del informe financiero
- Tasa BCV en vivo desde DolarAPI, con historial
- Monitor de WhatsApp con toggle de IA
- Notificaciones y mensajes en la barra superior, con datos reales
- `POST /api/automation/{availability,appointments}` completos
- **Rol asistente completo**: panel del turno (`/inicio`), registro de cobros
  desde la agenda, cierre de caja (`/caja`) con desglose por medio de pago
- **Responder por WhatsApp desde el panel**: compositor en el monitor, con
  toma de control automática de la IA y estado de entrega por mensaje
- **Rol odontólogo**: calendario semanal propio, sin tarifas y sin controles
  de estado (ver «`/agenda` son dos pantallas distintas»)
- **Cierre de caja**: cobros pendientes del día + arqueo del efectivo contado,
  con la diferencia calculada en el servidor y reapertura sólo del administrador
- **Medios de pago configurables** en `/configuracion`: el administrador pone
  banco, pago móvil, Zelle… y de ahí se alimentan tanto el bot de WhatsApp
  como el selector de cobro de recepción
- **Responsive completo**: menú lateral fijo, cajón hamburguesa por debajo de
  960 px y tablas que se apilan en tarjetas en el teléfono
- **Prompt para la automatización**: [`docs/PROMPT-N8N.md`](docs/PROMPT-N8N.md)
  — el brief completo para generar el flujo de n8n
- Cobros conectados de extremo a extremo: lo que registra recepción aparece
  al instante en el dashboard del administrador y en la liquidación del
  odontólogo
- **Procedimientos añadidos a una cita**: el paciente viene a una limpieza, el
  odontólogo le ve una caries y se la obtura en la misma sesión. Se añaden
  desde la agenda (botón del diente) y el cobro los suma solo. Ver «Cuando la
  consulta se alarga» más abajo

**Pendiente**

- `POST /api/automation/payments`: seguridad y validación completas; falta la
  transacción de persistencia (está escrita como comentario paso a paso).
- Verificación de `AutomationApiKey` contra la DB (revocación, scopes).
- Búsqueda de pacientes insensible a acentos en Postgres: requiere `unaccent`
  en la consulta (la extensión ya está instalada; ver comentario en
  `listPatients`).
- Rate limit en memoria: migrar a Redis si se despliega en varias instancias.
- Registro público de usuarios: no hay autoservicio, y es deliberado. Las
  cuentas del personal las crea el administrador desde `/odontologos` con
  invitación por correo (ver «Alta de un odontólogo con acceso al panel»).
- **Restablecer la clave de otro**: si a un odontólogo se le pierde el correo
  de invitación, hoy no hay botón para regenerársela. Es lo siguiente que
  toca en esta parte.
- **Recuperar contraseña olvidada** desde el login: requiere token por correo
  con caducidad. El canal (n8n → Gmail) ya está montado por el flujo D.
- **Rate limit en memoria**: si algún día el panel corre en varias
  instancias, los límites del login y de la recuperación hay que moverlos a
  Redis. Con una sola instancia —que es el caso— funcionan.

Lo que falta del panel, ordenado por lo que pidió la clínica, está en
[«Lo que pidió la clínica»](#11-lo-que-pidió-la-clínica).

---

## 10. Comandos

```bash
npm run dev          # desarrollo
npm run build        # build de producción
npm run typecheck    # tsc --noEmit
npm run db:deploy    # aplicar migraciones
npm run db:seed      # poblar con datos de prueba
npm run db:studio    # explorador visual de la DB
```



---

## 11. Lo que pidió la clínica

Las notas de la reunión, una por una, con su estado. Se mantiene el orden y
la redacción original a la derecha para poder contrastarlas con lo pedido.

| Estado | Petición | Dónde está |
|:--:|---|---|
| ✅ | *«historias clínicas para asistente»* | La transcribe recepción en `/pacientes/{id}/expediente`. El odontólogo rellena el papel; recepción lo pasa al sistema |
| ✅ | *«expedientes clínicos»* | Tablas `clinical_records` (uno por paciente) y `clinical_entries` (hoja de evolución) |
| ✅ | *«el resto imprimir, poder tener en físico»* · *«imprimir el tema del historial»* | Botón de imprimir en el expediente, con hoja en blanco para rellenar a mano |
| ✅ | *«los precios varían de acuerdo al tratamiento y también según el odontólogo»* | `/tarifas`. El odontólogo propone, el administrador aprueba. El bot cotiza el precio de ese odontólogo (`dentists[].prices` en `/catalog`). Ver «Quién pone el precio» |
| ✅ | *«tratamiento de conducto varía»* | `Treatment.isPriceVariable`. El bot cotiza «desde $X» en vez de un precio que luego habría que desdecir |
| ✅ | *«radiografía 10$ clínica»* | `Treatment.clinicKeepsAll`: la hace el equipo de la clínica, así que no se reparte 40/60 |
| ✅ | *«algunos consultorios fijos y algunos no»* · *«rotatorio consultorio 2»* | `Room.assignedDentistId`; vacío = rotativo. Al agendar, el consultorio propio se prueba **primero** (`scheduling.service.ts`). Es preferencia, no candado: si está ocupado se da otro, porque bloquearlo dejaría la sala vacía los días que su dueño no viene |
| ✅ | *«poder editar una cita en caso de hacerle más cosas»* | Procedimientos añadidos — ver abajo |
| ✅ | *«9am a 6»* | Jornada por defecto en `scripts/configurar-clinica.mjs` |
| ✅ | *«zelle binance»* | Medios de pago configurables en `/configuracion`, con Zelle y Binance como entradas propias |
| ✅ | *«odontólogos para asistente»* | Recepción ve el **listado**: quién atiende, sus especialidades y cómo localizarlo. Sin comisión, sin producción y sin deuda — y no ocultos, sino **no consultados**. El CRUD con las comisiones sigue siendo del administrador |
| ✅ | *«cada odontólogo tenga su inventario»* | `/instrumental`. Son SUS instrumentos (fórceps, turbina, cureta), no un almacén de insumos: lista de bienes con dueño, cantidad, estado y último servicio |
| ⏳ | *«cirujanos y tal»* | Las especialidades ya existen y el campo ahora **sugiere las que están en uso**, para que no convivan «CIRUGÍA ORAL» y «cirujano». Falta, si lo quieres: que la especialidad restrinja qué tratamientos puede hacer cada quien |
| ✅ | *«agendar desde los odontólogos, escribir al bot y también disponible en la web»* | Las dos vías: **por el bot** (le escribe por WhatsApp, `docs/PROMPT-N8N.md` §5) y **desde el panel** (botón «Agendar» en su calendario). No hay formulario público para pacientes: de eso se encarga el bot |
| ✅ | *«se paga al final del día»* | Bloque «Liquidación del día» en `/caja`: lo que le toca a cada odontólogo por lo cobrado hoy, con su equivalente en Bs, y botón de marcar pagado (sólo administración) |
| ⚠️ | *«bruxismo»* | Creados **Férula de descarga** y **Control de bruxismo** (`scripts/anadir-bruxismo.mjs`). ⚠️ **El precio de la férula, $150, es un marcador**: depende de tu laboratorio. Ajústalo en `/tratamientos` |

### La doctora agenda sus propias citas

Una odontóloga cierra citas por su cuenta: un paciente le escribe directo, o
acuerdan el control al terminar la consulta. Puede hacerlo por **dos vías**, y
las dos son suyas: escribiéndole al bot por WhatsApp, o con el botón
**«Agendar»** de su propio calendario en `/agenda`.

No hay un formulario público para que el paciente se agende solo desde la web:
para eso está el bot.

Las dos vías pasan por el **mismo servicio** (`scheduleAppointment`), el que
usa el bot. No hay una segunda vía de agendamiento con reglas propias — el
solapamiento, la duración, el precio congelado y la asignación de consultorio
se deciden en un solo sitio.

Tres cosas que su formulario **no pregunta**, y ahí está el punto:

- **Para quién es.** Es para ella: el `dentistId` sale de la sesión. Un campo
  en el formulario permitiría meterle una cita a una compañera en su horario.
- **Qué consultorio.** Lo asigna el servidor, probando primero el suyo si
  tiene uno fijo. Elegirlo a mano dejaría ocupar la sala de otra persona.
- **Cuánto cuesta.** Lo congela el servidor desde el tratamiento. En toda su
  parte del panel no viaja ni un importe, y esto no es la excepción.

El paciente se identifica **por teléfono**, no con un selector: ella no tiene
acceso al listado de pacientes de la clínica y no debe tenerlo. Si el número ya
existe se reutiliza su ficha; si no, se crea. Es lo mismo que hace el bot.

Si la hora está ocupada, el error propone **horas alternativas** en vez de
decir sólo «ocupado»: si no, hay que ir probando a ciegas.

### El instrumental es de cada quien

*«Cada odontólogo tenga su inventario.»* Y son **sus instrumentos**: el
fórceps, la turbina, la cureta que trajo él y que se lleva si se va.

Por eso `/instrumental` **no es un almacén de insumos que se descuenta al
usarlos**. Aquí no hay consumo: hay una lista de bienes con dueño, con
cantidad, número de serie, estado y último mantenimiento. Un coworking lo
necesita justo por eso — el material es de cada quien pero convive en salas
compartidas, y cuando algo se pierde o aparece roto hay que saber de quién era.

El odontólogo gestiona el suyo; administración ve el de todos. La comprobación
de propiedad la hace Postgres en el `WHERE` de la propia sentencia
(`updateMany` con el `dentistId`), no leyendo primero y comparando después:
entre esa lectura y la escritura cabría una carrera.

### Cambiar el horario: se pide, no se toma

El horario semanal es lo que el bot usa para ofrecer huecos, así que no lo
cambia cada quien por su cuenta. En `/horarios` el odontólogo **propone su
semana completa** y recepción o administración la aprueban.

Tres reglas, todas por el mismo motivo — que el horario es lo que decide qué
citas se pueden agendar:

- **Se propone la semana entera**, no un cambio suelto. Se aprueba o se
  rechaza completa: una aprobación parcial dejaría un horario que nadie
  propuso.
- **Aprobar APLICA el horario**, en la misma transacción. Separarlo dejaría
  una solicitud aprobada con el bot ofreciendo todavía las horas viejas, y
  nadie mirando la pantalla notaría la diferencia.
- **Una sola solicitud pendiente por odontólogo**, forzada por un índice único
  parcial en Postgres. Dos esperando dejarían a recepción sin saber cuál es la
  buena.

Recepción SÍ entra aquí, al revés que en `/tarifas`: quién trabaja cuándo es
exactamente su trabajo. Lo que no ve es cuánto cobra cada quien.

### Se paga al final del día

En `/caja`, debajo del arqueo: lo que le corresponde a cada odontólogo por lo
cobrado **ese día**, con su equivalente en bolívares —que es como se entrega
el dinero— y un botón de marcar pagado. Sólo administración: recepción
registra cobros y cuenta la caja, pero entregar dinero es otra decisión.

Va **después** del arqueo a propósito: primero se sabe cuánto entró y que el
efectivo cuadra, y sólo entonces se reparte.

Lo que se paga es el `dentistShareCents` que ya se congeló en cada cobro, **no
se recalcula**: ese número se fijó con la comisión vigente en ese momento, y
recalcularlo hoy cambiaría lo que se debe por trabajo ya hecho.

Pagar **engancha los cobros** a la liquidación (`payoutId`), así que dejan de
aparecer como pendientes. Eso es lo que impide pagar dos veces lo mismo, y hay
además un `unique` por (odontólogo, día) en Postgres. No hay botón de
deshacer: se corrige con un ajuste, no borrando el rastro.

### Alta de un odontólogo con acceso al panel

Al crear un odontólogo hay una casilla: **«Crear su cuenta de acceso»**. Es
opcional a propósito — a un odontólogo se le agendan citas y se le liquida
igual sin que entre nunca, y cada acceso vivo es superficie de ataque.

Cuando se marca:

1. El servidor **genera** una contraseña de 16 caracteres (`crypto.randomInt`,
   sin `O/0/l/1/I` porque se teclea desde un correo).
2. Cuenta y perfil se crean **en la misma transacción**. O las dos cosas o
   ninguna: un odontólogo sin la cuenta que se le prometió, o una cuenta
   huérfana que entra al panel sin perfil, son estados igual de malos.
3. Se le pide a **n8n** que mande el correo (flujo D, `STAFF_EMAIL_WEBHOOK_URL`).
   El panel no habla con Gmail — la credencial vive en n8n, igual que la de
   WhatsApp.
4. La cuenta nace con `mustChangePassword`, y **el layout no la deja navegar a
   ninguna otra sección** hasta que la cambia.

La contraseña **nadie del equipo la ve**: se genera, se hashea y se manda. No
se guarda en claro ni se devuelve a la interfaz, así que no acaba en el HTML,
ni en el historial del navegador, ni en una captura. Si el correo falla, no se
puede reenviar la misma — hay que generar otra.

**El orden importa: primero la base, después el correo.** Al revés, un fallo
al guardar dejaría a alguien con una clave por correo para una cuenta que no
existe. Como está, un fallo de correo deja la cuenta creada y la interfaz
avisa de que hay que hacerle llegar la clave por otra vía.

### Cambiar la contraseña

`/cambiar-clave`, para cualquier rol, sobre su propia cuenta. Pide la
contraseña **actual** aunque ya haya sesión: una sesión abierta en un equipo
compartido no debería bastar para quedarse con la cuenta.

Al cambiarla se **cierran todas las sesiones**, incluida la del navegador que
la está cambiando. El motivo habitual para cambiar una clave es sospechar que
alguien la tiene; dejarle la sesión abierta a ese alguien vacía la operación
de sentido.

> **Esto arregló un agujero real.** `sessionsValidFrom` existía en el esquema
> desde el principio, con un comentario que decía que invalidaba las sesiones
> al cambiar la contraseña — pero **no se comparaba en ningún sitio**: se
> escribía y no lo leía nadie. Ahora `getCurrentUser()` lo contrasta contra la
> base en cada petición autenticada, junto con `status` y `deletedAt`. Un
> token firmado sólo demuestra que este servidor lo emitió alguna vez; no dice
> nada de lo que ha pasado desde entonces.

### Si se pierde la contraseña

Dos caminos, y los dos usan el mismo canal de correo (flujo D de n8n):

**El administrador se la restablece** — botón «Restablecer clave» en
`/odontologos`, sólo visible si esa persona tiene cuenta. Genera una clave
nueva, se la manda y **cierra sus sesiones abiertas**: si hay que
restablecerle la clave a alguien es porque perdió el control de la cuenta o
del correo, y dejar viva la sesión de quien la tenga no arreglaría nada.

**Ella la recupera sola** — enlace «¿Olvidaste tu contraseña?» en el login,
que lleva a `/recuperar`. Llega un enlace de un solo uso que **caduca en una
hora**.

Cuatro decisiones que conviene no deshacer al tocar esto:

- **La respuesta es siempre la misma**, exista la cuenta o no. Si dijera «ese
  correo no está registrado», el formulario sería una forma de averiguar qué
  correos tienen cuenta en la clínica — y con esa lista, un objetivo para
  adivinar contraseñas. Ni siquiera al aplicar el límite cambia el mensaje:
  uno distinto delataría que ese correo recibió intentos.
- **Se guarda el hash del token, no el token.** Con el token en claro,
  cualquiera con acceso de lectura a la base —un volcado, una copia de
  seguridad— podría tomar el control de cualquier cuenta. SHA-256 basta aquí,
  a diferencia de las contraseñas: son 256 bits de entropía generados por el
  servidor, no hay diccionario que los ataque.
- **Un solo uso, y pedir otro quema el anterior.** Sin lo primero, quien
  reenvíe el correo entra otra vez; sin lo segundo, cada solicitud sumaría
  una llave viva más.
- **«No existe», «caducado» y «ya usado» dan el mismo error.**
  Distinguirlos permitiría sondear tokens.

Ninguna de las dos vías devuelve la contraseña a la pantalla, ni siquiera si
el correo falla: ya está hasheada y no hay forma de recuperarla. Devolverla
la dejaría en el HTML, en el historial del navegador y en cualquier captura.

### Quién pone el precio

*«Los precios varían de acuerdo al tratamiento, y también según el
odontólogo.»* Un cirujano con veinte años cobra la exodoncia distinto que
quien acaba de entrar.

En `/tarifas`, **el odontólogo propone y el administrador aprueba**. Es una
ruta con dos pantallas, igual que `/agenda`:

| | Odontólogo | Super Admin |
|---|---|---|
| Qué ve | sólo sus tarifas | las de todos |
| Qué puede hacer | proponer | crear, aprobar, rechazar, eliminar |
| En qué estado nace lo que guarda | `PENDING` | `APPROVED` |

Recepción no entra: no decide cuánto cobra nadie.

**Mientras esté pendiente, no se aplica.** Se sigue cobrando el precio de
lista. Es lo que impide que tener cuenta de odontólogo baste para cambiar lo
que se le cobra a un paciente — `createPayment` sólo mira los `APPROVED`.

Dos cosas **no** viajan en el formulario, y las dos por el mismo motivo:

- **El estado.** Lo decide el servidor según el rol de quien envía. Si
  llegara del cliente, un odontólogo podría aprobarse su propia tarifa.
- **El odontólogo.** Cuando propone un odontólogo, su id sale de la sesión.
  Si el formulario trae otro, se rechaza en vez de corregirlo por lo bajo:
  o es un error de programación o es un intento de tocarle la tarifa a otro,
  y en ambos casos conviene que se note.

Se puede pactar sólo el precio, sólo el reparto, o los dos. Lo que se deje
vacío sigue las reglas normales. Rechazar **exige un motivo**: sin él, lo
normal es que se vuelva a proponer exactamente lo mismo.

### Cuando la consulta se alarga

*«Poder editar una cita en caso de hacerle más cosas.»* El paciente viene a
una limpieza, el odontólogo ve una caries y se la obtura ahí mismo. Se agendó
por una cosa y hay que cobrar por dos.

Desde la agenda, el botón del diente abre los **procedimientos de la cita**:
se añade lo que se hizo de más y el cobro lo suma solo.

Lo que **no** hace es subir el precio de la cita, que sería lo más rápido:

- `agreedPriceCents` es el precio **congelado al agendar**. La diferencia
  entre lo que se cotizó y lo que se acabó cobrando es justo el dato que
  revela si el bot está cotizando mal. Machacarlo borra esa evidencia.
- **Cada línea se reparte por su cuenta.** Una limpieza va al 40/60 y una
  radiografía se la queda entera la clínica. Un único importe no puede
  representar dos repartos: con $30 de limpieza y $10 de radiografía, aplicar
  un solo porcentaje al total le pagaría al odontólogo parte de un trabajo que
  no hizo. El reparto correcto es $22 clínica / $18 odontólogo — un 55 %
  efectivo, que no es la media de los porcentajes.

El porcentaje **no viaja en el formulario**: lo deriva el servidor del
tratamiento y del acuerdo aprobado con el odontólogo. Si se aceptara del
cliente, se podría añadir una radiografía marcada como repartible y cobrar
comisión por un trabajo de la clínica.

Una cita **ya cobrada no admite cambios** en sus conceptos: el cobro congeló
el reparto, y añadir una línea después dejaría un pago que no cuadra con la
suma de sus partes. Para corregirla hay que anular el cobro primero.