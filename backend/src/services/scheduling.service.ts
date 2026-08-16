import 'server-only';
import { repository } from '@/backend/repositories';
import type { CreateAppointmentInput } from '@/backend/validators/appointment.schema';
import type { Appointment, Dentist, Room, Treatment } from '@/backend/domain/types';

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
 */
async function findFirstAvailableRoom(
  rooms: Room[],
  startsAt: Date,
  blockedUntil: Date,
  preferredRoomId?: string,
): Promise<Room | undefined> {
  const candidates = preferredRoomId
    ? rooms.filter((room) => room.id === preferredRoomId)
    : rooms;

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

    // Fuera del horario de atención: no se propone.
    const minuteOfDay = candidateStart.getUTCHours() * 60 + candidateStart.getUTCMinutes();
    if (minuteOfDay < CLINIC_OPEN_MINUTE || minuteOfDay >= CLINIC_CLOSE_MINUTE) continue;

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
export async function findAvailableSlots(params: {
  treatmentCode: string;
  date: Date;
  dentistId?: string;
  maxSlots: number;
}): Promise<AvailableSlot[]> {
  const treatment = await repository.findTreatmentByCode(params.treatmentCode);
  if (!treatment) return [];

  const [dentists, rooms] = await Promise.all([
    repository.listDentists(),
    repository.listRooms(),
  ]);

  const candidateDentists = params.dentistId
    ? dentists.filter((dentist) => dentist.id === params.dentistId)
    : dentists;

  const slots: AvailableSlot[] = [];
  const durationMs = treatment.durationMinutes * 60_000;
  const blockMs = durationMs + treatment.bufferMinutes * 60_000;

  // Se recorre la jornada en pasos de 30 minutos.
  for (
    let minute = CLINIC_OPEN_MINUTE;
    minute < CLINIC_CLOSE_MINUTE && slots.length < params.maxSlots;
    minute += SLOT_GRANULARITY_MINUTES
  ) {
    const startsAt = new Date(
      Date.UTC(
        params.date.getUTCFullYear(),
        params.date.getUTCMonth(),
        params.date.getUTCDate(),
        Math.floor(minute / 60),
        minute % 60,
      ),
    );

    // Nunca proponer algo que ya pasó.
    if (startsAt <= new Date()) continue;

    const endsAt = new Date(startsAt.getTime() + durationMs);
    // La cita debe caber entera dentro del horario de atención.
    const endMinute = endsAt.getUTCHours() * 60 + endsAt.getUTCMinutes();
    if (endMinute > CLINIC_CLOSE_MINUTE) break;

    for (const dentist of candidateDentists) {
      if (slots.length >= params.maxSlots) break;

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

  return slots;
}
