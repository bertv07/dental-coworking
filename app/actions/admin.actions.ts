'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import type { WriteResult } from '@/backend/repositories/types';
import type { UserRole } from '@/backend/domain/types';
import {
  patientFormSchema,
  dentistFormSchema,
  treatmentFormSchema,
  roomFormSchema,
  appointmentFormSchema,
  appointmentStatusSchema,
  clinicSettingsSchema,
  paymentFormSchema,
  cashClosingSchema,
  paymentMethodSchema,
} from '@/backend/validators/admin.schema';
import { cuidSchema } from '@/backend/validators/common';
import { clinicDayKey, clinicWallClockToInstant } from '@/backend/domain/clinic-calendar';

/**
 * ===========================================================================
 *  Server Actions de los CRUD del panel
 * ===========================================================================
 *  ⚠️  RECORDATORIO DE SEGURIDAD
 *  Una Server Action es un ENDPOINT HTTP PÚBLICO con otro nombre. Que sólo
 *  se invoque desde un componente ya protegido NO la protege: cualquiera
 *  puede llamarla directamente conociendo su identificador.
 *
 *  Por eso TODAS pasan por `runAction()`, que impone el mismo ciclo:
 *    1. Autorizar (rol mínimo, en el servidor)
 *    2. Validar con Zod
 *    3. Ejecutar
 *    4. Auditar
 *    5. Revalidar la caché de la ruta
 *
 *  Centralizarlo en un helper no es sólo comodidad: evita que una acción
 *  nueva se escriba mañana olvidándose del paso 1.
 * ===========================================================================
 */

/** Forma que consumen los formularios del cliente. */
export interface ActionResult {
  ok: boolean;
  /** Mensaje para mostrar. Genérico ante fallos internos. */
  error?: string;
  /** Campo concreto que falló, para resaltarlo en el formulario. */
  field?: string;
  message?: string;
}

/**
 * Envoltorio común de todas las acciones administrativas.
 *
 * El genérico `TSchema` mantiene el tipado de extremo a extremo: `handler`
 * recibe los datos ya validados Y transformados por Zod, no el FormData
 * crudo.
 */
async function runAction<TSchema extends z.ZodTypeAny>(config: {
  minimumRole: UserRole;
  schema: TSchema;
  input: unknown;
  /** Ruta a revalidar tras el cambio. */
  revalidate: string;
  /** Verbo de auditoría, ej: "patient.created". */
  auditAction: string;
  handler: (
    data: z.infer<TSchema>,
    userId: string,
  ) => Promise<WriteResult<{ id: string }>>;
}): Promise<ActionResult> {
  // --- 1. Autorización -----------------------------------------------------
  const authorization = await checkApiRole(config.minimumRole);
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para realizar esta acción.',
    };
  }

  // --- 2. Validación -------------------------------------------------------
  const validation = config.schema.safeParse(config.input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? 'Datos inválidos',
      field: issue?.path.join('.'),
    };
  }

  try {
    // --- 3. Ejecución ------------------------------------------------------
    const result = await config.handler(validation.data, authorization.user.id);

    if (!result.ok) {
      if (result.reason === 'DUPLICATE') {
        return {
          ok: false,
          field: result.field,
          error: `Ya existe un registro con ese ${FIELD_LABEL[result.field] ?? result.field}.`,
        };
      }
      return { ok: false, error: 'El registro no existe o fue eliminado.' };
    }

    // --- 4. Auditoría ------------------------------------------------------
    // En modo DB esto además escribe en `audit_logs` desde el repositorio.
    console.info(
      JSON.stringify({
        level: 'info',
        event: config.auditAction,
        entityId: result.data.id,
        userId: authorization.user.id,
        timestamp: new Date().toISOString(),
      }),
    );

    // --- 5. Revalidación ---------------------------------------------------
    // Invalida la caché para que el siguiente render traiga los datos nuevos
    // sin recargar la página entera a mano.
    revalidatePath(config.revalidate);

    return { ok: true };
  } catch (error) {
    // El detalle real va al log del servidor; al cliente sólo un mensaje
    // genérico, sin filtrar estructura interna del sistema.
    console.error(
      JSON.stringify({
        level: 'error',
        event: `${config.auditAction}.failed`,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo guardar. Intenta de nuevo.' };
  }
}

/** Nombres legibles de los campos únicos, para los mensajes de error. */
const FIELD_LABEL: Record<string, string> = {
  phoneE164: 'teléfono',
  documentId: 'documento',
  email: 'correo',
  licenseNumber: 'registro profesional',
  code: 'código',
  name: 'nombre',
};

// ===========================================================================
//  PACIENTES  (asistente o superior: recepción los da de alta a diario)
// ===========================================================================

export async function createPatientAction(input: unknown): Promise<ActionResult> {
  return runAction({
    minimumRole: 'ASSISTANT',
    schema: patientFormSchema,
    input,
    revalidate: '/pacientes',
    auditAction: 'patient.created',
    handler: (data) => repository.createPatient(data),
  });
}

export async function updatePatientAction(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsedId = cuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Identificador inválido' };

  return runAction({
    minimumRole: 'ASSISTANT',
    schema: patientFormSchema,
    input,
    revalidate: '/pacientes',
    auditAction: 'patient.updated',
    handler: (data) => repository.updatePatient(parsedId.data, data),
  });
}

export async function deletePatientAction(id: string): Promise<ActionResult> {
  return runAction({
    minimumRole: 'ASSISTANT',
    schema: cuidSchema,
    input: id,
    revalidate: '/pacientes',
    auditAction: 'patient.deleted',
    handler: (validId) => repository.softDeletePatient(validId),
  });
}

// ===========================================================================
//  ODONTÓLOGOS  (sólo Super Admin: define cuánto cobra cada persona)
// ===========================================================================

export async function createDentistAction(input: unknown): Promise<ActionResult> {
  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: dentistFormSchema,
    input,
    revalidate: '/odontologos',
    auditAction: 'dentist.created',
    handler: (data) => repository.createDentist(data),
  });
}

export async function updateDentistAction(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsedId = cuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Identificador inválido' };

  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: dentistFormSchema,
    input,
    revalidate: '/odontologos',
    auditAction: 'dentist.updated',
    handler: (data) => repository.updateDentist(parsedId.data, data),
  });
}

export async function deleteDentistAction(id: string): Promise<ActionResult> {
  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: cuidSchema,
    input: id,
    revalidate: '/odontologos',
    auditAction: 'dentist.deleted',
    handler: (validId) => repository.softDeleteDentist(validId),
  });
}

// ===========================================================================
//  TRATAMIENTOS Y PRECIOS  (sólo Super Admin)
// ===========================================================================

/** Convierte la entrada del formulario al shape que espera el repositorio. */
function toTreatmentInput(data: z.infer<typeof treatmentFormSchema>) {
  return {
    name: data.name,
    code: data.code,
    category: data.category,
    // El formulario recibe pesos; el esquema ya los convirtió a centavos.
    basePriceCents: data.priceInPesos,
    durationMinutes: data.durationMinutes,
    bufferMinutes: data.bufferMinutes,
    isActive: data.isActive,
  };
}

export async function createTreatmentAction(input: unknown): Promise<ActionResult> {
  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: treatmentFormSchema,
    input,
    revalidate: '/tratamientos',
    auditAction: 'treatment.created',
    handler: (data) => repository.createTreatment(toTreatmentInput(data)),
  });
}

export async function updateTreatmentAction(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsedId = cuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Identificador inválido' };

  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: treatmentFormSchema,
    input,
    revalidate: '/tratamientos',
    auditAction: 'treatment.price_updated',
    // `userId` se propaga para dejar constancia de QUIÉN cambió el precio.
    handler: (data, userId) =>
      repository.updateTreatment(parsedId.data, toTreatmentInput(data), userId),
  });
}

export async function deleteTreatmentAction(id: string): Promise<ActionResult> {
  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: cuidSchema,
    input: id,
    revalidate: '/tratamientos',
    auditAction: 'treatment.deleted',
    handler: (validId) => repository.softDeleteTreatment(validId),
  });
}

// ===========================================================================
//  CONSULTORIOS  (sólo Super Admin)
// ===========================================================================

export async function createRoomAction(input: unknown): Promise<ActionResult> {
  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: roomFormSchema,
    input,
    revalidate: '/consultorios',
    auditAction: 'room.created',
    handler: (data) => repository.createRoom(data),
  });
}

export async function updateRoomAction(id: string, input: unknown): Promise<ActionResult> {
  const parsedId = cuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Identificador inválido' };

  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: roomFormSchema,
    input,
    revalidate: '/consultorios',
    auditAction: 'room.updated',
    handler: (data) => repository.updateRoom(parsedId.data, data),
  });
}

export async function deleteRoomAction(id: string): Promise<ActionResult> {
  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: cuidSchema,
    input: id,
    revalidate: '/consultorios',
    auditAction: 'room.deleted',
    handler: (validId) => repository.softDeleteRoom(validId),
  });
}

// ===========================================================================
//  CITAS  (asistente o superior: recepción agenda a diario)
// ===========================================================================

export async function createAppointmentAction(input: unknown): Promise<ActionResult> {
  return runAction({
    minimumRole: 'ASSISTANT',
    schema: appointmentFormSchema,
    input,
    revalidate: '/agenda',
    auditAction: 'appointment.created_from_panel',
    handler: (data) => repository.createAppointmentFromPanel(data),
  });
}

export async function updateAppointmentAction(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsedId = cuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Identificador inválido' };

  return runAction({
    minimumRole: 'ASSISTANT',
    schema: appointmentFormSchema,
    input,
    revalidate: '/agenda',
    auditAction: 'appointment.rescheduled',
    handler: (data) => repository.updateAppointment(parsedId.data, data),
  });
}

/**
 * Cambia el estado de una cita (confirmar, completar, cancelar, no-show).
 *
 * Va aparte de `updateAppointmentAction` a propósito: cambiar el estado es
 * un clic en la tabla, no requiere abrir el formulario completo ni volver a
 * enviar paciente, sala y tratamiento.
 */
export async function setAppointmentStatusAction(input: unknown): Promise<ActionResult> {
  return runAction({
    minimumRole: 'ASSISTANT',
    schema: appointmentStatusSchema,
    input,
    revalidate: '/agenda',
    auditAction: 'appointment.status_changed',
    handler: (data) =>
      repository.updateAppointmentStatus({
        id: data.id,
        status: data.status,
        cancellationReason: data.cancellationReason,
      }),
  });
}

// ===========================================================================
//  AJUSTES DE LA CLÍNICA  (sólo Super Admin)
// ===========================================================================

export async function updateClinicSettingsAction(input: unknown): Promise<ActionResult> {
  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: clinicSettingsSchema,
    input,
    revalidate: '/configuracion',
    auditAction: 'clinic_settings.updated',
    handler: (data, userId) =>
      repository.updateClinicSettings(
        {
          clinicName: data.clinicName,
          taxId: data.taxId,
          address: data.address,
          phone: data.phone,
          email: data.email,
          defaultCommissionPercent: data.defaultCommissionPercent,
          // El esquema ya convirtió HH:MM a minutos desde medianoche.
          openingMinute: data.openingTime,
          closingMinute: data.closingTime,
          slotMinutes: data.slotMinutes,
          displayCurrency: data.displayCurrency,
          preferredRateSource: data.preferredRateSource,
        },
        userId,
      ),
  });
}

// ===========================================================================
//  TIPO DE CAMBIO
// ===========================================================================

/**
 * Fuerza la consulta a DolarAPI, ignorando la caché de una hora.
 *
 * Existe porque el BCV publica a una hora impredecible: el administrador
 * necesita poder decir "ya salió la tasa nueva, tráela ahora" sin esperar a
 * que venza la ventana.
 */
export async function refreshExchangeRateAction(source: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return { ok: false, error: 'No tienes permiso para actualizar la tasa.' };
  }

  const parsed = z.enum(['BCV', 'PARALELO']).safeParse(source);
  if (!parsed.success) return { ok: false, error: 'Fuente inválida' };

  const { refreshRate } = await import('@/backend/services/exchange-rate.service');
  const rate = await refreshRate(parsed.data);

  if (!rate) {
    return { ok: false, error: 'DolarAPI no respondió. Se mantiene la última tasa conocida.' };
  }

  revalidatePath('/tasa-cambio');
  revalidatePath('/dashboard');
  return { ok: true, message: `Tasa ${parsed.data} actualizada: ${rate.rate} Bs/USD` };
}

// ===========================================================================
//  COBROS  (asistente o superior: recepción cobra a diario)
// ===========================================================================

/**
 * Registra un cobro y cierra la cita.
 *
 * ES LA ACCIÓN QUE CONECTA EL MOSTRADOR CON LAS FINANZAS: en cuanto se
 * ejecuta, el importe aparece en el dashboard del administrador, en la
 * liquidación del odontólogo y en la caja del día.
 *
 * La tasa Bs/USD se resuelve AQUÍ, en el servidor, y se congela en el pago.
 * Si el cliente la enviara, bastaría con manipularla para alterar cuánto
 * dinero se registra como cobrado.
 */
export async function registerPaymentAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para registrar cobros.',
    };
  }

  const validation = paymentFormSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const data = validation.data;

  try {
    // Tasa vigente según la fuente configurada por la clínica.
    const [settings, { getCurrentRate }] = await Promise.all([
      repository.getClinicSettings(),
      import('@/backend/services/exchange-rate.service'),
    ]);

    const source = settings.preferredRateSource === 'PARALELO' ? 'PARALELO' : 'BCV';
    const rate = await getCurrentRate(source);

    // Sin tasa no se puede registrar el importe en bolívares, y ése es el
    // dinero que de verdad entra en caja. Mejor bloquear que inventar.
    if (!rate) {
      return {
        ok: false,
        error: 'No hay tasa de cambio disponible. Actualízala antes de cobrar.',
      };
    }

    const result = await repository.createPayment({
      data: {
        appointmentId: data.appointmentId,
        amountCents: data.amountInUsd,
        method: data.method,
        methodLabel: data.methodLabel,
        externalReference: data.externalReference,
      },
      exchangeRate: rate.rate,
      exchangeRateSource: rate.source,
      userId: authorization.user.id,
    });

    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === 'DUPLICATE'
            ? 'Esta cita ya tiene un cobro registrado.'
            : 'La cita no existe.',
      };
    }

    // Todas las vistas que dependen del dinero: caja, agenda y las del admin.
    revalidatePath('/caja');
    revalidatePath('/agenda');
    revalidatePath('/inicio');
    revalidatePath('/dashboard');
    revalidatePath('/odontologos');

    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'payment.record_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo registrar el cobro. Intenta de nuevo.' };
  }
}

/* ==========================================================================
   CIERRE DE CAJA
   ========================================================================== */

/**
 * Firma el arqueo del día.
 *
 * Del formulario sólo llega el efectivo contado y una nota. TODO lo demás
 * —lo esperado, el desglose, la diferencia— se recalcula aquí a partir de los
 * cobros que hay en la base. El navegador no puede influir en el número que
 * delata un descuadre.
 */
export async function closeCashAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para cerrar la caja.',
    };
  }

  const validation = cashClosingSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const { businessDate, countedCashBs, notes } = validation.data;

  // No se cierra un día que todavía no ha ocurrido: el arqueo sería de cero
  // y bloquearía el cierre real cuando llegue la fecha.
  if (businessDate > clinicDayKey(new Date())) {
    return { ok: false, error: 'No se puede cerrar un día que aún no ha llegado.' };
  }

  try {
    const cash = await repository.getDailyCash(clinicWallClockToInstant(businessDate, 12 * 60));
    const cashRow = cash.byMethod.find((row) => row.method === 'CASH');

    const result = await repository.closeCash(
      {
        businessDate,
        expectedCents: cash.totalCents,
        expectedBs: cash.totalBs,
        // Sólo la parte en efectivo es contable a mano. Si hoy no hubo
        // efectivo, lo esperado es cero y cualquier billete en la gaveta
        // aparecerá como sobrante — que es justo lo que se quiere ver.
        expectedCashBs: cashRow?.bs ?? 0,
        countedCashBs,
        paymentCount: cash.paymentCount,
        notes,
      },
      authorization.user.id,
    );

    if (!result.ok) {
      return { ok: false, error: 'Este día ya estaba cerrado. Recarga la página.' };
    }

    revalidatePath('/caja');
    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'cash.close_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo cerrar la caja. Intenta de nuevo.' };
  }
}

/**
 * Reabre un día cerrado. SÓLO administrador.
 *
 * Recepción no puede deshacer su propio arqueo: si pudiera, contar mal y
 * volver a contar hasta que cuadre sería trivial, y el descuadre —que es la
 * información valiosa— desaparecería sin dejar rastro. La reapertura queda
 * registrada en la auditoría con la diferencia que tenía el cierre anulado.
 */
export async function reopenCashAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('SUPER_ADMIN');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'Sólo el administrador puede reabrir una caja cerrada.',
    };
  }

  const parsed = z
    .object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Fecha inválida' };

  const reopened = await repository.reopenCash(parsed.data.businessDate, authorization.user.id);
  if (!reopened) return { ok: false, error: 'Ese día no estaba cerrado.' };

  revalidatePath('/caja');
  return { ok: true };
}

/* ==========================================================================
   MEDIOS DE PAGO
   ========================================================================== */

/**
 * CRUD de las formas de pago que la clínica acepta.
 *
 * SÓLO Super Admin, y no por costumbre: estos registros llevan los datos
 * bancarios que el bot le dicta a cada paciente. Quien pueda editarlos puede
 * redirigir los cobros de la clínica a otra cuenta. Por eso, además, cada
 * cambio queda en el registro de auditoría con el valor anterior.
 */
export async function savePaymentMethodAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('SUPER_ADMIN');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'Sólo el administrador puede cambiar los medios de pago.',
    };
  }

  const raw = input as Record<string, unknown>;
  const validation = paymentMethodSchema.safeParse(raw);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  // El id llega aparte del esquema: el formulario de alta no lo trae.
  const id = typeof raw.id === 'string' && raw.id ? raw.id : null;

  const result = id
    ? await repository.updatePaymentMethod(id, validation.data, authorization.user.id)
    : await repository.createPaymentMethod(validation.data, authorization.user.id);

  if (!result.ok) {
    return {
      ok: false,
      error: result.reason === 'NOT_FOUND' ? 'Ese medio de pago ya no existe.' : 'No se pudo guardar.',
    };
  }

  revalidatePath('/configuracion');
  // La agenda y la caja pintan el selector de medios al cobrar.
  revalidatePath('/agenda');
  revalidatePath('/caja');
  return { ok: true };
}

export async function deletePaymentMethodAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('SUPER_ADMIN');
  if (!authorization.authorized) {
    return { ok: false, error: 'Sólo el administrador puede eliminar medios de pago.' };
  }

  const parsed = z.object({ id: cuidSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };

  const deleted = await repository.deletePaymentMethod(parsed.data.id, authorization.user.id);
  if (!deleted) return { ok: false, error: 'Ese medio de pago ya no existe.' };

  revalidatePath('/configuracion');
  revalidatePath('/agenda');
  revalidatePath('/caja');
  return { ok: true };
}
