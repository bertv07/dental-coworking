import type { UserRole } from '@/backend/domain/types';

/**
 * ===========================================================================
 *  La ayuda de cada pantalla
 * ===========================================================================
 *  Lo que se lee al tocar el «?» de la barra de arriba: qué se puede hacer
 *  en ESA pantalla, cómo se hace, cómo se corrige y qué no se puede.
 *
 *  Está aquí, en un solo archivo y como datos, a propósito: cuando una
 *  pantalla cambia, su ayuda se corrige en el mismo sitio que la de todas
 *  las demás, sin ir a buscarla dentro de cada componente.
 *
 *  ESCRITO PARA QUIEN USA EL PANEL, no para quien lo programa: frases
 *  cortas, los nombres de los botones tal como se ven, y sin jerga.
 *
 *  `roles` en una sección = sólo la ve quien tenga ese rol. Sin `roles`, la
 *  ven todos los que entran a esa pantalla.
 * ===========================================================================
 */

export interface SeccionDeAyuda {
  titulo: string;
  puntos: string[];
  roles?: UserRole[];
}

export interface AyudaDePantalla {
  /** Prefijo de la ruta. Gana el más largo que coincida. */
  ruta: string;
  titulo: string;
  /** Una frase: para qué es esta pantalla. */
  para: string;
  secciones: SeccionDeAyuda[];
}

const ADMIN: UserRole[] = ['SUPER_ADMIN'];
const RECEPCION: UserRole[] = ['SUPER_ADMIN', 'ASSISTANT'];
const ODONTOLOGO: UserRole[] = ['DENTIST'];

export const AYUDA: AyudaDePantalla[] = [
  {
    ruta: '/inicio',
    titulo: 'Inicio',
    para: 'El panorama del día al empezar el turno: qué citas hay, quién falta por confirmar, cuánto se ha cobrado y a qué tasa.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Ver las citas de hoy con su estado y de dónde vino cada una.',
          'Ver cuánto se lleva cobrado en el día y la tasa de cambio vigente.',
          'Saltar a la agenda para crear una cita nueva.',
        ],
      },
      {
        titulo: 'Lo que no se hace aquí',
        puntos: [
          'Es una pantalla de consulta: no se edita nada. Las citas se cambian en Agenda y los cobros en Facturas o Caja.',
          'No muestra ganancias ni lo que se le debe a las odontólogas; eso está en Dashboard y en Caja, sólo para administración.',
        ],
      },
    ],
  },

  {
    ruta: '/dashboard',
    titulo: 'Dashboard',
    para: 'Las finanzas de la clínica de un vistazo: lo cobrado, lo que le queda a la clínica y el libro de Administración por mes.',
    secciones: [
      {
        titulo: 'Qué puedes ver',
        puntos: [
          'Arriba: ingresos de los últimos 30 días, lo que le queda a la clínica y lo que les corresponde a las odontólogas. Salen de los cobros reales.',
          'Administración: ingresos, egresos y total general del libro en un mes, y el saldo de caja chica.',
          'Libro por mes: toca un mes de la tabla para verlo arriba.',
          'Libro por odontóloga: consultas, presupuesto y reparto anotados en su pestaña ese mes.',
          'Liquidación por odontólogo y las próximas citas de la semana.',
        ],
      },
      {
        titulo: 'Cómo se usa',
        puntos: [
          '«Exportar» descarga los cobros de los últimos 30 días en un archivo.',
          '«Abrir el libro» lleva a Administración.',
          'Si el mes en curso todavía no tiene filas en el libro, se muestra el último mes que sí tenga.',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        puntos: [
          'Aquí no se edita nada: es sólo lectura. Los números se corrigen donde nacen (Facturas, Caja o Administración) y aquí se actualizan solos.',
          'Las cifras de arriba (cobros) y las de Administración (libro) pueden no coincidir: una cuenta lo cobrado en el sistema y la otra lo anotado en el libro.',
        ],
      },
    ],
  },

  {
    ruta: '/pacientes',
    titulo: 'Pacientes',
    para: 'La lista de todos los pacientes de la clínica y la ficha de cada uno.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Buscar un paciente por nombre, teléfono o documento.',
          'Registrar un paciente nuevo con su nombre, teléfono de WhatsApp, documento, correo y fecha de nacimiento.',
          'Abrir sus documentos: expediente, consentimiento informado, radiografías y otros papeles escaneados.',
          'Marcar si autoriza que se le escriba por mensajería automatizada.',
        ],
      },
      {
        titulo: 'Cómo editar',
        puntos: [
          'Usa el botón de editar en la fila del paciente, cambia lo que haga falta y guarda.',
          'En «Notas clínicas» van alergias, antecedentes y observaciones.',
          'Los documentos se suben desde «Documentos del paciente», eligiendo el tipo. No se transcribe nada: se guarda el papel escaneado.',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        puntos: [
          'El teléfono no se puede repetir en dos pacientes: es con lo que el bot de WhatsApp reconoce a cada uno.',
          'Quitar un paciente no borra su historial de citas ni de facturas.',
          'Borrar un paciente para siempre («Zona de peligro») es sólo para pacientes de prueba y sólo lo hace administración.',
        ],
      },
    ],
  },

  {
    ruta: '/agenda',
    titulo: 'Agenda',
    para: 'Las citas de la clínica: crearlas, moverlas, cambiar su estado y cobrarlas.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        roles: RECEPCION,
        puntos: [
          'Ver las citas del periodo con paciente, tratamiento, odontólogo, sala, origen y estado.',
          'Crear una cita nueva eligiendo paciente, tratamiento, odontólogo, consultorio y fecha y hora.',
          'Cambiar el estado de una cita (confirmada, completada, cancelada, no asistió).',
          'Cobrar una cita, y añadirle otro tratamiento si en consulta se hizo algo más.',
          'Abrir el expediente del paciente desde su cita.',
        ],
      },
      {
        titulo: 'Cómo cobrar una cita',
        roles: RECEPCION,
        puntos: [
          'Toca cobrar en la fila de la cita.',
          'Elige el medio de pago y el monto en dólares; el sistema calcula los bolívares con la tasa del día.',
          'El reparto entre la clínica y la odontóloga sale solo, y se puede ajustar para ese caso.',
        ],
      },
      {
        titulo: 'Cómo editar o mover una cita',
        roles: RECEPCION,
        puntos: [
          'Abre «Editar cita», cambia la fecha, la hora, el odontólogo o la sala y guarda.',
          'Si la hora está ocupada, el sistema avisa y sugiere horas libres.',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        roles: RECEPCION,
        puntos: [
          'No se pueden poner dos citas a la misma hora en el mismo consultorio ni con el mismo odontólogo.',
          'Cambiar el precio de un tratamiento en Precios no cambia las citas ya agendadas: cada una conserva el precio que se le dijo al paciente.',
          'Una cita ya cobrada no se «descobra» desde aquí: eso se corrige en su factura.',
        ],
      },
      {
        titulo: 'Tu agenda',
        roles: ODONTOLOGO,
        puntos: [
          'Ves el calendario de tus propias citas: hora, paciente, tratamiento, sala y si está confirmada.',
          'Puedes agendarte una cita a ti misma, incluso fuera de tu horario habitual.',
          'No ves las citas de otras odontólogas ni los importes, y no puedes cambiar el estado de una cita: eso lo hace recepción.',
        ],
      },
    ],
  },

  {
    ruta: '/facturas/',
    titulo: 'Una factura',
    para: 'El detalle de una factura: lo que se hizo, cuánto es, lo cobrado y cómo se reparte.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Añadir tratamientos o líneas escritas a mano, cambiar cantidad y precio, y poner un descuento con su motivo.',
          'Aplicar una promoción vigente.',
          'Registrar un cobro: total o parcial, con su medio de pago y referencia.',
          'Usar el saldo a favor del paciente, si tiene.',
          'Imprimir la factura o el presupuesto.',
        ],
      },
      {
        titulo: 'Cómo cobrar',
        puntos: [
          'Toca registrar cobro, elige el medio de pago y escribe el monto en dólares.',
          'Si pagó una parte, la factura queda abierta con lo que falta. Se pueden registrar varios cobros.',
          'Si el cobro fue otro día, cambia la fecha: el sistema usa la tasa de ese día, o te la pide si no la tiene.',
          'Si paga de más, lo que sobra le queda al paciente como saldo a favor.',
        ],
      },
      {
        titulo: 'Cómo corregir la odontóloga o el porcentaje',
        puntos: [
          'Odontóloga: en una venta directa (sin cita) elige la doctora en el selector «Odontóloga» y toca «Poner odontóloga» o «Cambiar». Si la factura salió sin doctora, sale un aviso amarillo.',
          'Reparto: usa los botones 60/40, 50/50, 40/60, o escribe el % de la clínica y toca «Aplicar». El primer número es siempre la clínica.',
          'Se puede corregir aunque la factura ya esté cobrada: el sistema vuelve a repartir lo cobrado y corrige el libro de Administración. No hace falta anular ni rehacer la factura.',
          'Con cobros ya registrados, estas correcciones sólo las hace administración.',
        ],
      },
      {
        titulo: 'Anular, reversar y borrar',
        puntos: [
          '«Anular factura»: sólo si todavía no se cobró nada. Pide el motivo y la factura queda como anulada.',
          '«Reversar venta»: para una factura ya cobrada que no debió existir. Quita sus cobros de Caja y del libro. Sólo administración.',
          '«Borrar factura definitivamente»: la hace desaparecer del todo. Pide escribir el número de la factura. Sólo administración.',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        puntos: [
          'Si a la odontóloga ya se le pagó su parte de esta factura, no se puede cambiar ni la doctora ni el reparto.',
          'En una factura que viene de una cita, la odontóloga es la de la cita: no se cambia desde la factura.',
          'Una factura anulada no se edita.',
          'Los totales no se escriben a mano: salen de las líneas.',
          'Sin odontóloga no hay reparto: todo queda para la clínica.',
        ],
      },
    ],
  },

  {
    ruta: '/facturas',
    titulo: 'Facturas',
    para: 'Todas las facturas emitidas, con lo que falta por cobrar.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Ver las últimas 100 facturas: las pendientes de cobro salen primero.',
          'Buscar las facturas de un paciente por su nombre.',
          'Abrir una factura tocando su fila, para cobrarla, corregirla o imprimirla.',
          'Registrar una venta directa: una factura sin cita, de hoy o de un día pasado.',
        ],
      },
      {
        titulo: 'Cómo registrar una venta directa',
        puntos: [
          'Busca y elige al paciente.',
          'Elige quién atendió. Es obligatorio: si de verdad no fue ninguna odontóloga, escoge «Nadie — venta directa».',
          'Pon la fecha si fue otro día. La factura nace vacía: los tratamientos y el cobro se añaden dentro de ella.',
        ],
      },
      {
        titulo: 'Los botones de la lista',
        puntos: [
          '«Ver todas» quita el tope de 100, para encontrar una factura vieja.',
          '«Ver anuladas» muestra las facturas anuladas, que por defecto no salen en la lista. No se borran: sólo se apartan.',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        puntos: [
          'Desde la lista no se edita ni se borra: hay que abrir la factura.',
          'La factura de una cita no se crea aquí: se abre desde la Agenda al cobrar la cita.',
        ],
      },
    ],
  },

  {
    ruta: '/caja',
    titulo: 'Caja',
    para: 'Lo cobrado en el día, el cierre de caja y lo que hay que pagarle a cada odontóloga.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Ver el total cobrado del día en dólares y en bolívares, cobro por cobro y por medio de pago.',
          'Ver qué citas del día faltan por cobrar, y cobrarlas.',
          'Cerrar la caja contando el efectivo.',
          'Ver cuánto le corresponde a cada odontóloga y cuánto se le debe.',
          'Pasar a otro día con «Anterior» y «Siguiente», o ver una semana, un mes, un año o un rango con los filtros.',
        ],
      },
      {
        titulo: 'Cómo cerrar la caja',
        puntos: [
          'Primero cobra lo que esté pendiente del día.',
          'En «Cierre de caja» escribe el efectivo que contaste. El sistema lo compara con el que debería haber y muestra la diferencia.',
          'Si hay diferencia, explica por qué en las observaciones y cierra.',
        ],
      },
      {
        titulo: 'Cómo pagarle a una odontóloga',
        roles: ADMIN,
        puntos: [
          '«Liquidación del día»: toca «Marcar pagado» para entregarle su parte de lo cobrado ese día.',
          '«Deudas pendientes con odontólogos»: muestra todo lo que se le debe a cada una, de cualquier día. «Pagar todo» salda todo lo de esa doctora; «Pagar este día» salda un día suelto.',
          'Cada pago queda anotado abajo, en «Pagos entregados», con fecha, hora y monto.',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        puntos: [
          'Un cobro no se edita ni se borra desde Caja: se corrige en su factura.',
          'Reabrir una caja ya cerrada sólo lo hace administración.',
          'Marcar un pago a una odontóloga no se puede deshacer desde la pantalla.',
          'Las tarjetas de cierre, liquidación y deudas sólo salen viendo un día completo; con filtros de periodo, odontólogo o medio de pago se ve el informe.',
          'Recepción ve lo que le corresponde a cada odontóloga, pero sólo administración entrega el dinero.',
        ],
      },
    ],
  },

  {
    ruta: '/administracion',
    titulo: 'Administración',
    para: 'El libro de la clínica, igual que la hoja de Excel: gastos administrativos, caja chica, el libro de cada odontóloga y los cierres de mes y de año.',
    secciones: [
      {
        titulo: 'Las pestañas',
        puntos: [
          'Gastos Administrativos: el libro general. Cada fila es un ingreso o un egreso.',
          'Caja Chica: el efectivo de la oficina, con su saldo.',
          'Una pestaña por cada odontóloga: sus consultas, con presupuesto, abono y reparto.',
          'Cierre mensual y anual: cuánto se ganó en un mes o en un año.',
        ],
      },
      {
        titulo: 'Cómo ver un mes',
        puntos: [
          'Cada pestaña se ve por mes. Encima de la tabla están los botones para ir al mes anterior y al siguiente.',
          '«Este mes» vuelve al mes en curso y «Ver todo» muestra la lista completa.',
          'Los totales de abajo son del mes que estás viendo. En Caja Chica, «Saldo anterior» es lo que quedó de los meses previos.',
        ],
      },
      {
        titulo: 'Cómo añadir, editar y quitar filas',
        puntos: [
          '«Nueva fila» (o «Nueva consulta» en una odontóloga) abre el formulario. Pon la fecha, la descripción y el ingreso O el egreso, nunca los dos.',
          'Para editar toca el lápiz de la fila; para quitarla, la papelera.',
          'En una odontóloga, al escribir el paciente se sugieren los suyos, pero puedes poner cualquier nombre. Marca cortesía si no se cobró.',
          'Ojo con la fecha: una fila nueva sale con la de hoy. Si estás viendo otro mes, cámbiala o no la verás en esa lista.',
        ],
      },
      {
        titulo: 'Cómo cargar un Excel',
        puntos: [
          'Toca «Cargar Excel», elige a dónde va (Gastos Administrativos, Caja Chica o una odontóloga) y el archivo.',
          '«Revisar archivo» muestra lo que se leyó sin guardar nada: revisa las fechas y que la suma coincida con el total de tu Excel.',
          'Desmarca las filas que no quieras y toca «Guardar».',
          'Subir la misma hoja otra vez no duplica: las filas que ya están se saltan.',
          'Columnas del libro general: Fecha, Descripción, Ingreso y Egreso. De una odontóloga: Fecha, Paciente y Presupuesto.',
        ],
      },
      {
        titulo: 'Las filas «Auto»',
        puntos: [
          'Cada cobro registrado en el sistema escribe solo sus filas aquí: el ingreso, el pago a la doctora y la consulta en el libro de ella. Llevan la insignia «Auto».',
          'Si el cobro se reversa o la factura se corrige, esas filas se actualizan solas.',
          'Quitar una fila «Auto» sólo borra la anotación del libro: no deshace el cobro.',
        ],
      },
      {
        titulo: 'Cómo hacer el cierre de mes o de año',
        puntos: [
          'En la pestaña «Cierre mensual y anual» elige «Cierre mensual» o «Cierre anual» y muévete con «Anterior» y «Siguiente».',
          'Verás cuánto se ganó, día por día (o mes por mes), por odontóloga, la caja chica y los mayores gastos.',
          '«Cerrar el mes» o «Cerrar el año» guarda el registro de lo ganado, con quién lo cerró y cuándo.',
          'Si después corriges el libro, la pantalla avisa que cambió y puedes «Volver a cerrar».',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        puntos: [
          'Una fila no puede tener ingreso y egreso a la vez.',
          'Editar el libro no cambia ningún cobro ni ninguna factura: va en un solo sentido.',
          'El Excel antiguo (.xls) no entra: guárdalo como .xlsx.',
          'Cerrar un mes no lo bloquea: el libro se puede seguir corrigiendo.',
          'Esta pantalla es sólo de administración.',
        ],
      },
    ],
  },

  {
    ruta: '/horarios',
    titulo: 'Horarios',
    para: 'Cuándo trabaja cada odontóloga. Es el horario que usa el bot de WhatsApp para ofrecer citas.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        roles: RECEPCION,
        puntos: [
          'Ver y fijar el horario habitual de cada odontóloga, por día, con hora de inicio y de fin.',
          'Ver las solicitudes de cambio que mandan las odontólogas, y aprobarlas o rechazarlas.',
        ],
      },
      {
        titulo: 'Cómo aprobar o rechazar una solicitud',
        roles: RECEPCION,
        puntos: [
          'Cada solicitud muestra el horario habitual y lo que se pide para esa semana.',
          'Se aprueba o se rechaza la semana entera. Al rechazar hay que escribir por qué.',
        ],
      },
      {
        titulo: 'Tu horario',
        roles: ODONTOLOGO,
        puntos: [
          'Ves tu horario habitual y tus solicitudes.',
          'Para pedir un cambio usa «Proponer horario»: arma la semana, escribe el motivo y envía la solicitud.',
          'El cambio no vale hasta que recepción lo apruebe.',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        puntos: [
          'Una odontóloga no cambia su horario por su cuenta: lo propone y recepción decide.',
          'Cambiar el horario no mueve las citas que ya estaban agendadas.',
        ],
      },
    ],
  },

  {
    ruta: '/recetarios',
    titulo: 'Recetarios',
    para: 'El récipe de cada odontóloga, escaneado tal como lo usa en papel, para imprimir sobre él.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Subir un recetario escaneado (imagen PNG, JPG o WEBP de hasta 8 MB) y elegir el tamaño del papel.',
          'Decir de quién es: de una odontóloga, o de la clínica para que lo vean todos.',
          'Abrir un recetario para usarlo e imprimirlo.',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        puntos: [
          'El recetario no se edita dentro del panel: vale la imagen que se subió. Para cambiarlo, sube uno nuevo.',
          'Una odontóloga ve sólo los suyos y los de la clínica, no los de sus compañeras.',
        ],
      },
    ],
  },

  {
    ruta: '/medicamentos',
    titulo: 'Medicamentos',
    para: 'El vademécum de la clínica: los medicamentos que se indican habitualmente, para imprimir la hoja al paciente.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Añadir un medicamento con su nombre, presentación, categoría y la indicación habitual.',
          'Editarlo, o ponerlo inactivo cuando ya no se usa.',
          'Imprimir la lista.',
        ],
      },
      {
        titulo: 'Bueno saber',
        puntos: [
          'Se ven todos, activos e inactivos; los inactivos salen marcados y se pueden reactivar.',
          'Si no pones categoría, queda en «General».',
        ],
      },
    ],
  },

  {
    ruta: '/instrumental',
    titulo: 'Instrumental',
    para: 'El inventario de instrumentos de cada odontóloga.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Añadir un instrumento con su categoría, cantidad, número de serie, ubicación, estado y último servicio.',
          'Editarlo o quitarlo.',
        ],
      },
      {
        titulo: 'Quién ve qué',
        puntos: [
          'Cada odontóloga ve y lleva sólo el suyo.',
          'Administración ve el de todas y elige la dueña al dar de alta un instrumento.',
          'Recepción no entra a esta pantalla.',
        ],
      },
    ],
  },

  {
    ruta: '/odontologos',
    titulo: 'Odontólogos',
    para: 'El equipo de odontólogas de la clínica.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        roles: ADMIN,
        puntos: [
          'Registrar una odontóloga con su nombre, registro profesional, especialidades, teléfono, correo y fecha de nacimiento.',
          'Fijar su comisión: el porcentaje que se queda la clínica de lo que ella produce.',
          'Crearle su cuenta para entrar al panel, o generarle una clave nueva que se le envía por correo.',
          'Ponerla inactiva o darla de baja, y ver las que ya están de baja.',
          'Ver lo que produjo en los últimos 30 días y lo que le corresponde.',
        ],
      },
      {
        titulo: 'Bueno saber',
        roles: ADMIN,
        puntos: [
          'Cambiar la comisión aquí afecta a los cobros nuevos, no a los ya hechos. Para un caso concreto, el reparto se ajusta en la factura.',
          'Una odontóloga dada de baja conserva su historial, y sigue ocupando su correo y su número de registro.',
          'Una odontóloga nueva aparece sola con su pestaña vacía en Administración.',
        ],
      },
      {
        titulo: 'Qué puedes ver',
        roles: ['ASSISTANT'],
        puntos: [
          'La lista del equipo: quién hay, qué especialidad tiene cada una y cómo localizarla. Sirve para agendar y para derivar.',
          'No se muestran comisiones ni producción, y no se puede editar: eso lo lleva administración.',
        ],
      },
    ],
  },

  {
    ruta: '/usuarios',
    titulo: 'Cuentas',
    para: 'Quién puede entrar al panel y con qué permisos.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Crear una cuenta con nombre, correo y rol.',
          'Suspender una cuenta para que deje de entrar, o volver a activarla.',
          'Enlazar la cuenta de una odontóloga con su ficha.',
          'Ver cuándo entró cada persona por última vez.',
        ],
      },
      {
        titulo: 'Los roles',
        puntos: [
          'Administrador: acceso a todo.',
          'Asistente: agenda, pacientes, facturas y caja.',
          'Odontólogo: su agenda y lo suyo.',
        ],
      },
      {
        titulo: 'Bueno saber',
        puntos: [
          'La contraseña la genera el sistema y se envía por correo; la persona la cambia al entrar la primera vez.',
          '«Clave sin estrenar» significa que todavía no ha entrado con la clave que se le envió.',
          'Esta pantalla es sólo de administración.',
        ],
      },
    ],
  },

  {
    ruta: '/tratamientos',
    titulo: 'Precios',
    para: 'El catálogo de tratamientos y lo que cuesta cada uno.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Añadir un tratamiento con su código, nombre, categoría, precio en dólares, duración y minutos de margen entre citas.',
          'Editar un precio o poner un tratamiento inactivo.',
          'Cargar toda la lista de precios desde un Excel.',
        ],
      },
      {
        titulo: 'Cómo cargar precios desde Excel',
        puntos: [
          'Descarga la plantilla con tu lista actual, cámbiala y súbela.',
          '«Revisar archivo» muestra qué es nuevo, qué cambia y qué tiene error, sin aplicar nada.',
          'Revisa los precios y toca aplicar. Las filas con error se quedan fuera y te dice en qué fila están.',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        puntos: [
          'Cambiar un precio no cambia las citas ya agendadas ni las facturas ya hechas.',
          'El código de un tratamiento es con lo que lo reconoce el bot: no conviene cambiarlo.',
          'El reparto con las odontólogas no se fija aquí, sino en Odontólogos y en cada factura.',
        ],
      },
    ],
  },

  {
    ruta: '/tasa-cambio',
    titulo: 'Tasa de cambio',
    para: 'La tasa del día con la que se convierten los precios en dólares a bolívares al cobrar.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Ver la tasa vigente y si está al día.',
          'Ver el historial de las últimas tasas.',
          'Ver cuánto cuesta cada tratamiento en bolívares a la tasa de hoy.',
        ],
      },
      {
        titulo: 'Bueno saber',
        puntos: [
          'Cada cobro guarda la tasa con la que se hizo: si la tasa cambia después, los cobros ya hechos no se mueven.',
          'Qué tasa usa la clínica (BCV, euro…) se elige en Configuración.',
          'Si la tasa sale como desactualizada, revísala antes de cobrar.',
        ],
      },
    ],
  },

  {
    ruta: '/consultorios',
    titulo: 'Consultorios',
    para: 'Las salas de la clínica donde se atiende.',
    secciones: [
      {
        titulo: 'Qué puedes hacer aquí',
        puntos: [
          'Añadir un consultorio con su nombre, código corto, equipamiento y notas.',
          'Asignarle una odontóloga fija, si la tiene.',
          'Editarlo o ponerlo inactivo.',
          'Ver cuántas citas tiene cada sala en los próximos 7 días.',
        ],
      },
      {
        titulo: 'Lo que no se puede',
        puntos: [
          'Dos citas no pueden coincidir a la misma hora en el mismo consultorio.',
          'Antes de poner inactiva una sala, mira las citas que tiene encima: hay que moverlas en la Agenda.',
        ],
      },
    ],
  },

  {
    ruta: '/configuracion',
    titulo: 'Configuración',
    para: 'Los ajustes generales de la clínica.',
    secciones: [
      {
        titulo: 'Qué puedes cambiar',
        puntos: [
          'Identidad de la clínica: nombre, RIF, dirección, teléfono y correo. Sale en facturas e informes.',
          'Reglas de negocio: la comisión habitual de la clínica, la hora de apertura y de cierre, y cada cuántos minutos va la agenda.',
          'La moneda y la fuente de la tasa de cambio.',
          'Los medios de pago: cuáles se aceptan, en qué moneda y en qué orden los ofrece el bot.',
          'El bot de WhatsApp: cuántas horas espera para volver a atender después de que una persona tomó la conversación.',
        ],
      },
      {
        titulo: 'Bueno saber',
        puntos: [
          'La comisión de aquí es la de por defecto; cada odontóloga puede tener la suya en Odontólogos.',
          'Un medio de pago inactivo deja de ofrecerse, pero los cobros ya hechos con él no cambian.',
          'Esta pantalla es sólo de administración.',
        ],
      },
    ],
  },
];

/** La ayuda de la pantalla en la que se está, o `null` si no tiene. */
export function ayudaDe(pathname: string): AyudaDePantalla | null {
  return (
    AYUDA.filter((a) => pathname === a.ruta || pathname.startsWith(a.ruta.endsWith('/') ? a.ruta : `${a.ruta}/`))
      // La más específica gana: «/facturas/123» es «Una factura», no «Facturas».
      .sort((a, b) => b.ruta.length - a.ruta.length)[0] ?? null
  );
}
