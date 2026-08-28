# Prompt para generar el flujo de n8n

> Copia **todo** lo que hay debajo de la línea y pégalo en la otra IA. Está
> escrito para que devuelva el JSON de un workflow importable en n8n.
>
> Antes de pegarlo, sustituye los marcadores del bloque «Variables»:
> `PANEL_URL`, `HMAC_SECRET` y las credenciales de WhatsApp.
>
> El flujo D (correos al personal: alta, restablecimiento y recuperación de
> contraseña) necesita además una credencial de **Gmail** conectada en n8n, y
> que apuntes `STAFF_EMAIL_WEBHOOK_URL` del panel a la URL de ese webhook.
>
> Si el panel y n8n corren en el mismo servidor (EasyPanel), `PANEL_URL` es la
> dirección **interna** — `http://panel:3000` — no el dominio público.

---

Eres un ingeniero especialista en n8n. Necesito que me devuelvas el **JSON
completo de un workflow de n8n** (importable con «Import from File»), sin
explicaciones antes ni después: solo el JSON.

El workflow es el asistente de WhatsApp de una clínica odontológica en
Venezuela. Ya existe un panel web con su base de datos y su API; **tu flujo no
guarda estado propio**: todo lo consulta y lo escribe contra esa API.

---

## 1. Variables de entorno del workflow

Declara estas variables en n8n y úsalas en todos los nodos (nunca escribas los
valores a mano dentro de un nodo):

| Variable | Valor | Para qué |
|---|---|---|
| `PANEL_URL` | `http://panel:3000` | Base de la API |
| `HMAC_SECRET` | `<el AUTOMATION_HMAC_SECRET del panel>` | Firma de cada petición |
| `WA_PHONE_ID` | id del número de WhatsApp Business | Enviar mensajes |
| `WA_TOKEN` | token de Meta | Enviar mensajes |
| `OPENAI_KEY` | clave del modelo | Redacción, audio e imagen |
| credencial de **Gmail** | cuenta de la clínica, por OAuth2 | Correos al personal (flujo D) |

La credencial de Gmail se configura como **credencial de n8n**, no como
variable: n8n la guarda cifrada y la renueva sola. Una contraseña de
aplicación escrita en un nodo acaba en el JSON del workflow, y ese JSON se
exporta y se comparte.

### Sobre `PANEL_URL`: la dirección interna

El panel y n8n corren en el **mismo servidor**, cada uno en su contenedor. Se
alcanzan por el nombre del servicio dentro de la red del proyecto:

```
http://panel:3000        ← correcto
https://panel.dominio.com ← funciona, pero sale a internet y vuelve
```

Usa la interna. No depende del DNS ni del certificado para algo que ocurre en
la misma máquina, no paga el viaje de ida y vuelta en cada mensaje, y el
tráfico con datos de pacientes no sale del servidor.

`http://` sin TLS es correcto **aquí**: es una red privada entre contenedores,
no alcanzable desde fuera. La firma HMAC se sigue aplicando igual — protege
frente a cualquier otro contenedor del servidor, no sólo frente a internet.

Los webhooks del panel hacia n8n van en el mismo sentido:
`http://n8n:5678/webhook/...`.

---

## 2. Cómo se autentica CADA llamada al panel

Todas las peticiones son `POST` con `Content-Type: application/json` y estas
tres cabeceras:

```
X-Automation-Key-Id: n8n-principal
X-Automation-Timestamp: <epoch en SEGUNDOS>
X-Automation-Signature: <HMAC-SHA256 en hex de "<timestamp>.<cuerpo exacto>">
```

La firma se calcula sobre **la cadena exacta que se envía como cuerpo**. Si
serializas el objeto dos veces (una para firmar y otra para enviar) y el
resultado difiere en un espacio o en el orden de las claves, el panel responde
`401`. Firma la cadena y envía **esa misma cadena**.

Incluye en el workflow un nodo **Code** reutilizable que haga esto:

```js
const crypto = require('crypto');
const body = JSON.stringify($json.payload);          // se serializa UNA vez
const ts = Math.floor(Date.now() / 1000).toString();
const signature = crypto
  .createHmac('sha256', $env.HMAC_SECRET)
  .update(`${ts}.${body}`)
  .digest('hex');
return [{ json: { body, ts, signature } }];
```

El timestamp caduca a los **300 segundos**. No reutilices firmas ni las
guardes.

Todas las respuestas tienen la forma `{ "ok": true, "data": {...} }` o
`{ "ok": false, "error": { "code", "message", "requestId" } }`.

---

## 3. Los endpoints del panel

### 3.1 `POST /api/automation/conversation` — ¿puedo responder?

**Es la primera llamada de todo mensaje entrante. Sin excepción.**

```json
{ "phone": "+584141234567", "displayName": "Juan" }
```

Respuesta:

```json
{
  "ok": true,
  "data": {
    "conversationId": "c...",
    "phone": "+584141234567",
    "aiEnabled": true,
    "aiDisabledReason": null,
    "aiAutoResumeAt": null,
    "needsHumanAttention": false,
    "patientId": "c..." | null,
    "patientName": "Juan Pablo Marcano" | null,
    "isNewConversation": false,
    "contact": {
      "role": "PATIENT" | "DENTIST" | "ASSISTANT" | "ADMIN" | "UNKNOWN",
      "name": "Dra. Gabriela Ferreira" | null,
      "dentistId": "c..." | null
    }
  }
}
```

**Si `aiEnabled` es `false`: registra el mensaje (§3.4) y TERMINA el flujo. No
generes ni envíes nada.** Significa que una persona del equipo tomó ese chat
desde el panel. Que el bot siga contestando en paralelo es el peor fallo
posible de este sistema: el paciente recibe dos respuestas que se contradicen.

**El bot puede volver solo.** Cuando la IA se apaga porque recepción escribió
en el chat o porque el propio bot escaló (§3.6), el sistema anota en
`aiAutoResumeAt` a partir de cuándo puede volver — por defecto 4 horas de
silencio, configurable en el panel.

No tienes que hacer NADA con ese campo: cuando llegue el momento, este mismo
endpoint te devolverá `aiEnabled: true` y seguirás el flujo normal. Se te
enseña sólo para que el flujo pueda registrarlo y para poder depurar por qué
un chat sigue mudo.

`aiAutoResumeAt: null` con `aiEnabled: false` significa que la IA la apagó una
persona a mano: ese chat NO vuelve solo y hay que respetarlo.

No cachees este dato. El interruptor lo mueve una persona en cualquier
momento; una copia de hace treinta segundos ya puede estar equivocada.

### 3.2 `POST /api/automation/catalog` — precios, horarios y personal

Cuerpo: `{}` (se firma igual, aunque vaya vacío).

```json
{
  "ok": true,
  "data": {
    "clinic":   { "name", "phone", "address", "timezone",
                  "opensAt": "08:00", "closesAt": "18:00", "slotMinutes": 30 },
    "currency": { "base": "USD", "quote": "VES", "rate": 771.07,
                  "source": "BCV", "fetchedAt": "...", "stale": false },
    "treatments": [
      { "code": "CONSULTA", "name": "Consulta y valoración",
        "category": "DIAGNÓSTICO",
        "description": "Evaluación + diagnóstico + presupuesto. Incluye limpieza, ultrasonido, profilaxis, desmanchador y flúor.",
        "durationMinutes": 45,
        "priceCents": 3000, "priceUsd": 30, "priceBs": 23132.14,
        "isPriceVariable": false },
      { "code": "BASE_CAV_M", "name": "Base cavitaria — caries pequeña con base",
        "category": "OPERATORIA",
        "description": "Caries pequeña ($35) más base cavitaria ($10).",
        "durationMinutes": 60, "priceUsd": 45,
        "isPriceVariable": false },
      { "code": "ENDO_BI", "name": "Endodoncia birradicular",
        "category": "ENDODONCIA",
        "description": "Dos tratamientos de conducto.",
        "durationMinutes": 120, "priceUsd": 140,
        "isPriceVariable": false }
    ],
    "dentists": [
      { "id": "c...", "name": "Dra. Gabriela Ferreira",
        "specialties": ["ORTODONCIA"],
        "prices": [] },
      { "id": "c...", "name": "Dr. Andrés Perdomo",
        "specialties": ["CIRUGIA"],
        "prices": [
          { "code": "EXODONCIA", "name": "Exodoncia simple",
            "priceCents": 5000, "priceUsd": 50, "priceBs": 38553.57,
            "isPriceVariable": false }
        ] }
    ],
    "rooms":    [ { "id": "c...", "code": "C1", "name": "Consultorio 1" } ],
    "paymentMethods": [
      { "label": "Pago móvil",
        "kind": "TRANSFER",
        "currency": "VES",
        "instructions": "Banco: 0102 Banco de Venezuela\nTeléfono: 0412-000-0000\nRIF: J-40123456-7" },
      { "label": "Zelle", "kind": "TRANSFER", "currency": "USD",
        "instructions": "Correo: pagos@clinica.com" },
      { "label": "Efectivo", "kind": "CASH", "currency": "VES",
        "instructions": "Se paga en recepción al terminar la consulta." }
    ]
  }
}
```

**Regla que no se negocia: NO escribas precios, nombres de tratamientos,
horarios ni nombres de odontólogos dentro del prompt del modelo.** Todo sale
de esta llamada, al principio de cada conversación (puedes cachearla como
mucho 10 minutos).

El motivo: si la clínica sube la ortodoncia de $350 a $380 desde el panel, el
bot tiene que cotizar $380 en la siguiente respuesta sin que nadie toque n8n.
Con los precios escritos en el prompt, el bot cotiza cifras viejas durante
semanas y nadie se entera hasta que el paciente llega al mostrador y le cobran
otra cosa.

**Tratamientos de precio variable.** Si un tratamiento trae
`"isPriceVariable": true` —el caso del tratamiento de conducto—, su precio es
ORIENTATIVO: depende de lo que se vea en la radiografía. Cotízalo como «desde
$X, el precio exacto te lo confirma el odontólogo en la consulta». Dar un
precio cerrado ahí garantiza tener que desdecirlo en el mostrador.

#### El precio depende de con QUIÉN se atienda

*«Los precios varían de acuerdo al tratamiento, y también según el
odontólogo.»* Un cirujano con veinte años cobra la exodoncia distinto que
quien acaba de entrar.

Por eso cada odontólogo trae su propio array `prices`. **La regla es una
sola:**

> Si el paciente ya eligió odontólogo y ese odontólogo tiene ese tratamiento
> en su `prices`, **cotiza ESE precio**. Si no lo tiene —o el array está
> vacío—, cotiza el de `treatments`, que es el precio de lista.

#### Precios compuestos

Algunos precios de la clínica son una suma: «caries pequeña $35 + $10 de
base». En el catálogo eso NO llega como dos entradas que haya que sumar —
llega ya sumado en `priceUsd`, y el desglose está en `description`.

Cotiza **siempre el total** de `priceUsd`. La descripción sirve para explicar
de qué se compone si el paciente pregunta por qué son $45 y no $35, no para
recalcular nada. Nunca sumes dos tratamientos por tu cuenta: si un caso
necesita dos cosas a la vez y no existe un código que lo cubra, es `handoff`.

`category` agrupa la lista igual que la hoja de la clínica (DIAGNÓSTICO,
OPERATORIA, ENDODONCIA, CIRUGÍA, PERIODONCIA, ESTÉTICA). Úsala para responder
«¿cuánto cuesta una endodoncia?» enumerando las de esa categoría con su
precio, en vez de adivinar por el nombre.

Cómo se traduce en la conversación:

- **Aún no ha elegido odontólogo** → da el precio de lista y aclara que puede
  variar según el profesional: *«La exodoncia está en $30. Con algunos
  especialistas varía; si prefieres a alguien en concreto te digo su
  precio.»* Nunca des el precio de un odontólogo que el paciente no pidió.
- **Ya eligió** → da directamente su precio, sin explicar que existe una
  lista distinta. Al paciente le interesa lo que va a pagar, no cómo se
  organiza la clínica por dentro.
- **Pregunta por varios** → puedes comparar, pero sólo con los que trae el
  catálogo. No inventes ni interpoles precios de un odontólogo que no tiene
  ese tratamiento en su `prices`.

`prices` sólo trae tarifas **ya aprobadas** por la administración. Una
propuesta que el odontólogo mandó pero nadie aprobó todavía no aparece aquí,
y eso es deliberado: hasta que se aprueba se cobra el precio de lista, así que
cotizarla sería prometer un precio que el mostrador no va a respetar.

`isPriceVariable` manda por encima de todo esto. Un conducto pactado en $150
sigue siendo «desde $150»: lo que varía es la pieza, no quién la trata.

**Lo que NO vas a encontrar en `prices`: el reparto.** Cómo se divide ese
dinero entre la clínica y el odontólogo es un acuerdo interno. No sale en esta
respuesta —directamente no se consulta— y no es algo que se le explique a un
paciente. Si alguien pregunta por comisiones → `handoff`.

`priceBs` ya viene convertido — no multipliques tú. Si `currency.stale` es
`true`, da el precio en dólares y di que el monto en bolívares lo confirma
recepción.

**`paymentMethods` es lo que respondes cuando preguntan «¿cómo pago?».** Ver
§8: es el mismo principio que los precios y con más consecuencias.

### 3.3 `POST /api/automation/availability` — huecos libres

```json
{ "treatmentCode": "LIMPIEZA", "date": "2026-08-20T00:00:00-04:00",
  "dentistId": "c...", "maxSlots": 6 }
```

Devuelve `data.slots[]` con `startsAt`, `endsAt`, `dentistId`, `dentistName`,
`roomId`, `roomCode`.

Un array vacío **no es un error**: ese día está lleno. Ofrece otra fecha.

Llama a esto **antes** de proponerle una hora al paciente. Nunca inventes
horarios ni digas «creo que a las 3 hay hueco».

### 3.4 `POST /api/automation/messages` — espejo en el panel

Llámalo **dos veces por turno**: una con lo que escribió el paciente y otra
con lo que respondió el bot.

```json
{
  "phone": "+584141234567",
  "direction": "INBOUND",
  "author": "PATIENT",
  "body": "Hola, quiero agendar una limpieza",
  "mediaUrl": "https://...",
  "externalId": "wamid.HBgM..."
}
```

- `direction`: `INBOUND` (paciente) / `OUTBOUND` (bot).
- `author`: `PATIENT` | `AI_BOT` | `SYSTEM`. **`HUMAN_AGENT` no se acepta** —
  ése nace en el panel, con la sesión de la persona detrás.
- `externalId`: el `wamid` de WhatsApp. Mándalo siempre: hace la operación
  idempotente, y tanto Meta como n8n reintentan. Si el mensaje ya estaba,
  responde `200` con `"duplicate": true` en vez de duplicarlo.
- `mediaUrl`: sólo `http`/`https`.

Sin estas llamadas, el monitor del panel muestra la conversación a medias y
nadie puede retomar un chat a mitad de camino — que es justo cuando hace falta.

### 3.5 `POST /api/automation/appointments` — agendar

```json
{
  "patientPhone":   "+584141234567",
  "patientName":    "Juan Herrera",
  "treatmentCode":  "LIMPIEZA",
  "startsAt":       "2026-08-20T14:00:00-04:00",
  "dentistId":      "c...",
  "notes":          "Viene con dolor en la muela del juicio",
  "idempotencyKey": "wa-<wamid del mensaje que confirmó>"
}
```

**No envíes `endsAt` ni el precio.** Los calcula el servidor a partir del
tratamiento. Si los mandas, se ignoran.

`idempotencyKey` es obligatoria y debe derivarse del mensaje que confirmó la
cita (por ejemplo el `wamid`). Así, si n8n reintenta, no se crean dos citas.

Respuestas:

| Código | Qué significa | Qué hace el bot |
|---|---|---|
| `201` | Cita creada | Confirma día, hora, odontólogo y consultorio |
| `200` | Ya existía esa `idempotencyKey` | Trátalo igual que `201`, no avises dos veces |
| `400` | Validación | Revisa `error.details`; suele ser el teléfono o la fecha |
| `404` | Tratamiento u odontólogo inexistente | Vuelve a leer el catálogo |
| `409` | El hueco se ocupó mientras hablaban | Usa `error.suggestedSlots` y ofrece esas horas |
| `429` | Demasiadas peticiones | Respeta la cabecera `Retry-After` |

El `409` es normal y hay que manejarlo bien: entre que el bot ofrece las 3:00
y el paciente responde «sí», recepción pudo agendar a otra persona ahí. La
respuesta trae alternativas; úsalas en vez de decir «hubo un error».

### 3.5-bis `POST /api/automation/promotions` — qué se está ofreciendo

Cuerpo `{}`. Devuelve sólo las promociones **vigentes hoy**: la vigencia se
filtra en el servidor, así que no tienes que mirar fechas.

```json
{ "ok": true, "data": { "promotions": [
  { "name": "Limpieza con consulta gratis",
    "requiredTreatments": ["LIMPIEZA"],
    "requiredTreatmentNames": ["Limpieza dental (profilaxis)"],
    "benefit": { "kind": "FREE_TREATMENT", "treatment": "CONSULTA",
                 "treatmentName": "Consulta y valoración",
                 "label": "Consulta y valoración sale gratis" },
    "pitch": "Si te haces la limpieza, la consulta va incluida.",
    "endsAt": null }
] } }
```

**Di el `pitch` tal cual.** Ya viene redactado. No calcules el precio final
con el descuento aplicado ni prometas importes: **ofreces**, no cobras. Quien
aplica el descuento es recepción al facturar, y si el bot cierra una cifra que
luego no cuadra, la clínica acaba respetándola por no discutir en el mostrador.

Cuándo usarlo: cuando alguien pregunte precios y exista una promoción que
incluya ese tratamiento, y cuando pregunten directamente si hay ofertas. No lo
sueltes en cada mensaje.

Si el paciente quiere cerrar la promoción, agenda normal y **deja constancia en
la conversación** de que se habló de ella. Recepción lo verá al cobrar.

### 3.5-ter `POST /api/automation/media` — el archivo que hay que enviar

Cuando el webhook de salida (§ flujo C) trae `media`, el mensaje lleva una
foto, un PDF o un audio. El archivo **no viaja en el webhook**: se pide aquí.

```json
{ "mediaId": "c..." }
```

También acepta `{ "messageId": "c..." }` — el webhook trae los dos, usa el que
te resulte cómodo. Mismas tres cabeceras que el resto: `X-Automation-Key-Id`,
`X-Automation-Timestamp` y `X-Automation-Signature`.

**Respuesta:** el binario, con `Content-Type` ya puesto y el nombre en
`X-Media-Filename`. Si tu nodo lo tiene más fácil con JSON, manda
`{ "mediaId": "c...", "format": "base64" }` y responde:

```json
{ "ok": true, "data": {
  "mediaId": "c...", "messageId": "c...",
  "filename": "radiografia.jpg", "mimeType": "image/jpeg",
  "sizeBytes": 184320, "base64": "..." } }
```

**Qué hacer con él:** súbelo a la **Media API de Meta**
(`POST /{phone-number-id}/media` con `messaging_product=whatsapp`), quédate
con el `id` que devuelve y manda el mensaje por `media_id`, no por link. El
`body` del webhook va como `caption` en imágenes y vídeos, y como texto
aparte cuando es un documento o un audio (WhatsApp no les pone pie).

Sólo sirve adjuntos de mensajes **salientes**. Un `mediaId` que no exista o
que sea de un mensaje entrante devuelve 404 — el mismo 404 en los dos casos,
a propósito.

### 3.6 `POST /api/automation/handoff` — pedir un humano

```json
{ "phone": "+584141234567", "reason": "El paciente pide hablar con una persona" }
```

Hace dos cosas de golpe: **apaga la IA** en ese chat y lo **marca** en el
monitor para que recepción lo vea.

Después de llamar aquí **no envíes nada más** a ese número. Si quieres
despedirte, manda ese único mensaje **antes** de la llamada.

`reason` es obligatorio y lo lee el agente antes de abrir el chat: «reclama
por un cobro» le ahorra reconstruir la conversación entera.

**El bot no puede volver a encenderse solo.** Reactivar la IA es una decisión
humana desde el panel.

---

## 4. Estructura del workflow

### Flujo A — mensaje entrante (el principal)

1. **Webhook** de WhatsApp (Meta Cloud API).
2. **Normalizar**: extraer `from` en E.164, `wamid`, tipo y contenido.
3. **Si es audio** → descargar → transcribir (Whisper) → seguir con el texto.
   Guarda también la URL del audio para el `mediaUrl`.
4. **Si es imagen** → descargar → describir con un modelo de visión
   («radiografía», «foto de una muela partida», «captura de un pago»)
   → seguir con esa descripción como texto.
5. **`POST /conversation`** → si `aiEnabled === false`: registrar el mensaje
   (paso 6) y **terminar**.
6. **`POST /messages`** con `direction: INBOUND`, `author: PATIENT`.
7. **`POST /catalog`** (o caché de ≤10 min).
8. **Enrutar por `contact.role`** (ver §5).
9. **Agente de IA** con las herramientas de §6.
10. **Enviar por WhatsApp** la respuesta.
11. **`POST /messages`** con `direction: OUTBOUND`, `author: AI_BOT`.

### Flujo B — eventos del panel

Un **Webhook** propio que el panel llama cuando alguien mueve el interruptor
de la IA. Llega firmado con el mismo HMAC (verifícalo igual):

```json
{ "event": "ai.disabled", "conversationId": "c...", "phone": "+58...",
  "aiEnabled": false, "reason": "...", "changedBy": "Paula Gómez", "at": "..." }
```

Úsalo para cancelar seguimientos programados a ese número. **No lo uses como
única fuente de verdad**: si el webhook se pierde, el bot seguiría hablando en
un chat ya tomado. La verdad la da el paso 5 del flujo A, en cada mensaje.

### Flujo C — envío desde el panel

Un **Webhook** que recibe los mensajes que un agente escribe en el monitor:

```json
{ "conversationId": "c...", "messageId": "c...",
  "to": "+584141234567", "body": "Hola, soy Paula de la clínica" }
```

Verifica la firma y reenvíalo a WhatsApp. **No lo registres con `/messages`**:
el panel ya lo guardó.

**Si el webhook trae `media`:** el mensaje lleva adjunto. Pide el archivo a
`POST /api/automation/media` (§3.5-ter), súbelo a la Media API de Meta y manda
el mensaje por `media_id`. El webhook trae `media.mimeType` y `media.filename`
para que sepas qué es antes de descargarlo.

```json
{ "conversationId": "c...", "messageId": "c...", "to": "+58...",
  "body": "Aquí tienes tu radiografía",
  "media": { "mediaId": "c...", "messageId": "c...",
             "mimeType": "image/jpeg", "filename": "radiografia.jpg" } }
```

Cuando no hay adjunto, `media` llega como `null` y el mensaje es texto normal.

### Flujo D — correos al personal

Un **Webhook** aparte, que NO tiene nada que ver con WhatsApp: el panel te
pide que mandes un correo cuando se da de alta a alguien del personal, cuando
un administrador le restablece la clave, o cuando esa persona la recupera
desde el login.

Apunta aquí la variable `STAFF_EMAIL_WEBHOOK_URL` del panel. Llega firmado
con el mismo HMAC (`X-Automation-Timestamp` + `X-Automation-Signature` sobre
`${timestamp}.${body}`) — **verifícalo igual que el resto, y rechaza si no
cuadra**.

```json
{
  "type": "STAFF_INVITE",
  "to": "gabriela.ferreira@dentalcoworking.com.ve",
  "fullName": "Dra. Gabriela Ferreira",
  "role": "Odontólogo",
  "temporaryPassword": "Kj7mQp2xRt9wBnZv",
  "resetUrl": null,
  "loginUrl": "https://panel.clinica.com/login",
  "issuedAt": "2026-08-19T14:32:00.000Z"
}
```

**Nodos:** `Webhook` → `Code` (verificar firma) → `IF` (firma válida) →
`Switch` por `type` → `Gmail: Send Message`.

`type` tiene **tres valores** y cada uno se redacta distinto. No los juntes en
un solo correo genérico: quien lo recibe tiene que entender por qué le llegó.

| `type` | Cuándo | Qué lleva | Qué debe decir |
|---|---|---|---|
| `STAFF_INVITE` | Se le creó la cuenta | `temporaryPassword` | Bienvenida, su usuario (`to`), la clave, el `loginUrl`, y **que al entrar el panel le exigirá cambiarla** |
| `STAFF_PASSWORD_RESET` | Un administrador le regeneró la clave | `temporaryPassword` | Que **se le restableció** (no que sea nueva cuenta), la clave, y que sus sesiones se cerraron |
| `STAFF_PASSWORD_RECOVERY` | **Ella misma** la pidió desde el login | `resetUrl` | Un enlace para poner su contraseña. **Caduca en 1 hora y es de un solo uso** — dilo, o lo intentará dos veces |

En `STAFF_PASSWORD_RECOVERY` **`temporaryPassword` viene `null`**: no se manda
ninguna clave, se manda un enlace. Y al revés en los otros dos: `resetUrl` es
`null`. Usa el que corresponda y no asumas que ambos vienen.

Lo de «el panel le exigirá cambiarla» no es un consejo de cortesía: el panel
no la deja hacer nada más hasta que la cambia, y sin avisarlo parece un error.

Cuatro reglas sobre este flujo:

1. **`temporaryPassword` y `resetUrl` son secretos en tránsito.** No los
   escribas en logs de n8n, no los mandes a Slack, no los guardes en una hoja.
   El panel ya no los tiene —guardó el hash— así que este correo es su único
   destino legítimo. Un `resetUrl` en un log es una cuenta regalada.
2. **No reenvíes.** Si el envío falla, la clave correcta ya no se puede
   recuperar: hay que generar otra desde el panel. Un reintento que reenvíe
   el mismo `issuedAt` está bien; fabricar una clave por tu cuenta, no.
3. **Un solo destinatario: `to`.** Nada de copia al administrador. Una clave
   que llega a dos buzones es una clave que conocen dos personas.
4. **`issuedAt` sirve para deduplicar.** Si el mismo evento te llega dos
   veces por un reintento de red, no mandes dos correos.

---

## 5. Los tres roles

El campo `contact.role` decide el guion completo. El bot es **el mismo**, pero
lo que puede hacer cambia.

### `PATIENT` y `UNKNOWN` — el caso principal

Público. Puede: informar de tratamientos y precios, consultar disponibilidad,
agendar, recordar la dirección y el horario.

**No puede**: diagnosticar, recomendar medicación, opinar sobre si algo duele
o es grave, ni negociar descuentos. Todo eso → `handoff`.

### `DENTIST`

Es un odontólogo de la clínica escribiendo desde su teléfono. Viene con
`contact.dentistId`.

Puede preguntar cosas como «¿qué tengo mañana?» o «¿a qué hora es mi primera
cita del jueves?». Responde consultando `/availability` con su `dentistId`
para saber qué tiene ocupado.

**También puede AGENDAR.** Un odontólogo cierra citas por su cuenta —un
paciente le escribe directo, o acuerdan el control al terminar la consulta— y
tiene que poder hacerlo sin pasar por recepción. Llama a `/appointments` con
`dentistId` = su propio `contact.dentistId`, nunca el de otro: si pide agendar
a nombre de un colega, eso es cosa de recepción y va a `handoff`.

Al agendar él, pídele siempre el **teléfono del paciente**: `patientPhone` es
la llave con la que se crea o se encuentra la ficha, y el número del
odontólogo no sirve.

**Nunca le des importes ni comisiones.** El odontólogo cobra por liquidación
y las tarifas no son asunto suyo en este canal. Si pregunta por dinero →
`handoff`.

**Lo que se hace en el panel y NO por aquí.** El panel tiene pantallas propias
para varias cosas que un odontólogo va a intentar pedirte por WhatsApp. No las
escales a un humano: dile dónde están, que es más rápido para él.

| Si pide… | Contéstale |
|---|---|
| Cambiar su horario | Que lo proponga en **Horarios** del panel; se aplica cuando lo aprueben |
| Cambiar el precio de un tratamiento suyo | Que lo proponga en **Tarifas**; hasta que lo aprueben se cobra el de lista |
| Apuntar o revisar su instrumental | Que use **Instrumental** en el panel |
| Su contraseña, o no poder entrar | Que use «¿Olvidaste tu contraseña?» en la pantalla de inicio de sesión |
| Ver o cobrar dinero | `handoff` — eso no va por este canal |

Agendar **sí** lo haces tú, aquí mismo: es lo único de esa lista que resuelve
mejor una conversación que una pantalla, porque suele pasar con el paciente
delante.

### `ASSISTANT` y `ADMIN`

Recepción y administración. Pueden consultar disponibilidad y agenda del día,
y agendar en nombre de un paciente (pasando el teléfono del paciente, no el
suyo).

**No pueden** cerrar caja ni registrar cobros por WhatsApp: eso se hace en el
panel, donde queda firmado por su usuario. Si lo piden, dilo así y remite al
panel.

> Si un número no está en el sistema, `role` es `UNKNOWN` y se trata como
> paciente nuevo. Para que el bot reconozca al personal, sus teléfonos deben
> estar cargados en el panel.

---

## 6. Herramientas del agente de IA

Declara estas *tools*; que el modelo no llame a la API por su cuenta:

| Tool | Endpoint | Cuándo |
|---|---|---|
| `consultar_disponibilidad` | `/availability` | Antes de ofrecer cualquier hora |
| `agendar_cita` | `/appointments` | Sólo tras confirmación explícita |
| `pedir_humano` | `/handoff` | Ver §7 |

El catálogo **no** es una tool: se inyecta en el contexto ya resuelto en el
paso 7 del flujo A. Así el modelo no puede «olvidarse» de consultarlo.

---

## 7. Cuándo escalar a un humano

Llama a `pedir_humano` cuando ocurra cualquiera de estas:

- El paciente lo pide, aunque sea de pasada («quiero hablar con alguien»).
- **Dolor, urgencia, sangrado, hinchazón, fiebre.** Sin excepciones y sin
  intentar tranquilizar primero.
- Cualquier pregunta clínica: diagnóstico, si un tratamiento le conviene,
  medicación, postoperatorio.
- Reclamo, queja o discusión sobre un cobro.
- Piden descuento, financiamiento o pagar en partes.
- **Mandan un comprobante o captura de pago** — hay que conciliarlo a mano.
- El modelo no ha entendido tras **dos** intentos.
- El paciente repite la misma pregunta tres veces (señal de que no se le está
  respondiendo lo que pregunta).

Ante la duda, escala. Un escalamiento de más cuesta un minuto a recepción; uno
de menos puede costar un paciente — o algo peor si era una urgencia.

---

## 8. Cómo se responde «¿cómo pago?»

Los medios de pago salen de `catalog.paymentMethods`. **No los escribas en el
prompt del modelo ni en un nodo Set.**

Es la misma regla que con los precios, pero con más consecuencias: si el
número de pago móvil vive dentro del flujo de n8n y la clínica cambia de
banco, el bot manda a los pacientes a pagarle a una cuenta ajena hasta que
alguien se acuerde de editar el flujo. Con dinero de por medio, eso no se
descubre en un día. En el panel lo cambia el administrador y la siguiente
conversación ya usa lo nuevo.

Cómo usar cada campo:

- **`instructions`** se dicta **literal**, respetando los saltos de línea. No
  lo parafrasees ni lo reordenes: un dígito cambiado en un número de cuenta es
  dinero perdido. Si está vacío, di sólo el nombre del medio.
- **`currency`**: `"USD"` significa que ese medio se paga en dólares aunque el
  precio se muestre en bolívares. Dilo — se ahorra la mitad de las preguntas.
- **`kind`**: si es `CASH` o `CARD`, **no dictes datos bancarios**; se paga en
  recepción y ya. Sólo `TRANSFER` lleva instrucciones que copiar.
- Si la lista viene **vacía**, no inventes nada: di que recepción le pasa los
  datos y llama a `handoff`.

Ofrece **como mucho tres** medios en un mensaje, empezando por los primeros de
la lista (vienen ordenados por preferencia de la clínica). Volcar seis formas
de pago de golpe hace que el paciente no elija ninguna.

### Lo que el bot NO hace con los pagos

- **No confirma que un pago se recibió.** Aunque el paciente mande la captura,
  la respuesta es «gracias, recepción lo verifica y te confirma» — nunca «listo,
  ya quedó registrado». Verificar un pago es mirar la cuenta del banco, y el
  bot no la ve.
- **No registra cobros en el sistema.** Eso lo hace recepción desde el panel,
  donde el cobro queda firmado por su usuario y entra en el cierre de caja.

  > Existe un `POST /api/automation/payments` en el panel, pero **NO lo
  > llames**: está a medias a propósito y no persiste nada todavía. No lo he
  > incluido en §3 por eso. Si algún día se activa, te lo paso aparte.
- **No negocia descuentos, abonos ni financiamiento** → `handoff`.
- Si el paciente **manda una captura de pago**, descríbela, guárdala con
  `/messages` (con su `mediaUrl`) y llama a `handoff` con el motivo
  «envió comprobante de pago». Así recepción la ve y la concilia.

---

## 9. Cómo debe escribir

El objetivo es que **no se note que es un bot**. Reglas concretas:

- **Español venezolano, tuteo.** «¿Te sirve?», «te espero», «dale».
- **Mensajes cortos.** Dos o tres líneas. Nunca párrafos largos.
- **Una pregunta por mensaje.** Preguntar tres cosas a la vez hace que la
  gente conteste sólo una.
- **Sin listas con viñetas ni negritas** salvo al enumerar horarios
  disponibles. WhatsApp no es un documento.
- **Sin emojis en exceso**: uno de vez en cuando, nunca dos seguidos.
- **Nunca digas que eres una IA** a menos que lo pregunten directamente. Si lo
  preguntan, dilo con naturalidad y ofrece pasar con una persona.
- **No saludes en cada mensaje.** «Hola» va una vez, al principio.
- **Confirma con datos, no con adjetivos**: «Listo, quedaste para el jueves 20
  a las 2:00 pm con la Dra. Ferreira, consultorio C1» y no «¡Perfecto! ¡Tu
  cita ha sido agendada exitosamente! 🎉».
- **Espera 1-3 segundos** antes de responder (nodo Wait). Una respuesta
  instantánea a un mensaje largo delata al robot.
- Si el paciente escribe varios mensajes seguidos, **júntalos** antes de
  responder — un nodo Wait de ~4 segundos agrupando por número.

Al confirmar una cita repite siempre: **día, fecha, hora, odontólogo y
consultorio**. Es lo que evita el «yo entendí que era el martes».

---

## 10. Errores y reintentos

- **`401`** → la firma o el reloj están mal. No reintentes en bucle: registra y
  escala. Reintentar con una firma mala 50 veces sólo llena los logs.
- **`429`** → espera lo que diga `Retry-After` y reintenta **una** vez.
- **`5xx`** → un reintento tras 2 segundos. Si vuelve a fallar, dile al
  paciente que hubo un problema y llama a `handoff`.
- **`409` al agendar** → no es un error del sistema; ofrece
  `error.suggestedSlots`.
- **Nunca** le muestres al paciente un código de error, un `requestId` ni un
  mensaje técnico. Que suene humano: «se me complicó el sistema un momento, ya
  te ayudo».

Si algo falla y el bot no puede continuar, **siempre** termina con `handoff`.
Un paciente esperando en silencio es el peor final posible.

---

## 11. Qué quiero de vuelta

El JSON del workflow con:

- Los **cuatro flujos** (A, B, C, D) en el mismo archivo.
- El nodo Code de la firma HMAC, reutilizado por todas las llamadas.
- Manejo de audio e imagen.
- El corte por `aiEnabled === false` bien visible.
- Enrutado por `contact.role`.
- Manejo de `409` con `suggestedSlots`.
- Respuesta a «¿cómo pago?» leyendo `catalog.paymentMethods`, sin ningún dato
  bancario escrito dentro del flujo.
- Cotización por odontólogo leyendo `dentists[].prices`, con caída al precio
  de lista cuando ese odontólogo no tiene tarifa propia.
- El flujo D con Gmail, con la firma verificada, un `Switch` por `type` que
  cubra los **tres** correos (alta, restablecimiento, recuperación) y **sin
  registrar `temporaryPassword` ni `resetUrl` en ningún log**.
- Para el rol `DENTIST`: agendar sí, y remitir al panel lo de horarios,
  tarifas, instrumental y contraseña (ver §5) en vez de escalarlo a un humano.
- Nodos con **nombres en español** y descriptivos («Verificar si la IA está
  activa» y no «HTTP Request 3»).
- Sin credenciales escritas dentro: todo por variables de entorno.

Y estas tres, que son las que más veces se hacen mal:

1. **Un solo `JSON.stringify`** por petición: se firma y se envía la MISMA
   cadena. Serializar dos veces es la causa número uno de `401`.
2. **`/conversation` primero, siempre**, y corte inmediato si `aiEnabled` es
   `false`. Que el bot conteste en paralelo a un humano es el peor fallo
   posible de este sistema.
3. **Ningún precio, horario ni nombre escrito dentro del prompt del modelo.**
   Todo sale de `/catalog` en cada conversación.

Devuelve **sólo el JSON**.
