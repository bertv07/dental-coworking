# Prompt para la IA que va a editar el flujo de n8n

Copia **todo lo que está debajo de la línea** y pásaselo a tu IA junto con el
archivo `Dental Coworking — Bot de WhatsApp por opciones.json`.

---

Vas a modificar el workflow de n8n de una clínica odontológica en Caracas
(Dental Coworking). Te paso el JSON exportado. Devuélveme el JSON completo y
válido para reimportar, sin romper nada de lo que ya funciona.

## Contexto que necesitas antes de tocar nada

**El bot es de OPCIONES, no conversacional.** Menú fijo con listas y botones
de WhatsApp. Hay un modelo de lenguaje, pero **sólo clasifica** texto libre en
una de siete palabras (nodo `2.12e`); nunca redacta lo que lee el paciente.
Todos los textos son fijos o salen del panel. **No conviertas esto en un
agente conversacional.**

**El panel es la fuente de verdad.** Precios, horarios, tratamientos y
odontólogas salen de `POST /api/automation/catalog`. Nunca escribas un precio,
un código de tratamiento ni un nombre de odontóloga a mano en un nodo.

**El subflujo 0 (nodos `0.1`–`0.10`) firma todas las llamadas al panel con
HMAC. NO LO TOQUES.** Para llamar a un endpoint nuevo, añade su ruta al mapa
`RUTAS` del nodo `0.2` y usa un nodo *Execute Workflow* con
`{ tool: 'nombre', payload: {...} }`, igual que los que ya existen.

**Límites de WhatsApp que no puedes ignorar:**
- Listas: **máximo 10 filas**, títulos de **24 caracteres**.
- Botones: **máximo 3**, títulos de **20 caracteres**.
- Fuera de la ventana de 24 h desde el último mensaje del paciente, **sólo se
  pueden enviar plantillas aprobadas**, no texto libre.

---

## TAREA 1 — Arreglar el registro de mensajes (lo más importante)

El panel registra los mensajes en `POST /api/automation/messages`, pero
**rechaza con 400 cualquier `body` vacío**. Hoy el nodo `2.20 Registrar la
respuesta del bot` manda `body: $json.textoPanel`, que sale de
`$getWorkflowStaticData` — y ese estado se pierde, así que la respuesta del
bot no se guarda y el monitor del panel muestra la conversación a medias.

Cambia el `body` del nodo `2.20` para que salga del mensaje **que ya se
envió**, no de la memoria:

```
={{ $('2.19 Enviar la respuesta por WhatsApp').item.json.payload?.text?.body
    || $('2.19 Enviar la respuesta por WhatsApp').item.json.payload?.interactive?.body?.text
    || '[mensaje interactivo]' }}
```

Revisa además **todos** los nodos que llaman a `registrar_mensaje` y asegúrate
de que ninguno pueda mandar un `body` vacío. Donde no haya texto, manda algo
descriptivo entre corchetes.

---

## TAREA 2 — Quitar la mensajería con los doctores

La clínica ya no quiere que el bot haga de intermediario entre paciente y
odontólogo. **Borra estos nodos y sus conexiones:**

```
2.12c Mensajero — Del doctor al paciente
2.12d Mensajero — Del paciente al doctor
2.12h Abrir el caso con el odontólogo
2.12g ¿Es una consulta clínica?
```

En `2.10b Decidir el camino del turno`, elimina los caminos `doctor` y `caso`:

```javascript
let camino;
if (opcionMenu) camino = 'opcion';
else if (ctx.enRegistro || /^AG_/.test(ctx.opcion || '')) camino = 'agenda';
else if (ctx.opcion) camino = 'opcion';
else camino = 'interpretar';
```

Quita también las salidas `doctor` y `caso` del switch `2.10c Enrutar por
camino`, y del nodo `2.10 Reunir el contexto del turno` quita lo que ya no se
use (`doctor`, `doctores`, `rolesDoctores`, el nodo `2.9e Cargar la lista de
doctores` y el historial `st.historial`).

En `2.12f Aplicar lo interpretado`, una consulta clínica pasa a recepción:

```javascript
const MAPA = {
  CITA: 'MENU_CITA', PROMOS: 'MENU_PROMOS', SERVICIOS: 'MENU_SERVICIOS',
  UBICACION: 'MENU_UBICACION', RECEPCION: 'MENU_RECEPCION',
  MEDICA: 'MENU_RECEPCION',
};
```

Conecta `2.12f` directamente a `2.11 Enrutar la opción elegida`.

> El aviso por correo al odontólogo cuando se agenda una cita (nodo `2.20e`)
> **se queda**. Lo que se elimina es la conversación de ida y vuelta, no el
> aviso de cita nueva.

---

## TAREA 3 — Elegir hora por TURNO, no una lista de horas

**Este es el motivo real:** las listas de WhatsApp sólo admiten 10 filas, y el
nodo `2.12b4` ya corta con `.slice(0, 10)`. Con un día completo, las horas de
la tarde no se ven nunca.

Cambia el flujo para que sea en dos pasos:

1. Cuando `/availability` devuelva los huecos (nodo `2.12b4`), en vez de
   listar las horas muestra **dos botones**: «Mañana (N)» y «Tarde (N)», con
   el número de huecos de cada turno. La mañana es todo lo anterior a las
   12:00 hora de Caracas; la tarde, el resto. Si un turno no tiene huecos, no
   muestres su botón.
2. Guarda `ag.horas` como ya se hace. Al tocar un turno (ids `AG_T:M` /
   `AG_T:T`), filtra esas horas y **entonces sí** lista hasta 10 con los ids
   `AG_S:i` que ya existen.

El caso `AG_T:` se maneja en `2.12b Agenda — Decidir el paso`, junto a los
`AG_D:` y `AG_S:` actuales. El índice `i` de `AG_S:i` debe seguir apuntando a
la posición dentro de `ag.horas` completo, no dentro del turno filtrado — si
cambias eso, se agenda una hora distinta de la que tocó el paciente.

---

## TAREA 4 — Botón de reagendar (endpoints nuevos, ya funcionan)

El panel ya expone dos endpoints nuevos. Añádelos al mapa `RUTAS` del nodo
`0.2`:

```javascript
mis_citas:  '/api/automation/my-appointments',
reagendar:  '/api/automation/reschedule',
```

**`mis_citas`** — qué tiene pendiente ese teléfono:
```json
{ "phone": "+584141234567" }
```
Devuelve `data.appointments[]` con `appointmentId`, `startsAtLabel` (ya escrito
en hora de Caracas — **úsalo tal cual, no reformatees `startsAt`**),
`treatment`, `dentistId`, `dentistName`, `room` y `status`. Lista vacía = no
tiene nada pendiente: ofrécele agendar una nueva.

**`reagendar`** — moverla:
```json
{
  "appointmentId":  "c...",
  "startsAt":       "2026-09-18T13:00:00.000Z",
  "dentistId":      "c...",
  "idempotencyKey": "wa-<id del mensaje>"
}
```

| Código | Qué pasó | Qué hace el bot |
|---|---|---|
| `200` | Movida | Confirmar usando `startsAtLabel` |
| `404` | Ya no existe | Ofrecer agendar una nueva |
| `409` con `details[].message` | Cancelada o ya atendida | «Esa cita ya se atendió, ¿le agendo otra?» |
| `409` con `error.suggestedSlots` | El hueco se ocupó | Ofrecer esas alternativas |

**Flujo a construir:**

1. Añade `{ id: 'MENU_REAGENDAR', title: 'Reagendar Cita', description: 'Cambiar el día u hora' }`
   a la lista del menú en `2.18 Armar — Menú principal`, y su salida en el
   switch `2.11`.
2. Llama a `mis_citas`. Si no tiene ninguna, dile que no tiene citas
   pendientes y ofrécele agendar.
3. Lista sus citas (ids `RE_C:<appointmentId>`) con `startsAtLabel` como
   título — **recórtalo a 24 caracteres**.
4. Elegida la cita, pregúntale si quiere **la misma odontóloga u otra**
   (botones). Si elige otra, lista las del catálogo (`cat.dentists`, ids
   `RE_O:<dentistId>`).
5. Pide el día igual que en el alta (`AG_D:`), consulta `/availability` con
   `dentistId` si eligió una, aplica el turno de la TAREA 3, y al elegir la
   hora llama a `reagendar`.
6. Confirma con `startsAtLabel` de la respuesta.

Guarda el estado de este flujo en `st.reagenda[phone]`, con la misma caducidad
de 1 hora que usa `st.agenda`.

---

## TAREA 5 — Aviso a recepción por WhatsApp

Hoy el nodo `2.25 Gmail — Avisar a recepción` manda un correo. La clínica
quiere que llegue al WhatsApp **0422-0437409** (E.164: `584220437409`).

**Cuidado:** el bot le escribe a recepción, y si ella no ha escrito al número
de la clínica en las últimas 24 h, Meta **no permite** texto libre. Hace falta
la plantilla `aviso_paciente_espera`, que está **registrada en inglés** (todas
las de esta cuenta lo están: manda `language: { code: 'en' }` o Meta responde
`132001`).

Añade un nodo HTTP Request **en paralelo** al de Gmail (no lo borres):

- **URL:** `https://graph.facebook.com/v22.0/{{ $env.WA_PHONE_ID }}/messages`
- **Header:** `Authorization: Bearer {{ $env.WA_TOKEN }}`
- **Body (JSON):**

```javascript
={{ JSON.stringify({
  messaging_product: 'whatsapp', recipient_type: 'individual',
  to: '584220437409',
  type: 'template',
  template: { name: 'aviso_paciente_espera', language: { code: 'en' },
    components: [{ type: 'body', parameters: [
      { type: 'text', text: $json.nombre },
      { type: 'text', text: $json.motivo },
      { type: 'text', text: $json.telefono },
    ]}]}
}) }}
```

Ponle `onError: continueRegularOutput`: si la plantilla todavía no está
aprobada, el WhatsApp falla pero **el correo tiene que salir igual**. Un aviso
que no llega es peor que uno que llega por correo.

---

## TAREA 6 — Horario, Google Maps y créditos

**6a. El horario está escrito a mano y está mal.** En `2.10 Reunir el contexto
del turno` dice 9–17; la clínica atiende **de 8:00 a 12:00 y de 13:00 a
17:00**, de lunes a sábado:

```javascript
const dentroDeHorario = dato('weekday') !== 'Sun' &&
  ((hora >= 8 && hora < 12) || (hora >= 13 && hora < 17));
```

Y en los nodos `2.13`, `2.14`, `2.15`, `2.17` y `2.18`, la constante:

```javascript
const HORARIO = 'de lunes a sábado, de 8:00 a. m. a 12:00 m. y de 1:00 a 5:00 p. m.';
```

> Los huecos que ofrece el bot los decide el panel, no esto. Esto es sólo el
> texto que el bot dice cuando le preguntan el horario.

**6b. Google Maps.** En `2.15 Armar — Ubicación y horario`, añade el enlace al
cuerpo del mensaje y **quita `preview_url: false` sólo en ese nodo**, para que
WhatsApp muestre la miniatura del mapa:

```javascript
const MAPS = 'https://maps.app.goo.gl/PENDIENTE';  // ← lo pone la clínica
```

Déjalo marcado como pendiente de forma visible si no te doy el enlace.

**6c. Créditos para pacientes.** Nueva opción en el menú:

```javascript
{ id: 'MENU_CREDITOS', title: 'Créditos Y Pagos', description: 'Formas de pago y financiamiento' },
```

Salida nueva en el switch `2.11` y un nodo Code que devuelva un texto con el
enlace, copiando la estructura de `2.15`. Deja el enlace como `PENDIENTE`.

> «Créditos Y Financiamiento» son 25 caracteres y WhatsApp corta a 24. Por eso
> el título es «Créditos Y Pagos».

**6d. NO añadas nada de medicamentos.** Esa lista es sólo para recepción
—imprime una hoja con fotos para el paciente— y no toca al bot.

---

## TAREA 7 — Servicios y promociones

Son dos listas escritas a mano dentro de nodos Code:
- `2.14 Armar — Servicios` → constante `SERVICIOS`
- `2.13 Armar — Promociones` → constante `PROMOCIONES`

**No cambies los textos por tu cuenta.** Deja ambas constantes claramente
señaladas con un comentario para que la clínica las edite, y verifica que el
mensaje resultante no pase de **1024 caracteres** (límite del cuerpo de un
mensaje interactivo de WhatsApp). Si la lista de promociones crece y se pasa,
pártela en dos mensajes o recórtala a las más vigentes.

---

## Antes de devolverme el JSON, comprueba

1. **Ningún `body` vacío** en las llamadas a `registrar_mensaje`.
2. **Ninguna lista con más de 10 filas** ni títulos de más de 24 caracteres.
3. **Ningún botón** con título de más de 20 caracteres ni grupos de más de 3.
4. Todos los nodos nuevos que llamen al panel pasan por el **subflujo 0**, con
   su `tool` dado de alta en el mapa `RUTAS` del nodo `0.2`.
5. **Ningún precio, código de tratamiento ni nombre de odontóloga** escrito a
   mano fuera de las constantes `SERVICIOS` y `PROMOCIONES`.
6. Las conexiones de los nodos borrados **no quedan colgando** hacia nodos que
   ya no existen.
7. El JSON **se puede reimportar en n8n**: nodos con `id`, `name`, `type`,
   `typeVersion` y `position`, y `connections` que referencian nombres que
   existen.

Devuélveme, además del JSON, **una lista corta de lo que cambiaste** y de todo
lo que dejaste marcado como `PENDIENTE` esperando un dato de la clínica.

---

## Una cosa que NO puedes arreglar tú, y hay que hacer igual

El workflow guarda el estado de las conversaciones con
`$getWorkflowStaticData` (`st.turno`, `st.agenda`, `st.casos`, `st.desvios`).
La instancia corre con `N8N_RUNNERS_MODE=external`, y en ese modo los nodos
Code se ejecutan en otro proceso: **ese estado no persiste de forma fiable**.

Eso hace que la agenda se «olvide» a mitad, que el paso a recepción no se
dispare y que los mensajes no se registren. La TAREA 1 elimina esa dependencia
para el caso más grave, pero el resto sigue expuesto.

**Díselo al dueño de la instancia:** hay que poner `N8N_RUNNERS_MODE=regular`
(y quitar `N8N_RUNNERS_AUTH_TOKEN` y `N8N_RUNNERS_BROKER_LISTEN_ADDRESS`) y
reiniciar. Es un cambio de variables de entorno, no de flujo.
