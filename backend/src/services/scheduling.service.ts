import 'server-only';
import { repository } from '@/backend/repositories';
import type { CreateAppointmentInput } from '@/backend/validators/appointment.schema';
import type { Appointment, Dentist, Room, Treatment } from '@/backend/domain/types';
import { env } from '@/backend/config/env';

/**
 * ===========================================================================
 *  Servicio de agendamiento
 * ===========================================================================
 *  Toda la lógica de negocio de la agenda vive aquí. Las rutas de API sólo
 *  se ocupan de HTTP (autenticar, validar, traducir a códigos de estado);
 *  este servicio no sabe qué es una petición HTTP.
 *
 *  Esa separación es la que permite que el mismo agendamiento lo invoquen el
 *  bot de WhatsApp, el panel de administración y, mañana, una app móvil, sin
 *  duplicar ni una regla.
 * ===========================================================================
 */

/** Resultado discriminado: obliga a la ruta a tratar cada caso explícitamente. */
export type SchedulingResult =
  | { outcome: 'CREATED'; appointment: Appointment }
  /** La llave de idempotencia ya se había usado: se devuelve la cita original. */
  | { outcome: 'ALREADY_EXISTS'; appointment: Appointment }
  | { outcome: 'TREATMENT_NOT_FOUND' }
  | { outcome: 'DENTIST_NOT_FOUND' }
  | { outcome: 'DENTIST_UNAVAILABLE'; suggestedSlots: Date[] }
  | { outcome: 'NO_ROOM_AVAILABLE'; suggestedSlots: Date[] };

/** Hueco libre que el bot puede ofrecer al paciente. */
export interface AvailableSlot {
  startsAt: Date;
  endsAt: Date;
  dentistId: string;
  dentistName: string;
  roomId: string;
  roomCode: string;
}

/** Jornada de la clínica, en minutos desde medianoche (hora local). */
const CLINIC_OPEN_MINUTE = 8 * 60; // 08:00
const CLINIC_CLOSE_MINUTE = 18 * 60; // 18:00
/** Granularidad de la agenda: las citas empiezan en punto o y media. */
const SLOT_GRANULARITY_MINUTES = 30;

/**
 * ===========================================================================
 *  LA HORA DE LA CLÍNICA NO ES LA HORA DEL SERVIDOR
 * ===========================================================================
 *  El servidor corre en UTC y la clínica está en Caracas (UTC-4). Construir
 *  un hueco con `Date.UTC(..., 9, 0)` no da las nueve de la mañana en la
 *  clínica: da las nueve UTC, que allí son las cinco de la madrugada. Es
 *  justo lo que hacía este servicio, y por eso el bot ofrecía citas de
 *  madrugada.
 *
 *  Estas dos funciones hacen la conversión de verdad, preguntándole a la
 *  zona horaria en vez de sumar un desfase a mano: Venezuela hoy no tiene
 *  horario de verano, pero lo ha tenido y lo ha cambiado dos veces, y un
 *  `-4` escrito a mano se convierte en una hora de citas equivocadas el día
 *  que vuelva a moverse.
 * ===========================================================================
 */

/** Cuánto se desvía la zona respecto a UTC en ESE instante, en milisegundos. */
function desfaseDeLaZona(instante: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);

  const v = Object.fromEntries(partes.map((p) => [p.type, p.value])) as Record<string, string>;
  const comoSiFueraUtc = Date.UTC(
    Number(v.year),
    Number(v.month) - 1,
    Number(v.day),
    Number(v.hour) % 24,
    Number(v.minute),
    Number(v.second),
  );

  return comoSiFueraUtc - instante.getTime();
}

/** Año, mes, día y día de la semana de una fecha, vistos EN LA CLÍNICA. */
function diaEnLaClinica(fecha: Date, zona: string) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(fecha);

  const v = Object.fromEntries(partes.map((p) => [p.type, p.value])) as Record<string, string>;
  const semana: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    anio: Number(v.year),
    mes: Number(v.month),
    dia: Number(v.day),
    /** 0 = domingo, como `DentistSchedule.weekday`. */
    diaSemana: semana[v.weekday ?? 'Sun'] ?? 0,
  };
}

/** El instante UTC que corresponde a «tal minuto de tal día» en la clínica. */
function instanteEnLaClinica(
  d: { anio: number; mes: number; dia: number },
  minutoDelDia: number,
  zona: string,
): Date {
  const tentativa = Date.UTC(
    d.anio,
    d.mes - 1,
    d.dia,
    Math.floor(minutoDelDia / 60),
    minutoDelDia % 60,
  );
  // Se corrige con el desfase que tenga la zona en ese momento concreto.
  return new Date(tentativa - desfaseDeLaZona(new Date(tentativa), zona));
}

/** El minuto del día, en hora de la clínica, de un instante cualquiera. */
function minutoEnLaClinica(instante: Date, zona: string): number {
  const v = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(instante)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  return (Number(v.hour) % 24) * 60 + Number(v.minute);
}

/**
 * Agenda una cita aplicando todas las reglas de negocio.
 *
 * ORDEN DE LAS COMPROBACIONES (importa, y mucho):
 *   1. Idempotencia   → lo primero, para que un reintento no repita trabajo.
 *   2. Tratamiento    → determina duración y precio.
 *   3. Paciente       → se busca o se crea.
 *   4. Odontólogo     → el pedido, o se asigna uno libre.
 *   5. Consultorio    → se busca uno libre en esa franja.
 *   6. Creación       → el constraint EXCLUDE de Postgres es el árbitro final.
 *
 * SOBRE LA CONCURRENCIA:
 * Entre el paso 5 y el 6 hay una ventana en la que otra petición podría
 * tomar el mismo hueco. Esa carrera NO se resuelve aquí, sino en la base de
 * datos, con los constraints EXCLUDE de la migración 0001. La comprobación
 * previa existe para dar un mensaje útil en el 99% de los casos; el
 * constraint garantiza la corrección en el 1% restante.
 * Quien llama debe capturar la violación (ver `isOverlapViolation`).
 */
export async function scheduleAppointment(
  input: CreateAppointmentInput,
): Promise<SchedulingResult> {
  // --- 1. Idempotencia ----------------------------------------------------
  const existing = await repository.findAppointmentByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return { outcome: 'ALREADY_EXISTS', appointment: existing };
  }

  // --- 2. Tratamiento: la fuente de duración y precio ---------------------
  const treatment = await repository.findTreatmentByCode(input.treatmentCode);
  if (!treatment) {
    return { outcome: 'TREATMENT_NOT_FOUND' };
  }

  const startsAt = input.startsAt;
  // EL SERVIDOR calcula el fin. Nunca se acepta del cliente: si no, el bot
  // podría reservar 5 minutos para una endodoncia de 120.
  const endsAt = new Date(startsAt.getTime() + treatment.durationMinutes * 60_000);
  // El buffer bloquea el consultorio pero no se le cobra al paciente.
  const roomBlockedUntil = new Date(
    endsAt.getTime() + treatment.bufferMinutes * 60_000,
  );

  // --- 3. Paciente: se busca por teléfono o se crea ------------------------
  const patient = await repository.upsertPatientByPhone({
    phoneE164: input.patientPhone,
    // Si es un contacto nuevo y el bot no mandó nombre, se guarda un
    // marcador; recepción lo completa después.
    fullName: input.patientName ?? `Paciente ${input.patientPhone.slice(-4)}`,
  });

  // --- 4. Odontólogo -------------------------------------------------------
  const dentists = await repository.listDentists();
  let dentist: Dentist | undefined;

  if (input.dentistId) {
    dentist = dentists.find((candidate) => candidate.id === input.dentistId);
    if (!dentist) return { outcome: 'DENTIST_NOT_FOUND' };

    // ¿Trabaja ese día a esa hora? Antes de mirar si tiene otra cita: no
    // tiene sentido comprobar choques en una franja en la que ni viene.
    if (!(await trabajaEnEseMomento(dentist.id, startsAt, endsAt))) {
      return {
        outcome: 'DENTIST_UNAVAILABLE',
        suggestedSlots: await suggestAlternativeSlots(startsAt, treatment, dentist.id),
      };
    }

    const conflicts = await repository.findOverlappingAppointments({
      startsAt,
      endsAt,
      dentistId: dentist.id,
    });
    if (conflicts.length > 0) {
      return {
        outcome: 'DENTIST_UNAVAILABLE',
        suggestedSlots: await suggestAlternativeSlots(startsAt, treatment, dentist.id),
      };
    }
  } else {
    // Sin preferencia: se asigna el primer odontólogo libre.
    dentist = await findFirstAvailableDentist(dentists, startsAt, endsAt);
    if (!dentist) {
      return {
        outcome: 'DENTIST_UNAVAILABLE',
        suggestedSlots: await suggestAlternativeSlots(startsAt, treatment),
      };
    }
  }

  // --- 5. Consultorio ------------------------------------------------------
  const rooms = await repository.listRooms();
  const room = await findFirstAvailableRoom(
    rooms,
    startsAt,
    roomBlockedUntil,
    input.roomId,
    dentist.id,
  );
  if (!room) {
    return {
      outcome: 'NO_ROOM_AVAILABLE',
      suggestedSlots: await suggestAlternativeSlots(startsAt, treatment, dentist.id),
    };
  }

  // --- 6. Creación ---------------------------------------------------------
  const appointment = await repository.createAppointment({
    patientId: patient.id,
    dentistId: dentist.id,
    roomId: room.id,
    treatmentId: treatment.id,
    startsAt,
    endsAt,
    // Precio congelado: si mañana sube la tarifa, esta cita conserva la
    // que se le prometió al paciente.
    agreedPriceCents: treatment.basePriceCents,
    source: 'WHATSAPP_AI',
    notes: input.notes ?? null,
    idempotencyKey: input.idempotencyKey,
  });

  return { outcome: 'CREATED', appointment };
}

/** Primer odontólogo sin conflictos en la franja. */
async function findFirstAvailableDentist(
  dentists: Dentist[],
  startsAt: Date,
  endsAt: Date,
): Promise<Dentist | undefined> {
  for (const dentist of dentists) {
    // Que esté libre no basta: tiene que estar TRABAJANDO. Sin esto, «la
    // primera que esté libre» un domingo devolvía a cualquiera.
    if (!(await trabajaEnEseMomento(dentist.id, startsAt, endsAt))) continue;

    const conflicts = await repository.findOverlappingAppointments({
      startsAt,
      endsAt,
      dentistId: dentist.id,
    });
    if (conflicts.length === 0) return dentist;
  }
  return undefined;
}

/**
 * Primer consultorio libre. Si se pidió uno concreto, se comprueba sólo ese
 * — respetar la preferencia importa cuando el tratamiento requiere el
 * equipamiento de una sala específica.
 *
 * Con `dentistId`, el consultorio FIJO de esa persona se prueba primero.
 * «Algunos consultorios son fijos y algunos no»: quien tiene el suyo deja
 * ahí su instrumental y espera encontrarlo ahí.
 *
 * Es una preferencia, no un candado — si su sala está ocupada se le da otra.
 * Bloquearlo dejaría el consultorio vacío los días que su dueño no viene,
 * justo lo contrario de lo que quiere un coworking.
 */
async function findFirstAvailableRoom(
  rooms: Room[],
  startsAt: Date,
  blockedUntil: Date,
  preferredRoomId?: string,
  dentistId?: string,
): Promise<Room | undefined> {
  const candidates = preferredRoomId
    ? rooms.filter((room) => room.id === preferredRoomId)
    : /*
       * Su sala primero, el resto después. `sort` con un comparador que sólo
       * distingue "es suya" de "no lo es" mantiene el orden relativo del
       * resto, así que los rotativos se siguen repartiendo como antes.
       */
      [...rooms].sort((a, b) => {
        const aEsSuya = dentistId != null && a.assignedDentistId === dentistId;
        const bEsSuya = dentistId != null && b.assignedDentistId === dentistId;
        return Number(bEsSuya) - Number(aEsSuya);
      });

  for (const room of candidates) {
    const conflicts = await repository.findOverlappingAppointments({
      startsAt,
      endsAt: blockedUntil,
      roomId: room.id,
    });
    if (conflicts.length === 0) return room;
  }
  return undefined;
}

/**
 * Propone horarios alternativos cuando el pedido no está libre.
 *
 * Esto es lo que convierte un "no se puede" en una conversación útil: el bot
 * responde "esa hora está ocupada, ¿te sirve alguna de estas tres?" en vez de
 * un error seco que deja al paciente sin salida.
 */
async function suggestAlternativeSlots(
  around: Date,
  treatment: Treatment,
  dentistId?: string,
  maxSuggestions = 3,
): Promise<Date[]> {
  const suggestions: Date[] = [];
  const durationMs = treatment.durationMinutes * 60_000;

  // Se exploran las 8 horas siguientes en pasos de 30 min.
  const stepsToCheck = (8 * 60) / SLOT_GRANULARITY_MINUTES;

  for (let step = 1; step <= stepsToCheck && suggestions.length < maxSuggestions; step += 1) {
    const candidateStart = new Date(
      around.getTime() + step * SLOT_GRANULARITY_MINUTES * 60_000,
    );
    const candidateEnd = new Date(candidateStart.getTime() + durationMs);

    /*
     * Fuera del horario de atención: no se propone.
     *
     * El minuto se lee EN HORA DE LA CLÍNICA. Con `getUTCHours()` las
     * alternativas salían desplazadas cuatro horas, igual que los huecos.
     */
    const minuteOfDay = minutoEnLaClinica(candidateStart, env.CLINIC_TIMEZONE);
    if (minuteOfDay < CLINIC_OPEN_MINUTE || minuteOfDay >= CLINIC_CLOSE_MINUTE) continue;

    // Y que la odontóloga trabaje en esa franja: proponer alternativas fuera
    // de su horario es cambiar un «no puedo» por otro.
    if (dentistId && !(await trabajaEnEseMomento(dentistId, candidateStart, candidateEnd))) {
      continue;
    }

    const conflicts = await repository.findOverlappingAppointments({
      startsAt: candidateStart,
      endsAt: candidateEnd,
      ...(dentistId ? { dentistId } : {}),
    });

    if (conflicts.length === 0) suggestions.push(candidateStart);
  }

  return suggestions;
}

/**
 * Calcula los huecos libres de un día para un tratamiento.
 * Lo consume `GET /api/automation/availability`: el bot lo llama ANTES de
 * proponerle horarios al paciente.
 */
/**
 * ¿Trabaja esa odontóloga a esa hora, según su horario?
 *
 * Hasta ahora agendar sólo miraba si tenía otra cita encima, así que el bot
 * podía cerrar una consulta un domingo a las tres de la madrugada y el
 * sistema decía que sí. La cita tiene que caber ENTERA dentro de uno de sus
 * bloques: media consulta dentro y media fuera no es un hueco.
 *
 * Esto vale para lo que agenda el BOT. Recepción sigue pudiendo poner una
 * cita fuera de horario desde el panel, que es otra vía: a veces alguien se
 * queda más tarde y eso lo decide una persona, no una regla.
 */
async function trabajaEnEseMomento(
  dentistId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<boolean> {
  const zona = env.CLINIC_TIMEZONE;
  const dia = diaEnLaClinica(startsAt, zona);

  const lunes = (() => {
    const d = new Date(Date.UTC(dia.anio, dia.mes - 1, dia.dia));
    d.setUTCDate(d.getUTCDate() - ((dia.diaSemana + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();

  const bloques = await repository.listSchedule(dentistId, lunes);
  const inicio = minutoEnLaClinica(startsAt, zona);
  const fin = minutoEnLaClinica(endsAt, zona);

  // Una cita que cruza la medianoche no cabe en ningún bloque del día.
  if (fin <= inicio) return false;

  return bloques.some(
    (b) => b.weekday === dia.diaSemana && inicio >= b.startMinute && fin <= b.endMinute,
  );
}

/**
 * Por qué no hay huecos, cuando no los hay.
 *
 * Sin esto, una lista vacía significaba siempre «ese día está lleno» — y el
 * bot le decía eso a un paciente por un día que ya había pasado o por un
 * domingo que la clínica no abre. Tres situaciones distintas que pedían tres
 * respuestas distintas y recibían la misma.
 */
export type MotivoSinHuecos = 'PASADO' | 'CERRADO' | 'LLENO';

export interface Disponibilidad {
  slots: AvailableSlot[];
  /** Sólo cuando `slots` viene vacío. */
  motivo?: MotivoSinHuecos;
}

export async function findAvailableSlots(params: {
  treatmentCode: string;
  date: Date;
  dentistId?: string;
  maxSlots: number;
}): Promise<AvailableSlot[]> {
  return (await buscarDisponibilidad(params)).slots;
}

export async function buscarDisponibilidad(params: {
  treatmentCode: string;
  date: Date;
  dentistId?: string;
  maxSlots: number;
}): Promise<Disponibilidad> {
  const treatment = await repository.findTreatmentByCode(params.treatmentCode);
  if (!treatment) return { slots: [] };

  const [dentists, rooms] = await Promise.all([
    repository.listDentists(),
    repository.listRooms(),
  ]);

  const candidateDentists = params.dentistId
    ? dentists.filter((dentist) => dentist.id === params.dentistId)
    : dentists;

  const zona = env.CLINIC_TIMEZONE;
  const dia = diaEnLaClinica(params.date, zona);

  /*
   * La jornada sale de los AJUSTES, no de dos constantes.
   *
   * Estaban clavadas en 08:00-18:00 mientras la clínica tenía configurado
   * 09:00-18:00: el bot ofrecía una hora que no existe y recepción se
   * encontraba a alguien en la puerta.
   */
  const ajustes = await repository.getClinicSettings();
  const abre = ajustes.openingMinute ?? CLINIC_OPEN_MINUTE;
  const cierra = ajustes.closingMinute ?? CLINIC_CLOSE_MINUTE;
  const paso = ajustes.slotMinutes || SLOT_GRANULARITY_MINUTES;

  /*
   * EL HORARIO DE CADA ODONTÓLOGA, que es lo que faltaba del todo.
   *
   * Este servicio sólo miraba las citas ya ocupadas, así que daba por
   * disponible a todo el mundo a todas horas: ofrecía domingos, y ofrecía a
   * una odontóloga que sólo viene martes y jueves cualquier día de la
   * semana. De ahí que el bot pareciera inventarse los días.
   *
   * `listSchedule` con la semana ya resuelve las excepciones de esa semana
   * concreta, así que un cambio puntual aprobado también se respeta.
   */
  const lunesDeEsaSemana = (() => {
    const d = new Date(Date.UTC(dia.anio, dia.mes - 1, dia.dia));
    d.setUTCDate(d.getUTCDate() - ((dia.diaSemana + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();

  const horarios = new Map<string, Array<{ startMinute: number; endMinute: number }>>();
  await Promise.all(
    candidateDentists.map(async (d) => {
      const bloques = await repository.listSchedule(d.id, lunesDeEsaSemana);
      horarios.set(
        d.id,
        bloques
          .filter((b) => b.weekday === dia.diaSemana)
          .map((b) => ({ startMinute: b.startMinute, endMinute: b.endMinute })),
      );
    }),
  );

  const slots: AvailableSlot[] = [];
  const durationMs = treatment.durationMinutes * 60_000;
  const blockMs = durationMs + treatment.bufferMinutes * 60_000;

  // Se recorre la jornada en pasos de la granularidad configurada.
  for (
    let minute = abre;
    minute < cierra && slots.length < params.maxSlots;
    minute += paso
  ) {
    // En hora de la CLÍNICA, no del servidor.
    const startsAt = instanteEnLaClinica(dia, minute, zona);

    // Nunca proponer algo que ya pasó.
    if (startsAt <= new Date()) continue;

    const endsAt = new Date(startsAt.getTime() + durationMs);
    // La cita debe caber entera dentro del horario de atención.
    const endMinute = minutoEnLaClinica(endsAt, zona);
    if (endMinute > cierra || endMinute <= minute) break;

    for (const dentist of candidateDentists) {
      if (slots.length >= params.maxSlots) break;

      /*
       * ¿Trabaja ESE día y a ESA hora? La cita entera tiene que caber dentro
       * de uno de sus bloques: media consulta dentro del horario y media
       * fuera no es un hueco, es una cita que se sale.
       */
      const bloques = horarios.get(dentist.id) ?? [];
      const trabaja = bloques.some((b) => minute >= b.startMinute && endMinute <= b.endMinute);
      if (!trabaja) continue;

      const dentistConflicts = await repository.findOverlappingAppointments({
        startsAt,
        endsAt,
        dentistId: dentist.id,
      });
      if (dentistConflicts.length > 0) continue;

      const room = await findFirstAvailableRoom(
        rooms,
        startsAt,
        new Date(startsAt.getTime() + blockMs),
        undefined,
        dentist.id,
      );
      if (!room) continue;

      slots.push({
        startsAt,
        endsAt,
        dentistId: dentist.id,
        dentistName: dentist.fullName,
        roomId: room.id,
        roomCode: room.code,
      });
      // Un solo hueco por franja: ofrecerle al paciente la misma hora con
      // cuatro odontólogos distintos no le ayuda a decidir.
      break;
    }
  }

  if (slots.length > 0) return { slots };

  /*
   * No hay huecos. Ahora hay que decir POR QUÉ, que es lo único que le
   * permite al bot responder algo útil en vez de «está lleno» siempre.
   */
  const hoy = diaEnLaClinica(new Date(), zona);
  const pedido = dia.anio * 10000 + dia.mes * 100 + dia.dia;
  const actual = hoy.anio * 10000 + hoy.mes * 100 + hoy.dia;

  if (pedido < actual) return { slots: [], motivo: 'PASADO' };

  // Nadie con horario ese día de la semana: la clínica no abre, o no abre
  // para ese tratamiento con esa odontóloga.
  const alguienTrabaja = [...horarios.values()].some((b) => b.length > 0);
  if (!alguienTrabaja) return { slots: [], motivo: 'CERRADO' };

  return { slots: [], motivo: 'LLENO' };
}
