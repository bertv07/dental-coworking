# Minuta del 16/09/2026 — qué toca a cada lado

Repasé el JSON del bot y probé el panel en producción. Esto separa lo que ya
hice, lo que te toca a ti en n8n, y lo que hay que cargar en el panel.

---

## 🔴 Lo más importante que encontré

### Las conversaciones SÍ se registran — el panel no es el problema

Probé el endpoint contra producción con exactamente el mismo cuerpo que manda
el bot:

```
1) /conversation       → 200 ✔
2) /messages INBOUND   → 201 ✔  (mensaje guardado)
3) /messages OUTBOUND  → 201 ✔  (mensaje guardado)
4) /messages body=""   → 400 ✖  «El mensaje no puede estar vacío»
```

**El caso 4 es la causa.** En el flujo, el nodo `2.20 Registrar la respuesta
del bot` manda `body: $json.textoPanel`, y ese texto lo recupera el nodo
`2.19b` desde `$getWorkflowStaticData`. Si el estado no está ahí, `textoPanel`
llega vacío → el panel devuelve 400 → **la respuesta del bot no se guarda** y
en el monitor la conversación se ve a medias o vacía.

**Y el estado no está ahí.** Tu n8n corre con `N8N_RUNNERS_MODE=external`: los
nodos Code se ejecutan en un proceso aparte (el task runner). Lo que escriben
con `$getWorkflowStaticData` **no se persiste de forma fiable** de una
ejecución a otra.

Eso no rompe sólo los mensajes. Todo esto depende del mismo mecanismo:

| Qué guarda | Nodo | Qué se rompe si se pierde |
|---|---|---|
| `st.turno` | 2.13–2.18 → 2.19b | El mensaje sale por WhatsApp pero no se registra, y el paso a recepción no se dispara |
| `st.agenda` | 2.12b, 2.16 | El paciente elige día y la agenda «se olvida»: vuelve al menú |
| `st.casos` | 2.12h | El caso médico se pierde y el doctor responde a un código que ya no existe |
| `st.catalogo` | 2.9 | Se pide el catálogo en cada mensaje (no rompe, sólo es lento) |
| `st.desvios` | 2.18 | Nunca llega al segundo desvío, así que nunca escala solo |

**Arreglo, de menos a más trabajo:**

1. **Rápido (hoy):** pon `N8N_RUNNERS_MODE=regular` y quita
   `N8N_RUNNERS_AUTH_TOKEN` / `N8N_RUNNERS_BROKER_LISTEN_ADDRESS`. Los Code
   vuelven al proceso principal y el estado persiste. Es un cambio de variable
   de entorno y un reinicio.
2. **Bien (después):** no dependas del estado para el texto. En el nodo 2.20,
   en vez de `$json.textoPanel`, saca el cuerpo del mensaje que **ya enviaste**:

   ```
   ={{ $('2.19 Enviar la respuesta por WhatsApp').item.json.payload?.text?.body
       || $('2.19 Enviar la respuesta por WhatsApp').item.json.payload?.interactive?.body?.text
       || '[mensaje interactivo]' }}
   ```

   Así el texto viene del mismo dato que se mandó, sin pasar por memoria.

> Mientras tanto, **nunca mandes `body` vacío**: el panel lo rechaza a
> propósito, porque un mensaje en blanco en el historial es peor que no tenerlo.

---

## ✅ Lo que ya corregí en el panel (subido)

### Turno partido: 8–12 y 13–17

El panel sólo tenía «abre» y «cierra», sin descanso. Con «8:00 a 18:00» el bot
ofrecía las 12:30 y el paciente llegaba a una puerta cerrada.

Ya se puede configurar el descanso en **Configuración**, y el buscador de
huecos descarta toda cita que lo pise: que empiece dentro, que acabe dentro, o
que lo cruce. Probado con el horario de la minuta:

```
Ofrece: 09:00 09:30 10:00 10:30 11:00 │ 13:00 13:30 14:00 14:30 15:00 15:30 16:00
Entre 12:00 y 13:00: NADA ✔
```

(11:30 tampoco sale: una cita de 45 min terminaría a las 12:15.)

**Te toca a ti:** entra a **Configuración** y pon apertura `08:00`, cierre
`17:00`, descanso `12:00`–`13:00`. Ahora mismo en producción dice 08:00–18:00
sin descanso.

### El doble espacio de «Emilmar  Palma Faneite»

Confirmado en producción: el nombre tiene **dos espacios**. No se ve en
pantalla (el HTML los colapsa) pero rompe cualquier cosa que cruce por nombre.
Ya los nombres se limpian al guardarse.

**Te toca a ti:** entra a Odontólogos → Editar en Emilmar → Guardar. Con eso
se normaliza. (El bot ya cruza por `dentistId`, no por nombre, así que ahí no
había fallo.)

### La hora del panel

El panel ya usa `America/Caracas` en todo, y el contenedor arranca con esa zona.
Lo que quedaba desalineado era el **horario de atención**, no la zona horaria:
el bot tenía 9–17 escrito a mano, el panel 8–18, y la realidad es 8–12/13–17.
Con lo de arriba quedan los tres iguales.

---

## 📋 Lo que hay que cargar en el panel (no es código)

Comprobado hoy contra producción — está vacío:

| Dónde | Qué falta |
|---|---|
| Configuración | **Teléfono** (0422-0437409) y **dirección**: los dos están en `null` |
| Configuración | Horario 08:00–17:00 con descanso 12:00–13:00 |
| Odontólogos | Sólo hay **3** (Emilmar, Samantha, Yvette). «Agregar docs del sistema» = darlos de alta aquí — recepción ya puede hacerlo |
| Odontólogos | Especialidades: dos en `GENERAL` y una en `ORTODONCIA`. Si hay cirujano, endodoncista, odontopediatra… hay que ponerlo |
| Consultorios | C1, C2, C3 sin dueño asignado. «Consultorios específicos de cada uno» = asignar el odontólogo dueño en cada uno |
| Precios | «Propuesta de nuevas tarifas» — cuando las tengan, se cargan en Precios |

---

## 🤖 Lo que te toca en n8n

### 1. Quitar la mensajería con los doctores

«Eliminar opción de mensajes para docs». Hay que **borrar** estos nodos y sus
conexiones:

```
2.12c Mensajero — Del doctor al paciente
2.12d Mensajero — Del paciente al doctor
2.12h Abrir el caso con el odontólogo
2.12g ¿Es una consulta clínica?
```

En `2.10b Decidir el camino del turno`, quita los caminos `doctor` y `caso`:

```javascript
let camino;
if (opcionMenu) camino = 'opcion';
else if (ctx.enRegistro || /^AG_/.test(ctx.opcion || '')) camino = 'agenda';
else if (ctx.opcion) camino = 'opcion';
else camino = 'interpretar';
```

Y en `2.12f Aplicar lo interpretado`, que `MEDICA` mande a recepción en vez de
abrir un caso:

```javascript
const MAPA = {
  CITA: 'MENU_CITA', PROMOS: 'MENU_PROMOS', SERVICIOS: 'MENU_SERVICIOS',
  UBICACION: 'MENU_UBICACION', RECEPCION: 'MENU_RECEPCION',
  MEDICA: 'MENU_RECEPCION',   // ← ya no abre caso: va directo a una persona
};
```

Conecta `2.12f` directo a `2.11 Enrutar la opción elegida` y borra el IF `2.12g`.

### 2. El aviso a recepción por WhatsApp, no por correo

«Validación de la notificación del Box para reenviar atención personalizada
mediante el WhatsApp 0422-0437409 y no a un correo».

El nodo `2.25 Gmail — Avisar a recepción` hay que cambiarlo por un HTTP
Request a Meta. **Pero ojo:** el bot le escribe a recepción, y si recepción no
le ha escrito al número de la clínica en las últimas 24 h, **Meta no deja
mandar texto libre** — hace falta plantilla aprobada.

Ya tienes la plantilla documentada en tu propia nota (`aviso_paciente_espera`).
Si está aprobada, el nodo queda así:

- **URL:** `https://graph.facebook.com/v22.0/{{ $env.WA_PHONE_ID }}/messages`
- **Body:**

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

**Mientras la plantilla no esté aprobada, deja el correo.** Un aviso que no
sale es peor que uno que llega por correo.

### 3. Google Maps

En `2.15 Armar — Ubicación y horario`, añade el enlace al cuerpo:

```javascript
const MAPS = 'https://maps.app.goo.gl/TU-ENLACE';   // sácalo de Google Maps → Compartir
const cuerpo = 'Nuestra sede se encuentra en ' + direccion + '.\n\n' +
  'Ubicación en Google Maps:\n' + MAPS + '\n\n' +
  'El horario de atención es ' + HORARIO + '.\n\n¿Desea agendar una cita?';
```

> Y quita `preview_url: false` de `soloTexto` **sólo en este nodo**, para que
> WhatsApp muestre la miniatura del mapa. En los demás déjalo: una vista previa
> en mitad de una lista de precios distrae.

### 4. Lista de medicamentos y créditos

Dos opciones nuevas en el menú (`2.18`), en las filas de la lista:

```javascript
{ id: 'MENU_MEDICAMENTOS', title: 'Lista De Medicamentos', description: 'Medicamentos que manejamos' },
{ id: 'MENU_CREDITOS',     title: 'Créditos Y Financiamiento', description: 'Formas de pago a crédito' },
```

Añade dos salidas al switch `2.11` con esos ids, y dos nodos Code que devuelvan
un texto con el enlace, copiando la estructura de `2.15`. Los enlaces los pones
tú (Drive, PDF, una página…).

> **Recuerda el límite de WhatsApp:** los títulos de fila son **24 caracteres**
> y los de botón **20**. «Créditos Y Financiamiento» son 25 → se corta. Usa
> «Créditos Y Pagos».

### 5. Horario: el bot tiene 9–17 escrito a mano

En `2.10 Reunir el contexto del turno`:

```javascript
// Turno mañana 8-12 y tarde 13-17, igual que el panel.
const dentroDeHorario = dato('weekday') !== 'Sun' &&
  ((hora >= 8 && hora < 12) || (hora >= 13 && hora < 17));
```

Y en `2.13`, `2.14`, `2.15`, `2.17`, `2.18` cambia la constante:

```javascript
const HORARIO = 'de lunes a sábado, de 8:00 a. m. a 12:00 m. y de 1:00 a 5:00 p. m.';
```

> Los huecos que ofrece el bot salen de `/availability`, o sea del panel: en
> cuanto configures el descanso en Configuración, el bot deja de ofrecer el
> mediodía **sin tocar nada más**. Esto de aquí es sólo el texto que dice.

### 6. Botón de reagendar eligiendo odontóloga

«Incorporación de un botón para reagendar citas con las odontólogas».

En el menú (`2.18`) añade `{ id: 'MENU_REAGENDAR', title: 'Reagendar Cita' }`,
y una salida en `2.11`. El flujo más simple que funciona hoy:

1. Le dices que para reagendar hace falta confirmar con recepción.
2. Escalas con `pasar_a_recepcion` (ya lo tienes montado).

Para que el propio bot reagende hace falta que el panel exponga «buscar la
cita del paciente» y «moverla», que **hoy no existe**. Dímelo y lo construyo:
son dos endpoints.

Para «elegir odontóloga», el flujo ya soporta pedir por una en concreto —
`/availability` acepta `dentistId`. Bastaría con una lista previa de las
odontólogas del catálogo antes de mostrar los días.

### 7. El bot NO mira la especialidad

«Ver si el bot mira la especialidad». **No la mira, y la nota del nodo
`2.12b4` dice lo contrario:** «La especialidad ya la filtra el panel según el
tratamiento». Eso es falso — el panel ofrece a todas las odontólogas que
tengan el hueco libre, sin mirar especialidad.

Hoy no causa daño porque la cita que agenda el bot es **siempre la consulta de
valoración**, y esa la hace cualquiera. Pero si mañana agendas ortodoncia
directa, te la va a asignar a quien no la hace.

Si quieres que el panel filtre por especialidad, dímelo: es un cambio en
`/availability`.

### 8. Servicios y planes

«Ajuste en la respuesta de servicios y actualización de planes/servicios
vigentes». Los dos son nodos Code que se editan a mano:

- **Servicios:** nodo `2.14`, lista `SERVICIOS`.
- **Promociones:** nodo `2.13`, lista `PROMOCIONES`.

Pásame los textos nuevos y te los dejo escritos, o los cambias tú ahí mismo —
están en español y comentados.

---

## Lo que falta decidir

- **Instagram** está montado y desactivado en el flujo 8. El panel **ya acepta
  `channel: "INSTAGRAM"`** al agendar. Lo que falta es acordar cómo se
  identifica a alguien de Instagram: el panel identifica por teléfono, y un
  usuario de IG no tiene. Lo más simple: que el bot le **pida el teléfono**
  antes de agendar, igual que por WhatsApp, y mande `channel: 'INSTAGRAM'`.
  Así no hace falta tocar el panel.
- **Lista de medicamentos para imprimir desde recepción** — eso es una pantalla
  nueva en el panel (seleccionar medicamentos e imprimir la selección). No está
  hecho. Dime si lo quieres y lo construyo.
