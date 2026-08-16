# Prompt para generar el flujo de n8n

> Copia **todo** lo que hay debajo de la línea y pégalo en la otra IA. Está
> escrito para que devuelva el JSON de un workflow importable en n8n.
>
> Antes de pegarlo, sustituye los marcadores del bloque «Variables»:
> `PANEL_URL`, `HMAC_SECRET` y las credenciales de WhatsApp.
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
      { "code": "LIMPIEZA", "name": "Limpieza dental (profilaxis)",
        "description": "...", "durationMinutes": 45,
        "priceCents": 3000, "priceUsd": 30, "priceBs": 23132.14 }
    ],
    "dentists": [ { "id": "c...", "name": "Dra. Gabriela Ferreira",
                    "specialties": ["ORTODONCIA"] } ],
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

`priceBs` ya viene convertido — no multipliques tú. Si `currency.stale` es
`true`, da el precio en dólares y di que el monto en bolívares lo confirma
recepción.

**`paymentMethods` es lo que respondes cuando preguntan «¿cómo pago?».** Ver
§8bis: es el mismo principio que los precios y con más consecuencias.

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

**Nunca le des importes ni comisiones.** El odontólogo cobra por liquidación
mensual y las tarifas no son asunto suyo en este canal. Si pregunta por
dinero → `handoff`.

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

## 8bis. Cómo se responde «¿cómo pago?»

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
- **No negocia descuentos, abonos ni financiamiento** → `handoff`.
- Si el paciente **manda una captura de pago**, descríbela, guárdala con
  `/messages` (con su `mediaUrl`) y llama a `handoff` con el motivo
  «envió comprobante de pago». Así recepción la ve y la concilia.

---

## 8. Cómo debe escribir

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

## 9. Errores y reintentos

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

## 10. Qué quiero de vuelta

El JSON del workflow con:

- Los **tres flujos** (A, B, C) en el mismo archivo.
- El nodo Code de la firma HMAC, reutilizado por todas las llamadas.
- Manejo de audio e imagen.
- El corte por `aiEnabled === false` bien visible.
- Enrutado por `contact.role`.
- Manejo de `409` con `suggestedSlots`.
- Respuesta a «¿cómo pago?» leyendo `catalog.paymentMethods`, sin ningún dato
  bancario escrito dentro del flujo.
- Nodos con **nombres en español** y descriptivos («Verificar si la IA está
  activa» y no «HTTP Request 3»).
- Sin credenciales escritas dentro: todo por variables de entorno.

Devuelve **sólo el JSON**.
