#!/usr/bin/env node
/**
 * ===========================================================================
 *  Parche del workflow de n8n — de Gemini a OpenRouter, y las correcciones
 * ===========================================================================
 *  Se aplica sobre TU export, no lo sustituye: lee el JSON que exportaste de
 *  n8n y escribe otro corregido al lado. Así no hay que rehacer el workflow
 *  ni copiar nada a mano, y lo que ya funciona se queda igual.
 *
 *      node docs/parche-workflow-n8n.mjs "Clínica odontológica — Asistente de WhatsApp.json"
 *
 *  Deja "<nombre>-corregido.json" listo para importar en n8n.
 *
 *  ---------------------------------------------------------------------
 *  ES IDEMPOTENTE
 *  ---------------------------------------------------------------------
 *  Pasarlo dos veces sobre el mismo archivo no duplica nodos ni vuelve a
 *  sustituir lo ya sustituido: cada parche comprueba primero si ya está
 *  puesto. Si algo no lo encuentra, lo dice y sigue con el resto en vez de
 *  romperse — es preferible un parche parcial y avisado que un archivo a
 *  medias sin saberlo.
 * ===========================================================================
 */

import fs from 'node:fs';
import path from 'node:path';

const entrada = process.argv[2];
if (!entrada) {
  console.error('Uso: node docs/parche-workflow-n8n.mjs <workflow.json>');
  process.exit(1);
}

const wf = JSON.parse(fs.readFileSync(entrada, 'utf8'));
const hechos = [];
const avisos = [];

/**
 * Busca un nodo por nombre, tolerando variantes del guion y los acentos.
 *
 * Los nombres llevan em-dash («Guion — Paciente») y según cómo se exporte o
 * se pegue el archivo puede llegar como guion normal o con los acentos
 * cambiados. Comparar en crudo haría que el parche no encontrara nada y
 * dijera que está todo bien sin haber tocado una línea.
 */
const normalizar = (t) =>
  String(t)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const nodo = (nombre) =>
  wf.nodes.find((n) => n.name === nombre) ??
  wf.nodes.find((n) => normalizar(n.name) === normalizar(nombre));

/** Renombra un nodo y arrastra sus conexiones, que van por nombre. */
function renombrar(antes, despues) {
  const n = nodo(antes);
  if (!n) return false;
  n.name = despues;

  if (wf.connections[antes]) {
    wf.connections[despues] = wf.connections[antes];
    delete wf.connections[antes];
  }
  for (const origen of Object.values(wf.connections)) {
    for (const tipo of Object.values(origen)) {
      for (const salidas of tipo) {
        for (const c of salidas ?? []) {
          if (c.node === antes) c.node = despues;
        }
      }
    }
  }
  return true;
}

// ===========================================================================
//  1. El modelo del agente: OpenRouter, y con límite de salida
// ===========================================================================
//  Es LA causa de las respuestas cortadas a mitad de frase: el nodo no
//  declaraba ningún límite de tokens de salida.
{
  const m = nodo('Modelo de lenguaje (Gemini)') ?? nodo('Modelo de lenguaje (OpenRouter)');
  if (!m) {
    avisos.push('No encontré el nodo del modelo. Cámbialo a mano por OpenRouter.');
  } else {
    m.type = '@n8n/n8n-nodes-langchain.lmChatOpenRouter';
    m.typeVersion = 1;
    m.parameters = {
      model: "={{ $env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4' }}",
      options: {
        temperature: 0.4,
        /*
         * SIN ESTO LAS RESPUESTAS SE CORTAN.
         * 800 tokens dan de sobra para el mensaje más largo que manda este
         * bot (una lista de horarios con confirmación) y evitan que se pare
         * a mitad de un precio.
         */
        maxTokens: 800,
      },
    };
    // La credencial de Gemini ya no vale aquí; se selecciona la de OpenRouter
    // en la interfaz de n8n al importar.
    m.credentials = { openRouterApi: { id: '', name: 'OpenRouter account' } };
    m.notes =
      'API key de OpenRouter en la credencial. maxTokens 800: sin límite declarado, ' +
      'las respuestas se cortaban a mitad de frase.';
    renombrar('Modelo de lenguaje (Gemini)', 'Modelo de lenguaje (OpenRouter)');
    hechos.push('Modelo del agente → OpenRouter, con maxTokens 800');
  }
}

// ===========================================================================
//  2. La descripción de imágenes, también por OpenRouter
// ===========================================================================
//  OpenRouter admite visión con el formato de chat de OpenAI. El audio NO se
//  toca: la transcripción sigue en Gemini porque OpenRouter no ofrece un
//  equivalente fiable, y con la clave de Google puesta funciona bien.
{
  const v = nodo('Describir imagen (visión)');
  if (!v) {
    avisos.push('No encontré «Describir imagen (visión)».');
  } else if (String(v.parameters?.url ?? '').includes('openrouter')) {
    hechos.push('La visión ya estaba en OpenRouter (sin cambios)');
  } else {
    v.parameters.url = 'https://openrouter.ai/api/v1/chat/completions';
    v.parameters.headerParameters = {
      parameters: [
        { name: 'Authorization', value: '=Bearer {{ $env.OPENROUTER_KEY }}' },
        { name: 'Content-Type', value: 'application/json' },
      ],
    };
    v.parameters.jsonBody =
      "={{ JSON.stringify({ model: ($env.OPENROUTER_VISION_MODEL || 'anthropic/claude-sonnet-4')," +
      ' max_tokens: 300, messages: [ { role: \'user\', content: [' +
      " { type: 'text', text: 'Describe en una o dos frases, en espanol, que muestra esta imagen que envia un paciente a una clinica odontologica." +
      ' Di si es una radiografia, una foto de la boca o un diente, una captura de un pago o comprobante bancario, un documento, o algo distinto.' +
      " No diagnostiques nada ni opines sobre gravedad.' }," +
      " { type: 'image_url', image_url: { url: 'data:' + (($('Obtener URL de la imagen (Meta)').first().json.mime_type || 'image/jpeg').split(';')[0]) + ';base64,' + $json.base64 } }" +
      ' ] } ] }) }}';
    v.notes =
      'Sólo describe. El diagnóstico y la conciliación de pagos son de humanos. ' +
      'Vía OpenRouter, formato de chat de OpenAI.';
    hechos.push('Descripción de imágenes → OpenRouter');
  }

  // La respuesta de OpenRouter viene en choices[0].message.content, no en
  // candidates[]: sin esto, la descripción llegaría siempre vacía.
  const t = nodo('Texto desde imagen');
  if (t && !t.parameters.jsCode.includes('choices')) {
    t.parameters.jsCode = t.parameters.jsCode.replace(
      "$json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()",
      "($json?.choices?.[0]?.message?.content || $json?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim()",
    );
    hechos.push('Lectura de la respuesta de visión adaptada a OpenRouter');
  }
}

// ===========================================================================
//  3. El guion del paciente: pagos, precios y promociones
// ===========================================================================
{
  const g = nodo('Guion — Paciente o desconocido');
  if (!g) {
    avisos.push('No encontré «Guion — Paciente o desconocido».');
  } else {
    let c = g.parameters.jsCode;
    const antes = c;

    // 3.1 — Pagar en partes NO se escala: se responde que sí.
    c = c.replace(
      '- Piden descuento, financiamiento o pagar en partes.',
      '- Piden financiamiento a plazos o negocian un precio distinto al de la lista.',
    );

    // 3.2 — Y se le dice qué SÍ sabe responder sobre pagos.
    if (!c.includes('PAGOS (esto lo respondes tú')) {
      c = c.replace(
        'LO QUE NO PUEDES HACER',
        `PAGOS (esto lo respondes tú, NO lo escalas)
- Formas de pago: están en MEDIOS DE PAGO, más arriba. Dilas tal cual.
- ¿Se puede pagar en dos partes? SÍ. Se abona una parte el día del tratamiento y el resto después. Lo que NO haces es pactar el reparto ni las fechas: eso lo cierra recepción.
- ¿Hay descuento? Llama a promociones_vigentes y ofrece lo que haya, con el texto tal cual viene. Si piden un descuento distinto del que hay, eso sí es pedir_humano.
- ¿A qué tasa? La lista está en dólares y se cobra a la tasa del EURO. El importe en bolívares viene ya calculado en el catálogo: NO lo calcules tú.

LO QUE NO PUEDES HACER`,
      );
    }

    // 3.3 — «desde» sólo en los precios que de verdad varían.
    c = c.replace(
      '2. Precio, si lo pregunta o si es evidente que le interesa. Siempre \\"desde $X\\".',
      '2. Precio. Di el importe tal cual aparece en el catálogo. Sólo usas \\"desde\\" si esa línea dice PRECIO VARIABLE; en el resto el precio es cerrado y decir \\"desde\\" hace dudar de un número que no cambia.',
    );

    // 3.4 — Y que no se invente lo que no está en el catálogo.
    if (!c.includes('SI NO ESTÁ EN EL CATÁLOGO')) {
      c = c.replace(
        'LO QUE NO PUEDES HACER',
        `SI NO ESTÁ EN EL CATÁLOGO, NO TIENE PRECIO
Preguntan mucho por diseño de sonrisa, ortodoncia, brackets y cordales. Si no aparecen arriba, no los estimes ni los deduzcas de otro parecido: di que ese tratamiento no está en la lista de precios y ofrece pasar con una persona.

LO QUE NO PUEDES HACER`,
      );
    }

    if (c !== antes) {
      g.parameters.jsCode = c;
      hechos.push('Guion del paciente: pagos, «desde», promociones y catálogo');
    } else {
      avisos.push('El guion del paciente ya estaba parcheado o cambió de texto.');
    }
  }
}


// ===========================================================================
//  3-bis. Los cuatro guiones tienen que saber qué día es hoy
// ===========================================================================
//  Un modelo de lenguaje no sabe la fecha: la deduce, y la deduce mal. El
//  agente pidió disponibilidad para el «17 de enero de 2026» estando en
//  septiembre; el panel respondía correctamente que no había nada y el bot le
//  decía al paciente que ese día estaba lleno.
//
//  El catálogo ya trae `now`. Aquí sólo hay que ponerlo delante del modelo.
{
  const guiones = [
    'Guion — Paciente o desconocido',
    'Guion — Odontólogo',
    'Guion — Recepción (asistente)',
    'Guion — Administración',
  ];

  let tocados = 0;
  for (const nombre of guiones) {
    const g = nodo(nombre);
    if (!g || typeof g.parameters?.jsCode !== 'string') continue;
    if (g.parameters.jsCode.includes('const hoy = c.now')) continue;

    let c = g.parameters.jsCode;

    // La variable, junto al resto de datos que saca del catálogo.
    c = c.replace(
      'const tz = clinica.timezone ||',
      `const hoy = c.now || {};
const fechaHoy = hoy.label
  ? \`HOY es \${hoy.label}, \${hoy.time}. La fecha de hoy en formato ISO es \${hoy.date}.\`
  : 'No se pudo leer la fecha de hoy: pregúntale al paciente la fecha completa antes de consultar disponibilidad.';
const tz = clinica.timezone ||`,
    );

    // Y el bloque dentro del prompt, arriba del todo para que pese.
    c = c.replace(
      'const systemPrompt = `Eres el asistente',
      `const BLOQUE_FECHA = \`QUÉ DÍA ES HOY
\${fechaHoy}
- Cuando alguien diga "mañana", "el viernes" o "la semana que viene", CALCÚLALO A PARTIR DE ESA FECHA. No la deduzcas por tu cuenta: te equivocas de mes y de año.
- Las fechas que le pasas a consultar_disponibilidad y a agendar_cita van en ISO con zona -04:00, y NUNCA en el pasado.
- Si no te queda claro qué día quiere, pregúntaselo antes de consultar. Una pregunta de más es mejor que ofrecerle un día que ya pasó.\`;

const systemPrompt = \`\${BLOQUE_FECHA}

Eres el asistente`,
    );

    if (c !== g.parameters.jsCode) {
      g.parameters.jsCode = c;
      tocados += 1;
    }
  }

  if (tocados > 0) hechos.push(`La fecha de hoy entra en ${tocados} guiones`);
  else avisos.push('Los guiones ya tenían la fecha, o cambiaron de texto.');
}

// ===========================================================================
//  3-ter. «Está lleno» sólo cuando de verdad está lleno
// ===========================================================================
{
  const i = nodo('Interpretar respuesta del panel');
  if (!i) {
    avisos.push('No encontré «Interpretar respuesta del panel».');
  } else if (i.parameters.jsCode.includes('data?.reason')) {
    hechos.push('El motivo de «sin huecos» ya se interpretaba');
  } else {
    i.parameters.jsCode = i.parameters.jsCode.replace(
      `    mensajeAgente = slots.length
      ? 'Huecos libres: ' + JSON.stringify(slots)
      : 'Ese día está lleno. No es un error: ofrécele otra fecha.';`,
      `    // El panel dice POR QUÉ no hay huecos: pasado, cerrado o lleno.
    // Antes todo era "está lleno", y eso se le decía a un paciente que había
    // pedido una fecha ya pasada.
    mensajeAgente = slots.length
      ? 'Huecos libres: ' + JSON.stringify(slots)
      : (data?.message || 'Ese día no tiene huecos. Ofrécele otra fecha.')
        + (data?.today ? ' (hoy es ' + data.today + ')' : '');`,
    );
    hechos.push('n8n distingue «lleno» de «ya pasó» y de «cerrado»');
  }
}

// ===========================================================================
//  4. La ruta de promociones y la del archivo a enviar
// ===========================================================================
{
  const b = nodo('Construir petición al panel');
  if (!b) {
    avisos.push('No encontré «Construir petición al panel».');
  } else if (b.parameters.jsCode.includes('promociones_vigentes')) {
    hechos.push('Las rutas nuevas ya estaban (sin cambios)');
  } else {
    b.parameters.jsCode = b.parameters.jsCode.replace(
      "  registrar_datos_paciente: '/api/automation/messages',",
      `  registrar_datos_paciente: '/api/automation/messages',
  // Promociones vigentes: lo que la clínica está ofreciendo hoy.
  promociones_vigentes:     '/api/automation/promotions',
  // El archivo que recepción adjuntó desde el panel, para subirlo a Meta.
  obtener_archivo:          '/api/automation/media',`,
    );
    hechos.push('Rutas /promotions y /media añadidas al ejecutor');
  }
}

// ===========================================================================
//  5. La herramienta de promociones para el agente
// ===========================================================================
{
  if (nodo('promociones_vigentes')) {
    hechos.push('La herramienta promociones_vigentes ya existía');
  } else {
    const modelo = nodo('Modelo de lenguaje (OpenRouter)');
    const base = nodo('pedir_humano');
    if (!base) {
      avisos.push('No encontré «pedir_humano»: añade la tool de promociones a mano.');
    } else {
      wf.nodes.push({
        parameters: {
          description:
            'Devuelve las promociones vigentes hoy. Úsala cuando pregunten si hay ofertas o descuentos, ' +
            'y también cuando pregunten el precio de un tratamiento que aparezca en los requisitos de alguna. ' +
            'Di el campo pitch tal cual: ya viene redactado. No calcules el precio final con el descuento aplicado.',
          workflowId: {
            __rl: true,
            value: '={{ $workflow.id }}',
            mode: 'id',
            cachedResultName: 'Este mismo workflow (subflujo ejecutor)',
          },
          workflowInputs: {
            mappingMode: 'defineBelow',
            value: { tool: 'promociones_vigentes', payload: '={{ ({}) }}' },
            matchingColumns: [],
            schema: [
              { id: 'tool', displayName: 'tool', required: false, type: 'string', display: true, canBeUsedToMatch: true },
              { id: 'payload', displayName: 'payload', required: false, type: 'object', display: true, canBeUsedToMatch: true },
            ],
            attemptToConvertTypes: false,
            convertFieldsToString: false,
          },
        },
        id: 'promo-tool-0001-0000-000000000001',
        name: 'promociones_vigentes',
        type: '@n8n/n8n-nodes-langchain.toolWorkflow',
        typeVersion: 2.2,
        position: [(base.position?.[0] ?? 14896) + 160, base.position?.[1] ?? 5840],
        notes: 'El bot ofrece; quien aplica el descuento es recepción al facturar.',
      });

      wf.connections['promociones_vigentes'] = {
        ai_tool: [[{ node: 'Agente de la clínica', type: 'ai_tool', index: 0 }]],
      };
      void modelo;
      hechos.push('Herramienta promociones_vigentes conectada al agente');
    }
  }
}

// ===========================================================================
//  6. El flujo C aprende a enviar archivos
// ===========================================================================
//  Cuando recepción adjunta una foto, un PDF o un audio, el webhook trae
//  `media`. Sin esta rama el adjunto no sale: se enviaba sólo el texto.
{
  if (nodo('¿El mensaje lleva adjunto?')) {
    hechos.push('La rama de adjuntos del flujo C ya existía');
  } else {
    const envio = nodo('Enviar mensaje del agente por WhatsApp');
    const ok = nodo('Responder 200 al panel (envío)');
    const firmaOk = nodo('¿Firma válida? (envío)');

    if (!envio || !ok || !firmaOk) {
      avisos.push('No encontré los nodos del flujo C: añade la rama de adjuntos a mano.');
    } else {
      const [x, y] = envio.position ?? [9872, 8272];

      wf.nodes.push(
        {
          parameters: {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
              conditions: [
                {
                  id: 'media-1',
                  leftValue: '={{ $json.evento.media }}',
                  rightValue: '',
                  operator: { type: 'object', operation: 'exists', singleValue: true },
                },
              ],
              combinator: 'and',
            },
            options: {},
          },
          id: 'media-if-0001-0000-000000000001',
          name: '¿El mensaje lleva adjunto?',
          type: 'n8n-nodes-base.if',
          typeVersion: 2.2,
          position: [x, y],
          notes: 'Sin adjunto sigue siendo un mensaje de texto normal.',
        },
        {
          parameters: {
            workflowId: {
              __rl: true,
              value: '={{ $workflow.id }}',
              mode: 'id',
              cachedResultName: 'Este mismo workflow (subflujo ejecutor)',
            },
            workflowInputs: {
              mappingMode: 'defineBelow',
              value: {
                tool: 'obtener_archivo',
                payload: "={{ { mediaId: $json.evento.media.mediaId, format: 'base64' } }}",
              },
              matchingColumns: [],
              schema: [
                { id: 'tool', displayName: 'tool', required: false, type: 'string', display: true, canBeUsedToMatch: true },
                { id: 'payload', displayName: 'payload', required: false, type: 'object', display: true, canBeUsedToMatch: true },
              ],
              attemptToConvertTypes: false,
              convertFieldsToString: false,
            },
            options: { waitForSubWorkflow: true },
          },
          id: 'media-get-0001-0000-000000000001',
          name: 'Pedir el archivo al panel',
          type: 'n8n-nodes-base.executeWorkflow',
          typeVersion: 1.2,
          position: [x + 200, y - 160],
          notes:
            'POST /api/automation/media firmado igual que todo lo demás. En base64 para poder ' +
            'reenviarlo a Meta sin manejar binarios entre subflujos.',
        },
        {
          parameters: {
            jsCode: `
// El archivo llega en base64 desde el panel y hay que subirlo a Meta como
// multipart. Se convierte a binario aquí, que es lo que espera el nodo HTTP.
const d = $json.data ?? $json;
const evento = $('Verificar firma del panel (envío)').first().json.evento;

if (!d?.base64) {
  throw new Error('El panel no devolvió el archivo del adjunto');
}

return [{
  json: {
    to: evento.to,
    body: evento.body || '',
    mimeType: d.mimeType,
    filename: d.filename,
  },
  binary: {
    archivo: {
      data: d.base64,
      mimeType: d.mimeType,
      fileName: d.filename,
    },
  },
}];
`,
          },
          id: 'media-bin-0001-0000-000000000001',
          name: 'Preparar el archivo para Meta',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [x + 400, y - 160],
        },
        {
          parameters: {
            method: 'POST',
            url: '=https://graph.facebook.com/v20.0/{{ $env.WA_PHONE_ID }}/media',
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.WA_TOKEN }}' }],
            },
            sendBody: true,
            contentType: 'multipart-form-data',
            bodyParameters: {
              parameters: [
                { name: 'messaging_product', value: 'whatsapp' },
                { name: 'type', value: '={{ $json.mimeType }}' },
                { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'archivo' },
              ],
            },
            options: { timeout: 60000 },
          },
          id: 'media-up-0001-0000-000000000001',
          name: 'Subir el archivo a la Media API',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [x + 600, y - 160],
          retryOnFail: true,
          maxTries: 2,
          waitBetweenTries: 2000,
          notes: 'Devuelve { id }: ese es el media_id con el que se manda el mensaje.',
        },
        {
          parameters: {
            method: 'POST',
            url: '=https://graph.facebook.com/v20.0/{{ $env.WA_PHONE_ID }}/messages',
            sendHeaders: true,
            headerParameters: {
              parameters: [
                { name: 'Authorization', value: '=Bearer {{ $env.WA_TOKEN }}' },
                { name: 'Content-Type', value: 'application/json' },
              ],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: `={{ (() => {
  const prep = $('Preparar el archivo para Meta').first().json;
  const id = $json.id;
  const tipo = String(prep.mimeType || '');
  const familia = tipo.startsWith('image/') ? 'image'
    : tipo.startsWith('audio/') ? 'audio'
    : tipo.startsWith('video/') ? 'video'
    : 'document';

  // El pie sólo lo admiten imagen, vídeo y documento. En audio, WhatsApp lo
  // ignora: por eso el texto se manda aparte en ese caso.
  const contenido = familia === 'audio'
    ? { id }
    : familia === 'document'
      ? { id, caption: prep.body || undefined, filename: prep.filename }
      : { id, caption: prep.body || undefined };

  return JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: prep.to,
    type: familia,
    [familia]: contenido,
  });
})() }}`,
            options: { timeout: 30000 },
          },
          id: 'media-send-0001-0000-000000000001',
          name: 'Enviar el adjunto por WhatsApp',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [x + 800, y - 160],
          retryOnFail: true,
          maxTries: 2,
          waitBetweenTries: 2000,
        },
      );

      // Se recablea: la firma válida entra al IF, y de ahí a cada rama.
      wf.connections['¿Firma válida? (envío)'].main[0] = [
        { node: '¿El mensaje lleva adjunto?', type: 'main', index: 0 },
      ];
      wf.connections['¿El mensaje lleva adjunto?'] = {
        main: [
          [{ node: 'Pedir el archivo al panel', type: 'main', index: 0 }],
          [{ node: 'Enviar mensaje del agente por WhatsApp', type: 'main', index: 0 }],
        ],
      };
      wf.connections['Pedir el archivo al panel'] = {
        main: [[{ node: 'Preparar el archivo para Meta', type: 'main', index: 0 }]],
      };
      wf.connections['Preparar el archivo para Meta'] = {
        main: [[{ node: 'Subir el archivo a la Media API', type: 'main', index: 0 }]],
      };
      wf.connections['Subir el archivo a la Media API'] = {
        main: [[{ node: 'Enviar el adjunto por WhatsApp', type: 'main', index: 0 }]],
      };
      wf.connections['Enviar el adjunto por WhatsApp'] = {
        main: [[{ node: 'Responder 200 al panel (envío)', type: 'main', index: 0 }]],
      };

      hechos.push('Flujo C: rama de adjuntos (foto, PDF, audio y vídeo)');
    }
  }
}

// ===========================================================================
//  7. Detalles sueltos
// ===========================================================================
{
  const alerta = nodo('Gmail — Avisar del error');
  if (alerta && !String(alerta.parameters.sendTo).includes('ALERT_EMAIL')) {
    alerta.parameters.sendTo = '={{ $env.ALERT_EMAIL }}';
    hechos.push('El aviso de errores va a ALERT_EMAIL, no a un buzón escrito a mano');
  }

  const espera = nodo('Agrupar mensajes seguidos (4 s)');
  if (espera && espera.parameters.amount === 4) {
    // No agrupa nada —cada mensaje abre su propia ejecución—, así que 4 s sólo
    // añaden retraso. Se deja 1 s hasta que se encole de verdad por número.
    espera.parameters.amount = 1;
    renombrar('Agrupar mensajes seguidos (4 s)', 'Pequeña pausa antes de responder (1 s)');
    hechos.push('La espera de 4 s baja a 1 s (no agrupaba nada)');
  }
}

// ===========================================================================
//  Se escribe el resultado
// ===========================================================================
const dir = path.dirname(entrada);
const base = path.basename(entrada, '.json');
const salida = path.join(dir, `${base}-corregido.json`);
fs.writeFileSync(salida, JSON.stringify(wf, null, 2), 'utf8');

console.log('\nCambios aplicados:');
for (const h of hechos) console.log('  ✓', h);
if (avisos.length) {
  console.log('\nRevisa a mano:');
  for (const a of avisos) console.log('  !', a);
}
console.log(`\nEscrito: ${salida}`);
console.log(`Nodos: ${wf.nodes.length}\n`);
