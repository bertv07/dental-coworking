-- ===========================================================================
--  Plantillas de respuesta iniciales
-- ===========================================================================
--  Las carga el propio despliegue, no un script a mano.
--
--  POR QUÉ AQUÍ Y NO EN `scripts/cargar-plantillas.mjs`
--  Porque el script hay que acordarse de ejecutarlo, y en un servidor nuevo
--  nadie se acuerda: recepción abre «Plantillas», la ve vacía y da por hecho
--  que la función no existe. Las migraciones sí corren solas al arrancar el
--  contenedor, así que esto llega sin que nadie haga nada.
--
--  ES IDEMPOTENTE Y NO PISA NADA. El `WHERE NOT EXISTS` mira si ya hay
--  plantillas vivas: si la clínica ya ajustó sus textos, esta migración no
--  inserta ni una fila. Sin esa guarda, un `migrate deploy` les devolvería los
--  textos de fábrica y volverían a cotizar precios viejos sin enterarse.
--
--  Los corchetes `[Precio]`, `[Hora]` se guardan tal cual: son el recordatorio
--  visible de lo que hay que sustituir antes de enviar, y el panel avisa si
--  queda alguno.
-- ===========================================================================

INSERT INTO "message_templates"
  ("id", "category", "title", "body", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT
  v."id", v."category", v."title", v."body", v."sortOrder", true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  -- 1. Saludos y bienvenida
  ('ctpl000001xxxxxxxxxxxxxx', 'Saludos y bienvenida', 'Primer contacto',
   '¡Hola! Gracias por comunicarte con [Nombre de la Clínica]. Te atiende [Tu Nombre], ¿en qué te puedo ayudar hoy?', 0),
  ('ctpl000002xxxxxxxxxxxxxx', 'Saludos y bienvenida', 'Respuesta a un ''Hola'' sin contexto',
   '¡Hola! Buen día. Gracias por escribir a [Nombre de la Clínica]. Cuéntame, ¿buscas información sobre algún tratamiento en particular o deseas agendar una cita?', 1),
  ('ctpl000003xxxxxxxxxxxxxx', 'Saludos y bienvenida', 'Horarios y ubicación',
   'Con gusto. Estamos ubicados en [Dirección completa/Punto de referencia]. Nuestro horario de atención es de [Día] a [Día], de [Hora] a [Hora]. ¿Te gustaría que revisemos disponibilidad para agendar una cita?', 2),

  -- 2. Precios que no dependen de valoración
  ('ctpl000004xxxxxxxxxxxxxx', 'Precios directos', 'Consulta de valoración',
   'La consulta de valoración inicial tiene un costo de [Precio]. En esta cita, el doctor realizará una revisión completa de tu salud bucal, diagnóstico y te entregará un plan de tratamiento detallado. ¿Qué día de esta semana te viene mejor para asistir?', 3),
  ('ctpl000005xxxxxxxxxxxxxx', 'Precios directos', 'Limpieza dental',
   'Nuestra limpieza dental profunda (profilaxis) tiene un valor de [Precio]. El procedimiento incluye remoción de cálculo (sarro), pulido de manchas superficiales y aplicación de flúor para proteger el esmalte. ¿Te gustaría que busquemos un espacio en la agenda?', 4),
  ('ctpl000006xxxxxxxxxxxxxx', 'Precios directos', 'Blanqueamiento dental',
   'El blanqueamiento dental de consultorio tiene una inversión de [Precio]. Logramos aclarar varios tonos en una sola sesión de aproximadamente [Tiempo]. Para realizarlo, solo necesitamos confirmar en consulta que tus encías estén sanas. ¿Deseas agendar tu sesión?', 5),

  -- 3. Tratamientos que dependen de evaluación.
  --    Se da un rango para no perder al paciente, pero dejando claro que el
  --    precio exacto sale de la consulta.
  ('ctpl000007xxxxxxxxxxxxxx', 'Tratamientos complejos', 'Ortodoncia (brackets o alineadores)',
   'Para tratamientos de ortodoncia, manejamos cuotas iniciales desde [Precio] y mensualidades de [Precio]. Sin embargo, el presupuesto exacto y el tiempo de tratamiento dependen de la evaluación de tu mordida. Te sugiero agendar una cita de valoración por [Precio de consulta] para que el especialista te dé tu plan exacto. ¿Qué te parece?', 6),
  ('ctpl000008xxxxxxxxxxxxxx', 'Tratamientos complejos', 'Implantes dentales',
   'El costo de un implante dental (tornillo y corona) inicia en aproximadamente [Precio]. Como cada paciente tiene una calidad y cantidad de hueso diferente, es indispensable realizar una valoración previa clínica y radiográfica para darte un presupuesto exacto y seguro. ¿Te gustaría agendar esta primera evaluación?', 7),
  ('ctpl000009xxxxxxxxxxxxxx', 'Tratamientos complejos', 'Extracción de cordales',
   'Las extracciones de cordales tienen un costo que va desde [Precio] por muelita. El valor final depende de la posición en la que se encuentren (si están impactadas o en el hueso), lo cual verificamos con una radiografía panorámica. ¿Deseas que programemos tu cita de evaluación para revisarlo?', 8),
  ('ctpl000010xxxxxxxxxxxxxx', 'Tratamientos complejos', 'Caries y resinas',
   'El costo para eliminar caries y colocar resinas estéticas (del color del diente) va desde [Precio] por superficie. Para indicarte cuántas necesitas exactamente y su tamaño, te invitamos a una consulta de valoración. ¿Te agendamos un espacio?', 9),

  -- 4. Citas, pagos y urgencias
  ('ctpl000011xxxxxxxxxxxxxx', 'Citas, pagos y urgencias', 'Cerrar la cita',
   '¡Perfecto! Para esta semana tengo disponibilidad el [Día] a las [Hora] o el [Día] a las [Hora]. ¿Cuál de las dos opciones te funciona mejor?', 10),
  ('ctpl000012xxxxxxxxxxxxxx', 'Citas, pagos y urgencias', 'Confirmar cita (un día antes)',
   '¡Hola [Nombre del paciente]! Te escribimos de [Nombre de la Clínica] para confirmar tu cita de mañana a las [Hora] con el Dr./Dra. [Nombre]. Por favor, confírmanos tu asistencia con un ''Sí''. ¡Te esperamos!', 11),
  ('ctpl000013xxxxxxxxxxxxxx', 'Citas, pagos y urgencias', 'Métodos de pago',
   'Para tu comodidad, aceptamos los siguientes métodos de pago: [Efectivo, Zelle, Pago Móvil, Binance]. [Opcional: También contamos con financiamiento para tratamientos largos].', 12),
  ('ctpl000014xxxxxxxxxxxxxx', 'Citas, pagos y urgencias', 'Paciente con dolor (urgencia)',
   'Lamento mucho que estés presentando dolor. Las urgencias son prioridad para nosotros. Déjame revisar la agenda inmediatamente... Tengo un espacio de urgencia hoy a las [Hora]. ¿Puedes acercarte a esa hora para que el doctor te atienda?', 13)
) AS v("id", "category", "title", "body", "sortOrder")
-- La guarda: si ya hay UNA plantilla viva, no se inserta ninguna.
WHERE NOT EXISTS (
  SELECT 1 FROM "message_templates" WHERE "deletedAt" IS NULL
);
