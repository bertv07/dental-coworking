import 'server-only';
import type {
  CashClosing,
  CreateAppointmentData,
  DataRepository,
  DateRange,
  WriteResult,
} from '@/backend/repositories/types';
import type {
  Appointment,
  AppointmentAddon,
  AppointmentWithRelations,
  ConversationListItem,
  Dentist,
  DentistEarnings,
  DentistInstrument,
  DentistTreatmentAgreement,
  ScheduleBlock,
  ScheduleChangeRequest,
  FinancialSummary,
  Patient,
  PaymentMethodOption,
  Room,
  Treatment,
  WhatsAppMessage,
} from '@/backend/domain/types';
import { hashPassword } from '@/backend/auth/password';
import { percentChange, sumCents } from '@/backend/domain/money';
import { clinicDayKey } from '@/backend/domain/clinic-calendar';
import {
  MOCK_APPOINTMENTS,
  MOCK_CONVERSATIONS,
  MOCK_CREDENTIALS,
  MOCK_DENTISTS,
  MOCK_DEV_PASSWORD,
  MOCK_MESSAGES,
  MOCK_PATIENTS,
  MOCK_PAYMENTS,
  MOCK_PAYMENT_METHODS,
  MOCK_ROOMS,
  MOCK_TREATMENTS,
  MOCK_USERS,
} from '@/backend/mock/data';

/**
 * ===========================================================================
 *  Repositorio MOCK — en memoria
 * ===========================================================================
 *  Implementa el mismo contrato que el de Prisma, contra los arrays de
 *  `mock/data.ts`. Permite navegar el panel completo sin Postgres.
 *
 *  ⚠️  Las escrituras son EFÍMERAS: viven en la memoria del proceso y se
 *   pierden al reiniciar. Es intencional — es un entorno de demo, no un
 *   sustituto de la base de datos.
 * ===========================================================================
 */

/** Copias mutables: las escrituras de la demo no deben tocar los datos base. */
const appointments: Appointment[] = [...MOCK_APPOINTMENTS];
const patients: Patient[] = [...MOCK_PATIENTS];
const dentists: Dentist[] = MOCK_DENTISTS.map((dentist) => ({ ...dentist }));
const treatments: Treatment[] = MOCK_TREATMENTS.map((treatment) => ({ ...treatment }));
const rooms: Room[] = MOCK_ROOMS.map((room) => ({ ...room }));
const conversations = MOCK_CONVERSATIONS.map((conversation) => ({ ...conversation }));

/** Mensajes: mutable, porque la demo permite escribir y recibir. */
const messages: WhatsAppMessage[] = MOCK_MESSAGES.map((message) => ({ ...message }));

/** Medios de pago configurados. Mutables: se editan desde la demo. */
const paymentMethods: PaymentMethodOption[] = MOCK_PAYMENT_METHODS.map((item) => ({ ...item }));

/** Arqueos firmados durante la sesión, indexados por día 'YYYY-MM-DD'. */
const cashClosings = new Map<string, CashClosing>();

/** Genera un id con forma de CUID para las entidades creadas en la demo. */
let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `c${prefix}${Date.now().toString(36)}${idCounter}${'x'.repeat(20)}`.slice(0, 25);
}

/**
 * Comprueba unicidad ignorando el propio registro al editar.
 *
 * Sin la exclusión de `selfId`, editar un paciente sin cambiarle el teléfono
 * fallaría por "duplicado" — chocando consigo mismo.
 */
function isTaken<T extends { id: string }>(
  collection: T[],
  selfId: string | null,
  predicate: (item: T) => boolean,
): boolean {
  return collection.some((item) => item.id !== selfId && predicate(item));
}

/**
 * Hashes de las contraseñas de demo, calculados una sola vez por email y de
 * forma perezosa. Argon2 tarda ~80 ms: rehashear en cada intento de login
 * volvería la demo lenta sin motivo.
 *
 * Se cachea la PROMESA, no el resultado: dos logins simultáneos del mismo
 * usuario comparten el mismo cálculo en vez de lanzar dos.
 */
const passwordHashCache = new Map<string, Promise<string>>();

function getPasswordHashFor(email: string): Promise<string> {
  let cached = passwordHashCache.get(email);
  if (!cached) {
    // Fallback a la clave del admin para cualquier usuario sin credencial
    // propia declarada.
    cached = hashPassword(MOCK_CREDENTIALS[email] ?? MOCK_DEV_PASSWORD);
    passwordHashCache.set(email, cached);
  }
  return cached;
}

/**
 * Normaliza un texto para búsqueda: minúsculas y sin diacríticos.
 *
 * `NFD` descompone "á" en "a" + acento combinante, y el reemplazo elimina el
 * acento suelto. Así "MARÍA", "maria" y "María" se comparan iguales.
 */
function normalizeForSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Resuelve las relaciones de una cita (paciente, odontólogo, sala,
 * tratamiento). En Prisma esto lo hace `include`; aquí se busca a mano.
 *
 * Los valores de respaldo ("Paciente desconocido", "—") cubren el caso de un
 * registro borrado lógicamente: la cita histórica debe seguir mostrándose
 * aunque su paciente ya no aparezca en los listados.
 */
function hydrateAppointment(appointment: Appointment): AppointmentWithRelations {
  const patient = patients.find((p) => p.id === appointment.patientId);
  const dentist = dentists.find((d) => d.id === appointment.dentistId);
  const room = rooms.find((r) => r.id === appointment.roomId);
  const treatment = treatments.find((t) => t.id === appointment.treatmentId);

  return {
    ...appointment,
    patient: {
      id: patient?.id ?? '',
      fullName: patient?.fullName ?? 'Paciente desconocido',
      phoneE164: patient?.phoneE164 ?? '',
    },
    dentist: { id: dentist?.id ?? '', fullName: dentist?.fullName ?? '—' },
    room: { id: room?.id ?? '', name: room?.name ?? '—', code: room?.code ?? '—' },
    treatment: {
      id: treatment?.id ?? '',
      name: treatment?.name ?? '—',
      durationMinutes: treatment?.durationMinutes ?? 0,
    },
    addons: addons.filter((addon) => addon.appointmentId === appointment.id),
  };
}

/**
 * Procedimientos añadidos, en memoria.
 *
 * Empieza vacío a propósito: los añadidos son un hecho de la consulta, no
 * del catálogo de ejemplo. Se llena al usarlos desde la agenda.
 */
const addons: AppointmentAddon[] = [];

/**
 * Tarifas pactadas por odontólogo, en memoria.
 *
 * Vacío = todos cobran el precio de lista, que es el estado de partida real
 * de la clínica.
 */
const agreements: DentistTreatmentAgreement[] = [];

/** Instrumental en memoria. Vacío: cada odontólogo va cargando el suyo. */
const instruments: DentistInstrument[] = [];

/** Horario BASE por odontólogo, el que pone recepción. */
const schedules = new Map<string, ScheduleBlock[]>();

/**
 * Excepciones de una semana concreta, indexadas por `dentistId|weekStart`.
 *
 * Vacío = todas las semanas siguen el horario base, que es el estado normal.
 */
const overrides = new Map<string, ScheduleBlock[]>();
const scheduleRequests: ScheduleChangeRequest[] = [];

/** Ajustes en memoria para el modo mock. */
const mockSettings = {
  id: 'singleton',
  clinicName: 'Dental Coworking',
  taxId: 'J-40123456-7',
  address: 'Av. Francisco de Miranda, Caracas',
  phone: '+582125551234',
  email: 'contacto@dentalcoworking.com.ve',
  defaultCommissionPercent: 40,
  openingMinute: 480,
  closingMinute: 1080,
  slotMinutes: 30,
  displayCurrency: 'USD',
  preferredRateSource: 'BCV',
  updatedAt: new Date(),
};

/** ¿Se solapan dos intervalos? Semiabierto `[inicio, fin)`, igual que en SQL. */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function withinRange(date: Date | null, range: DateRange): boolean {
  return date !== null && date >= range.from && date <= range.to;
}

export const mockRepository: DataRepository = {
  // --- Autenticación -------------------------------------------------------

  async findUserForLogin(email) {
    const user = MOCK_USERS.find((candidate) => candidate.email === email);
    if (!user) return null;

    return {
      ...user,
      passwordHash: await getPasswordHashFor(user.email),
      failedLoginAttempts: 0,
      lockedUntil: null,
      sessionsValidFrom: user.createdAt,
    };
  },

  async getAccountState(userId) {
    const user = MOCK_USERS.find((item) => item.id === userId);
    if (!user) return null;

    return {
      status: user.status,
      // En memoria no hay revocación real: el modo mock existe para poder
      // mover la interfaz sin Postgres, y una marca que nunca avanza deja
      // todas las sesiones válidas, que es lo esperable aquí.
      sessionsValidFrom: user.createdAt,
      mustChangePassword: false,
      deletedAt: null,
    };
  },

  async resetPasswordAsAdmin({ dentistId }) {
    const dentist = dentists.find((item) => item.id === dentistId);
    if (!dentist?.userId) return { ok: false, reason: 'NOT_FOUND' };

    return {
      ok: true,
      data: { userId: dentist.userId, email: dentist.email, fullName: dentist.fullName },
    };
  },

  async createPasswordResetToken({ email }) {
    const user = MOCK_USERS.find((item) => item.email === email);
    // Mismo contrato que en Postgres: `null` si no procede, y quien llama
    // responde igual en los dos casos.
    if (!user) return null;
    return { email: user.email, fullName: user.fullName };
  },

  async redeemPasswordResetToken() {
    // La demo no persiste tokens: no hay enlace que canjear.
    return { ok: false, reason: 'NOT_FOUND' };
  },

  async changePassword({ userId }) {
    const user = MOCK_USERS.find((item) => item.id === userId);
    if (!user) return { ok: false, reason: 'NOT_FOUND' };
    return { ok: true, data: { id: userId } };
  },

  async registerLoginOutcome() {
    // En modo mock no se persiste el contador de intentos fallidos.
    // El rate limit de `auth.config.ts` sigue activo, así que el bloqueo por
    // fuerza bruta funciona igualmente en la demo.
  },

  // --- Catálogos -----------------------------------------------------------

  // Se lee de los arrays MUTABLES, no de las constantes MOCK_*: así lo que
  // se crea o edita desde el panel se refleja de inmediato en la agenda, en
  // el bot y en los desplegables.

  async listDentists(options) {
    const visible = dentists.filter((dentist) => dentist.deletedAt === null);
    return options?.includeInactive ? visible : visible.filter((d) => d.isActive);
  },

  async listRooms(options) {
    return options?.includeInactive ? rooms : rooms.filter((room) => room.isActive);
  },

  async listTreatments(options) {
    return options?.includeInactive
      ? treatments
      : treatments.filter((treatment) => treatment.isActive);
  },

  async findTreatmentByCode(code) {
    return (
      treatments.find((treatment) => treatment.code === code && treatment.isActive) ?? null
    );
  },

  async findDentistById(id) {
    return dentists.find((dentist) => dentist.id === id) ?? null;
  },

  // --- Medios de pago ------------------------------------------------------

  async listPaymentMethods(options) {
    return paymentMethods
      .filter((item) => (options?.includeInactive ? true : item.isActive))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  },

  async createPaymentMethod(data) {
    const created = { ...data, id: newId('pmo') };
    paymentMethods.push(created);
    return { ok: true, data: created };
  },

  async updatePaymentMethod(id, data) {
    const index = paymentMethods.findIndex((item) => item.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };
    paymentMethods[index] = { ...data, id };
    return { ok: true, data: paymentMethods[index] };
  },

  async deletePaymentMethod(id) {
    const index = paymentMethods.findIndex((item) => item.id === id);
    if (index === -1) return false;
    paymentMethods.splice(index, 1);
    return true;
  },

  async findDentistByUserId(userId) {
    return dentists.find((dentist) => dentist.userId === userId) ?? null;
  },

  // --- Pacientes -----------------------------------------------------------

  async findPatientByPhone(phoneE164) {
    return patients.find((patient) => patient.phoneE164 === phoneE164) ?? null;
  },

  async upsertPatientByPhone({ phoneE164, fullName }) {
    const existing = patients.find((patient) => patient.phoneE164 === phoneE164);
    if (existing) return existing;

    const created: Patient = {
      id: `cpat${Date.now().toString(36)}${'x'.repeat(10)}`.slice(0, 25),
      fullName,
      phoneE164,
      email: null,
      documentId: null,
      birthDate: null,
      notes: null,
      marketingConsent: false,
      createdAt: new Date(),
      deletedAt: null,
    };
    patients.push(created);
    return created;
  },

  async listPatients({ search, page, limit }) {
    // Búsqueda insensible a mayúsculas Y A ACENTOS sobre nombre, teléfono y
    // documento. Lo segundo no es opcional en español: sin ello, buscar
    // "maria" no encuentra a "María Fernanda", y nadie en recepción escribe
    // las tildes al teclear rápido.
    const term = search ? normalizeForSearch(search) : undefined;

    const filtered = patients.filter((patient) => {
      if (patient.deletedAt !== null) return false;
      if (!term) return true;
      return (
        normalizeForSearch(patient.fullName).includes(term) ||
        patient.phoneE164.includes(term) ||
        (patient.documentId ?? '').includes(term)
      );
    });

    // El total se calcula ANTES de paginar: es lo que necesita el paginador.
    const start = (page - 1) * limit;

    return {
      items: filtered
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'))
        .slice(start, start + limit),
      total: filtered.length,
    };
  },

  async createPatient(data) {
    if (isTaken(patients, null, (p) => p.phoneE164 === data.phoneE164 && p.deletedAt === null)) {
      return { ok: false, reason: 'DUPLICATE', field: 'phoneE164' };
    }
    if (
      data.documentId &&
      isTaken(patients, null, (p) => p.documentId === data.documentId && p.deletedAt === null)
    ) {
      return { ok: false, reason: 'DUPLICATE', field: 'documentId' };
    }

    const created: Patient = {
      id: newId('pat'),
      ...data,
      createdAt: new Date(),
      deletedAt: null,
    };
    patients.unshift(created);
    return { ok: true, data: created };
  },

  async updatePatient(id, data) {
    const index = patients.findIndex((patient) => patient.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    if (isTaken(patients, id, (p) => p.phoneE164 === data.phoneE164 && p.deletedAt === null)) {
      return { ok: false, reason: 'DUPLICATE', field: 'phoneE164' };
    }

    const updated: Patient = { ...patients[index]!, ...data };
    patients[index] = updated;
    return { ok: true, data: updated };
  },

  async softDeletePatient(id) {
    const index = patients.findIndex((patient) => patient.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    // Borrado LÓGICO: el paciente desaparece de los listados pero sus citas
    // y pagos siguen existiendo, así que la contabilidad no cambia.
    const updated: Patient = { ...patients[index]!, deletedAt: new Date() };
    patients[index] = updated;
    return { ok: true, data: updated };
  },

  // --- Odontólogos (escritura) ---------------------------------------------

  async reactivateDentist({ id }) {
    const dentist = dentists.find((item) => item.id === id);
    if (!dentist) return { ok: false, reason: 'NOT_FOUND' };

    dentist.isActive = true;
    dentist.deletedAt = null;
    return { ok: true, data: { id } };
  },

  async findDentistByLicenseOrEmail({ licenseNumber, email }) {
    const dentist = dentists.find(
      (item) => item.licenseNumber === licenseNumber || item.email === email,
    );
    if (!dentist) return null;

    return {
      id: dentist.id,
      fullName: dentist.fullName,
      isActive: dentist.isActive,
      isDeleted: dentist.deletedAt !== null,
    };
  },

  async createDentistWithAccount({ dentist }) {
    const created = await mockRepository.createDentist(dentist);
    if (!created.ok) return created;

    // En memoria no hay tabla de usuarios que crecer: basta con dejar el
    // vínculo puesto para que la interfaz se comporte igual que con Postgres.
    const userId = newId('user');
    const stored = dentists.find((item) => item.id === created.data.id);
    if (stored) stored.userId = userId;

    return { ok: true, data: { id: created.data.id, userId } };
  },

  async createDentist(data) {
    if (isTaken(dentists, null, (d) => d.licenseNumber === data.licenseNumber)) {
      return { ok: false, reason: 'DUPLICATE', field: 'licenseNumber' };
    }
    if (isTaken(dentists, null, (d) => d.email === data.email)) {
      return { ok: false, reason: 'DUPLICATE', field: 'email' };
    }

    const created: Dentist = {
      id: newId('dent'),
      userId: null,
      photoUrl: null,
      ...data,
      createdAt: new Date(),
      deletedAt: null,
    };
    dentists.push(created);
    return { ok: true, data: created };
  },

  async updateDentist(id, data) {
    const index = dentists.findIndex((dentist) => dentist.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    if (isTaken(dentists, id, (d) => d.licenseNumber === data.licenseNumber)) {
      return { ok: false, reason: 'DUPLICATE', field: 'licenseNumber' };
    }
    if (isTaken(dentists, id, (d) => d.email === data.email)) {
      return { ok: false, reason: 'DUPLICATE', field: 'email' };
    }

    const updated: Dentist = { ...dentists[index]!, ...data };
    dentists[index] = updated;
    return { ok: true, data: updated };
  },

  async softDeleteDentist(id) {
    const index = dentists.findIndex((dentist) => dentist.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    // Se desactiva Y se marca borrado: sus citas históricas y sus
    // liquidaciones deben seguir apareciendo en las finanzas.
    const updated: Dentist = { ...dentists[index]!, isActive: false, deletedAt: new Date() };
    dentists[index] = updated;
    return { ok: true, data: updated };
  },

  // --- Tratamientos (escritura) --------------------------------------------

  async createTreatment(data) {
    if (isTaken(treatments, null, (t) => t.code === data.code)) {
      return { ok: false, reason: 'DUPLICATE', field: 'code' };
    }

    const created: Treatment = {
      id: newId('trmt'),
      description: null,
      // El formulario del panel aún no ofrece estas dos reglas; se crean
      // apagadas y se activan desde la base o al editarlas.
      isPriceVariable: false,
      clinicKeepsAll: false,
      ...data,
    };
    treatments.push(created);
    return { ok: true, data: created };
  },

  async updateTreatment(id, data, changedByUserId) {
    const index = treatments.findIndex((treatment) => treatment.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    if (isTaken(treatments, id, (t) => t.code === data.code)) {
      return { ok: false, reason: 'DUPLICATE', field: 'code' };
    }

    const previous = treatments[index]!;

    // El historial de precios en modo mock sólo se registra en el log. En
    // Prisma se inserta una fila en `treatment_price_history`.
    if (previous.basePriceCents !== data.basePriceCents) {
      console.info(
        JSON.stringify({
          level: 'info',
          event: 'treatment.price_updated',
          treatmentId: id,
          from: previous.basePriceCents,
          to: data.basePriceCents,
          changedByUserId,
        }),
      );
    }

    const updated: Treatment = { ...previous, ...data };
    treatments[index] = updated;
    return { ok: true, data: updated };
  },

  async softDeleteTreatment(id) {
    const index = treatments.findIndex((treatment) => treatment.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    const updated: Treatment = { ...treatments[index]!, isActive: false };
    treatments[index] = updated;
    return { ok: true, data: updated };
  },

  // --- Consultorios (escritura) --------------------------------------------

  async createRoom(data) {
    if (isTaken(rooms, null, (r) => r.code === data.code)) {
      return { ok: false, reason: 'DUPLICATE', field: 'code' };
    }
    if (isTaken(rooms, null, (r) => r.name === data.name)) {
      return { ok: false, reason: 'DUPLICATE', field: 'name' };
    }

    const created: Room = { id: newId('room'), ...data };
    rooms.push(created);
    return { ok: true, data: created };
  },

  async updateRoom(id, data) {
    const index = rooms.findIndex((room) => room.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    if (isTaken(rooms, id, (r) => r.code === data.code)) {
      return { ok: false, reason: 'DUPLICATE', field: 'code' };
    }

    const updated: Room = { ...rooms[index]!, ...data };
    rooms[index] = updated;
    return { ok: true, data: updated };
  },

  async softDeleteRoom(id) {
    const index = rooms.findIndex((room) => room.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    const updated: Room = { ...rooms[index]!, isActive: false };
    rooms[index] = updated;
    return { ok: true, data: updated };
  },

  async createPayment() {
    // El modo mock no persiste cobros: la contabilidad sólo tiene sentido
    // contra la base de datos real.
    return { ok: false, reason: 'NOT_FOUND' };
  },

  async getDailyCash(date) {
    return {
      date,
      totalCents: 0,
      totalBs: 0,
      clinicShareCents: 0,
      dentistShareCents: 0,
      paymentCount: 0,
      byMethod: [],
      payments: [],
    };
  },

  async getPaidAppointmentIds() {
    return [];
  },

  // --- Cierre de caja ------------------------------------------------------
  // En memoria: el modo mock existe para poder navegar la interfaz sin
  // Postgres, así que el arqueo se comporta igual aunque no persista al
  // reiniciar el servidor.
  async getCashClosing(businessDate) {
    return cashClosings.get(businessDate) ?? null;
  },

  async closeCash(input, userId) {
    if (cashClosings.has(input.businessDate)) {
      return { ok: false as const, reason: 'ALREADY_CLOSED' as const };
    }

    const closing = {
      ...input,
      id: `cclose-${input.businessDate}`,
      closedByUserId: userId,
      closedByName: MOCK_USERS.find((user) => user.id === userId)?.fullName ?? 'Usuario',
      closedAt: new Date(),
      differenceBs: Math.round((input.countedCashBs - input.expectedCashBs) * 100) / 100,
    };
    cashClosings.set(input.businessDate, closing);
    return { ok: true as const, data: closing };
  },

  async reopenCash(businessDate) {
    return cashClosings.delete(businessDate);
  },

  async listUnpaidAppointmentsForDay(businessDate) {
    const paidIds = new Set(MOCK_PAYMENTS.filter((p) => p.status === 'PAID').map((p) => p.appointmentId));

    return appointments
      .filter(
        (appointment) =>
          clinicDayKey(appointment.startsAt) === businessDate &&
          ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(appointment.status) &&
          !paidIds.has(appointment.id),
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map(hydrateAppointment);
  },

  async getClinicSettings() {
    return { ...mockSettings };
  },

  async updateClinicSettings(data) {
    Object.assign(mockSettings, data, { updatedAt: new Date() });
    return { ok: true, data: { ...mockSettings } };
  },

  async getEntityCounts() {
    return {
      patients: patients.filter((p) => p.deletedAt === null).length,
      dentists: dentists.filter((d) => d.deletedAt === null).length,
      activeDentists: dentists.filter((d) => d.deletedAt === null && d.isActive).length,
      treatments: treatments.filter((t) => t.isActive).length,
      rooms: rooms.filter((r) => r.isActive).length,
    };
  },

  // --- Agenda --------------------------------------------------------------

  async findAppointmentByIdempotencyKey(key) {
    return appointments.find((appointment) => appointment.idempotencyKey === key) ?? null;
  },

  async findOverlappingAppointments({ startsAt, endsAt, dentistId, roomId }) {
    return appointments.filter((appointment) => {
      // Las canceladas y no-show liberan el hueco.
      if (appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW') {
        return false;
      }
      if (!overlaps(startsAt, endsAt, appointment.startsAt, appointment.endsAt)) {
        return false;
      }
      // Sin filtro concreto → cualquier solapamiento cuenta.
      if (!dentistId && !roomId) return true;
      return (
        (dentistId !== undefined && appointment.dentistId === dentistId) ||
        (roomId !== undefined && appointment.roomId === roomId)
      );
    });
  },

  async createAppointment(data: CreateAppointmentData) {
    const created: Appointment = {
      id: `cappt${Date.now().toString(36)}${'x'.repeat(10)}`.slice(0, 25),
      ...data,
      status: 'PENDING',
      createdAt: new Date(),
    };
    appointments.push(created);
    return created;
  },

  async findAppointmentById(id) {
    const appointment = appointments.find((item) => item.id === id);
    if (!appointment) return null;
    return hydrateAppointment(appointment);
  },

  async createAppointmentFromPanel(data) {
    const treatment = treatments.find((item) => item.id === data.treatmentId);
    if (!treatment) return { ok: false, reason: 'NOT_FOUND' };

    // EL SERVIDOR calcula el fin y el precio a partir del tratamiento.
    // Nunca se aceptan del formulario: si no, alguien podría reservar 5
    // minutos para una endodoncia de 120, o ponerle precio 0.
    const endsAt = new Date(data.startsAt.getTime() + treatment.durationMinutes * 60_000);

    // Solapamiento: se comprueba contra el odontólogo Y contra la sala.
    // En Postgres esto lo garantizan además los constraints EXCLUDE.
    const conflict = appointments.some(
      (item) =>
        item.status !== 'CANCELLED' &&
        item.status !== 'NO_SHOW' &&
        overlaps(data.startsAt, endsAt, item.startsAt, item.endsAt) &&
        (item.dentistId === data.dentistId || item.roomId === data.roomId),
    );
    if (conflict) return { ok: false, reason: 'DUPLICATE', field: 'startsAt' };

    const created: Appointment = {
      id: newId('appt'),
      patientId: data.patientId,
      dentistId: data.dentistId,
      roomId: data.roomId,
      treatmentId: data.treatmentId,
      startsAt: data.startsAt,
      endsAt,
      status: 'CONFIRMED', // Creada por un humano: ya viene confirmada.
      source: 'ADMIN_PANEL',
      agreedPriceCents: treatment.basePriceCents,
      notes: data.notes,
      idempotencyKey: null,
      createdAt: new Date(),
    };
    appointments.push(created);
    return { ok: true, data: created };
  },

  async updateAppointment(id, data) {
    const index = appointments.findIndex((item) => item.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    const treatment = treatments.find((item) => item.id === data.treatmentId);
    if (!treatment) return { ok: false, reason: 'NOT_FOUND' };

    const endsAt = new Date(data.startsAt.getTime() + treatment.durationMinutes * 60_000);

    // Se excluye la propia cita del chequeo: si no, reprogramar sin mover la
    // hora chocaría consigo misma.
    const conflict = appointments.some(
      (item) =>
        item.id !== id &&
        item.status !== 'CANCELLED' &&
        item.status !== 'NO_SHOW' &&
        overlaps(data.startsAt, endsAt, item.startsAt, item.endsAt) &&
        (item.dentistId === data.dentistId || item.roomId === data.roomId),
    );
    if (conflict) return { ok: false, reason: 'DUPLICATE', field: 'startsAt' };

    const updated: Appointment = {
      ...appointments[index]!,
      ...data,
      endsAt,
      // El precio pactado NO se recalcula al reprogramar: se le prometió al
      // paciente y mover la hora no cambia lo que va a pagar.
    };
    appointments[index] = updated;
    return { ok: true, data: updated };
  },

  async updateAppointmentStatus({ id, status, cancellationReason }) {
    const index = appointments.findIndex((item) => item.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    const updated: Appointment = { ...appointments[index]!, status };
    appointments[index] = updated;

    if (cancellationReason) {
      console.info(
        JSON.stringify({
          level: 'info',
          event: 'appointment.cancelled',
          appointmentId: id,
          reason: cancellationReason,
        }),
      );
    }

    return { ok: true, data: updated };
  },

  async listAppointments({ range, dentistId, limit = 100 }) {
    return appointments
      .filter((appointment) => {
        if (appointment.startsAt < range.from || appointment.startsAt > range.to) return false;
        if (dentistId && appointment.dentistId !== dentistId) return false;
        return true;
      })
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, limit)
      .map(hydrateAppointment);
  },

  async addAppointmentAddon({ appointmentId, treatmentId, priceCents, notes }) {
    const appointment = appointments.find((item) => item.id === appointmentId);
    if (!appointment) return { ok: false, reason: 'NOT_FOUND' };

    const treatment = treatments.find((item) => item.id === treatmentId);
    if (!treatment) return { ok: false, reason: 'NOT_FOUND' };

    // Misma regla que en Postgres: una cita cobrada ya congeló su reparto.
    const cobrada = MOCK_PAYMENTS.some(
      (payment) => payment.appointmentId === appointmentId && payment.status === 'PAID',
    );
    if (cobrada) return { ok: false, reason: 'DUPLICATE', field: 'appointmentId' };

    const dentist = dentists.find((item) => item.id === appointment.dentistId);

    const addon: AppointmentAddon = {
      id: `addon-${addons.length + 1}`,
      appointmentId,
      treatmentId,
      treatmentName: treatment.name,
      priceCents: priceCents ?? treatment.basePriceCents,
      // Sin acuerdos por odontólogo en el mock: basta con respetar la regla
      // que de verdad cambia el dinero, que es la del 100 % de la clínica.
      commissionPercent: treatment.clinicKeepsAll
        ? 100
        : (dentist?.clinicCommissionPercent ?? 40),
      notes,
      createdAt: new Date(),
    };

    addons.push(addon);
    return { ok: true, data: addon };
  },

  async removeAppointmentAddon({ id }) {
    const index = addons.findIndex((addon) => addon.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    addons.splice(index, 1);
    return { ok: true, data: { id } };
  },

  async getDailySettlements() {
    // El mock no lleva liquidaciones: la demo enseña la pantalla vacía, que
    // es el estado real de una clínica que aún no ha cobrado nada ese día.
    return [];
  },

  async settleDentistDay() {
    return { ok: false, reason: 'NOT_FOUND' };
  },

  // --- Facturas -------------------------------------------------------------
  //  La demo no factura: emitir, descontar y cobrar en partes son operaciones
  //  con dinero de verdad, y una versión en memoria que se pierde al
  //  reiniciar daría una falsa sensación de que quedó registrado.

  async openInvoiceForAppointment() {
    return { ok: false, reason: 'NOT_FOUND' };
  },

  async listInvoices() {
    return [];
  },

  async getInvoice() {
    return null;
  },

  async addInvoiceLine() {
    return { ok: false, reason: 'NOT_FOUND' };
  },

  async updateInvoiceLine() {
    return { ok: false, reason: 'NOT_FOUND' };
  },

  async removeInvoiceLine() {
    return { ok: false, reason: 'NOT_FOUND' };
  },

  async registerInvoicePayment() {
    return { ok: false, reason: 'NOT_FOUND' };
  },

  async voidInvoice() {
    return { ok: false, reason: 'NOT_FOUND' };
  },

  async listPatientDocuments() {
    // La demo no guarda binarios: la pantalla se ve vacía, que es el estado
    // real de un paciente al que aún no se le ha escaneado nada.
    return [];
  },

  async getPatientDocumentFile() {
    return null;
  },

  async savePatientDocument() {
    return { ok: false, reason: 'NOT_FOUND' };
  },

  async deletePatientDocument({ id }) {
    return { ok: true, data: { id } };
  },

  async listInstruments(params) {
    return instruments.filter(
      (item) => !params?.dentistId || item.dentistId === params.dentistId,
    );
  },

  async saveInstrument({ id, dentistId, data }) {
    if (id) {
      const existente = instruments.find(
        (item) => item.id === id && item.dentistId === dentistId,
      );
      if (!existente) return { ok: false, reason: 'NOT_FOUND' };
      Object.assign(existente, data);
      return { ok: true, data: { id } };
    }

    const nuevo = { id: newId('instr'), dentistId, ...data };
    instruments.push(nuevo);
    return { ok: true, data: { id: nuevo.id } };
  },

  async deleteInstrument({ id }) {
    const index = instruments.findIndex((item) => item.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };
    instruments.splice(index, 1);
    return { ok: true, data: { id } };
  },

  async listSchedule(dentistId, weekStart) {
    // Misma regla que en Postgres: la excepción de esa semana manda; si no
    // hay ninguna, rige el base.
    if (weekStart) {
      const excepcion = overrides.get(`${dentistId}|${weekStart}`);
      if (excepcion && excepcion.length > 0) return excepcion;
    }
    return schedules.get(dentistId) ?? [];
  },

  async setBaseSchedule({ dentistId, blocks }) {
    const dentist = dentists.find((item) => item.id === dentistId);
    if (!dentist) return { ok: false, reason: 'NOT_FOUND' };

    schedules.set(dentistId, blocks);
    return { ok: true, data: { id: dentistId } };
  },

  async listScheduleRequests(params) {
    return scheduleRequests.filter((request) => {
      if (params?.dentistId && request.dentistId !== params.dentistId) return false;
      if (params?.status && request.status !== params.status) return false;
      return true;
    });
  },

  async createScheduleRequest({ dentistId, weekStart, proposedBlocks, reason }) {
    const dentist = dentists.find((item) => item.id === dentistId);
    if (!dentist) return { ok: false, reason: 'NOT_FOUND' };

    // Misma regla que el índice único parcial de Postgres: una pendiente por
    // odontólogo Y SEMANA. Para semanas distintas sí puede tener varias.
    if (
      scheduleRequests.some(
        (r) => r.dentistId === dentistId && r.weekStart === weekStart && r.status === 'PENDING',
      )
    ) {
      return { ok: false, reason: 'DUPLICATE', field: 'weekStart' };
    }

    const request: ScheduleChangeRequest = {
      id: newId('sched'),
      dentistId,
      dentistName: dentist.fullName,
      weekStart,
      proposedBlocks,
      currentBlocks: schedules.get(dentistId) ?? [],
      reason,
      status: 'PENDING',
      reviewNotes: null,
      reviewedAt: null,
      createdAt: new Date(),
    };

    scheduleRequests.push(request);
    return { ok: true, data: { id: request.id } };
  },

  async reviewScheduleRequest({ id, status, reviewNotes }) {
    const request = scheduleRequests.find((item) => item.id === id);
    if (!request) return { ok: false, reason: 'NOT_FOUND' };
    if (request.status !== 'PENDING') {
      return { ok: false, reason: 'DUPLICATE', field: 'status' };
    }

    request.status = status;
    request.reviewNotes = reviewNotes;
    request.reviewedAt = new Date();

    // Aprobar guarda la EXCEPCIÓN de esa semana; el base no se toca.
    if (status === 'APPROVED') {
      overrides.set(`${request.dentistId}|${request.weekStart}`, request.proposedBlocks);
    }

    return { ok: true, data: { id } };
  },

  async listDentistTreatments(params) {
    return agreements.filter((agreement) => {
      if (params?.dentistId && agreement.dentistId !== params.dentistId) return false;
      if (params?.status && agreement.status !== params.status) return false;
      return true;
    });
  },

  async upsertDentistTreatment({
    dentistId,
    treatmentId,
    customPriceCents,
    customCommissionPercent,
    status,
  }) {
    const dentist = dentists.find((item) => item.id === dentistId);
    const treatment = treatments.find((item) => item.id === treatmentId);
    if (!dentist || !treatment) return { ok: false, reason: 'NOT_FOUND' };

    const existente = agreements.find(
      (agreement) =>
        agreement.dentistId === dentistId && agreement.treatmentId === treatmentId,
    );

    if (existente) {
      existente.customPriceCents = customPriceCents;
      existente.customCommissionPercent = customCommissionPercent;
      existente.status = status;
      existente.reviewNotes = null;
      existente.reviewedAt = status === 'APPROVED' ? new Date() : null;
      return { ok: true, data: { id: existente.id } };
    }

    const agreement: DentistTreatmentAgreement = {
      id: `tarifa-${agreements.length + 1}`,
      dentistId,
      dentistName: dentist.fullName,
      treatmentId,
      treatmentName: treatment.name,
      treatmentBasePriceCents: treatment.basePriceCents,
      customPriceCents,
      customCommissionPercent,
      status,
      reviewNotes: null,
      reviewedAt: status === 'APPROVED' ? new Date() : null,
      createdAt: new Date(),
    };

    agreements.push(agreement);
    return { ok: true, data: { id: agreement.id } };
  },

  async reviewDentistTreatment({ id, status, reviewNotes }) {
    const agreement = agreements.find((item) => item.id === id);
    if (!agreement) return { ok: false, reason: 'NOT_FOUND' };

    agreement.status = status;
    agreement.reviewNotes = reviewNotes;
    agreement.reviewedAt = new Date();
    return { ok: true, data: { id } };
  },

  async deleteDentistTreatment({ id }) {
    const index = agreements.findIndex((agreement) => agreement.id === id);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    agreements.splice(index, 1);
    return { ok: true, data: { id } };
  },

  async listDentistAgenda({ dentistId, range, limit = 200 }) {
    return appointments
      .filter(
        (appointment) =>
          appointment.dentistId === dentistId &&
          appointment.startsAt >= range.from &&
          appointment.startsAt <= range.to,
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, limit)
      .map((appointment) => {
        const full = hydrateAppointment(appointment);

        // Se construye el objeto campo a campo en vez de con `...full`: así
        // `agreedPriceCents` no se cuela, que es el motivo de que esta vista
        // exista aparte.
        return {
          id: full.id,
          startsAt: full.startsAt,
          endsAt: full.endsAt,
          status: full.status,
          source: full.source,
          notes: full.notes,
          patientName: full.patient.fullName,
          treatmentName: full.treatment.name,
          treatmentDurationMinutes: full.treatment.durationMinutes,
          roomName: full.room.name,
          roomCode: full.room.code,
        };
      });
  },

  // --- Finanzas ------------------------------------------------------------

  async getFinancialSummary(range) {
    const paidInRange = MOCK_PAYMENTS.filter(
      (payment) => payment.status === 'PAID' && withinRange(payment.paidAt, range),
    );

    // Periodo anterior de la MISMA duración, para calcular la variación.
    const periodMs = range.to.getTime() - range.from.getTime();
    const previousRange: DateRange = {
      from: new Date(range.from.getTime() - periodMs),
      to: range.from,
    };
    const paidPreviously = MOCK_PAYMENTS.filter(
      (payment) => payment.status === 'PAID' && withinRange(payment.paidAt, previousRange),
    );

    const appointmentsInRange = appointments.filter(
      (appointment) => appointment.startsAt >= range.from && appointment.startsAt <= range.to,
    );

    const totalRevenueCents = sumCents(paidInRange.map((p) => p.amountCents));
    const previousRevenueCents = sumCents(paidPreviously.map((p) => p.amountCents));

    // Deuda viva = parte del odontólogo aún sin liquidar (`payoutId === null`).
    const outstandingPayoutsCents = sumCents(
      MOCK_PAYMENTS.filter((p) => p.status === 'PAID' && p.payoutId === null).map(
        (p) => p.dentistShareCents,
      ),
    );

    return {
      periodStart: range.from,
      periodEnd: range.to,
      totalRevenueCents,
      clinicEarningsCents: sumCents(paidInRange.map((p) => p.clinicShareCents)),
      dentistEarningsCents: sumCents(paidInRange.map((p) => p.dentistShareCents)),
      outstandingPayoutsCents,
      completedAppointments: appointmentsInRange.filter((a) => a.status === 'COMPLETED').length,
      cancelledAppointments: appointmentsInRange.filter((a) => a.status === 'CANCELLED').length,
      noShowAppointments: appointmentsInRange.filter((a) => a.status === 'NO_SHOW').length,
      aiBookedAppointments: appointmentsInRange.filter((a) => a.source === 'WHATSAPP_AI').length,
      revenueChangePercent: percentChange(totalRevenueCents, previousRevenueCents),
    };
  },

  async getDentistEarnings(range) {
    // Índice cita → pago, para no recorrer el array de pagos por cada cita.
    const appointmentById = new Map(appointments.map((a) => [a.id, a]));

    const rows = dentists.map((dentist): DentistEarnings => {
      const dentistPayments = MOCK_PAYMENTS.filter((payment) => {
        if (payment.status !== 'PAID') return false;
        if (!withinRange(payment.paidAt, range)) return false;
        return appointmentById.get(payment.appointmentId)?.dentistId === dentist.id;
      });

      const dentistShareCents = sumCents(dentistPayments.map((p) => p.dentistShareCents));
      // Ya liquidado = los pagos que tienen `payoutId`.
      const paidOutCents = sumCents(
        dentistPayments.filter((p) => p.payoutId !== null).map((p) => p.dentistShareCents),
      );

      return {
        dentistId: dentist.id,
        dentistName: dentist.fullName,
        commissionPercent: dentist.clinicCommissionPercent,
        grossCents: sumCents(dentistPayments.map((p) => p.amountCents)),
        clinicShareCents: sumCents(dentistPayments.map((p) => p.clinicShareCents)),
        dentistShareCents,
        paidOutCents,
        outstandingCents: dentistShareCents - paidOutCents,
        appointmentCount: dentistPayments.length,
      };
    });

    // Mayor producción primero: es el orden en que el admin quiere leerlo.
    return rows.sort((a, b) => b.grossCents - a.grossCents);
  },

  // --- WhatsApp ------------------------------------------------------------

  async listConversations(options) {
    return conversations
      .map((conversation): ConversationListItem => {
        const conversationMessages = messages.filter(
          (message) => message.conversationId === conversation.id,
        ).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());

        const lastMessage = conversationMessages[0];

        return {
          ...conversation,
          patientName: conversation.displayName,
          lastMessagePreview: lastMessage?.body.slice(0, 120) ?? null,
          lastMessageAuthor: lastMessage?.author ?? null,
        };
      })
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0))
      .slice(0, options?.limit ?? 50);
  },

  async getConversationMessages(conversationId) {
    return messages.filter((message) => message.conversationId === conversationId).sort(
      (a, b) => a.sentAt.getTime() - b.sentAt.getTime(),
    ) as WhatsAppMessage[];
  },

  async createOutboundMessage() {
    // El envío de mensajes sólo tiene sentido contra la base de datos real.
    return { ok: false, reason: 'NOT_FOUND' };
  },

  async setMessageDelivery() {
    // Sin persistencia en modo mock.
  },

  // --- WhatsApp: lo que consume la automatización --------------------------

  async getConversationStateByPhone({ phoneE164, displayName }) {
    let conversation = conversations.find((item) => item.phoneE164 === phoneE164);
    const patient = patients.find((item) => item.phoneE164 === phoneE164);

    const isNewConversation = conversation === undefined;
    if (!conversation) {
      conversation = {
        id: newId('conv'),
        phoneE164,
        patientId: patient?.id ?? null,
        displayName: displayName ?? patient?.fullName ?? null,
        aiEnabled: true,
        aiToggledByUserId: null,
        aiToggledAt: null,
        aiDisabledReason: null,
        unreadCount: 0,
        needsHumanAttention: false,
        lastMessageAt: null,
      };
      conversations.push(conversation);
    }

    // Mismo orden de precedencia que en Prisma: personal antes que paciente.
    const dentist = dentists.find((item) => item.phone === phoneE164);
    const staff = MOCK_USERS.find((item) => item.phoneE164 === phoneE164);

    const contact = dentist
      ? { role: 'DENTIST' as const, name: dentist.fullName, dentistId: dentist.id }
      : staff
        ? {
            role: (staff.role === 'SUPER_ADMIN' ? 'ADMIN' : 'ASSISTANT') as 'ADMIN' | 'ASSISTANT',
            name: staff.fullName,
            dentistId: null,
          }
        : patient
          ? { role: 'PATIENT' as const, name: patient.fullName, dentistId: null }
          : { role: 'UNKNOWN' as const, name: conversation.displayName, dentistId: null };

    return {
      conversationId: conversation.id,
      phoneE164: conversation.phoneE164,
      aiEnabled: conversation.aiEnabled,
      aiDisabledReason: conversation.aiDisabledReason,
      needsHumanAttention: conversation.needsHumanAttention,
      patientId: patient?.id ?? null,
      patientName: patient?.fullName ?? conversation.displayName,
      isNewConversation,
      contact,
    };
  },

  async recordAutomationMessage({ phoneE164, direction, author, body, mediaUrl, externalId }) {
    const state = await mockRepository.getConversationStateByPhone({ phoneE164 });

    if (externalId) {
      const existing = messages.find((message) => message.externalMessageId === externalId);
      if (existing) {
        return { conversationId: state.conversationId, messageId: existing.id, duplicate: true };
      }
    }

    const sentAt = new Date();
    const message = {
      id: newId('msg'),
      conversationId: state.conversationId,
      direction,
      author,
      body,
      mediaUrl: mediaUrl ?? null,
      externalMessageId: externalId ?? null,
      deliveryStatus: 'SENT' as const,
      deliveryError: null,
      sentAt,
    };
    messages.push(message);

    const conversation = conversations.find((item) => item.id === state.conversationId);
    if (conversation) {
      conversation.lastMessageAt = sentAt;
      if (direction === 'INBOUND') conversation.unreadCount += 1;
    }

    return { conversationId: state.conversationId, messageId: message.id, duplicate: false };
  },

  async requestHumanHandoff({ phoneE164, reason }) {
    const conversation = conversations.find((item) => item.phoneE164 === phoneE164);
    if (!conversation) return null;

    conversation.aiEnabled = false;
    conversation.aiDisabledReason = reason;
    conversation.aiToggledAt = new Date();
    conversation.aiToggledByUserId = null;
    conversation.needsHumanAttention = true;

    return { conversationId: conversation.id, aiEnabled: false };
  },

  async setConversationAiEnabled({ conversationId, aiEnabled, userId, reason }) {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) return null;

    conversation.aiEnabled = aiEnabled;
    conversation.aiToggledByUserId = userId;
    conversation.aiToggledAt = new Date();
    conversation.aiDisabledReason = aiEnabled ? null : reason;

    const thread = messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());

    return {
      ...conversation,
      patientName: conversation.displayName,
      lastMessagePreview: thread[0]?.body.slice(0, 120) ?? null,
      lastMessageAuthor: thread[0]?.author ?? null,
    };
  },
};
