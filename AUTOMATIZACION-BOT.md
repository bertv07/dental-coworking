# API de automatización — lo que el bot de WhatsApp necesita

Todo lo que n8n tiene que saber para agendar citas, consultar horarios y
hablar con el panel. Y al final, lo que **yo necesito de ti** para que la
otra mitad (el panel escribiéndole al paciente) funcione.

Base URL en producción: `https://TU-DOMINIO` · en desarrollo: `http://localhost:3000`

---

## 1. Autenticación — las 3 cabeceras

**Todos** los endpoints de `/api/automation/*` son `POST` y van firmados con
HMAC-SHA256. No hay token estático: se firma el cuerpo de cada petición.

```
Content-Type: application/json
X-Automation-Key-Id: dck_live_xxxxxxxx     ← etiqueta, para auditoría
X-Automation-Timestamp: 1786000000         ← epoch en SEGUNDOS
X-Automation-Signature: <hex>              ← HMAC-SHA256("{timestamp}.{body}")
```

Lo que autentica de verdad es la **firma**. El secreto es
`AUTOMATION_HMAC_SECRET` (el mismo que está en el `.env` del panel) y nunca
viaja por la red.

La firma caduca a los **5 minutos** (`AUTOMATION_SIGNATURE_TOLERANCE_SECONDS`).
Si n8n y el servidor tienen el reloj desincronizado, todo devolverá 401.

### Nodo Code de n8n (poner antes de cada HTTP Request)

```javascript
const crypto = require('crypto');

const body = JSON.stringify($json.payload);          // el cuerpo, ya como texto
const ts = Math.floor(Date.now() / 1000);
const signature = crypto
  .createHmac('sha256', $env.AUTOMATION_HMAC_SECRET)
  .update(`${ts}.${body}`)
  .digest('hex');

return [{ json: {
  body,
  headers: {
    'Content-Type': 'application/json',
    'X-Automation-Key-Id': 'dck_live_n8n',
    'X-Automation-Timestamp': String(ts),
    'X-Automation-Signature': signature,
  },
}}];
```

> ⚠️ **El cuerpo que se firma y el que se envía tienen que ser el MISMO texto,
> carácter por carácter.** Si en el nodo HTTP Request vuelves a construir el
> JSON, cambia el orden de las claves o los espacios y la firma deja de
> coincidir → 401. Manda `body` tal cual, como raw/string.

---

## 2. El flujo de agendar, en orden

Este es el orden correcto. Saltarse el paso 1 es lo que hacía que no agendara.

```
   mensaje entra
        │
        ▼
 ① /conversation ──► ¿la IA está encendida en este chat?  (si no: callarse)
        │
        ▼
 ② /catalog ──────► ¿qué tratamientos existen y cómo se llaman sus códigos?
        │
        ▼
 ③ /availability ─► ¿qué horas hay libres ese día?
        │
        ▼
 ④ /appointments ─► agendar el hueco que el paciente eligió
        │
        ▼
 ⑤ /messages ─────► copiar al panel lo que se dijo (paciente y bot)
```

---

## 3. Endpoints

### ① `POST /api/automation/conversation` — ¿puedo contestar?

**La primera llamada de cada mensaje entrante, siempre.** Dice si recepción
apagó la IA en ese chat. Si está apagada, el bot no responde nada.

No se cachea: el interruptor lo mueve una persona desde el panel en mitad de
la conversación. Si el número no existía, la conversación se crea aquí.

```json
{ "phone": "+584141234567", "displayName": "Juan" }
```

Respuesta: `{ "ok": true, "data": { "conversationId", "phone", "aiEnabled", ... } }`

---

### ② `POST /api/automation/catalog` — tratamientos, precios y horario

Cuerpo: `{}` (vacío, pero **firmado igual**).

Devuelve lo que la clínica tiene cargado **ahora mismo**: nombre de la
clínica, horario de atención, tratamientos activos con su código, duración y
precio, odontólogos, consultorios y medios de pago.

```json
{ "ok": true, "data": {
  "clinic":   { "name", "phone", "address", "timezone", "opensAt": "09:00", "closesAt": "18:00" },
  "currency": { "base": "USD", "quote": "VES", "rate": 977.87, "source": "EURO", "stale": false },
  "treatments": [ { "code": "CONSULTA", "name": "Consulta y valoración",
                    "durationMinutes": 45, "priceUsd": 30, "priceCents": 3000, "priceBs": 29336 } ],
  "dentists": [ { "id", "name", "specialties" } ],
  "rooms":    [ { "id", "code", "name" } ],
  "paymentMethods": [ { "label": "Pago móvil", "kind": "TRANSFER", "currency": "VES" } ]
} }
```

> **Los precios de lista están en DÓLARES y se cobran en bolívares a la tasa
> del EURO.** No es un error: es como opera la clínica. El campo `rate` ya
> viene con la tasa correcta aplicada — el bot no debe convertir por su cuenta.

> ⚠️ **El bot NO debe llevar los códigos escritos a mano en el flujo.** Los
> códigos cambian cuando la clínica actualiza su lista de precios. Lee este
> endpoint al empezar la conversación (o cachéalo unos minutos) y usa esos.
> Códigos viejos como `LIMPIEZA` o `RESINA` **ya están desactivados**.

---

### ③ `POST /api/automation/availability` — qué horas hay libres

```json
{
  "treatmentCode": "CONSULTA",
  "date": "2026-09-17T00:00:00-04:00",
  "dentistId": "c...",     // opcional: sólo si el paciente pidió a alguien
  "maxSlots": 6            // opcional, 1-20
}
```

Respuesta con huecos:

```json
{ "ok": true, "data": {
  "treatmentCode": "CONSULTA",
  "today": "2026-09-15",
  "slots": [ { "startsAt": "2026-09-17T13:00:00.000Z",
               "endsAt":   "2026-09-17T13:45:00.000Z",
               "dentistId": "c...", "dentistName": "Dr. Andrés Perdomo",
               "roomId": "c...", "roomCode": "C1" } ]
} }
```

`today` va en todas las respuestas para que el modelo no tenga que adivinar
en qué día vive (una vez pidió «17 de enero» estando en septiembre).

**Cuando `slots` viene vacío, viene también `reason`, y cada uno se trata
distinto:**

| `reason` | Qué significa | Qué debe hacer el bot |
|---|---|---|
| `LLENO` | Ese día no queda hueco | Ofrecer otra fecha |
| `CERRADO` | Ese día la clínica no atiende | Ofrecer otro día de la semana |
| `PASADO` | La fecha ya pasó | Confirmar la fecha; hoy es `today` |
| `TRATAMIENTO_DESCONOCIDO` | El código no existe o está desactivado | **NO ofrecer otra fecha** — releer `/catalog` y usar un código válido |

> Este último era el fallo: con un código viejo la lista salía vacía sin
> explicación, el bot lo leía como «día lleno» y ofrecía otra fecha… que
> también salía vacía. La conversación entraba en bucle y nunca agendaba.

---

### ④ `POST /api/automation/appointments` — agendar

```json
{
  "patientPhone":   "+584141234567",
  "patientName":    "Juan Herrera",
  "treatmentCode":  "CONSULTA",
  "startsAt":       "2026-09-17T13:00:00.000Z",
  "dentistId":      "c...",
  "idempotencyKey": "wa-msg-4821"
}
```

`startsAt` se copia **tal cual** del slot que devolvió `/availability`.

**`idempotencyKey` es obligatorio y único por intención.** Usa el id del
mensaje de WhatsApp. Es lo que impide que un reintento de n8n por timeout
cree la cita dos veces.

**No mandes `endsAt` ni el precio**: los calcula el servidor a partir del
tratamiento. Si los mandas, se ignoran.

| Código | Qué pasó | Qué hacer |
|---|---|---|
| `201` | Cita creada | Confirmarle al paciente |
| `200` | Esa `idempotencyKey` ya existía | Es la misma cita, no dupliques |
| `400` | Validación (`error.details` dice el campo) | Revisar el cuerpo |
| `401` | Firma ausente, inválida o caducada | Revisar reloj y secreto |
| `404` | El `treatmentCode` o el `dentistId` no existen | Releer `/catalog` |
| `409` | El hueco se ocupó mientras conversaban | Trae `suggestedSlots`: ofrecerlos |
| `429` | Rate limit | Respetar `Retry-After` |
| `500` | Error interno | Pasar `error.requestId` al soporte |

El `409` pasa de verdad: entre que el bot ofrece y el paciente responde,
recepción puede haber agendado a alguien ahí. Por eso la respuesta ya trae
alternativas.

---

### ⑤ `POST /api/automation/messages` — copiar la conversación al panel

**Dos llamadas por turno**: una con lo que escribió el paciente, otra con lo
que respondió el bot. Sin esto, recepción ve media conversación en el monitor
y no puede retomar el chat.

```json
{
  "phone": "+584141234567",
  "direction": "INBOUND",
  "author": "PATIENT",
  "body": "quiero una cita para limpieza",
  "mediaUrl": "https://..."
}
```

Para audios e imágenes: el panel **no transcribe**. n8n transcribe/describe
antes y manda el texto resultante en `body`, más el `mediaUrl` del original
para que el agente humano pueda oírlo si la transcripción es dudosa.

---

### ⑥ `POST /api/automation/handoff` — pasar a una persona

Apaga la IA en ese chat **y** marca la conversación como «requiere atención».

```json
{ "phone": "+584141234567", "reason": "El paciente pidió hablar con alguien" }
```

**Cuándo llamarlo:** lo pide el paciente · consulta clínica que necesita
criterio profesional (dolor, urgencia, diagnóstico, medicación) · reclamo o
discusión por un cobro · el modelo no entiende tras dos intentos.

Después de esta llamada el bot **no envía nada más** a ese número. Si quieres
un «te paso con una persona del equipo», mándalo **antes**.

La IA vuelve sola tras unas horas de silencio (4 h por defecto), o cuando
alguien la enciende en el panel.

---

### ⑦ `POST /api/automation/promotions` — qué ofrecer

Cuerpo: `{}`. Devuelve sólo las **vigentes** (la vigencia se filtra aquí, no
en el flujo de n8n).

Cada promoción trae `pitch`: una frase ya redactada para decirla tal cual.

> **El bot ofrece; el descuento lo aplica recepción al facturar.** El bot no
> calcula el precio final: dos promociones a la vez o un caso raro acabarían
> en un importe que nadie puede sostener en el mostrador.

---

### ⑧ `POST /api/automation/media` — descargar un archivo para enviarlo

```json
{ "mediaId": "c..." }
```

Devuelve el binario (o `{"format":"base64"}` si lo prefieres así). n8n lo
sube a la Media API de Meta y manda el mensaje por `media_id`.

---

### ⑨ `POST /api/automation/payments` — ⚠️ todavía no conectado

La seguridad está completa, pero **la persistencia no está implementada**
(marcada como `TODO(db)`). Hoy la facturación y los cobros se hacen desde el
panel. **No lo uses todavía** — dime si lo necesitas y lo conecto.

---

## 4. Lo que yo necesito de ti (del lado de n8n)

Esto es lo que falta para que el panel pueda **escribirle** al paciente. Hoy
recepción escribe desde el monitor y el mensaje se guarda, pero queda en
`PENDING` porque no hay a dónde entregarlo.

### 4.1 La URL del webhook de n8n — **esto es lo único bloqueante**

En el `.env` del panel está vacío:

```
WHATSAPP_OUTBOUND_WEBHOOK_URL=""     ← me falta esto
```

Necesito la URL de un webhook en n8n que reciba el mensaje y lo mande por
WhatsApp. El panel le hará `POST` con **la misma firma HMAC** (mismas tres
cabeceras), así que n8n tiene que verificarla igual.

**Lo que le voy a mandar a ese webhook:**

```json
{
  "conversationId": "c...",
  "messageId": "c...",
  "to": "+584141234567",
  "body": "Buenas tardes, le confirmamos su cita para el jueves 3pm.",
  "media": null
}
```

Cuando lleve adjunto, `media` viene así — y el archivo se pide aparte con
`POST /api/automation/media` (va por referencia para no meter radiografías de
pacientes en el historial de ejecuciones de n8n):

```json
"media": { "mediaId": "c...", "messageId": "c...", "mimeType": "image/png", "filename": "radiografia.png" }
```

Que responda `2xx` si lo entregó. Si responde error, el mensaje queda marcado
`FAILED` en el panel y recepción lo ve.

### 4.2 Al mismo webhook llegan también los avisos de encendido/apagado de la IA

```json
{ "event": "ai.disabled", "conversationId": "c...", "phone": "+58...",
  "aiEnabled": false, "reason": "...", "changedBy": "Paula Gómez",
  "at": "2026-09-15T18:00:00.000Z" }
```

Sirve para que n8n deje de responder en ese chat sin tener que preguntar.
Aun así, **sigue llamando a `/conversation` en cada mensaje**: ese evento es
un atajo, no la fuente de verdad.

### 4.3 Reglas que el flujo debe respetar

1. **Llamar a `/conversation` en cada mensaje entrante.** Sin excepción.
2. **Leer los códigos de `/catalog`, no escribirlos en el flujo.**
3. **`idempotencyKey` único por intención**, sacado del id del mensaje.
4. **Tratar `TRATAMIENTO_DESCONOCIDO` distinto del resto**: releer catálogo,
   no ofrecer otra fecha.
5. **No inventar precios ni convertir a bolívares por tu cuenta**: usa
   `priceUsd`/`priceBs` y `rate` del catálogo.
6. **Ante `409`, ofrecer los `suggestedSlots`** que vienen en la respuesta.
7. **Reloj sincronizado** (NTP) o todo dará 401.

---

## 5. Qué le falta a la clínica por configurar

Cosas del panel, no de n8n, que afectan a lo que el bot puede ofrecer:

- **Horarios de los odontólogos** — ya están cargados (13 odontólogos,
  lunes a sábado). Si alguien no trabaja un día, el bot ya no lo ofrece.
- **Tratamientos activos** — hay **17 activos**. Los 11 viejos del arranque
  (`LIMPIEZA`, `RESINA`, `ORTHO_CTRL`…) están **desactivados**: si el bot los
  pide, recibirá `TRATAMIENTO_DESCONOCIDO`.
- **Zona horaria** — `America/Caracas`. Ya es el valor por defecto del
  sistema, pero conviene dejar `CLINIC_TIMEZONE="America/Caracas"` explícito
  en el despliegue.

---

## 6. Probado y funcionando

Flujo completo verificado contra el servidor real el 15/09/2026:

```
[0] código desactivado  → 200  reason: TRATAMIENTO_DESCONOCIDO ✔
[1] /catalog            → 200  17 tratamientos, tasa EURO 977,87 ✔
[2] /availability       → 200  4 huecos reales con odontólogo y consultorio ✔
[3] /appointments       → 201  cita creada ✔
```
