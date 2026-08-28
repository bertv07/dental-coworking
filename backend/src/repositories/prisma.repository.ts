import 'server-only';
import {
  prisma,
  isPrismaError,
  isOverlapViolation,
  PRISMA_ERROR,
} from '@/backend/db/client';
import { Prisma } from '@prisma/client';
import type { DataRepository, DateRange, WriteResult } from '@/backend/repositories/types';
import type {
  DentistEarnings,
  FinancialSummary,
  ScheduleBlock,
} from '@/backend/domain/types';
import { percentChange, splitCents } from '@/backend/domain/money';
import { calcularComision, calcularPrecio, repartirCobro } from '@/backend/domain/pricing';
import {
  recalcularFactura,
  repartirPago,
  totalLinea,
} from '@/backend/repositories/invoice-helpers';
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
 * Relaciones que lleva una cita en la vista de recepción.
 *
 * Está extraído porque lo comparten tres consultas (agenda, detalle y
 * pendientes de cobro) y las tres tienen que devolver exactamente la misma
 * forma: si una se olvidara los añadidos, esa pantalla cobraría de menos sin
 * avisar. Un solo sitio que cambiar es la diferencia entre añadir un campo y
 * salir a buscar quién más lo necesitaba.
 */
const APPOINTMENT_RELATIONS = {
  patient: { select: { id: true, fullName: true, phoneE164: true } },
  dentist: { select: { id: true, fullName: true } },
  room: { select: { id: true, name: true, code: true } },
  treatment: { select: { id: true, name: true, durationMinutes: true } },
  addons: {
    select: {
      id: true,
      appointmentId: true,
      treatmentId: true,
      priceCents: true,
      commissionPercent: true,
      notes: true,
      createdAt: true,
      treatment: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} as const;

/** Aplana el nombre del tratamiento de cada añadido al contrato del dominio. */
function toAppointmentWithRelations<
  T extends {
    addons: Array<{
      id: string;
      appointmentId: string;
      treatmentId: string;
      priceCents: number;
      commissionPercent: number;
      notes: string | null;
      createdAt: Date;
      treatment: { name: string };
    }>;
  },
>(row: T) {
  return {
    ...row,
    addons: row.addons.map((addon) => ({
      id: addon.id,
      appointmentId: addon.appointmentId,
      treatmentId: addon.treatmentId,
      treatmentName: addon.treatment.name,
      priceCents: addon.priceCents,
      commissionPercent: addon.commissionPercent,
      notes: addon.notes,
      createdAt: addon.createdAt,
    })),
  };
}

/** Todo lo que necesita una factura para pintarse: líneas, pagos y nombres. */
const INVOICE_RELATIONS = {
  patient: { select: { fullName: true } },
  dentist: { select: { fullName: true } },
  lines: {
    select: {
      id: true,
      treatmentId: true,
      description: true,
      quantity: true,
      unitPriceCents: true,
      discountCents: true,
      discountReason: true,
      commissionPercent: true,
    },
    orderBy: { sortOrder: 'asc' },
  },
  payments: {
    where: { status: 'PAID' },
    select: {
      id: true,
      amountCents: true,
      amountBs: true,
      exchangeRate: true,
      method: true,
      methodLabel: true,
      paidAt: true,
    },
    orderBy: { paidAt: 'asc' },
  },
} as const;

/**
 * Aplana una factura al contrato del dominio.
 *
 * `paidCents` y `balanceCents` se calculan aquí y no se guardan: derivarlos de
 * los pagos hace imposible que el saldo se quede desfasado respecto al dinero
 * que de verdad entró.
 */
function toInvoice(row: {
  id: string;
  number: number;
  patientId: string;
  dentistId: string | null;
  appointmentId: string | null;
  status: 'OPEN' | 'PAID' | 'VOID';
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  clinicShareCents: number;
  dentistShareCents: number;
  notes: string | null;
  issuedAt: Date;
  patient: { fullName: string };
  dentist: { fullName: string } | null;
  lines: Array<{
    id: string;
    treatmentId: string | null;
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    discountReason: string | null;
    commissionPercent: number;
  }>;
  payments: Array<{
    id: string;
    amountCents: number;
    amountBs: Prisma.Decimal;
    exchangeRate: Prisma.Decimal;
    method: 'CASH' | 'CARD' | 'TRANSFER' | 'INSURANCE';
    methodLabel: string | null;
    paidAt: Date | null;
  }>;
}) {
  const paidCents = row.payments.reduce((suma, p) => suma + p.amountCents, 0);

  return {
    id: row.id,
    number: row.number,
    patientId: row.patientId,
    patientName: row.patient.fullName,
    dentistId: row.dentistId,
    dentistName: row.dentist?.fullName ?? null,
    appointmentId: row.appointmentId,
    status: row.status,
    subtotalCents: row.subtotalCents,
    discountCents: row.discountCents,
    totalCents: row.totalCents,
    clinicShareCents: row.clinicShareCents,
    dentistShareCents: row.dentistShareCents,
    paidCents,
    balanceCents: row.totalCents - paidCents,
    notes: row.notes,
    issuedAt: row.issuedAt,
    lines: row.lines.map((l) => ({ ...l, totalCents: totalLinea(l) })),
    payments: row.payments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      amountBs: Number(p.amountBs),
      exchangeRate: Number(p.exchangeRate),
      method: p.method,
      methodLabel: p.methodLabel,
      paidAt: p.paidAt!,
    })),
  };
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

/**
 * Cuándo puede volver el bot a un chat que se acaba de apagar SOLO.
 *
 * Devuelve `null` si la clínica desactivó el regreso automático
 * (`aiAutoResumeHours = 0`): entonces el chat se queda con la IA apagada
 * hasta que una persona la encienda, que es como funcionaba antes.
 */
async function calcularRegresoDelBot(desde: Date): Promise<Date | null> {
  const settings = await prisma.clinicSettings.findUnique({
    where: { id: 'singleton' },
    select: { aiAutoResumeHours: true },
  });

  const horas = settings?.aiAutoResumeHours ?? 4;
  if (horas <= 0) return null;
  return new Date(desde.getTime() + horas * 60 * 60 * 1000);
}

/**
 * El reparto por defecto de la clínica, leído de los ajustes.
 *
 * Se cachea un minuto: lo consultan las tres rutas que calculan comisión y es
 * un valor que cambia dos veces al año. Sin caché, cada línea de cada factura
 * añadiría una consulta a `clinic_settings` para leer el mismo número.
 */
let comisionCache: { valor: number; hasta: number } | null = null;

async function comisionPorDefectoDeLaClinica(): Promise<number> {
  if (comisionCache && comisionCache.hasta > Date.now()) return comisionCache.valor;

  const ajustes = await prisma.clinicSettings.findUnique({
    where: { id: 'singleton' },
    select: { defaultCommissionPercent: true },
  });

  const valor = ajustes?.defaultCommissionPercent ?? 60;
  comisionCache = { valor, hasta: Date.now() + 60_000 };
  return valor;
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

  async getAccountState(userId) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        sessionsValidFrom: true,
        mustChangePassword: true,
        deletedAt: true,
      },
    });
  },

  async resetPasswordAsAdmin({ dentistId, passwordHash, userId }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const dentist = await tx.dentist.findUnique({
          where: { id: dentistId },
          select: { userId: true, fullName: true, email: true },
        });

        if (!dentist?.userId) {
          // Sin cuenta vinculada no hay contraseña que restablecer. Es un caso
          // real: un odontólogo puede existir sin acceso al panel.
          return { ok: false as const, reason: 'NOT_FOUND' as const };
        }

        const user = await tx.user.update({
          where: { id: dentist.userId },
          data: {
            passwordHash,
            passwordChangedAt: new Date(),
            // La clave nueva viaja por correo: no puede quedarse.
            mustChangePassword: true,
            // Cierra sus sesiones. Si se le restablece la clave es porque
            // perdió el control de algo; dejar la sesión abierta no arregla
            // nada.
            sessionsValidFrom: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
          select: { id: true, email: true, fullName: true },
        });

        await tx.auditLog.create({
          data: {
            userId,
            action: 'user.password_reset_by_admin',
            entityType: 'User',
            entityId: user.id,
            // Nunca la clave: sólo a quién y cuándo.
            after: { dentistId, targetEmail: user.email, at: new Date().toISOString() },
          },
        });

        return {
          ok: true as const,
          data: { userId: user.id, email: user.email, fullName: user.fullName },
        };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async createPasswordResetToken({ email, tokenHash, expiresAt, requestedIp }) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, fullName: true, status: true, deletedAt: true },
    });

    // Cuenta inexistente, suspendida o borrada: no se emite nada. El llamador
    // responde igual en todos los casos.
    if (!user || user.deletedAt !== null || user.status !== 'ACTIVE') return null;

    await prisma.$transaction(async (tx) => {
      /*
       * Los enlaces pendientes de esa cuenta se queman. Pedir uno nuevo tiene
       * que dejar sin valor al anterior: si no, cada solicitud sumaría una
       * llave viva más y bastaría con pedir veinte para tener veinte formas de
       * entrar.
       */
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt, requestedIp },
      });
    });

    return { email: user.email, fullName: user.fullName };
  },

  async redeemPasswordResetToken({ tokenHash, passwordHash }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const token = await tx.passwordResetToken.findUnique({
          where: { tokenHash },
          select: { id: true, userId: true, expiresAt: true, usedAt: true },
        });

        // Inexistente, ya usado o caducado: todos son "no vale".
        if (!token || token.usedAt !== null || token.expiresAt < new Date()) {
          return { ok: false as const, reason: 'NOT_FOUND' as const };
        }

        // Se quema ANTES de nada más: dos peticiones simultáneas con el mismo
        // token compiten por este UPDATE y sólo una lo consigue.
        const quemado = await tx.passwordResetToken.updateMany({
          where: { id: token.id, usedAt: null },
          data: { usedAt: new Date() },
        });

        if (quemado.count === 0) {
          return { ok: false as const, reason: 'NOT_FOUND' as const };
        }

        await tx.user.update({
          where: { id: token.userId },
          data: {
            passwordHash,
            passwordChangedAt: new Date(),
            // La puso ella misma: no hay nada que forzar después.
            mustChangePassword: false,
            // Cierra cualquier sesión abierta con la contraseña vieja.
            sessionsValidFrom: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: token.userId,
            action: 'user.password_recovered',
            entityType: 'User',
            entityId: token.userId,
            after: { at: new Date().toISOString() },
          },
        });

        return { ok: true as const, data: { userId: token.userId } };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async changePassword({ userId, passwordHash }) {
    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          // Ya cumplió: si entró con una clave temporal, deja de estar
          // obligado a cambiarla.
          mustChangePassword: false,
          /*
           * Invalida TODAS las sesiones, incluida la que está haciendo el
           * cambio — la del propio navegador se renueva al terminar. Sin
           * esto, quien tuviera la contraseña vieja seguiría dentro con su
           * token todavía válido, que es exactamente de quien se está
           * intentando proteger la cuenta.
           */
          sessionsValidFrom: new Date(),
          // Un cambio de clave también limpia el bloqueo por intentos
          // fallidos: la credencial que se estaba atacando ya no existe.
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
        select: { id: true },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'user.password_changed',
          entityType: 'User',
          entityId: userId,
          // Jamás el hash ni la contraseña: sólo que ocurrió y cuándo.
          after: { changedAt: new Date().toISOString() },
        },
      });

      return { ok: true, data: user };
    } catch (error) {
      return toWriteFailure(error);
    }
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
        // Los dados de baja se excluyen salvo que se pidan: siguen en la
        // tabla porque sus liquidaciones históricas cuelgan de ellos.
        ...(options?.includeDeleted ? {} : { deletedAt: null }),
        ...(options?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { fullName: 'asc' },
    });
  },

  async listStaffBirthdays(month) {
    /*
     * SQL en crudo porque hay que filtrar por MES, y Prisma no sabe expresar
     * `EXTRACT(MONTH FROM ...)` en un `where`. Traerse todo el personal para
     * filtrar en memoria funcionaría hoy con quince personas y sería una
     * tontería en cuanto crezca.
     *
     * El `LEFT JOIN` + `IS NULL` es lo que evita el duplicado: la odontóloga
     * que además tiene cuenta ya salió por la primera mitad de la unión.
     */
    const filas = await prisma.$queryRaw<
      Array<{ id: string; name: string; role: string; day: number }>
    >`
      SELECT d.id, d."fullName" AS name, 'Odontólogo' AS role,
             EXTRACT(DAY FROM d."birthDate")::int AS day
        FROM dentists d
       WHERE d."birthDate" IS NOT NULL
         AND d."deletedAt" IS NULL
         AND EXTRACT(MONTH FROM d."birthDate") = ${month}

      UNION ALL

      SELECT u.id, u."fullName" AS name,
             CASE u.role WHEN 'SUPER_ADMIN' THEN 'Administrador' ELSE 'Asistente' END AS role,
             EXTRACT(DAY FROM u."birthDate")::int AS day
        FROM users u
        LEFT JOIN dentists d2 ON d2."userId" = u.id AND d2."deletedAt" IS NULL
       WHERE u."birthDate" IS NOT NULL
         AND u."deletedAt" IS NULL
         AND u.status = 'ACTIVE'
         AND d2.id IS NULL
         AND EXTRACT(MONTH FROM u."birthDate") = ${month}

       ORDER BY day ASC, name ASC
    `;

    return filas;
  },

  async reactivateDentist({ id, userId }) {
    try {
      const dentist = await prisma.dentist.update({
        where: { id },
        // Se limpia la baja Y se reactiva. El historial no se toca: sigue
        // colgando de esta misma fila, que es justo el motivo de reactivar
        // en vez de crear una ficha nueva.
        data: { isActive: true, deletedAt: null },
        select: { id: true, fullName: true },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'dentist.reactivated',
          entityType: 'Dentist',
          entityId: dentist.id,
          after: { fullName: dentist.fullName },
        },
      });

      return { ok: true, data: { id: dentist.id } };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async findDentistByLicenseOrEmail({ licenseNumber, email }) {
    const dentist = await prisma.dentist.findFirst({
      // Sin filtrar por `deletedAt`: el choque lo provoca precisamente una
      // ficha dada de baja que sigue ocupando el número.
      where: { OR: [{ licenseNumber }, { email }] },
      select: { id: true, fullName: true, isActive: true, deletedAt: true },
    });

    if (!dentist) return null;

    return {
      id: dentist.id,
      fullName: dentist.fullName,
      isActive: dentist.isActive,
      isDeleted: dentist.deletedAt !== null,
    };
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

  async createDentistWithAccount({ dentist, passwordHash }) {
    try {
      return await prisma.$transaction(async (tx) => {
        /*
         * La cuenta primero: si el correo ya está en uso, la transacción se
         * corta aquí y no queda un odontólogo a medio crear.
         *
         * `mustChangePassword` en `true` porque la clave viaja por correo.
         * Hasta que la cambie, el panel no le deja hacer nada más.
         */
        const user = await tx.user.create({
          data: {
            email: dentist.email,
            passwordHash,
            fullName: dentist.fullName,
            role: 'DENTIST',
            status: 'ACTIVE',
            mustChangePassword: true,
          },
          select: { id: true },
        });

        const created = await tx.dentist.create({
          data: { ...dentist, userId: user.id },
          select: { id: true },
        });

        await tx.auditLog.create({
          data: {
            userId: null,
            action: 'dentist.created_with_account',
            entityType: 'Dentist',
            entityId: created.id,
            // Jamás la contraseña ni su hash: sólo que se creó un acceso.
            after: { email: dentist.email, userId: user.id, role: 'DENTIST' },
          },
        });

        return { ok: true as const, data: { id: created.id, userId: user.id } };
      });
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
    const ajustesComision = await comisionPorDefectoDeLaClinica();
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. La cita y su odontólogo. El porcentaje de comisión se lee AHORA
        //    del odontólogo; nunca se acepta del formulario.
        const appointment = await tx.appointment.findUnique({
          where: { id: data.appointmentId },
          include: {
            dentist: { select: { id: true, clinicCommissionPercent: true } },
            treatment: { select: { id: true, clinicKeepsAll: true } },
            // Lista, no uno: una factura puede pagarse en dos partes.
            payments: { where: { status: 'PAID' }, select: { amountCents: true } },
            // Los procedimientos añadidos durante la consulta: cada uno con su
            // propio precio y su propia comisión.
            addons: { select: { priceCents: true, commissionPercent: true } },
          },
        });

        if (!appointment) return { ok: false as const, reason: 'NOT_FOUND' as const };

        /*
         * 2. No se cobra dos veces lo mismo.
         *
         * Antes la regla era «un pago por cita», impuesta por un índice único.
         * Con el pago en dos partes eso ya no vale, así que la regla pasa a
         * ser: si la cita YA tiene algún cobro registrado, el segundo hay que
         * hacerlo desde su factura, que es la que lleva la cuenta del saldo.
         *
         * Sigue protegiendo del doble clic en «Cobrar», que era el motivo
         * original del candado.
         */
        if (appointment.payments.length > 0) {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'appointmentId' };
        }

        // 3. Reparto calculado en el SERVIDOR, línea a línea.
        //
        //    Se reparte cada concepto por separado porque cada uno puede tener
        //    su propia comisión: si a una limpieza (40/60) se le añadió una
        //    radiografía (100 % clínica), aplicar un solo porcentaje al total
        //    le pagaría al odontólogo parte de un trabajo que no hizo.
        //
        //    Ver `domain/pricing.ts` para la cadena de precedencia completa.
        const acuerdo = await tx.dentistTreatment.findUnique({
          where: {
            dentistId_treatmentId: {
              dentistId: appointment.dentist.id,
              treatmentId: appointment.treatment.id,
            },
          },
          select: { customPriceCents: true, customCommissionPercent: true, status: true },
        });

        const comisionPrincipal = calcularComision({
          tratamiento: appointment.treatment,
          // Sólo cuentan los acuerdos APROBADOS: una propuesta pendiente no
          // puede cambiar lo que se cobra.
          acuerdo: acuerdo?.status === 'APPROVED' ? acuerdo : null,
          comisionOdontologo: appointment.dentist.clinicCommissionPercent,
          /*
           * El reparto por defecto sale de los ajustes de la clínica, no de
           * un literal. Estaba clavado en 40 y la clínica pasó a 60/40: un
           * odontólogo sin porcentaje propio habría cobrado el 60 % sin que
           * nadie lo hubiera decidido.
           *
           * Sólo se usa si el odontólogo no tiene el suyo, que no debería
           * pasar; por eso el respaldo es 60 y no 0.
           */
          comisionPorDefecto: ajustesComision ?? 60,
          ajusteManual: data.commissionOverride ?? null,
        }).clinicPercent;

        /*
         * El importe que teclea recepción cubre la cita PRINCIPAL. Los
         * añadidos suman aparte, con su propio precio congelado.
         *
         * Por eso `amountCents` no se reparte entero con un porcentaje: sería
         * mezclar conceptos que se reparten distinto.
         */
        const split = repartirCobro([
          { cents: data.amountCents, clinicPercent: comisionPrincipal },
          ...appointment.addons.map((addon) => ({
            cents: addon.priceCents,
            // El ajuste manual de recepción manda también sobre los añadidos:
            // el 50/50 se pacta sobre la visita entera, no sobre una línea.
            clinicPercent: data.commissionOverride ?? addon.commissionPercent,
          })),
        ]);

        // 4. Snapshot cambiario: importe en Bs y tasa aplicada quedan
        //    congelados. Mañana la tasa cambia; este cobro no.
        // Sobre el TOTAL, añadidos incluidos: es el dinero que de verdad
        // entra en caja.
        const amountBs = Math.round((split.totalCents / 100) * exchangeRate * 100) / 100;

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
              // Un reparto distinto al habitual tiene que poder explicarse
              // después. Sin esto, un 50/50 puntual es indistinguible de un
              // error de cálculo.
              commissionOverride: data.commissionOverride ?? null,
              addonCount: appointment.addons.length,
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
        // La cita es opcional: puede haber venta de mostrador sin cita. Se
        // pone un guion en vez de romper el cierre de caja por un cobro
        // suelto, que es justo cuando más falta hace que la pantalla abra.
        patientName: payment.appointment?.patient.fullName ?? '—',
        dentistName: payment.appointment?.dentist.fullName ?? '—',
        treatmentName: payment.appointment?.treatment.name ?? 'Venta directa',
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

    /*
     * `appointmentId` pasó a ser opcional al desligar el pago de la cita: un
     * cobro de mostrador no tiene cita. Aquí se piden por id, así que no
     * pueden venir nulos, pero se filtran igual para que el tipo lo diga en
     * vez de forzarlo con un `!`.
     */
    return rows
      .map((row) => row.appointmentId)
      .filter((id): id is string => id !== null);
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

    const rows = await prisma.appointment.findMany({
      where: {
        deletedAt: null,
        startsAt: { gte: dayStart, lt: dayEnd },
        status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
        // Ninguno de sus pagos está cobrado. `none` cubre las dos formas de
        // "sin cobrar": que no haya pago, o que lo haya pero esté devuelto o
        // fallido — en ambos casos el dinero no ha entrado.
        payments: { none: { status: 'PAID' } },
      },
      include: APPOINTMENT_RELATIONS,
      orderBy: { startsAt: 'asc' },
    });

    return rows.map(toAppointmentWithRelations);
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
    const row = await prisma.appointment.findFirst({
      where: { id, deletedAt: null },
      include: APPOINTMENT_RELATIONS,
    });

    return row ? toAppointmentWithRelations(row) : null;
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
    const rows = await prisma.appointment.findMany({
      where: {
        deletedAt: null,
        startsAt: { gte: range.from, lte: range.to },
        ...(dentistId ? { dentistId } : {}),
      },
      // `include` con `select` anidado: una sola query con JOINs, sin N+1,
      // y devolviendo únicamente los campos que la UI necesita.
      include: APPOINTMENT_RELATIONS,
      orderBy: { startsAt: 'asc' },
      take: limit,
    });

    return rows.map(toAppointmentWithRelations);
  },

  async addAppointmentAddon({ appointmentId, treatmentId, priceCents, notes, userId }) {
    const ajustesComision = await comisionPorDefectoDeLaClinica();
    try {
      return await prisma.$transaction(async (tx) => {
        // 1. La cita, con lo que hace falta para decidir precio y reparto.
        const appointment = await tx.appointment.findUnique({
          where: { id: appointmentId },
          select: {
            id: true,
            dentistId: true,
            dentist: { select: { clinicCommissionPercent: true } },
            payments: { where: { status: 'PAID' }, select: { id: true } },
          },
        });

        if (!appointment) return { ok: false as const, reason: 'NOT_FOUND' as const };

        /*
         * 2. Una cita cobrada ya no admite líneas nuevas.
         *
         * El cobro congeló el reparto sumando los añadidos que existían en
         * ese momento. Añadir uno después dejaría un pago cuyo importe no
         * coincide con la suma de sus conceptos, y el descuadre no saldría
         * hasta el arqueo.
         */
        if (appointment.payments.length > 0) {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'appointmentId' };
        }

        const treatment = await tx.treatment.findUnique({
          where: { id: treatmentId },
          select: {
            id: true,
            basePriceCents: true,
            isPriceVariable: true,
            clinicKeepsAll: true,
          },
        });

        if (!treatment) return { ok: false as const, reason: 'NOT_FOUND' as const };

        // 3. Acuerdo del odontólogo para ESE tratamiento. Sólo si está
        //    aprobado: una propuesta pendiente no cambia lo que se cobra.
        const acuerdo = await tx.dentistTreatment.findUnique({
          where: {
            dentistId_treatmentId: { dentistId: appointment.dentistId, treatmentId },
          },
          select: { customPriceCents: true, customCommissionPercent: true, status: true },
        });

        const acuerdoAprobado = acuerdo?.status === 'APPROVED' ? acuerdo : null;

        /*
         * 4. Precio y comisión se deciden EN EL SERVIDOR.
         *
         * `priceCents` del formulario sólo puede pisar el precio (recepción
         * pacta el importe con el paciente delante), nunca el reparto. Ver la
         * cadena de precedencia en `domain/pricing.ts`.
         */
        const precio =
          priceCents ?? calcularPrecio(treatment, acuerdoAprobado).priceCents;

        const comision = calcularComision({
          tratamiento: treatment,
          acuerdo: acuerdoAprobado,
          comisionOdontologo: appointment.dentist.clinicCommissionPercent,
          /*
           * El reparto por defecto sale de los ajustes de la clínica, no de
           * un literal. Estaba clavado en 40 y la clínica pasó a 60/40: un
           * odontólogo sin porcentaje propio habría cobrado el 60 % sin que
           * nadie lo hubiera decidido.
           *
           * Sólo se usa si el odontólogo no tiene el suyo, que no debería
           * pasar; por eso el respaldo es 60 y no 0.
           */
          comisionPorDefecto: ajustesComision ?? 60,
        }).clinicPercent;

        const addon = await tx.appointmentAddon.create({
          data: {
            appointmentId,
            treatmentId,
            priceCents: precio,
            commissionPercent: comision,
            notes,
            addedByUserId: userId,
          },
          select: {
            id: true,
            appointmentId: true,
            treatmentId: true,
            priceCents: true,
            commissionPercent: true,
            notes: true,
            createdAt: true,
            treatment: { select: { name: true } },
          },
        });

        // 5. Cambia lo que se le va a cobrar al paciente: deja rastro.
        await tx.auditLog.create({
          data: {
            userId,
            action: 'appointment.addon_added',
            entityType: 'AppointmentAddon',
            entityId: addon.id,
            after: {
              appointmentId,
              treatmentId,
              priceCents: precio,
              commissionPercent: comision,
              // Si el precio lo puso recepción a mano, el motivo tiene que
              // poder reconstruirse después.
              precioManual: priceCents != null,
            },
          },
        });

        return {
          ok: true as const,
          data: {
            id: addon.id,
            appointmentId: addon.appointmentId,
            treatmentId: addon.treatmentId,
            treatmentName: addon.treatment.name,
            priceCents: addon.priceCents,
            commissionPercent: addon.commissionPercent,
            notes: addon.notes,
            createdAt: addon.createdAt,
          },
        };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async listDentistTreatments(params) {
    const rows = await prisma.dentistTreatment.findMany({
      where: {
        ...(params?.dentistId ? { dentistId: params.dentistId } : {}),
        ...(params?.status ? { status: params.status } : {}),
      },
      select: {
        id: true,
        dentistId: true,
        treatmentId: true,
        customPriceCents: true,
        customCommissionPercent: true,
        status: true,
        reviewNotes: true,
        reviewedAt: true,
        createdAt: true,
        dentist: { select: { fullName: true } },
        treatment: { select: { name: true, basePriceCents: true } },
      },
      /*
       * Las pendientes primero: son las únicas que piden una acción. El resto
       * es consulta. `PENDING` < `APPROVED` < `REJECTED` por orden alfabético
       * del enum, que aquí resulta ser justo el orden útil.
       */
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      dentistId: row.dentistId,
      dentistName: row.dentist.fullName,
      treatmentId: row.treatmentId,
      treatmentName: row.treatment.name,
      treatmentBasePriceCents: row.treatment.basePriceCents,
      customPriceCents: row.customPriceCents,
      customCommissionPercent: row.customCommissionPercent,
      status: row.status,
      reviewNotes: row.reviewNotes,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
    }));
  },

  async upsertDentistTreatment({
    dentistId,
    treatmentId,
    customPriceCents,
    customCommissionPercent,
    status,
    userId,
  }) {
    try {
      const agreement = await prisma.dentistTreatment.upsert({
        where: { dentistId_treatmentId: { dentistId, treatmentId } },
        update: {
          customPriceCents,
          customCommissionPercent,
          status,
          proposedByUserId: userId,
          /*
           * Al reproponer se limpia la revisión anterior. Dejar el motivo del
           * rechazo colgando de una propuesta nueva haría creer que ésta
           * también se rechazó.
           */
          reviewedByUserId: status === 'APPROVED' ? userId : null,
          reviewedAt: status === 'APPROVED' ? new Date() : null,
          reviewNotes: null,
        },
        create: {
          dentistId,
          treatmentId,
          customPriceCents,
          customCommissionPercent,
          status,
          proposedByUserId: userId,
          reviewedByUserId: status === 'APPROVED' ? userId : null,
          reviewedAt: status === 'APPROVED' ? new Date() : null,
        },
        select: { id: true },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: status === 'APPROVED' ? 'tariff.set' : 'tariff.proposed',
          entityType: 'DentistTreatment',
          entityId: agreement.id,
          after: { dentistId, treatmentId, customPriceCents, customCommissionPercent, status },
        },
      });

      return { ok: true, data: agreement };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async reviewDentistTreatment({ id, status, reviewNotes, userId }) {
    try {
      const agreement = await prisma.dentistTreatment.update({
        where: { id },
        data: { status, reviewNotes, reviewedByUserId: userId, reviewedAt: new Date() },
        select: { id: true, dentistId: true, treatmentId: true },
      });

      // Aprobar cambia lo que se le cobra al paciente: tiene que dejar rastro
      // de quién lo autorizó.
      await prisma.auditLog.create({
        data: {
          userId,
          action: status === 'APPROVED' ? 'tariff.approved' : 'tariff.rejected',
          entityType: 'DentistTreatment',
          entityId: agreement.id,
          after: {
            dentistId: agreement.dentistId,
            treatmentId: agreement.treatmentId,
            status,
            reviewNotes,
          },
        },
      });

      return { ok: true, data: { id: agreement.id } };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async deleteDentistTreatment({ id, userId }) {
    try {
      const agreement = await prisma.dentistTreatment.delete({
        where: { id },
        select: { id: true, dentistId: true, treatmentId: true },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'tariff.deleted',
          entityType: 'DentistTreatment',
          entityId: agreement.id,
          before: { dentistId: agreement.dentistId, treatmentId: agreement.treatmentId },
        },
      });

      return { ok: true, data: { id: agreement.id } };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  // --- Liquidación diaria --------------------------------------------------

  async getDailySettlements(businessDate) {
    const dayStart = clinicWallClockToInstant(businessDate, 0);
    const dayEnd = clinicWallClockToInstant(businessDate, MINUTES_PER_DAY);

    /*
     * Se separa lo PENDIENTE de lo YA LIQUIDADO con `FILTER`, en una sola
     * pasada. `payoutId IS NULL` es la marca de pendiente: al pagar, los
     * cobros quedan enganchados a un payout y dejan de sumar aquí.
     *
     * Sin esa distinción, un odontólogo al que ya se le pagó volvería a
     * aparecer con la misma deuda cada vez que se abriera la pantalla.
     */
    const rows = await prisma.$queryRaw<
      Array<{
        dentistId: string;
        dentistName: string;
        paymentCount: bigint;
        grossCents: bigint;
        clinicShareCents: bigint;
        dentistShareCents: bigint;
        settledCents: bigint;
      }>
    >`
      SELECT
        d.id         AS "dentistId",
        d."fullName" AS "dentistName",
        COUNT(p.id) FILTER (WHERE p."payoutId" IS NULL)  AS "paymentCount",
        COALESCE(SUM(p."amountCents")       FILTER (WHERE p."payoutId" IS NULL), 0) AS "grossCents",
        COALESCE(SUM(p."clinicShareCents")  FILTER (WHERE p."payoutId" IS NULL), 0) AS "clinicShareCents",
        COALESCE(SUM(p."dentistShareCents") FILTER (WHERE p."payoutId" IS NULL), 0) AS "dentistShareCents",
        COALESCE(SUM(p."dentistShareCents") FILTER (WHERE p."payoutId" IS NOT NULL), 0) AS "settledCents"
      FROM dentists d
      JOIN appointments a ON a."dentistId" = d.id AND a."deletedAt" IS NULL
      JOIN payments p
        ON p."appointmentId" = a.id
       AND p.status = 'PAID'
       AND p."paidAt" >= ${dayStart}
       AND p."paidAt" <  ${dayEnd}
      WHERE d."deletedAt" IS NULL
      GROUP BY d.id, d."fullName"
      ORDER BY "dentistShareCents" DESC
    `;

    return rows.map((row) => ({
      dentistId: row.dentistId,
      dentistName: row.dentistName,
      paymentCount: Number(row.paymentCount),
      grossCents: Number(row.grossCents),
      clinicShareCents: Number(row.clinicShareCents),
      dentistShareCents: Number(row.dentistShareCents),
      settledCents: Number(row.settledCents),
      // Ya liquidado del todo: no queda nada pendiente y sí hay algo pagado.
      isSettled: Number(row.dentistShareCents) === 0 && Number(row.settledCents) > 0,
    }));
  },

  async settleDentistDay({ dentistId, businessDate, userId }) {
    const dayStart = clinicWallClockToInstant(businessDate, 0);
    const dayEnd = clinicWallClockToInstant(businessDate, MINUTES_PER_DAY);

    try {
      return await prisma.$transaction(async (tx) => {
        // Cobros del día de ESE odontólogo que aún no se han liquidado.
        const pendientes = await tx.payment.findMany({
          where: {
            status: 'PAID',
            payoutId: null,
            paidAt: { gte: dayStart, lt: dayEnd },
            appointment: { dentistId, deletedAt: null },
          },
          select: { id: true, dentistShareCents: true },
        });

        if (pendientes.length === 0) {
          // Nada que pagar: o ya se liquidó, o no produjo hoy. No se crea un
          // payout de $0, que sólo ensuciaría el historial.
          return { ok: false as const, reason: 'NOT_FOUND' as const };
        }

        const totalCents = pendientes.reduce(
          (suma, pago) => suma + pago.dentistShareCents,
          0,
        );

        const payout = await tx.dentistPayout.create({
          data: {
            dentistId,
            // El periodo es EL DÍA. El unique (dentistId, inicio, fin) impide
            // pagar dos veces el mismo día al mismo odontólogo.
            periodStart: dayStart,
            periodEnd: dayEnd,
            totalCents,
            status: 'PAID',
            paidAt: new Date(),
            notes: `Liquidación diaria ${businessDate}`,
          },
          select: { id: true },
        });

        /*
         * Enganchar los cobros es lo que hace que esto no se pueda pagar dos
         * veces: a partir de aquí ya no salen como pendientes en
         * `getDailySettlements`. El total del payout y la suma de sus pagos
         * son el mismo número por construcción.
         */
        await tx.payment.updateMany({
          where: { id: { in: pendientes.map((pago) => pago.id) } },
          data: { payoutId: payout.id },
        });

        await tx.auditLog.create({
          data: {
            userId,
            action: 'payout.daily_settled',
            entityType: 'DentistPayout',
            entityId: payout.id,
            after: {
              dentistId,
              businessDate,
              totalCents,
              paymentCount: pendientes.length,
            },
          },
        });

        return { ok: true as const, data: { id: payout.id, totalCents } };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async importTreatmentPrices({ filas, userId, desactivarCodigos }) {
    return prisma.$transaction(async (tx) => {
      /*
       * Se lee el precio ANTERIOR de cada uno, no sólo qué códigos existen:
       * un precio que cambia por Excel tiene que dejar el mismo rastro en el
       * historial que uno cambiado a mano. Si no, el día que alguien pregunte
       * desde cuándo la limpieza cuesta $35 la respuesta sería «no consta»
       * justo en el caso en que cambiaron sesenta precios de una vez.
       */
      const previos = new Map(
        (
          await tx.treatment.findMany({
            where: { code: { in: filas.map((f) => f.code) } },
            select: { id: true, code: true, basePriceCents: true },
            // (nombre, categoría y descripción se comparan en la vista
            // previa; aquí sólo hace falta el precio para el historial)
          })
        ).map((t) => [t.code, t]),
      );

      for (const fila of filas) {
        await tx.treatment.upsert({
          where: { code: fila.code },
          /*
           * Al ACTUALIZAR no se toca `isActive`: si alguien desactivó un
           * tratamiento a mano, reimportar la lista no debe resucitarlo sin
           * que nadie lo haya decidido.
           */
          update: {
            name: fila.name,
            category: fila.category,
            description: fila.description,
            basePriceCents: fila.basePriceCents,
            durationMinutes: fila.durationMinutes,
            bufferMinutes: fila.bufferMinutes,
          },
          create: { ...fila, isActive: true },
        });

        const previo = previos.get(fila.code);
        if (previo && previo.basePriceCents !== fila.basePriceCents) {
          await tx.treatmentPriceHistory.create({
            data: {
              treatmentId: previo.id,
              oldPriceCents: previo.basePriceCents,
              newPriceCents: fila.basePriceCents,
              changedByUserId: userId,
              reason: 'Importación desde Excel',
            },
          });
        }
      }

      const creados = filas.filter((f) => !previos.has(f.code)).length;

      /*
       * Los que ya no están en la lista se apagan, pero NO se borran.
       *
       * `isActive: false` y `deletedAt` intacto: dejan de ofrecerse al
       * agendar y siguen existiendo para las citas, facturas y liquidaciones
       * que los usan. Borrarlos rompería la contabilidad de meses enteros por
       * un cambio de catálogo.
       */
      let desactivados = 0;
      if (desactivarCodigos && desactivarCodigos.length > 0) {
        const resultado = await tx.treatment.updateMany({
          where: { code: { in: desactivarCodigos }, isActive: true, deletedAt: null },
          data: { isActive: false },
        });
        desactivados = resultado.count;
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'treatment.prices_imported',
          entityType: 'Treatment',
          /*
           * `entityId` es obligatorio y aquí no hay UNA entidad: el cambio
           * afecta a toda la lista. Se marca como importación en lote para
           * que al buscar en la auditoría se distinga de un cambio de precio
           * suelto, que sí lleva el id del tratamiento.
           */
          entityId: 'IMPORTACION_LOTE',
          // Un cambio masivo de precios tiene que poder reconstruirse después:
          // se guardan los códigos y los importes aplicados.
          after: {
            total: filas.length,
            creados,
            actualizados: filas.length - creados,
            desactivados,
            desactivadosCodigos: desactivarCodigos ?? [],
            precios: filas.map((f) => ({ code: f.code, cents: f.basePriceCents })),
          },
        },
      });

      return { creados, actualizados: filas.length - creados, desactivados };
    });
  },

  // --- Facturas -------------------------------------------------------------

  async openInvoiceForAppointment({ appointmentId, userId }) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Si ya existe, se devuelve. Regenerarla borraría los descuentos que
        // recepción ya hubiera marcado.
        const existente = await tx.invoice.findFirst({
          where: { appointmentId, status: { not: 'VOID' } },
          select: { id: true },
        });
        if (existente) return { ok: true as const, data: existente };

        const cita = await tx.appointment.findUnique({
          where: { id: appointmentId },
          select: {
            id: true,
            patientId: true,
            dentistId: true,
            agreedPriceCents: true,
            dentist: { select: { clinicCommissionPercent: true } },
            treatment: { select: { id: true, name: true, clinicKeepsAll: true } },
            addons: {
              select: {
                treatmentId: true,
                priceCents: true,
                commissionPercent: true,
                treatment: { select: { name: true } },
              },
            },
          },
        });

        if (!cita) return { ok: false as const, reason: 'NOT_FOUND' as const };

        const factura = await tx.invoice.create({
          data: {
            patientId: cita.patientId,
            dentistId: cita.dentistId,
            appointmentId: cita.id,
            issuedByUserId: userId,
          },
          select: { id: true },
        });

        /*
         * Las líneas salen de la cita: el tratamiento por el que se agendó,
         * más lo que se añadió en consulta. Cada una con SU comisión, que es
         * lo que permite que una radiografía (100 % clínica) conviva con una
         * limpieza (40/60) en el mismo papel.
         */
        await tx.invoiceLine.create({
          data: {
            invoiceId: factura.id,
            treatmentId: cita.treatment.id,
            description: cita.treatment.name,
            quantity: 1,
            unitPriceCents: cita.agreedPriceCents,
            commissionPercent: cita.treatment.clinicKeepsAll
              ? 100
              : cita.dentist.clinicCommissionPercent,
            sortOrder: 0,
          },
        });

        for (const [i, addon] of cita.addons.entries()) {
          await tx.invoiceLine.create({
            data: {
              invoiceId: factura.id,
              treatmentId: addon.treatmentId,
              description: addon.treatment.name,
              quantity: 1,
              unitPriceCents: addon.priceCents,
              commissionPercent: addon.commissionPercent,
              sortOrder: i + 1,
            },
          });
        }

        await recalcularFactura(tx, factura.id);
        return { ok: true as const, data: factura };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async listInvoices(params) {
    const rows = await prisma.invoice.findMany({
      where: {
        ...(params?.status ? { status: params.status } : {}),
        ...(params?.patientId ? { patientId: params.patientId } : {}),
      },
      include: INVOICE_RELATIONS,
      // Las abiertas primero: son las que piden una acción.
      orderBy: [{ status: 'asc' }, { issuedAt: 'desc' }],
      take: params?.limit ?? 100,
    });
    return rows.map(toInvoice);
  },

  async getInvoice(id) {
    const row = await prisma.invoice.findUnique({ where: { id }, include: INVOICE_RELATIONS });
    return row ? toInvoice(row) : null;
  },

  async addInvoiceLine({ invoiceId, treatmentId, description, quantity, unitPriceCents, userId }) {
    const ajustesComision = await comisionPorDefectoDeLaClinica();
    try {
      return await prisma.$transaction(async (tx) => {
        const factura = await tx.invoice.findUnique({
          where: { id: invoiceId },
          select: {
            id: true,
            status: true,
            dentistId: true,
            dentist: { select: { clinicCommissionPercent: true } },
            _count: { select: { lines: true } },
          },
        });

        if (!factura) return { ok: false as const, reason: 'NOT_FOUND' as const };
        // Una factura anulada no se edita: el papel que se entregó ya no vale.
        if (factura.status === 'VOID') {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'status' };
        }

        let descripcion = description ?? '';
        let precio = unitPriceCents ?? 0;
        let comision = factura.dentist?.clinicCommissionPercent ?? 40;

        if (treatmentId) {
          const tratamiento = await tx.treatment.findUnique({
            where: { id: treatmentId },
            select: {
              name: true,
              basePriceCents: true,
              clinicKeepsAll: true,
              isPriceVariable: true,
            },
          });
          if (!tratamiento) return { ok: false as const, reason: 'NOT_FOUND' as const };

          // Acuerdo aprobado con ese odontólogo, si lo hay.
          const acuerdo = factura.dentistId
            ? await tx.dentistTreatment.findUnique({
                where: {
                  dentistId_treatmentId: { dentistId: factura.dentistId, treatmentId },
                },
                select: { customPriceCents: true, customCommissionPercent: true, status: true },
              })
            : null;
          const aprobado = acuerdo?.status === 'APPROVED' ? acuerdo : null;

          descripcion = tratamiento.name;
          // El precio del formulario sólo pisa el importe, nunca el reparto.
          precio = unitPriceCents ?? calcularPrecio(tratamiento, aprobado).priceCents;
          comision = calcularComision({
            tratamiento,
            acuerdo: aprobado,
            comisionOdontologo: factura.dentist?.clinicCommissionPercent ?? null,
            /*
           * El reparto por defecto sale de los ajustes de la clínica, no de
           * un literal. Estaba clavado en 40 y la clínica pasó a 60/40: un
           * odontólogo sin porcentaje propio habría cobrado el 60 % sin que
           * nadie lo hubiera decidido.
           *
           * Sólo se usa si el odontólogo no tiene el suyo, que no debería
           * pasar; por eso el respaldo es 60 y no 0.
           */
          comisionPorDefecto: ajustesComision ?? 60,
          }).clinicPercent;
        }

        if (!descripcion.trim()) {
          return { ok: false as const, reason: 'NOT_FOUND' as const };
        }

        const linea = await tx.invoiceLine.create({
          data: {
            invoiceId,
            treatmentId,
            description: descripcion,
            quantity,
            unitPriceCents: precio,
            commissionPercent: comision,
            sortOrder: factura._count.lines,
          },
          select: { id: true },
        });

        await recalcularFactura(tx, invoiceId);

        await tx.auditLog.create({
          data: {
            userId,
            action: 'invoice.line_added',
            entityType: 'Invoice',
            entityId: invoiceId,
            after: { description: descripcion, unitPriceCents: precio, quantity },
          },
        });

        return { ok: true as const, data: linea };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async updateInvoiceLine({ id, quantity, unitPriceCents, discountCents, discountReason, userId }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const linea = await tx.invoiceLine.findUnique({
          where: { id },
          select: { invoiceId: true, invoice: { select: { status: true } } },
        });

        if (!linea) return { ok: false as const, reason: 'NOT_FOUND' as const };
        if (linea.invoice.status === 'VOID') {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'status' };
        }

        await tx.invoiceLine.update({
          where: { id },
          data: { quantity, unitPriceCents, discountCents, discountReason },
        });

        await recalcularFactura(tx, linea.invoiceId);

        // El descuento deja rastro: a fin de mes hay que poder decir qué se
        // regaló y a cambio de qué.
        if (discountCents > 0) {
          await tx.auditLog.create({
            data: {
              userId,
              action: 'invoice.discount_applied',
              entityType: 'Invoice',
              entityId: linea.invoiceId,
              after: { lineId: id, discountCents, discountReason },
            },
          });
        }

        return { ok: true as const, data: { id } };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async removeInvoiceLine({ id, userId }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const linea = await tx.invoiceLine.findUnique({
          where: { id },
          select: { invoiceId: true, description: true, invoice: { select: { status: true } } },
        });

        if (!linea) return { ok: false as const, reason: 'NOT_FOUND' as const };
        if (linea.invoice.status === 'VOID') {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'status' };
        }

        await tx.invoiceLine.delete({ where: { id } });
        await recalcularFactura(tx, linea.invoiceId);

        await tx.auditLog.create({
          data: {
            userId,
            action: 'invoice.line_removed',
            entityType: 'Invoice',
            entityId: linea.invoiceId,
            before: { description: linea.description },
          },
        });

        return { ok: true as const, data: { id } };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async registerInvoicePayment({
    invoiceId,
    amountCents,
    method,
    methodLabel,
    externalReference,
    exchangeRate,
    exchangeRateSource,
    userId,
  }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const factura = await tx.invoice.findUnique({
          where: { id: invoiceId },
          select: {
            id: true,
            appointmentId: true,
            status: true,
            totalCents: true,
            clinicShareCents: true,
            payments: {
              where: { status: 'PAID' },
              select: { amountCents: true, clinicShareCents: true },
            },
          },
        });

        if (!factura) return { ok: false as const, reason: 'NOT_FOUND' as const };
        if (factura.status === 'VOID') {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'status' };
        }

        const yaCobrado = factura.payments.reduce((s, p) => s + p.amountCents, 0);
        const saldo = factura.totalCents - yaCobrado;

        /*
         * No se cobra de más. Sin esto, dos clics seguidos en «Cobrar»
         * meterían el importe dos veces y la caja del día cuadraría con un
         * dinero que nadie entregó.
         */
        if (saldo <= 0) {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'invoiceId' };
        }
        if (amountCents > saldo) {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'amountCents' };
        }

        const reparto = repartirPago({
          amountCents,
          totalCents: factura.totalCents,
          clinicShareCents: factura.clinicShareCents,
          yaCobradoCents: yaCobrado,
          yaAsignadoClinicaCents: factura.payments.reduce((s, p) => s + p.clinicShareCents, 0),
        });

        const amountBs = Math.round((amountCents / 100) * exchangeRate * 100) / 100;

        const pago = await tx.payment.create({
          data: {
            invoiceId,
            // Se conserva el vínculo con la cita: los informes que agrupan
            // por odontólogo siguen pasando por ahí.
            appointmentId: factura.appointmentId,
            amountCents,
            exchangeRate,
            amountBs,
            exchangeRateSource,
            commissionPercentApplied:
              factura.totalCents === 0
                ? 0
                : Math.round((factura.clinicShareCents / factura.totalCents) * 100),
            clinicShareCents: reparto.clinicShareCents,
            dentistShareCents: reparto.dentistShareCents,
            method,
            methodLabel,
            status: 'PAID',
            paidAt: new Date(),
            externalReference,
          },
          select: { id: true },
        });

        await recalcularFactura(tx, invoiceId);

        // Cobrada del todo implica cita atendida.
        const nuevoSaldo = saldo - amountCents;
        if (nuevoSaldo === 0 && factura.appointmentId) {
          await tx.appointment.update({
            where: { id: factura.appointmentId },
            data: { status: 'COMPLETED' },
          });
        }

        await tx.auditLog.create({
          data: {
            userId,
            action: 'invoice.payment_registered',
            entityType: 'Invoice',
            entityId: invoiceId,
            after: {
              paymentId: pago.id,
              amountCents,
              amountBs,
              exchangeRate,
              saldoRestante: nuevoSaldo,
              // Un pago parcial hay que poder distinguirlo después de uno
              // completo que se quedó corto por error.
              esParcial: nuevoSaldo > 0,
            },
          },
        });

        return { ok: true as const, data: { id: pago.id, balanceCents: nuevoSaldo } };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async voidInvoice({ id, reason, userId }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const factura = await tx.invoice.findUnique({
          where: { id },
          select: { id: true, payments: { where: { status: 'PAID' }, select: { id: true } } },
        });

        if (!factura) return { ok: false as const, reason: 'NOT_FOUND' as const };

        /*
         * Una factura con dinero cobrado NO se anula desde aquí.
         *
         * Anularla dejaría cobros huérfanos apuntando a un documento sin
         * validez, y el arqueo del día seguiría contando ese dinero. Para
         * deshacer un cobro hace falta una devolución, que es otra operación
         * y deja su propio rastro.
         */
        if (factura.payments.length > 0) {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'payments' };
        }

        await tx.invoice.update({
          where: { id },
          data: { status: 'VOID', voidedAt: new Date(), voidReason: reason },
        });

        await tx.auditLog.create({
          data: {
            userId,
            action: 'invoice.voided',
            entityType: 'Invoice',
            entityId: id,
            after: { reason },
          },
        });

        return { ok: true as const, data: { id } };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  // --- Documentos escaneados del paciente ----------------------------------

  // --- Adjuntos de WhatsApp ---------------------------------------------------

  async attachOutboundMedia({ messageId, fileName, mimeType, content, userId }) {
    try {
      /*
       * Se marca también `mediaType` en el mensaje.
       *
       * Es lo que mira el monitor para decidir si pinta una foto, un
       * reproductor o un enlace. Sin esto habría que consultar la tabla de
       * adjuntos en cada burbuja para saber qué es.
       */
      await prisma.whatsAppMessage.update({
        where: { id: messageId },
        data: { mediaType: mimeType },
      });

      const creado = await prisma.whatsAppAttachment.create({
        data: {
          messageId,
          fileName,
          mimeType,
          sizeBytes: content.byteLength,
          content: new Uint8Array(content),
          uploadedByUserId: userId,
        },
        select: { id: true },
      });
      return { ok: true, data: creado };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async getOutboundMedia({ mediaId, messageId }) {
    if (!mediaId && !messageId) return null;

    const fila = await prisma.whatsAppAttachment.findFirst({
      where: mediaId ? { id: mediaId } : { messageId },
      select: {
        id: true,
        messageId: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        content: true,
        message: { select: { direction: true } },
      },
    });
    if (!fila) return null;

    return {
      id: fila.id,
      messageId: fila.messageId,
      fileName: fila.fileName,
      mimeType: fila.mimeType,
      sizeBytes: fila.sizeBytes,
      content: Buffer.from(fila.content),
      direction: fila.message.direction,
    };
  },

  // --- Cuentas del panel ------------------------------------------------------

  async listStaffUsers() {
    const filas = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        phoneE164: true,
        birthDate: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        dentist: { select: { id: true, fullName: true } },
        // `passwordHash` NO se selecciona. No se oculta en la pantalla: no se
        // consulta. Un hash que nunca sale de la base no se puede filtrar.
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });

    return filas.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      status: u.status,
      phoneE164: u.phoneE164,
      birthDate: u.birthDate,
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt,
      dentistId: u.dentist?.id ?? null,
      dentistName: u.dentist?.fullName ?? null,
      createdAt: u.createdAt,
    }));
  },

  async createStaffUser({
    email,
    fullName,
    role,
    phoneE164,
    birthDate,
    passwordHash,
    dentistId,
    createdByUserId,
  }) {
    try {
      const creado = await prisma.$transaction(async (tx) => {
        const usuario = await tx.user.create({
          data: {
            email,
            fullName,
            role,
            phoneE164,
            birthDate,
            passwordHash,
            /*
             * Obligado a cambiarla al entrar: la clave temporal viajó por
             * correo, así que la ha visto un tercero y no puede quedarse.
             */
            mustChangePassword: true,
          },
          select: { id: true },
        });

        // Enlaza la cuenta a una ficha de odontólogo existente, si se pidió.
        if (dentistId) {
          await tx.dentist.update({ where: { id: dentistId }, data: { userId: usuario.id } });
        }

        await tx.auditLog.create({
          data: {
            userId: createdByUserId,
            action: 'user.created',
            entityType: 'User',
            entityId: usuario.id,
            after: { email, role, dentistId },
          },
        });

        return usuario;
      });

      return { ok: true, data: creado };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async updateStaffUser({ id, fullName, role, phoneE164, birthDate, userId }) {
    try {
      const antes = await prisma.user.findUnique({
        where: { id },
        select: { role: true, email: true },
      });
      if (!antes) return { ok: false, reason: 'NOT_FOUND' };

      const roleChanged = antes.role !== role;

      const actualizado = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id },
          data: {
            fullName,
            role,
            phoneE164,
            birthDate,
            /*
             * CAMBIAR EL ROL CIERRA SUS SESIONES.
             *
             * El rol viaja dentro del token de sesión. Sin esto, a quien se
             * le quita el rol de administrador seguiría entrando como
             * administrador hasta que su token caducara — es decir, se le
             * habría quitado el acceso sólo en la pantalla.
             */
            ...(roleChanged ? { sessionsValidFrom: new Date() } : {}),
          },
          select: { id: true },
        });

        await tx.auditLog.create({
          data: {
            userId,
            action: 'user.updated',
            entityType: 'User',
            entityId: id,
            before: { role: antes.role },
            after: { role, fullName },
          },
        });

        return u;
      });

      return { ok: true, data: { id: actualizado.id, roleChanged } };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async setStaffUserStatus({ id, status, userId }) {
    try {
      await prisma.$transaction([
        prisma.user.update({
          where: { id },
          data: {
            status,
            // Suspender cierra lo que tenga abierto; reactivar no necesita
            // tocarlo, pero se hace igual para no dejar tokens de antes de la
            // suspensión dando vueltas.
            sessionsValidFrom: new Date(),
          },
        }),
        prisma.auditLog.create({
          data: {
            userId,
            action: status === 'SUSPENDED' ? 'user.suspended' : 'user.reactivated',
            entityType: 'User',
            entityId: id,
            after: { status },
          },
        }),
      ]);
      return { ok: true, data: null };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async resetStaffUserPassword({ id, passwordHash, userId }) {
    try {
      const actualizado = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id },
          data: {
            passwordHash,
            mustChangePassword: true,
            passwordChangedAt: new Date(),
            // La clave vieja deja de valer en todas partes al instante.
            sessionsValidFrom: new Date(),
            // Un restablecimiento también levanta el bloqueo por intentos
            // fallidos: si no, la clave nueva tampoco entraría.
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
          select: { email: true, fullName: true, role: true },
        });

        await tx.auditLog.create({
          data: {
            userId,
            action: 'user.password_reset',
            entityType: 'User',
            entityId: id,
          },
        });

        return u;
      });

      return { ok: true, data: actualizado };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async countActiveAdmins() {
    return prisma.user.count({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE', deletedAt: null },
    });
  },

  // --- Promociones -----------------------------------------------------------

  async listPromotions(options) {
    const ahora = new Date();
    return prisma.promotion.findMany({
      where: {
        deletedAt: null,
        ...(options?.soloVigentes
          ? {
              isActive: true,
              /*
               * Vigencia con extremos abiertos: sin fecha de inicio vale
               * desde siempre, y sin fecha de fin vale hasta que alguien la
               * apague. Es como las escribe la clínica —«esta la dejamos
               * puesta»— y forzar dos fechas obligaría a inventarse una.
               */
              AND: [
                { OR: [{ startsAt: null }, { startsAt: { lte: ahora } }] },
                { OR: [{ endsAt: null }, { endsAt: { gte: ahora } }] },
              ],
            }
          : {}),
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  },

  async createPromotion(data, userId) {
    try {
      return {
        ok: true,
        data: await prisma.promotion.create({ data: { ...data, createdByUserId: userId } }),
      };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async updatePromotion(id, data) {
    try {
      return { ok: true, data: await prisma.promotion.update({ where: { id }, data }) };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async deletePromotion(id) {
    try {
      // Se marca como borrada: una promoción que se anunció por WhatsApp
      // tiene que poder consultarse después aunque ya no se ofrezca.
      await prisma.promotion.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      return { ok: true, data: null };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  // --- Recetarios ------------------------------------------------------------

  async listPrescriptionTemplates({ dentistId, includeClinic = true }) {
    const filas = await prisma.prescriptionTemplate.findMany({
      where: {
        deletedAt: null,
        /*
         * Una odontóloga ve los suyos y los de la clínica, nunca los de otra.
         * El membrete, el número de colegio y la firma de una compañera no
         * son cosa suya, y aquí eso se resuelve en la consulta, no ocultando
         * filas en la pantalla.
         */
        ...(dentistId === undefined
          ? {}
          : includeClinic
            ? { OR: [{ dentistId }, { dentistId: null }] }
            : { dentistId }),
      },
      select: {
        id: true,
        dentistId: true,
        name: true,
        widthPx: true,
        heightPx: true,
        elements: true,
        updatedAt: true,
        dentist: { select: { fullName: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });

    return filas.map((f) => ({
      id: f.id,
      dentistId: f.dentistId,
      dentistName: f.dentist?.fullName ?? null,
      name: f.name,
      widthPx: f.widthPx,
      heightPx: f.heightPx,
      elementCount: Array.isArray(f.elements) ? f.elements.length : 0,
      updatedAt: f.updatedAt,
    }));
  },

  async getPrescriptionTemplate(id) {
    const f = await prisma.prescriptionTemplate.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        dentistId: true,
        name: true,
        widthPx: true,
        heightPx: true,
        elements: true,
        updatedAt: true,
        dentist: { select: { fullName: true } },
      },
    });
    if (!f) return null;

    return {
      id: f.id,
      dentistId: f.dentistId,
      dentistName: f.dentist?.fullName ?? null,
      name: f.name,
      widthPx: f.widthPx,
      heightPx: f.heightPx,
      elementCount: Array.isArray(f.elements) ? f.elements.length : 0,
      elements: f.elements,
      updatedAt: f.updatedAt,
    };
  },

  async createPrescriptionTemplate({ dentistId, name, widthPx, heightPx, userId }) {
    try {
      const creado = await prisma.prescriptionTemplate.create({
        data: { dentistId, name, widthPx, heightPx, createdByUserId: userId, elements: [] },
        select: { id: true },
      });
      return { ok: true, data: creado };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async savePrescriptionTemplate({ id, name, widthPx, heightPx, elements, userId }) {
    try {
      const actualizado = await prisma.prescriptionTemplate.update({
        where: { id },
        data: {
          name,
          widthPx,
          heightPx,
          // Ya viene validado por `prescriptionElementsSchema` en la acción:
          // aquí no se vuelve a mirar porque el tipo de la columna es JSON.
          elements: elements as never,
          createdByUserId: undefined,
        },
        select: { id: true },
      });
      void userId;
      return { ok: true, data: actualizado };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async deletePrescriptionTemplate({ id, userId }) {
    try {
      await prisma.$transaction([
        // Se marca como borrado, no se borra: una odontóloga que se equivoca
        // de botón perdería el diseño que montó pieza a pieza.
        prisma.prescriptionTemplate.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            userId,
            action: 'prescription_template.deleted',
            entityType: 'PrescriptionTemplate',
            entityId: id,
          },
        }),
      ]);
      return { ok: true, data: null };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async addPrescriptionAsset({
    templateId,
    fileName,
    mimeType,
    widthPx,
    heightPx,
    content,
    userId,
  }) {
    try {
      const creado = await prisma.prescriptionAsset.create({
        data: {
          templateId,
          fileName,
          mimeType,
          sizeBytes: content.byteLength,
          widthPx,
          heightPx,
          // Prisma pide `Uint8Array`; `Buffer` ya lo es, pero el tipo de Node
          // lo declara sobre `ArrayBufferLike` y no encaja sin esta vuelta.
          content: new Uint8Array(content),
          uploadedByUserId: userId,
        },
        select: { id: true, widthPx: true, heightPx: true },
      });
      return { ok: true, data: creado };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async getPrescriptionAsset(id) {
    const asset = await prisma.prescriptionAsset.findUnique({
      where: { id },
      select: { mimeType: true, content: true, templateId: true },
    });
    if (!asset) return null;
    return {
      mimeType: asset.mimeType,
      content: Buffer.from(asset.content),
      templateId: asset.templateId,
    };
  },

  async listPatientDocuments(patientId) {
    return prisma.patientDocument.findMany({
      where: { patientId, deletedAt: null },
      // `content` NO se selecciona: un paciente con diez escaneos mandaría
      // varios MB al navegador sólo por abrir su ficha.
      select: {
        id: true,
        patientId: true,
        kind: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        notes: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getPatientDocumentFile(id) {
    const doc = await prisma.patientDocument.findFirst({
      where: { id, deletedAt: null },
      select: { fileName: true, mimeType: true, content: true },
    });
    return doc;
  },

  async savePatientDocument({ patientId, kind, fileName, mimeType, content, notes, userId }) {
    try {
      const doc = await prisma.patientDocument.create({
        data: {
          patientId,
          kind,
          fileName,
          mimeType,
          sizeBytes: content.byteLength,
          content: Buffer.from(content),
          notes,
          uploadedByUserId: userId,
        },
        select: { id: true },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'patient_document.uploaded',
          entityType: 'PatientDocument',
          entityId: doc.id,
          // Ni rastro del contenido: es material clínico y el log se copia.
          after: { patientId, kind, fileName, sizeBytes: content.byteLength },
        },
      });

      return { ok: true, data: doc };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async deletePatientDocument({ id, userId }) {
    try {
      await prisma.patientDocument.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'patient_document.deleted',
          entityType: 'PatientDocument',
          entityId: id,
        },
      });

      return { ok: true, data: { id } };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  // --- Instrumental --------------------------------------------------------

  async listInstruments(params) {
    return prisma.dentistInstrument.findMany({
      where: {
        deletedAt: null,
        ...(params?.dentistId ? { dentistId: params.dentistId } : {}),
      },
      select: {
        id: true,
        dentistId: true,
        name: true,
        category: true,
        quantity: true,
        serialNumber: true,
        condition: true,
        location: true,
        notes: true,
        lastServicedOn: true,
      },
      // Lo que necesita atención primero: perdido y fuera de servicio arriba.
      // `GOOD` es el último valor del enum, así que `desc` lo manda al final.
      orderBy: [{ condition: 'desc' }, { name: 'asc' }],
    });
  },

  async saveInstrument({ id, dentistId, data, userId }) {
    try {
      if (id) {
        /*
         * `updateMany` con el `dentistId` en el WHERE, no `update` por id.
         *
         * Así la comprobación de propiedad la hace Postgres en la misma
         * sentencia: si el id existe pero es de otro odontólogo, no se
         * actualiza ninguna fila y se devuelve NOT_FOUND. Con `update` por id
         * habría que leer primero y comparar, y entre la lectura y la
         * escritura cabe una carrera.
         */
        const result = await prisma.dentistInstrument.updateMany({
          where: { id, dentistId, deletedAt: null },
          data,
        });

        if (result.count === 0) return { ok: false, reason: 'NOT_FOUND' };
        return { ok: true, data: { id } };
      }

      const created = await prisma.dentistInstrument.create({
        data: { ...data, dentistId },
        select: { id: true },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'instrument.created',
          entityType: 'DentistInstrument',
          entityId: created.id,
          after: { dentistId, name: data.name, quantity: data.quantity },
        },
      });

      return { ok: true, data: created };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async deleteInstrument({ id, userId }) {
    try {
      // Borrado lógico: saber quién tenía qué sigue importando después de
      // quitarlo de la lista.
      await prisma.dentistInstrument.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'instrument.deleted',
          entityType: 'DentistInstrument',
          entityId: id,
        },
      });

      return { ok: true, data: { id } };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  // --- Horarios ------------------------------------------------------------

  async listSchedule(dentistId, weekStart) {
    /*
     * Si se pregunta por una SEMANA, primero se mira si tiene excepción.
     *
     * Que no haya filas ES la respuesta —esa semana es normal— así que no
     * hace falta ninguna marca que decir «aquí no hay cambio». Y como la
     * excepción vive en su propia tabla, pasada la semana se vuelve solo al
     * base sin que nadie deshaga nada.
     */
    if (weekStart) {
      const excepcion = await prisma.dentistScheduleOverride.findMany({
        where: { dentistId, weekStart: new Date(`${weekStart}T00:00:00Z`) },
        select: { weekday: true, startMinute: true, endMinute: true },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      });

      if (excepcion.length > 0) return excepcion;
    }

    return prisma.dentistSchedule.findMany({
      where: { dentistId, isActive: true },
      select: { weekday: true, startMinute: true, endMinute: true },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
  },

  async setBaseSchedule({ dentistId, blocks, userId }) {
    try {
      await prisma.$transaction(async (tx) => {
        // Se reemplaza la semana entera: es lo que se está editando, y un
        // merge dejaría bloques viejos que nadie quiso conservar.
        await tx.dentistSchedule.deleteMany({ where: { dentistId } });

        if (blocks.length > 0) {
          await tx.dentistSchedule.createMany({
            data: blocks.map((block) => ({
              dentistId,
              weekday: block.weekday,
              startMinute: block.startMinute,
              endMinute: block.endMinute,
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            userId,
            action: 'schedule.base_set',
            entityType: 'Dentist',
            entityId: dentistId,
            after: { blocks: blocks.length },
          },
        });
      });

      return { ok: true, data: { id: dentistId } };
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async listScheduleRequests(params) {
    const rows = await prisma.scheduleChangeRequest.findMany({
      where: {
        ...(params?.dentistId ? { dentistId: params.dentistId } : {}),
        ...(params?.status ? { status: params.status } : {}),
      },
      select: {
        id: true,
        dentistId: true,
        weekStart: true,
        proposedBlocks: true,
        reason: true,
        status: true,
        reviewNotes: true,
        reviewedAt: true,
        createdAt: true,
        dentist: {
          select: {
            fullName: true,
            // El horario vigente viaja con la solicitud: quien decide tiene
            // que poder comparar, y pedirlo aparte sería una consulta por fila.
            schedules: {
              where: { isActive: true },
              select: { weekday: true, startMinute: true, endMinute: true },
              orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
            },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      dentistId: row.dentistId,
      dentistName: row.dentist.fullName,
      weekStart: row.weekStart.toISOString().slice(0, 10),
      proposedBlocks: row.proposedBlocks as unknown as ScheduleBlock[],
      // El horario que regiría esa semana sin este cambio. Hoy es el base;
      // si algún día se permite encadenar excepciones, este es el punto a
      // cambiar.
      currentBlocks: row.dentist.schedules,
      reason: row.reason,
      status: row.status,
      reviewNotes: row.reviewNotes,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
    }));
  },

  async createScheduleRequest({ dentistId, weekStart, proposedBlocks, reason, userId }) {
    try {
      const created = await prisma.scheduleChangeRequest.create({
        data: {
          dentistId,
          weekStart: new Date(`${weekStart}T00:00:00Z`),
          proposedBlocks: proposedBlocks as unknown as Prisma.InputJsonValue,
          reason,
          requestedByUserId: userId,
        },
        select: { id: true },
      });

      return { ok: true, data: created };
    } catch (error) {
      /*
       * El índice único parcial `one_pending_per_dentist` salta si ya hay una
       * esperando. `toWriteFailure` lo traduce a DUPLICATE y la acción le
       * pone el mensaje que describe lo que pasó de verdad.
       */
      return toWriteFailure(error);
    }
  },

  async reviewScheduleRequest({ id, status, reviewNotes, userId }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const request = await tx.scheduleChangeRequest.findUnique({
          where: { id },
          select: {
            id: true,
            dentistId: true,
            weekStart: true,
            proposedBlocks: true,
            status: true,
          },
        });

        if (!request) return { ok: false as const, reason: 'NOT_FOUND' as const };

        // Revisar dos veces la misma solicitud reaplicaría un horario ya
        // sustituido, pisando cambios posteriores.
        if (request.status !== 'PENDING') {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'status' };
        }

        await tx.scheduleChangeRequest.update({
          where: { id },
          data: { status, reviewNotes, reviewedByUserId: userId, reviewedAt: new Date() },
        });

        /*
         * Aprobar APLICA el horario, en la misma transacción.
         *
         * Separar las dos cosas dejaría al odontólogo con una solicitud
         * aprobada y el bot ofreciendo todavía las horas viejas — y nadie
         * mirando la pantalla podría notar la diferencia.
         *
         * Se reemplaza la semana entera porque eso es lo que se propuso: un
         * merge dejaría bloques del horario anterior que él quiso quitar.
         */
        if (status === 'APPROVED') {
          const blocks = request.proposedBlocks as unknown as ScheduleBlock[];

          /*
           * El horario base NO SE TOCA.
           *
           * Los bloques aprobados se guardan como la excepción de ESA semana.
           * La versión anterior sustituía `dentist_schedules`, así que un
           * «esta semana entro a las 10» quedaba para siempre y había que
           * acordarse de deshacerlo — que es justo lo que nadie hace.
           *
           * Pasada la semana, no hay nada que revertir: al no existir filas
           * para la siguiente, vuelve a regir el base solo.
           */
          await tx.dentistScheduleOverride.deleteMany({
            where: { dentistId: request.dentistId, weekStart: request.weekStart },
          });

          if (blocks.length > 0) {
            await tx.dentistScheduleOverride.createMany({
              data: blocks.map((block) => ({
                dentistId: request.dentistId,
                weekStart: request.weekStart,
                weekday: block.weekday,
                startMinute: block.startMinute,
                endMinute: block.endMinute,
                requestId: request.id,
              })),
            });
          }
        }

        await tx.auditLog.create({
          data: {
            userId,
            action: status === 'APPROVED' ? 'schedule.approved' : 'schedule.rejected',
            entityType: 'ScheduleChangeRequest',
            entityId: id,
            after: { dentistId: request.dentistId, status, reviewNotes },
          },
        });

        return { ok: true as const, data: { id } };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
  },

  async removeAppointmentAddon({ id, userId }) {
    try {
      return await prisma.$transaction(async (tx) => {
        const addon = await tx.appointmentAddon.findUnique({
          where: { id },
          select: {
            id: true,
            appointmentId: true,
            priceCents: true,
            appointment: {
              select: { payments: { where: { status: 'PAID' }, select: { id: true } } },
            },
          },
        });

        if (!addon) return { ok: false as const, reason: 'NOT_FOUND' as const };

        // Mismo motivo que al añadir: el cobro ya congeló este importe.
        if ((addon.appointment?.payments.length ?? 0) > 0) {
          return { ok: false as const, reason: 'DUPLICATE' as const, field: 'appointmentId' };
        }

        await tx.appointmentAddon.delete({ where: { id } });

        await tx.auditLog.create({
          data: {
            userId,
            action: 'appointment.addon_removed',
            entityType: 'AppointmentAddon',
            entityId: id,
            before: { appointmentId: addon.appointmentId, priceCents: addon.priceCents },
          },
        });

        return { ok: true as const, data: { id } };
      });
    } catch (error) {
      return toWriteFailure(error);
    }
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
        // Sin `phoneE164`: el teléfono del paciente no es asunto del
        // odontólogo. Ver el comentario de `DentistAgendaItem`.
        patient: { select: { fullName: true } },
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
        aiAutoResumeAt: conversation.aiAutoResumeAt,
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
    const filas = await prisma.whatsAppMessage.findMany({
      where: { conversationId },
      // Sólo el id del adjunto: los bytes se piden aparte cuando hay que
      // pintarlos. Traerlos aquí cargaría cada foto enviada en cada apertura
      // del hilo.
      include: { attachment: { select: { id: true } } },
      orderBy: { sentAt: 'asc' },
      // Techo defensivo: un hilo de un año no debe tumbar el navegador.
      // La paginación hacia atrás es la evolución natural.
      take: 200,
    });

    return filas.map((m) => ({ ...m, attachmentId: m.attachment?.id ?? null }));
  },

  async createOutboundMessage({ conversationId, body, userId }) {
    try {
      // Se calcula ANTES de la transacción: es una lectura de configuración
      // que no debe alargar el bloqueo sobre la conversación.
      const regreso = await calcularRegresoDelBot(new Date());

      const result = await prisma.$transaction(async (tx) => {
        const conversation = await tx.whatsAppConversation.findUnique({
          where: { id: conversationId },
          select: { id: true, phoneE164: true, aiEnabled: true, aiAutoResumeAt: true },
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
            /*
             * Y cuándo vuelve solo.
             *
             * Se refresca en CADA mensaje del agente, no sólo en el primero:
             * así la cuenta atrás corre desde la última vez que habló un
             * humano y el bot no se mete en mitad de una conversación que
             * alguien sigue atendiendo.
             *
             * Sólo aplica a los chats que se apagaron solos: si `aiEnabled`
             * ya era false por decisión de una persona, ese chat no tiene
             * fecha de regreso y aquí tampoco se le pone.
             */
            ...(conversation.aiEnabled || conversation.aiAutoResumeAt
              ? { aiAutoResumeAt: regreso }
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
        /*
         * Decisión humana: sin fecha de regreso, en los dos sentidos.
         *
         * Si una persona APAGA la IA a mano, el bot no debe reaparecer solo
         * cuatro horas después contradiciendo lo que decidió. Y si la
         * ENCIENDE, la cuenta atrás que hubiera sobra.
         */
        aiAutoResumeAt: null,
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
      aiAutoResumeAt: updated.aiAutoResumeAt,
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
      /*
       * ---------------------------------------------------------------
       *  AQUÍ VUELVE EL BOT
       * ---------------------------------------------------------------
       *  Esta función es lo primero que consulta la automatización con cada
       *  mensaje entrante, así que es el sitio natural para resolverlo: si
       *  el chat lleva callado el tiempo acordado, la IA se enciende en ese
       *  mismo instante y el mensaje que acaba de llegar ya se atiende.
       *
       *  Se hace aquí y no con una tarea programada a propósito: una tarea
       *  cada cinco minutos encendería chats que nadie va a mirar, y habría
       *  que montarla y vigilarla. Esto no necesita infraestructura y ocurre
       *  justo cuando importa — cuando el paciente vuelve a escribir.
       */
      const ahora = new Date();
      if (
        !existing.aiEnabled &&
        existing.aiAutoResumeAt !== null &&
        existing.aiAutoResumeAt <= ahora
      ) {
        const [reactivada] = await prisma.$transaction([
          prisma.whatsAppConversation.update({
            where: { id: existing.id },
            data: {
              aiEnabled: true,
              aiAutoResumeAt: null,
              aiDisabledReason: null,
              aiToggledAt: ahora,
              // Nadie la encendió: la encendió el propio silencio del chat.
              aiToggledByUserId: null,
              needsHumanAttention: false,
            },
            include: { patient: { select: { id: true, fullName: true } } },
          }),
          prisma.auditLog.create({
            data: {
              userId: null,
              action: 'whatsapp.ai_auto_resumed',
              entityType: 'WhatsAppConversation',
              entityId: existing.id,
              before: {
                aiEnabled: false,
                aiDisabledReason: existing.aiDisabledReason,
              },
              after: {
                aiEnabled: true,
                motivo: 'El chat quedó en silencio el tiempo configurado',
              },
            },
          }),
        ]);

        return {
          conversationId: reactivada.id,
          phoneE164: reactivada.phoneE164,
          aiEnabled: true,
          aiDisabledReason: null,
          aiAutoResumeAt: null,
          needsHumanAttention: false,
          patientId: reactivada.patient?.id ?? null,
          patientName: reactivada.patient?.fullName ?? reactivada.displayName,
          isNewConversation: false,
          contact: {
            ...contact,
            role:
              contact.role === 'UNKNOWN' && reactivada.patient
                ? ('PATIENT' as const)
                : contact.role,
            name: contact.name ?? reactivada.patient?.fullName ?? reactivada.displayName,
          },
        };
      }

      return {
        conversationId: existing.id,
        phoneE164: existing.phoneE164,
        aiEnabled: existing.aiEnabled,
        aiDisabledReason: existing.aiDisabledReason,
        aiAutoResumeAt: existing.aiAutoResumeAt,
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
      aiAutoResumeAt: created.aiAutoResumeAt,
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

    const regreso = await calcularRegresoDelBot(new Date());

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
        // Tampoco lo apagó una persona aquí, así que también vuelve solo. Si
        // nadie atiende el escalamiento, el bot retoma el chat en vez de
        // dejar al paciente hablando con una pared.
        aiAutoResumeAt: regreso,
      },
      select: { id: true, aiEnabled: true },
    });

    return { conversationId: updated.id, aiEnabled: updated.aiEnabled };
  },
};
