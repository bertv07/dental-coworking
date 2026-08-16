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
| `/agenda` — citas + cobros | ✅ | ✅ | calendario, sólo lectura |
| `/caja` — cierre del día | ✅ | ✅ | 🔒 |
| `/whatsapp` — monitor IA | ✅ | ✅ | 🔒 |
| `/pacientes` | ✅ | ✅ | 🔒 |
| `/tasa-cambio` | ✅ | ✅ | 🔒 |
| `/odontologos`, `/tratamientos`, `/consultorios`, `/configuracion` | ✅ | 🔒 | 🔒 |
| Barra superior: buscador, mensajes, notificaciones | ✅ | ✅ | — |
| Sidebar: tarjeta «Precios en USD» | ✅ | ✅ | — |

Al odontólogo no se le pintan esos controles porque las tres cosas llevan a
secciones que su rol no abre (`/pacientes`, `/whatsapp`, `/tasa-cambio`), y
los avisos hablan de pacientes de toda la clínica. **No se ocultan con CSS: no
se consultan**, así que esos datos no llegan a su navegador.

> Para cambiarlas, edita `MOCK_CREDENTIALS` en
> [`backend/src/mock/data.ts`](backend/src/mock/data.ts) y vuelve a ejecutar
> `npm run db:seed`. El hash se recalcula solo.

### `/agenda` son dos pantallas distintas

La ruta es la misma; lo que se sirve depende del rol, porque el trabajo es
otro.

**Recepción y administración** ven la tabla de toda la clínica: alta,
reprogramación, cambio de estado y cobro.

**El odontólogo** ve un **calendario semanal de sus propias citas**, en modo
lectura. De cada cita muestra hora, paciente, tratamiento, consultorio, origen
y si está confirmada. Se navega entre semanas con `?semana=YYYY-MM-DD` y al
pinchar una cita se abre el detalle con el teléfono y las notas de recepción.

Dos cosas que **no** tiene, a propósito:

- **Ningún importe.** No es que la columna esté oculta: la consulta
  (`listDentistAgenda`) no selecciona `agreedPriceCents`, así que el precio no
  sale de Postgres. Un dato que no viaja no se puede leer abriendo las
  herramientas del navegador. El odontólogo cobra por liquidación mensual, no
  por cita.
- **Ningún control de estado.** Confirmar, cancelar o marcar una inasistencia
  implica hablar con el paciente, y eso es de recepción. Aquí el estado sólo se
  lee: *Confirmada*, *Por confirmar*, *Atendida*, *Cancelada*, *No asistió*.

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

**7. Cargar los datos iniciales.** Sólo la primera vez, desde `panel` → Console:

```bash
node /opt/prisma-cli/node_modules/prisma/build/index.js db seed --schema backend/prisma/schema.prisma
```

> El seed trae 30 pacientes y 600 citas de ejemplo. Para una clínica real
> sáltatelo y crea sólo el usuario administrador.

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

**Pendiente**

- `POST /api/automation/payments`: seguridad y validación completas; falta la
  transacción de persistencia (está escrita como comentario paso a paso).
- Verificación de `AutomationApiKey` contra la DB (revocación, scopes).
- Búsqueda de pacientes insensible a acentos en Postgres: requiere `unaccent`
  en la consulta (la extensión ya está instalada; ver comentario en
  `listPatients`).
- Rate limit en memoria: migrar a Redis si se despliega en varias instancias.
- Registro público de usuarios: hoy las cuentas se crean por seed. El hasheo
  y la validación ya existen; falta la pantalla.

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
