/**
 * ===========================================================================
 *  Plantillas de respuesta iniciales
 * ===========================================================================
 *      node scripts/cargar-plantillas.mjs
 *
 *  Carga el juego de plantillas con el que arranca recepción. A partir de ahí
 *  se editan desde el panel, en `/plantillas`.
 *
 *  NO PISA LO QUE YA HAYA: si la lista tiene algo, no toca nada. Volver a
 *  ejecutarlo después de que la clínica haya ajustado sus textos les
 *  devolvería los de fábrica, y nadie se daría cuenta hasta enviar un precio
 *  viejo a un paciente.
 *
 *  Los corchetes `[Precio]`, `[Hora]` se dejan a propósito: son el recordatorio
 *  visible de lo que hay que sustituir antes de enviar. El panel avisa si
 *  queda alguno sin rellenar.
 * ===========================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PLANTILLAS = [
  // --- 1. Saludos y bienvenida ---------------------------------------------
  {
    category: 'Saludos y bienvenida',
    title: 'Primer contacto',
    body: '¡Hola! Gracias por comunicarte con [Nombre de la Clínica]. Te atiende [Tu Nombre], ¿en qué te puedo ayudar hoy?',
  },
  {
    category: 'Saludos y bienvenida',
    title: "Respuesta a un 'Hola' sin contexto",
    body: '¡Hola! Buen día. Gracias por escribir a [Nombre de la Clínica]. Cuéntame, ¿buscas información sobre algún tratamiento en particular o deseas agendar una cita?',
  },
  {
    category: 'Saludos y bienvenida',
    title: 'Horarios y ubicación',
    body: 'Con gusto. Estamos ubicados en [Dirección completa/Punto de referencia]. Nuestro horario de atención es de [Día] a [Día], de [Hora] a [Hora]. ¿Te gustaría que revisemos disponibilidad para agendar una cita?',
  },

  // --- 2. Precios directos --------------------------------------------------
  {
    category: 'Precios directos',
    title: 'Consulta de valoración',
    body: 'La consulta de valoración inicial tiene un costo de [Precio]. En esta cita, el doctor realizará una revisión completa de tu salud bucal, diagnóstico y te entregará un plan de tratamiento detallado. ¿Qué día de esta semana te viene mejor para asistir?',
  },
  {
    category: 'Precios directos',
    title: 'Limpieza dental',
    body: 'Nuestra limpieza dental profunda (profilaxis) tiene un valor de [Precio]. El procedimiento incluye remoción de cálculo (sarro), pulido de manchas superficiales y aplicación de flúor para proteger el esmalte. ¿Te gustaría que busquemos un espacio en la agenda?',
  },
  {
    category: 'Precios directos',
    title: 'Blanqueamiento dental',
    body: 'El blanqueamiento dental de consultorio tiene una inversión de [Precio]. Logramos aclarar varios tonos en una sola sesión de aproximadamente [Tiempo]. Para realizarlo, solo necesitamos confirmar en consulta que tus encías estén sanas. ¿Deseas agendar tu sesión?',
  },

  // --- 3. Tratamientos que dependen de evaluación ---------------------------
  // El objetivo es dar un rango para no perder al paciente, pero dejando claro
  // que el precio exacto sale de la consulta.
  {
    category: 'Tratamientos complejos',
    title: 'Ortodoncia (brackets o alineadores)',
    body: 'Para tratamientos de ortodoncia, manejamos cuotas iniciales desde [Precio] y mensualidades de [Precio]. Sin embargo, el presupuesto exacto y el tiempo de tratamiento dependen de la evaluación de tu mordida. Te sugiero agendar una cita de valoración por [Precio de consulta] para que el especialista te dé tu plan exacto. ¿Qué te parece?',
  },
  {
    category: 'Tratamientos complejos',
    title: 'Implantes dentales',
    body: 'El costo de un implante dental (tornillo y corona) inicia en aproximadamente [Precio]. Como cada paciente tiene una calidad y cantidad de hueso diferente, es indispensable realizar una valoración previa clínica y radiográfica para darte un presupuesto exacto y seguro. ¿Te gustaría agendar esta primera evaluación?',
  },
  {
    category: 'Tratamientos complejos',
    title: 'Extracción de cordales',
    body: 'Las extracciones de cordales tienen un costo que va desde [Precio] por muelita. El valor final depende de la posición en la que se encuentren (si están impactadas o en el hueso), lo cual verificamos con una radiografía panorámica. ¿Deseas que programemos tu cita de evaluación para revisarlo?',
  },
  {
    category: 'Tratamientos complejos',
    title: 'Caries y resinas',
    body: 'El costo para eliminar caries y colocar resinas estéticas (del color del diente) va desde [Precio] por superficie. Para indicarte cuántas necesitas exactamente y su tamaño, te invitamos a una consulta de valoración. ¿Te agendamos un espacio?',
  },

  // --- 4. Citas, pagos y urgencias -----------------------------------------
  {
    category: 'Citas, pagos y urgencias',
    title: 'Cerrar la cita',
    body: '¡Perfecto! Para esta semana tengo disponibilidad el [Día] a las [Hora] o el [Día] a las [Hora]. ¿Cuál de las dos opciones te funciona mejor?',
  },
  {
    category: 'Citas, pagos y urgencias',
    title: 'Confirmar cita (un día antes)',
    body: "¡Hola [Nombre del paciente]! Te escribimos de [Nombre de la Clínica] para confirmar tu cita de mañana a las [Hora] con el Dr./Dra. [Nombre]. Por favor, confírmanos tu asistencia con un 'Sí'. ¡Te esperamos!",
  },
  {
    category: 'Citas, pagos y urgencias',
    title: 'Métodos de pago',
    body: 'Para tu comodidad, aceptamos los siguientes métodos de pago: [Efectivo, Zelle, Pago Móvil, Binance]. [Opcional: También contamos con financiamiento para tratamientos largos].',
  },
  {
    category: 'Citas, pagos y urgencias',
    title: 'Paciente con dolor (urgencia)',
    body: 'Lamento mucho que estés presentando dolor. Las urgencias son prioridad para nosotros. Déjame revisar la agenda inmediatamente... Tengo un espacio de urgencia hoy a las [Hora]. ¿Puedes acercarte a esa hora para que el doctor te atienda?',
  },
];

async function main() {
  const existentes = await prisma.messageTemplate.count({ where: { deletedAt: null } });

  if (existentes > 0) {
    console.log(`Ya hay ${existentes} plantillas. No se toca nada.`);
    console.log('Para empezar de cero, bórralas primero desde /plantillas.');
    return;
  }

  // `sortOrder` sigue el orden del array: el primero de cada categoría es el
  // que más se usa, y así aparece arriba desde el primer día.
  await prisma.messageTemplate.createMany({
    data: PLANTILLAS.map((plantilla, indice) => ({ ...plantilla, sortOrder: indice })),
  });

  console.log(`✓ ${PLANTILLAS.length} plantillas cargadas\n`);
  const categorias = [...new Set(PLANTILLAS.map((p) => p.category))];
  for (const categoria of categorias) {
    const cuantas = PLANTILLAS.filter((p) => p.category === categoria).length;
    console.log(`  ${categoria.padEnd(26)} ${cuantas}`);
  }
  console.log('\nEdítalas en el panel: Plantillas.');
  console.log('Los corchetes [ ] se sustituyen antes de enviar — el panel avisa si queda alguno.');
}

main()
  .catch((error) => {
    console.error('\n❌ No se pudieron cargar las plantillas:\n');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
