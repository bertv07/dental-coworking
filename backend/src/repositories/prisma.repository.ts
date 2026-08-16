import 'server-only';
import {
  prisma,
  isPrismaError,
  isOverlapViolation,
  PRISMA_ERROR,
} from '@/backend/db/client';
import type { DataRepository, DateRange, WriteResult } from '@/backend/repositories/types';
import type { DentistEarnings, FinancialSummary } from '@/backend/domain/types';
import { percentChange, splitCents } from '@/backend/domain/money';
import { MINUTES_PER_DAY, clinicWallClockToInstant } from '@/backend/domain/clinic-calendar';

/**
 * Traduce un error de escritura de Prisma al resultado tipado del contrato.
 *
 * Sirve para no propagar excepciones del ORM hasta la UI: el llamador recibe
 * "teléfono duplicado" y puede señalar el campo exacto en el formulario, en
 * lugar de un 500 genérico.
 *
 * Cualquier error que NO sea de unicidad o de registro inexistente se vuelve
 * a lanzar: son fallos reales que deben acabar en el log, no silenciarse.
 */
function toWriteFailure(error: unknown): Extract<WriteResult<never>, { ok: false }> {
  if (isPrismaError(error)) {
    if (error.code === PRISMA_ERROR.UNIQUE_CONSTRAINT) {
      // `meta.target` trae las columnas que colisionaron, ej: ["phoneE164"].
      const target = error.meta?.target;
      const field = Array.isArray(target) ? String(target[0]) : 'campo';
      return { ok: false, reason: 'DUPLICATE', field };
    }
    if (error.code === PRISMA_ERROR.RECORD_NOT_FOUND) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
  }
  throw error;
}

/**
 * ===========================================================================
 *  Repositorio PRISMA — PostgreSQL real
 * ===========================================================================
 *  SOBRE INYECCIÓN SQL:
 *  Todas las consultas de este archivo pasan por el query builder de Prisma,
 *  que SIEMPRE parametriza. Escribir `where: { email }` genera
 *  `WHERE email = $1` — el valor viaja fuera de la sentencia y es imposible
 *  que se interprete como SQL.
 *
 *  Reglas del proyecto:
 *   · PROHIBIDO `$queryRawUnsafe` y `$executeRawUnsafe`. Sin excepciones.
 *   · Si hace falta SQL crudo (agregaciones complejas), usar `$queryRaw`
 *     con template literal etiquetado: `` prisma.$queryRaw`... ${valor}` ``
 *     también parametriza. Lo peligroso es la CONCATENACIÓN de cadenas.
 *
 *  SOBRE `select` EXPLÍCITO:
 *  Nunca se devuelve el modelo entero "por comodidad". Se enumeran los
 *  campos. Así, el día que se añada una columna sensible al modelo, no se
 *  filtra sola por una API existente.
 * ===========================================================================
 */

/** Tras 5 fallos, la cuenta se bloquea 15 minutos. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;


/**
 * Traduce a un rol de conversación lo que se encontró por teléfono.
 *
 * Se separa del método para que la precedencia quede en un solo sitio: si
 * mañana hace falta añadir otro tipo de contacto, es aquí.
 */
function resolveContact(
  staff: { fullName: string; role: 'SUPER_ADMIN' | 'ASSISTANT' | 'DENTIST' } | null,
  dentistProfile: { id: string; fullName: string } | null,
): { role: 'PATIENT' | 'DENTIST' | 'ASSISTANT' | 'ADMIN' | 'UNKNOWN'; name: string | null; dentistId: string | null } {
  // La ficha de odontólogo manda sobre la cuenta de usuario: puede haber
  // odontólogos con teléfono registrado y sin cuenta en el panel.
  if (dentistProfile) {
    return { role: 'DENTIST', name: dentistProfile.fullName, dentistId: dentistProfile.id };
  }

  if (staff) {
    return {
      role: staff.role === 'SUPER_ADMIN' ? 'ADMIN' : staff.role === 'DENTIST' ? 'DENTIST' : 'ASSISTANT',
      name: staff.fullName,
      dentistId: null,
    };
  }

  // Ni personal ni odontólogo: lo resuelve quien llama mirando si el número
  // corresponde a un paciente.
  return { role: 'UNKNOWN', name: null, dentistId: null };
}

export const prismaRepository: DataRepository = {
  // --- Autenticación -------------------------------------------------------

  async findUserForLogin(email) {
    // `email` se parametriza: aunque valga `' OR 1=1 --`, Postgres lo trata
    // como una cadena literal a comparar, jamás como SQL.
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        passwordHash: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        sessionsValidFrom: true,
        lastLoginAt: true,
        createdAt: true,
        deletedAt: true,
      },
    });

    return user;
  },

  async registerLoginOutcome(userId, success) {
    if (success) {
      await prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      return;
    }

    // `increment` es atómico a nivel SQL (`SET x = x + 1`). Un read-modify-write
    // en la aplicación perdería incrementos si llegan intentos concurrentes —
    // exactamente el escenario de un ataque de fuerza bruta paralelo.
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });

    if (updated.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          lockedUntil: new Date(Date.now() + LOCK_DURATION_MINUTES * 60_000),
          failedLoginAttempts: 0, // Se reinicia: el bloqueo ya cumplió su función.
        },
      });
    }
  },

  // --- Catálogos -----------------------------------------------------------

  async listDentists(options) {
    return prisma.dentist.findMany({
      where: {
        deletedAt: null,
        ...(options?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { fullName: 'asc' },
    });
  },

  async listRooms(options) {
    return prisma.room.findMany({
      where: { deletedAt: null, ...(options?.includeInactive ? {} : { isActive: true }) },
      orderBy: { code: 'asc' },
    });
  },

  async listTreatments(options) {
    return prisma.treatment.findMany({
      where: { deletedAt: null, ...(options?.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  },

  async findTreatmentByCode(code) {
    return prisma.treatment.findFirst({
      where: { code, isActive: true, deletedAt: null },
    });
  },

  async findDentistById(id) {
    return prisma.dentist.findFirst({ where: { id, deletedAt: null } });
  },

  // --- Medios de pago ------------------------------------------------------

  async listPaymentMethods(options) {
    const rows = await prisma.paymentMethodOption.findMany({
      where: { deletedAt: null, ...(options?.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      kind: row.kind,
      instructions: row.instructions,
      currency: row.currency as 'VES' | 'USD',
      sortOrder: row.sortOrder,
      isActive: row.isActive,
    }));
  },

  async createPaymentMethod(data, userId) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.paymentMethodOption.create({ data });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'payment_method.created',
            entityType: 'PaymentMethodOption',
            entityId: row.id,
            after: { label: row.label, kind: row.kind, currency: row.currency },
          },
        });
        return row;
      });
      return { ok: true, data: { ...created, currency: created.currency as 'VES' | 'USD' } };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async updatePaymentMethod(id, data, userId) {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const previous = await tx.paymentMethodOption.findUnique({ where: { id } });
        const row = await tx.paymentMethodOption.update({ where: { id }, data });

        // Cambiar unos datos bancarios es delicado: si alguien los altera, los
        // pacientes empiezan a pagarle a otra cuenta. Queda el antes y el después.
        await tx.auditLog.create({
          data: {
            userId,
            action: 'payment_method.updated',
            entityType: 'PaymentMethodOption',
            entityId: id,
            before: previous
              ? { label: previous.label, instructions: previous.instructions }
              : undefined,
            after: { label: row.label, instructions: row.instructions },
          },
        });
        return row;
      });
      return { ok: true, data: { ...updated, currency: updated.currency as 'VES' | 'USD' } };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async deletePaymentMethod(id, userId) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.paymentMethodOption.update({
          where: { id },
          data: { deletedAt: new Date(), isActive: false },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'payment_method.deleted',
            entityType: 'PaymentMethodOption',
            entityId: id,
          },
        });
      });
      return true;
    } catch {
      return false;
    }
  },

  async findDentistByUserId(userId) {
    // Se incluye al inactivo a propósito: si a un odontólogo se le desactiva
    // la ficha, debe seguir viendo su agenda para cerrar lo que tenga pendiente.
    return prisma.dentist.findFirst({ where: { userId, deletedAt: null } });
  },

  // --- Pacientes -----------------------------------------------------------

  async findPatientByPhone(phoneE164) {
    return prisma.patient.findFirst({ where: { phoneE164, deletedAt: null } });
  },

  async upsertPatientByPhone({ phoneE164, fullName }) {
    // `upsert` se traduce a una sola sentencia atómica. Con `findFirst` +
    // `create` habría una condición de carrera entre ambas: dos mensajes
    // simultáneos del mismo número nuevo harían fallar la segunda inserción.
    return prisma.patient.upsert({
      where: { phoneE164 },
      // Si ya existe no se toca el nombre: el que puso recepción es más fiable
      // que el nombre de perfil de WhatsApp.
      update: {},
      create: { phoneE164, fullName },
    });
  },

  async listPatients({ search, page, limit }) {
    // `search` viaja como PARÁMETRO al query builder, nunca concatenado.
    // Prisma genera `WHERE "fullName" ILIKE $1`, así que un valor como
    // `%' OR 1=1 --` se busca literalmente en vez de ejecutarse.
    //
    // ⚠️  `mode: 'insensitive'` ignora mayúsculas pero NO acentos: buscar
    //  "maria" no encontrará "María". Para igualar el comportamiento del
    //  repositorio mock hace falta la extensión `unaccent` de Postgres y un
    //  índice sobre la expresión:
    //      CREATE EXTENSION IF NOT EXISTS unaccent;
    //      CREATE INDEX patients_name_unaccent_idx
    //        ON patients (lower(unaccent("fullName")) text_pattern_ops);
    //  y sustituir este `contains` por un `$queryRaw` que use unaccent().
    const where = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { phoneE164: { contains: search } },
              { documentId: { contains: search } },
            ],
          }
        : {}),
    };

    // Página y total en paralelo: son consultas independientes.
    const [items, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        orderBy: { fullName: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.patient.count({ where }),
    ]);

    return { items, total };
  },

  async createPatient(data) {
    try {
      return { ok: true, data: await prisma.patient.create({ data }) };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async updatePatient(id, data) {
    try {
      return { ok: true, data: await prisma.patient.update({ where: { id }, data }) };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async softDeletePatient(id) {
    try {
      return {
        ok: true,
        // Borrado LÓGICO: citas y pagos del paciente siguen existiendo, así
        // que la contabilidad histórica no se altera.
        data: await prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } }),
      };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  // --- Odontólogos (escritura) ---------------------------------------------

  async createDentist(data) {
    try {
      return { ok: true, data: await prisma.dentist.create({ data }) };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async updateDentist(id, data) {
    try {
      return { ok: true, data: await prisma.dentist.update({ where: { id }, data }) };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async softDeleteDentist(id) {
    try {
      return {
        ok: true,
        data: await prisma.dentist.update({
          where: { id },
          // Se desactiva Y se marca borrado: sus liquidaciones históricas
          // deben seguir apareciendo en las finanzas.
          data: { isActive: false, deletedAt: new Date() },
        }),
      };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  // --- Tratamientos (escritura) --------------------------------------------

  async createTreatment(data) {
    try {
      return { ok: true, data: await prisma.treatment.create({ data }) };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async updateTreatment(id, data, changedByUserId) {
    try {
      // TRANSACCIÓN: el cambio de precio y su registro en el historial deben
      // ocurrir juntos. Si se guarda el precio nuevo pero falla el historial,
      // se pierde la trazabilidad contable — y nadie se entera hasta la
      // auditoría.
      const updated = await prisma.$transaction(async (tx) => {
        const previous = await tx.treatment.findUnique({
          where: { id },
          select: { basePriceCents: true },
        });
        if (!previous) throw Object.assign(new Error('not found'), { code: 'P2025' });

        const treatment = await tx.treatment.update({ where: { id }, data });

        if (previous.basePriceCents !== data.basePriceCents) {
          await tx.treatmentPriceHistory.create({
            data: {
              treatmentId: id,
              oldPriceCents: previous.basePriceCents,
              newPriceCents: data.basePriceCents,
              changedByUserId,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: changedByUserId,
              action: 'treatment.price_updated',
              entityType: 'Treatment',
              entityId: id,
              before: { basePriceCents: previous.basePriceCents },
              after: { basePriceCents: data.basePriceCents },
            },
          });
        }

        return treatment;
      });

      return { ok: true, data: updated };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async softDeleteTreatment(id) {
    try {
      return {
        ok: true,
        data: await prisma.treatment.update({
          where: { id },
          data: { isActive: false, deletedAt: new Date() },
        }),
      };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  // --- Consultorios (escritura) --------------------------------------------

  async createRoom(data) {
    try {
      return { ok: true, data: await prisma.room.create({ data }) };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async updateRoom(id, data) {
    try {
      return { ok: true, data: await prisma.room.update({ where: { id }, data }) };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async softDeleteRoom(id) {
    try {
      return {
        ok: true,
        data: await prisma.room.update({
          where: { id },
          data: { isActive: false, deletedAt: new Date() },
        }),
      };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async createPayment({ data, exchangeRate, exchangeRateSource, userId }) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. La cita y su odontólogo. El porcentaje de comisión se lee AHORA
        //    del odontólogo; nunca se acepta del formulario.
        const appointment = await tx.appointment.findUnique({
          where: { id: data.appointmentId },
          include: {
            dentist: { select: { clinicCommissionPercent: true } },
            payment: { select: { id: true } },
          },
        });

        if (!appointment) return { ok: false as const, reason: 'NOT_FOUND' as const };

        // 2. Una cita, un cobro. Sin esto, dos clics seguidos en "Cobrar"
        //    duplicarían el ingreso y descuadrarían las comisiones.
        if (appointment.payment) {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'appointmentId' };
        }

        // 3. Reparto 40/60 calculado en el SERVIDOR con la misma función que
        //    usa todo el sistema. Garantiza clinic + dentist === total.
        const split = splitCents(data.amountCents, appointment.dentist.clinicCommissionPercent);

        // 4. Snapshot cambiario: importe en Bs y tasa aplicada quedan
        //    congelados. Mañana la tasa cambia; este cobro no.
        const amountBs = Math.round((data.amountCents / 100) * exchangeRate * 100) / 100;

        const payment = await tx.payment.create({
          data: {
            appointmentId: appointment.id,
            amountCents: split.totalCents,
            commissionPercentApplied: split.clinicPercent,
            clinicShareCents: split.clinicShareCents,
            dentistShareCents: split.dentistShareCents,
            exchangeRate,
            amountBs,
            exchangeRateSource,
            method: data.method,
            methodLabel: data.methodLabel,
            status: 'PAID',
            paidAt: new Date(),
            externalReference: data.externalReference,
          },
        });

        // 5. La cita se cierra: cobrada implica atendida.
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { status: 'COMPLETED' },
        });

        // 6. El dinero siempre deja rastro.
        await tx.auditLog.create({
          data: {
            userId,
            action: 'payment.recorded',
            entityType: 'Payment',
            entityId: payment.id,
            after: {
              amountCents: split.totalCents,
              amountBs,
              exchangeRate,
              clinicShareCents: split.clinicShareCents,
              dentistShareCents: split.dentistShareCents,
            },
          },
        });

        return { ok: true as const, data: { id: payment.id } };
      });

      return result;
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async getDailyCash(date) {
    // Día completo en la zona de la clínica, no en la del servidor.
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const payments = await prisma.payment.findMany({
      where: { status: 'PAID', paidAt: { gte: dayStart, lt: dayEnd } },
      include: {
        appointment: {
          include: {
            patient: { select: { fullName: true } },
            dentist: { select: { fullName: true } },
            treatment: { select: { name: true } },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
    });

    // Se agrega en memoria y no con `groupBy`: son los cobros de UN día
    // (decenas, no miles), y así se calculan los totales y el desglose por
    // método en una sola pasada en vez de tres consultas.
    const byMethod = new Map<string, { cents: number; bs: number; count: number }>();
    let totalCents = 0;
    let totalBs = 0;
    let clinicShareCents = 0;
    let dentistShareCents = 0;

    for (const payment of payments) {
      totalCents += payment.amountCents;
      totalBs += Number(payment.amountBs);
      clinicShareCents += payment.clinicShareCents;
      dentistShareCents += payment.dentistShareCents;

      const current = byMethod.get(payment.method) ?? { cents: 0, bs: 0, count: 0 };
      current.cents += payment.amountCents;
      current.bs += Number(payment.amountBs);
      current.count += 1;
      byMethod.set(payment.method, current);
    }

    return {
      date: dayStart,
      totalCents,
      totalBs: Math.round(totalBs * 100) / 100,
      clinicShareCents,
      dentistShareCents,
      paymentCount: payments.length,
      byMethod: [...byMethod.entries()].map(([method, value]) => ({ method, ...value })),
      payments: payments.map((payment) => ({
        id: payment.id,
        patientName: payment.appointment.patient.fullName,
        dentistName: payment.appointment.dentist.fullName,
        treatmentName: payment.appointment.treatment.name,
        amountCents: payment.amountCents,
        amountBs: Number(payment.amountBs),
        exchangeRate: Number(payment.exchangeRate),
        method: payment.method,
        paidAt: payment.paidAt!,
      })),
    };
  },

  async getPaidAppointmentIds(appointmentIds) {
    if (appointmentIds.length === 0) return [];

    const rows = await prisma.payment.findMany({
      where: { appointmentId: { in: appointmentIds }, status: 'PAID' },
      select: { appointmentId: true },
    });
    return rows.map((row) => row.appointmentId);
  },

  async getCashClosing(businessDate) {
    const row = await prisma.cashClosing.findUnique({
      where: { businessDate },
      include: { closedBy: { select: { fullName: true } } },
    });
    if (!row) return null;

    return {
      id: row.id,
      businessDate: row.businessDate,
      closedByUserId: row.closedByUserId,
      closedByName: row.closedBy.fullName,
      closedAt: row.closedAt,
      expectedCents: row.expectedCents,
      expectedBs: Number(row.expectedBs),
      expectedCashBs: Number(row.expectedCashBs),
      countedCashBs: Number(row.countedCashBs),
      differenceBs: Number(row.differenceBs),
      paymentCount: row.paymentCount,
      notes: row.notes,
    };
  },

  async closeCash(input, userId) {
    // La diferencia se calcula AQUÍ, no se acepta del cliente: es el número
    // que delata un descuadre y no puede depender de lo que mande el
    // navegador. Redondeo a céntimos para no arrastrar el error binario del
    // punto flotante a la base.
    const differenceBs = Math.round((input.countedCashBs - input.expectedCashBs) * 100) / 100;

    try {
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.cashClosing.create({
          data: {
            businessDate: input.businessDate,
            closedByUserId: userId,
            expectedCents: input.expectedCents,
            expectedBs: input.expectedBs,
            expectedCashBs: input.expectedCashBs,
            countedCashBs: input.countedCashBs,
            differenceBs,
            paymentCount: input.paymentCount,
            notes: input.notes,
          },
          include: { closedBy: { select: { fullName: true } } },
        });

        await tx.auditLog.create({
          data: {
            userId,
            action: 'cash.closed',
            entityType: 'CashClosing',
            entityId: row.id,
            after: {
              businessDate: row.businessDate,
              expectedCashBs: input.expectedCashBs,
              countedCashBs: input.countedCashBs,
              differenceBs,
            },
          },
        });

        return row;
      });

      return {
        ok: true as const,
        data: {
          id: created.id,
          businessDate: created.businessDate,
          closedByUserId: created.closedByUserId,
          closedByName: created.closedBy.fullName,
          closedAt: created.closedAt,
          expectedCents: created.expectedCents,
          expectedBs: Number(created.expectedBs),
          expectedCashBs: Number(created.expectedCashBs),
          countedCashBs: Number(created.countedCashBs),
          differenceBs: Number(created.differenceBs),
          paymentCount: created.paymentCount,
          notes: created.notes,
        },
      };
    } catch {
      // Choque con el índice único de `businessDate`: alguien cerró el día
      // entre que se pintó la pantalla y se pulsó el botón.
      return { ok: false as const, reason: 'ALREADY_CLOSED' as const };
    }
  },

  async reopenCash(businessDate, userId) {
    const existing = await prisma.cashClosing.findUnique({ where: { businessDate } });
    if (!existing) return false;

    await prisma.$transaction(async (tx) => {
      await tx.cashClosing.delete({ where: { businessDate } });
      // El arqueo se borra, pero el hecho de que existió y con qué diferencia
      // queda en el registro. Reabrir una caja no puede ser invisible.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'cash.reopened',
          entityType: 'CashClosing',
          entityId: existing.id,
          before: {
            businessDate: existing.businessDate,
            countedCashBs: Number(existing.countedCashBs),
            differenceBs: Number(existing.differenceBs),
            closedByUserId: existing.closedByUserId,
          },
        },
      });
    });

    return true;
  },

  async listUnpaidAppointmentsForDay(businessDate) {
    /*
     * Citas del día atendibles y todavía sin cobro.
     *
     * El filtro de "sin cobro" se hace con `payments: { none: ... }` en vez de
     * traer las citas y cruzarlas en memoria: así Postgres devuelve
     * directamente lo que falta por cobrar, que suelen ser dos o tres filas de
     * entre las veinte del día.
     */
    const dayStart = clinicWallClockToInstant(businessDate, 0);
    const dayEnd = clinicWallClockToInstant(businessDate, MINUTES_PER_DAY);

    return prisma.appointment.findMany({
      where: {
        deletedAt: null,
        startsAt: { gte: dayStart, lt: dayEnd },
        status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
        // La relación es 1-a-1 (`payment`, no `payments`). `isNot` cubre las
        // dos formas de "sin cobrar": que no haya pago, o que lo haya pero
        // esté devuelto o fallido — en ambos casos el dinero no ha entrado.
        NOT: { payment: { is: { status: 'PAID' } } },
      },
      include: {
        patient: { select: { id: true, fullName: true, phoneE164: true } },
        dentist: { select: { id: true, fullName: true } },
        room: { select: { id: true, name: true, code: true } },
        treatment: { select: { id: true, name: true, durationMinutes: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  },

  async getClinicSettings() {
    // `upsert` con id fijo: la primera lectura crea la fila con valores por
    // defecto. Evita tener que acordarse de sembrarla en cada entorno nuevo.
    return prisma.clinicSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
  },

  async updateClinicSettings(data, userId) {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const before = await tx.clinicSettings.findUnique({ where: { id: 'singleton' } });

        const settings = await tx.clinicSettings.upsert({
          where: { id: 'singleton' },
          update: { ...data, updatedByUserId: userId },
          create: { id: 'singleton', ...data, updatedByUserId: userId },
        });

        // Cambiar la comisión por defecto o el horario afecta al dinero y a
        // la agenda: queda auditado igual que un cambio de precio.
        await tx.auditLog.create({
          data: {
            userId,
            action: 'clinic_settings.updated',
            entityType: 'ClinicSettings',
            entityId: 'singleton',
            before: before ? JSON.parse(JSON.stringify(before)) : undefined,
            after: JSON.parse(JSON.stringify(settings)),
          },
        });

        return settings;
      });

      return { ok: true, data: updated };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async getEntityCounts() {
    // Cinco COUNT en paralelo. Postgres los resuelve con index-only scans:
    // más rápido que traer las filas para contarlas en Node.
    const [patients, dentists, activeDentists, treatments, rooms] = await Promise.all([
      prisma.patient.count({ where: { deletedAt: null } }),
      prisma.dentist.count({ where: { deletedAt: null } }),
      prisma.dentist.count({ where: { deletedAt: null, isActive: true } }),
      prisma.treatment.count({ where: { deletedAt: null, isActive: true } }),
      prisma.room.count({ where: { deletedAt: null, isActive: true } }),
    ]);

    return { patients, dentists, activeDentists, treatments, rooms };
  },

  // --- Agenda --------------------------------------------------------------

  async findAppointmentByIdempotencyKey(key) {
    return prisma.appointment.findUnique({ where: { idempotencyKey: key } });
  },

  async findOverlappingAppointments({ startsAt, endsAt, dentistId, roomId }) {
    return prisma.appointment.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        // Solapamiento clásico: A empieza antes de que B termine Y
        // B empieza antes de que A termine.
        AND: [{ startsAt: { lt: endsAt } }, { endsAt: { gt: startsAt } }],
        ...(dentistId || roomId
          ? {
              OR: [
                ...(dentistId ? [{ dentistId }] : []),
                ...(roomId ? [{ roomId }] : []),
              ],
            }
          : {}),
      },
    });
  },

  async createAppointment(data) {
    return prisma.appointment.create({ data: { ...data, status: 'PENDING' } });
  },

  async findAppointmentById(id) {
    return prisma.appointment.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, fullName: true, phoneE164: true } },
        dentist: { select: { id: true, fullName: true } },
        room: { select: { id: true, name: true, code: true } },
        treatment: { select: { id: true, name: true, durationMinutes: true } },
      },
    });
  },

  async createAppointmentFromPanel(data) {
    const treatment = await prisma.treatment.findUnique({
      where: { id: data.treatmentId },
      select: { durationMinutes: true, basePriceCents: true },
    });
    if (!treatment) return { ok: false, reason: 'NOT_FOUND' };

    // EL SERVIDOR calcula fin y precio a partir del tratamiento. Nunca se
    // aceptan del formulario: si no, alguien podría reservar 5 minutos para
    // una endodoncia de 120, o ponerle precio 0.
    const endsAt = new Date(data.startsAt.getTime() + treatment.durationMinutes * 60_000);

    try {
      const appointment = await prisma.appointment.create({
        data: {
          ...data,
          endsAt,
          // Creada por un humano: ya viene confirmada.
          status: 'CONFIRMED',
          source: 'ADMIN_PANEL',
          agreedPriceCents: treatment.basePriceCents,
        },
      });
      return { ok: true, data: appointment };
    } catch (error) {
      // Los constraints EXCLUDE de la migración 0001 rechazan el solapamiento
      // a nivel de motor. Se traduce a DUPLICATE sobre `startsAt` para que el
      // formulario resalte el campo de la hora.
      if (isOverlapViolation(error)) {
        return { ok: false, reason: 'DUPLICATE', field: 'startsAt' };
      }
      return toWriteFailure(error);
    }
  },

  async updateAppointment(id, data) {
    const treatment = await prisma.treatment.findUnique({
      where: { id: data.treatmentId },
      select: { durationMinutes: true },
    });
    if (!treatment) return { ok: false, reason: 'NOT_FOUND' };

    const endsAt = new Date(data.startsAt.getTime() + treatment.durationMinutes * 60_000);

    try {
      // `agreedPriceCents` NO se recalcula: se le prometió al paciente y
      // reprogramar la hora no cambia lo que va a pagar.
      const appointment = await prisma.appointment.update({
        where: { id },
        data: { ...data, endsAt },
      });
      return { ok: true, data: appointment };
    } catch (error) {
      if (isOverlapViolation(error)) {
        return { ok: false, reason: 'DUPLICATE', field: 'startsAt' };
      }
      return toWriteFailure(error);
    }
  },

  async updateAppointmentStatus({ id, status, cancellationReason }) {
    try {
      const appointment = await prisma.appointment.update({
        where: { id },
        data: { status, cancellationReason },
      });
      return { ok: true, data: appointment };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async listAppointments({ range, dentistId, limit = 100 }) {
    return prisma.appointment.findMany({
      where: {
        deletedAt: null,
        startsAt: { gte: range.from, lte: range.to },
        ...(dentistId ? { dentistId } : {}),
      },
      // `include` con `select` anidado: una sola query con JOINs, sin N+1,
      // y devolviendo únicamente los campos que la UI necesita.
      include: {
        patient: { select: { id: true, fullName: true, phoneE164: true } },
        dentist: { select: { id: true, fullName: true } },
        room: { select: { id: true, name: true, code: true } },
        treatment: { select: { id: true, name: true, durationMinutes: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: limit,
    });
  },

  async listDentistAgenda({ dentistId, range, limit = 200 }) {
    /*
     * `select` explícito, no `include`.
     *
     * La diferencia es justo la que importa aquí: `include` trae TODAS las
     * columnas de la cita y añade las relaciones, así que `agreedPriceCents`
     * viajaría hasta Node aunque la pantalla no lo pinte. Con `select`, el
     * SELECT que se manda a Postgres ni siquiera nombra esa columna.
     */
    const rows = await prisma.appointment.findMany({
      where: {
        dentistId,
        deletedAt: null,
        startsAt: { gte: range.from, lte: range.to },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        source: true,
        notes: true,
        patient: { select: { fullName: true, phoneE164: true } },
        treatment: { select: { name: true, durationMinutes: true } },
        room: { select: { name: true, code: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: limit,
    });

    // Se aplana aquí para que la vista reciba el contrato del dominio y no la
    // forma de las tablas.
    return rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      status: row.status,
      source: row.source,
      notes: row.notes,
      patientName: row.patient.fullName,
      patientPhone: row.patient.phoneE164,
      treatmentName: row.treatment.name,
      treatmentDurationMinutes: row.treatment.durationMinutes,
      roomName: row.room.name,
      roomCode: row.room.code,
    }));
  },

  // --- Finanzas ------------------------------------------------------------

  async getFinancialSummary(range): Promise<FinancialSummary> {
    const periodMs = range.to.getTime() - range.from.getTime();
    const previousRange: DateRange = {
      from: new Date(range.from.getTime() - periodMs),
      to: range.from,
    };

    // Todas las agregaciones en paralelo: las hace Postgres, no Node.
    // Traer 10.000 pagos a memoria para sumarlos en JS sería un desperdicio
    // de red y de RAM — `aggregate` devuelve una sola fila.
    const [current, previous, statusCounts, aiCount] = await Promise.all([
      prisma.payment.aggregate({
        where: { status: 'PAID', paidAt: { gte: range.from, lte: range.to } },
        _sum: { amountCents: true, clinicShareCents: true, dentistShareCents: true },
      }),
      prisma.payment.aggregate({
        where: {
          status: 'PAID',
          paidAt: { gte: previousRange.from, lte: previousRange.to },
        },
        _sum: { amountCents: true },
      }),
      // `groupBy` sustituye tres consultas COUNT separadas por una sola.
      prisma.appointment.groupBy({
        by: ['status'],
        where: { deletedAt: null, startsAt: { gte: range.from, lte: range.to } },
        _count: { _all: true },
      }),
      prisma.appointment.count({
        where: {
          deletedAt: null,
          source: 'WHATSAPP_AI',
          startsAt: { gte: range.from, lte: range.to },
        },
      }),
    ]);

    // Deuda viva: pagos cobrados cuya parte del odontólogo aún no se liquidó.
    // No se filtra por rango a propósito — la deuda es acumulada, no del periodo.
    const outstanding = await prisma.payment.aggregate({
      where: { status: 'PAID', payoutId: null },
      _sum: { dentistShareCents: true },
    });

    const countFor = (status: string) =>
      statusCounts.find((row) => row.status === status)?._count._all ?? 0;

    const totalRevenueCents = current._sum.amountCents ?? 0;

    return {
      periodStart: range.from,
      periodEnd: range.to,
      totalRevenueCents,
      clinicEarningsCents: current._sum.clinicShareCents ?? 0,
      dentistEarningsCents: current._sum.dentistShareCents ?? 0,
      outstandingPayoutsCents: outstanding._sum.dentistShareCents ?? 0,
      completedAppointments: countFor('COMPLETED'),
      cancelledAppointments: countFor('CANCELLED'),
      noShowAppointments: countFor('NO_SHOW'),
      aiBookedAppointments: aiCount,
      revenueChangePercent: percentChange(totalRevenueCents, previous._sum.amountCents ?? 0),
    };
  },

  async getDentistEarnings(range): Promise<DentistEarnings[]> {
    /**
     * Esta agregación cruza `payments` con `appointments` para agrupar por
     * odontólogo. `groupBy` de Prisma no atraviesa relaciones, así que se usa
     * SQL crudo — pero con `$queryRaw` (template etiquetado), NO con
     * `$queryRawUnsafe`.
     *
     * Las interpolaciones `${range.from}` y `${range.to}` se convierten en
     * placeholders `$1`/`$2`: siguen siendo parámetros, no texto concatenado.
     * Esto es seguro frente a inyección; `$queryRawUnsafe` no lo sería.
     */
    const rows = await prisma.$queryRaw<
      Array<{
        dentistId: string;
        dentistName: string;
        commissionPercent: number;
        grossCents: bigint;
        clinicShareCents: bigint;
        dentistShareCents: bigint;
        paidOutCents: bigint;
        appointmentCount: bigint;
      }>
    >`
      SELECT
        d.id                                    AS "dentistId",
        d."fullName"                            AS "dentistName",
        d."clinicCommissionPercent"             AS "commissionPercent",
        COALESCE(SUM(p."amountCents"), 0)       AS "grossCents",
        COALESCE(SUM(p."clinicShareCents"), 0)  AS "clinicShareCents",
        COALESCE(SUM(p."dentistShareCents"), 0) AS "dentistShareCents",
        COALESCE(SUM(p."dentistShareCents") FILTER (WHERE p."payoutId" IS NOT NULL), 0)
                                                AS "paidOutCents",
        COUNT(p.id)                             AS "appointmentCount"
      FROM dentists d
      LEFT JOIN appointments a ON a."dentistId" = d.id AND a."deletedAt" IS NULL
      LEFT JOIN payments p
        ON p."appointmentId" = a.id
       AND p.status = 'PAID'
       AND p."paidAt" >= ${range.from}
       AND p."paidAt" <= ${range.to}
      WHERE d."deletedAt" IS NULL
      GROUP BY d.id, d."fullName", d."clinicCommissionPercent"
      ORDER BY "grossCents" DESC
    `;

    // Postgres devuelve SUM()/COUNT() como BIGINT → Prisma los entrega como
    // `bigint` de JS. Se convierten a `number`: los montos en centavos están
    // muy por debajo de Number.MAX_SAFE_INTEGER (~9e15) y `bigint` no es
    // serializable a JSON sin ayuda.
    return rows.map((row) => {
      const dentistShareCents = Number(row.dentistShareCents);
      const paidOutCents = Number(row.paidOutCents);

      return {
        dentistId: row.dentistId,
        dentistName: row.dentistName,
        commissionPercent: row.commissionPercent,
        grossCents: Number(row.grossCents),
        clinicShareCents: Number(row.clinicShareCents),
        dentistShareCents,
        paidOutCents,
        outstandingCents: dentistShareCents - paidOutCents,
        appointmentCount: Number(row.appointmentCount),
      };
    });
  },

  // --- WhatsApp ------------------------------------------------------------

  async listConversations(options) {
    const conversations = await prisma.whatsAppConversation.findMany({
      include: {
        patient: { select: { fullName: true } },
        // Sólo el último mensaje de cada hilo, para la vista previa.
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { body: true, author: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: options?.limit ?? 50,
    });

    return conversations.map((conversation) => {
      const lastMessage = conversation.messages[0];
      return {
        id: conversation.id,
        phoneE164: conversation.phoneE164,
        patientId: conversation.patientId,
        displayName: conversation.displayName,
        aiEnabled: conversation.aiEnabled,
        aiToggledByUserId: conversation.aiToggledByUserId,
        aiToggledAt: conversation.aiToggledAt,
        aiDisabledReason: conversation.aiDisabledReason,
        unreadCount: conversation.unreadCount,
        needsHumanAttention: conversation.needsHumanAttention,
        lastMessageAt: conversation.lastMessageAt,
        patientName: conversation.patient?.fullName ?? conversation.displayName,
        lastMessagePreview: lastMessage?.body.slice(0, 120) ?? null,
        lastMessageAuthor: lastMessage?.author ?? null,
      };
    });
  },

  async getConversationMessages(conversationId) {
    return prisma.whatsAppMessage.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'asc' },
      // Techo defensivo: un hilo de un año no debe tumbar el navegador.
      // La paginación hacia atrás es la evolución natural.
      take: 200,
    });
  },

  async createOutboundMessage({ conversationId, body, userId }) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const conversation = await tx.whatsAppConversation.findUnique({
          where: { id: conversationId },
          select: { id: true, phoneE164: true, aiEnabled: true },
        });
        if (!conversation) return null;

        const sentAt = new Date();

        const message = await tx.whatsAppMessage.create({
          data: {
            conversationId,
            direction: 'OUTBOUND',
            author: 'HUMAN_AGENT',
            body,
            sentAt,
            // PENDING hasta que el proveedor confirme. Nunca se nace SENT.
            deliveryStatus: 'PENDING',
            sentByUserId: userId,
          },
        });

        await tx.whatsAppConversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: sentAt,
            // Un humano ya respondió: el chat deja de estar sin atender.
            unreadCount: 0,
            needsHumanAttention: false,
            /**
             * TOMA DE CONTROL: al escribir un humano, la IA se apaga.
             *
             * Es el comportamiento estándar de cualquier bandeja con bot, y
             * por un motivo concreto: si la IA sigue activa, contestará en
             * paralelo y contradirá al agente delante del paciente.
             * Volver a encenderla es un clic en el toggle.
             */
            ...(conversation.aiEnabled
              ? {
                  aiEnabled: false,
                  aiToggledByUserId: userId,
                  aiToggledAt: sentAt,
                  aiDisabledReason: 'Un agente tomó la conversación',
                }
              : {}),
          },
        });

        return { id: message.id, phoneE164: conversation.phoneE164 };
      });

      if (!result) return { ok: false, reason: 'NOT_FOUND' };
      return { ok: true, data: result };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async setMessageDelivery({ messageId, status, error }) {
    await prisma.whatsAppMessage.update({
      where: { id: messageId },
      data: { deliveryStatus: status, deliveryError: error },
    });
  },

  async setConversationAiEnabled({ conversationId, aiEnabled, userId, reason }) {
    const updated = await prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        aiEnabled,
        aiToggledByUserId: userId,
        aiToggledAt: new Date(),
        aiDisabledReason: aiEnabled ? null : reason,
        // Al reactivar la IA se limpia la marca de escalamiento.
        ...(aiEnabled ? { needsHumanAttention: false } : {}),
      },
      include: {
        patient: { select: { fullName: true } },
        messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { body: true, author: true } },
      },
    });

    const lastMessage = updated.messages[0];
    return {
      id: updated.id,
      phoneE164: updated.phoneE164,
      patientId: updated.patientId,
      displayName: updated.displayName,
      aiEnabled: updated.aiEnabled,
      aiToggledByUserId: updated.aiToggledByUserId,
      aiToggledAt: updated.aiToggledAt,
      aiDisabledReason: updated.aiDisabledReason,
      unreadCount: updated.unreadCount,
      needsHumanAttention: updated.needsHumanAttention,
      lastMessageAt: updated.lastMessageAt,
      patientName: updated.patient?.fullName ?? updated.displayName,
      lastMessagePreview: lastMessage?.body.slice(0, 120) ?? null,
      lastMessageAuthor: lastMessage?.author ?? null,
    };
  },

  // --- WhatsApp: lo que consume la automatización --------------------------

  async getConversationStateByPhone({ phoneE164, displayName }) {
    /*
     * Identificación del contacto ANTES de nada.
     *
     * El orden importa: se mira primero al personal. Un odontólogo puede
     * estar además registrado como paciente, y si se resolviera al revés el
     * bot le ofrecería cita en vez de decirle su horario.
     */
    const [staff, dentistProfile] = await Promise.all([
      prisma.user.findFirst({
        where: { phoneE164, deletedAt: null, status: 'ACTIVE' },
        select: { fullName: true, role: true },
      }),
      prisma.dentist.findFirst({
        where: { phone: phoneE164, deletedAt: null },
        select: { id: true, fullName: true },
      }),
    ]);
    /*
     * `upsert` y no `findFirst` + `create`: dos mensajes casi simultáneos de
     * un número nuevo entrarían a la vez en el hueco entre la lectura y la
     * escritura, y el segundo chocaría con el índice único del teléfono.
     */
    const contact = resolveContact(staff, dentistProfile);

    const existing = await prisma.whatsAppConversation.findUnique({
      where: { phoneE164 },
      include: { patient: { select: { id: true, fullName: true } } },
    });

    if (existing) {
      return {
        conversationId: existing.id,
        phoneE164: existing.phoneE164,
        aiEnabled: existing.aiEnabled,
        aiDisabledReason: existing.aiDisabledReason,
        needsHumanAttention: existing.needsHumanAttention,
        patientId: existing.patient?.id ?? null,
        patientName: existing.patient?.fullName ?? existing.displayName,
        isNewConversation: false,
        contact: {
          ...contact,
          role:
            contact.role === 'UNKNOWN' && existing.patient ? ('PATIENT' as const) : contact.role,
          name: contact.name ?? existing.patient?.fullName ?? existing.displayName,
        },
      };
    }

    // Primer contacto: si el número ya es de un paciente conocido, la
    // conversación nace vinculada a su ficha. Así el bot puede saludarle por
    // su nombre y ver su historial en vez de tratarlo como un desconocido.
    const patient = await prisma.patient.findFirst({
      where: { phoneE164, deletedAt: null },
      select: { id: true, fullName: true },
    });

    const created = await prisma.whatsAppConversation.create({
      data: {
        phoneE164,
        patientId: patient?.id ?? null,
        displayName: displayName ?? patient?.fullName ?? null,
        aiEnabled: true,
      },
    });

    return {
      conversationId: created.id,
      phoneE164: created.phoneE164,
      aiEnabled: created.aiEnabled,
      aiDisabledReason: created.aiDisabledReason,
      needsHumanAttention: created.needsHumanAttention,
      patientId: patient?.id ?? null,
      patientName: patient?.fullName ?? created.displayName,
      isNewConversation: true,
      contact: {
        ...contact,
        // Si no es personal pero sí paciente conocido, el rol es PATIENT.
        role: contact.role === 'UNKNOWN' && patient ? ('PATIENT' as const) : contact.role,
        name: contact.name ?? patient?.fullName ?? created.displayName,
      },
    };
  },

  async recordAutomationMessage({ phoneE164, direction, author, body, mediaUrl, externalId }) {
    // Reutiliza la resolución de conversación de arriba: crea la conversación
    // si es un número nuevo.
    const state = await prismaRepository.getConversationStateByPhone({ phoneE164 });

    /*
     * Deduplicación por el id de WhatsApp. Meta reintenta sus webhooks con
     * agresividad y n8n también reintenta; sin esto, el monitor mostraría el
     * mismo mensaje del paciente tres veces.
     */
    if (externalId) {
      const duplicate = await prisma.whatsAppMessage.findUnique({
        where: { externalMessageId: externalId },
        select: { id: true },
      });
      if (duplicate) {
        return { conversationId: state.conversationId, messageId: duplicate.id, duplicate: true };
      }
    }

    const sentAt = new Date();

    const [message] = await prisma.$transaction([
      prisma.whatsAppMessage.create({
        data: {
          conversationId: state.conversationId,
          direction,
          author,
          body,
          mediaUrl: mediaUrl ?? null,
          externalMessageId: externalId ?? null,
          // Un mensaje que YA pasó por WhatsApp llega aquí sólo para quedar
          // registrado; su entrega no depende de este sistema.
          deliveryStatus: 'SENT',
          sentAt,
        },
      }),
      prisma.whatsAppConversation.update({
        where: { id: state.conversationId },
        data: {
          lastMessageAt: sentAt,
          // El contador de no leídos sólo sube con lo que escribe el paciente.
          // Lo que responde el bot no es algo pendiente de leer.
          ...(direction === 'INBOUND' ? { unreadCount: { increment: 1 } } : {}),
        },
      }),
    ]);

    return { conversationId: state.conversationId, messageId: message.id, duplicate: false };
  },

  async requestHumanHandoff({ phoneE164, reason }) {
    const conversation = await prisma.whatsAppConversation.findUnique({
      where: { phoneE164 },
      select: { id: true },
    });
    if (!conversation) return null;

    const updated = await prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        // Las dos cosas a la vez y a propósito: marcar el chat sin callar al
        // bot dejaría a la IA respondiendo mientras el aviso espera a que
        // alguien lo lea.
        aiEnabled: false,
        aiDisabledReason: reason,
        aiToggledAt: new Date(),
        // `aiToggledByUserId` queda en null: no lo apagó una persona.
        aiToggledByUserId: null,
        needsHumanAttention: true,
      },
      select: { id: true, aiEnabled: true },
    });

    return { conversationId: updated.id, aiEnabled: updated.aiEnabled };
  },
};
