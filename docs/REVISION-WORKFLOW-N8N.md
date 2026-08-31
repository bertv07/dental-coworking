# Revisión del workflow «Clínica odontológica — Asistente de WhatsApp»

> Hecha sobre el JSON exportado, contra la conversación real que falló.
> Cada punto dice **en qué nodo** se toca y **qué se pone**.

---

## Aplícalo sin tocar nada a mano

Todo lo de abajo está en un parche que se aplica sobre **tu propio export**:

```bash
node docs/parche-workflow-n8n.mjs "Clínica odontológica — Asistente de WhatsApp.json"
```

Deja un `...-corregido.json` al lado, listo para importar en n8n. No sustituye
tu archivo, no rehace el workflow y lo que ya funciona se queda igual. Pasarlo
dos veces no duplica nada: cada cambio comprueba antes si ya está puesto.

### Variables nuevas en n8n

| Variable | Para qué |
|---|---|
| `OPENROUTER_KEY` | La API key. Va también en la **credencial** de OpenRouter que hay que seleccionar en el nodo del modelo al importar. |
| `OPENROUTER_MODEL` | Opcional. Por defecto `anthropic/claude-sonnet-4`. |
| `OPENROUTER_VISION_MODEL` | Opcional. El que describe las fotos que mandan los pacientes. |
| `GEMINI_KEY` | **Se queda.** Sólo para transcribir notas de voz — ver abajo. |

### Por qué el audio sigue en Gemini

OpenRouter no ofrece transcripción de audio: es una API de chat. Las notas de
voz son la mitad de lo que manda un paciente, así que ese nodo se queda con
Gemini, que ya funciona. El agente y la descripción de imágenes sí pasan a
OpenRouter.

Si quieres quitar Gemini del todo, hay que cambiar ese nodo por Whisper de
OpenAI o por Deepgram — y eso es otra credencial y otra factura. Dime y lo
monto.

---

## 1. 🔴 Las respuestas se cortan a mitad — CAUSA CONFIRMADA

**Nodo:** `Modelo de lenguaje (Gemini)`

```json
"parameters": {
  "modelName": "models/gemini-3.6-flash",
  "options": { "temperature": 0.4 }
}
```

**No hay ningún límite de salida configurado.** Eso es lo que produjo:

> «La consulta y valoración tiene un costo de $30 (o Bs 27.»
> «El tratamiento para caries va desde $20 o Bs 18.437,»

**Lo que hace el parche:** cambia el nodo entero a OpenRouter y le pone el
límite que faltaba.

```json
"type": "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
"parameters": {
  "model": "={{ $env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4' }}",
  "options": { "temperature": 0.4, "maxTokens": 800 }
}
```

**De paso resuelve otra cosa:** el modelo estaba escrito a mano como
`models/gemini-3.6-flash`, mientras los nodos de audio e imagen usaban
`$env.GEMINI_MODEL || 'gemini-2.5-flash'`. Si ese identificador no existía en
tu proyecto de Google, el nodo fallaba o caía a otro modelo — y eso solo ya
explicaría respuestas raras.

Al importar en n8n hay que **seleccionar la credencial de OpenRouter** en ese
nodo: el parche deja el hueco, pero la clave no viaja en el archivo.

---

## 2. 🔴 Escala a un humano lo que sabe responder

**Nodo:** `Guion — Paciente o desconocido`, dentro de `systemPrompt`.

Esta línea está en la lista de «CUÁNDO LLAMAS A pedir_humano»:

```
- Piden descuento, financiamiento o pagar en partes.
```

Es exactamente lo que hizo que el paciente preguntara **ocho veces seguidas**
por formas de pago y pagar en dos partes sin recibir respuesta.

**Sustitúyela por:**

```
- Piden financiamiento a plazos o negocian un precio distinto al de la lista.
```

Y **añade arriba**, en lo que sí puede responder:

```
PAGOS (sabes responder esto, NO lo escales)
- Formas de pago: están en MEDIOS DE PAGO, aquí abajo. Dilas.
- ¿Se puede pagar en dos partes? SÍ. Se abona una parte el día del
  tratamiento y el resto después. Lo que no haces es pactar el reparto ni las
  fechas: eso lo cierra recepción.
- ¿Hay descuento? Consulta la herramienta promociones_vigentes y ofrece lo
  que haya, tal cual viene. Si piden otro descuento distinto, eso sí es
  pedir_humano.
```

---

## 3. 🟠 Dice «desde» en precios que son cerrados

**Nodo:** `Guion — Paciente o desconocido`, paso 2 de «CÓMO SE AGENDA»:

```
2. Precio, si lo pregunta o si es evidente que le interesa. Siempre "desde $X".
```

Por eso salió «La exodoncia en adultos tiene un costo **desde** $40», cuando
son $40 exactos. El catálogo ya distingue los dos casos con
`isPriceVariable`, y el propio código del guion lo marca como
`DESDE $X — PRECIO VARIABLE`.

**Sustitúyelo por:**

```
2. Precio. Di el importe tal cual aparece en el catálogo. Sólo usas "desde"
   si esa línea dice PRECIO VARIABLE; en el resto, el precio es cerrado y
   decir "desde" hace dudar de un número que no cambia.
```

---

## 4. 🟠 Falta la herramienta de promociones

El panel ya expone `POST /api/automation/promotions`, pero el workflow no lo
llama. Sin eso el bot no puede responder «¿hay descuento?» — y hay una
promoción vigente cargada: *si te haces la exodoncia, la consulta va
incluida*.

**En el nodo `Construir petición al panel`**, añade la ruta:

```js
const RUTAS = {
  // …lo que ya hay…
  promociones_vigentes: '/api/automation/promotions',
};
```

**Y crea una tool nueva** (`toolWorkflow`), igual que las otras cuatro:

- **Nombre:** `promociones_vigentes`
- **Descripción:** «Devuelve las promociones vigentes hoy. Úsala cuando
  pregunten si hay ofertas o descuentos, y cuando pregunten el precio de un
  tratamiento que aparezca en los requisitos de alguna. Di el campo `pitch`
  tal cual: ya viene redactado. No calcules el precio final con el descuento
  aplicado.»
- **payload:** `={{ ({}) }}`

---

## 5. 🟠 El flujo C sólo sabe enviar texto

**Nodo:** `Enviar mensaje del agente por WhatsApp`

```js
type: 'text', text: { preview_url: false, body: $json.evento.body }
```

Cuando recepción adjunta una foto, un PDF o un audio desde el panel, el
webhook ahora trae también un objeto `media`:

```json
{ "to": "+58...", "body": "Aquí tienes tu radiografía",
  "media": { "mediaId": "c...", "messageId": "c...",
             "mimeType": "image/jpeg", "filename": "radiografia.jpg" } }
```

Falta la rama que lo trata: pedir el archivo a
`POST /api/automation/media` (mismas tres cabeceras), subirlo a la Media API
de Meta y mandar el mensaje por `media_id`. Está detallado en el §3.5-ter del
prompt. Mientras no exista esa rama, **los adjuntos del panel no salen**.

---

## 6. 🟡 «Agrupar mensajes seguidos» no agrupa nada

**Nodo:** `Agrupar mensajes seguidos (4 s)`

Es un `Wait` de 4 segundos. Cada mensaje entrante abre su **propia ejecución**
y cada una espera y responde por su cuenta: no se agrupa nada, sólo se
retrasa todo 4 segundos.

En la conversación real se ve el efecto: el paciente manda cinco preguntas
seguidas y recibe respuestas sueltas y descolocadas.

La nota del propio nodo ya dice cómo se arregla de verdad (encolar por número
y descartar el turno si llegó otro `wamid` del mismo teléfono durante la
espera). Hasta entonces, **bajarlo a 1 segundo** al menos deja de añadir
latencia sin dar nada a cambio.

---

## 7. 🟡 El correo de errores va a un buzón escrito a mano

**Nodo:** `Gmail — Avisar del error`

```
"sendTo": "=ertwebdev@gmail.com"
```

La nota del workflow dice que usa `ALERT_EMAIL`, pero está escrito a mano.
Cámbialo por `={{ $env.ALERT_EMAIL }}` para que no haya que tocar el nodo si
cambia el destinatario.

---

## 8. 🟡 El estilo del guion del paciente se contradice

**Nodo:** `Guion — Paciente o desconocido`, bloque `ESTILO`:

```
- SUper formal
- Nunca emojis.
```

…pero el ejemplo de confirmación que viene justo debajo tutea:
«Listo, **quedaste** para el jueves 20…». Y el resto de guiones (odontólogo,
recepción, administración) dicen «Español venezolano, tuteo».

Decide una y déjala coherente. Si la clínica quiere trato formal con
pacientes, el ejemplo tiene que ser «Su cita quedó agendada para el jueves 20
a las 2:00 p. m. con la Dra. Ferreira, consultorio C1».

---

## Lo que está bien y conviene no tocar

- **El corte por `aiEnabled`** antes de generar nada. Es lo que impide que el
  bot conteste encima de una persona.
- **Firmar y enviar la misma cadena** en `Firmar petición (HMAC)`. Serializar
  dos veces es el fallo clásico que devuelve 401.
- **`idempotencyKey` derivada del `wamid`** al agendar: los reintentos de n8n
  no crean citas duplicadas.
- **El secreto leído en un nodo `Set`** y no con `$env` dentro del Code. En
  n8n 2.x los Code nodes no ven las variables de entorno.
- **Flujo D sin guardar historial** (`saveDataSuccessExecution: none`): las
  claves temporales no quedan en las ejecuciones.
- **`registrar_datos_paciente`** dejando una nota legible en la conversación
  en vez de inventarse una ficha a medias.
