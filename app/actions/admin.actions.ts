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
  appointmentAddonSchema,
  dentistTreatmentSchema,
  tariffReviewSchema,
  instrumentSchema,
  scheduleRequestSchema,
  scheduleReviewSchema,
  baseScheduleSchema,
  ownAppointmentSchema,
  clinicSettingsSchema,
  paymentFormSchema,
  cashClosingSchema,
  paymentMethodSchema,
} from '@/backend/validators/admin.schema';
import type { DentistFormInput } from '@/backend/validators/admin.schema';
import { cuidSchema } from '@/backend/validators/common';
import { hashPassword } from '@/backend/auth/password';
import { env } from '@/backend/config/env';
import {
  generateTemporaryPassword,
  sendStaffInvite,
} from '@/backend/services/staff-invite.service';
import { clinicDayKey, clinicWallClockToInstant } from '@/backend/domain/clinic-calendar';
import { scheduleAppointment } from '@/backend/services/scheduling.service';
import { resolveRateSource } from '@/backend/services/exchange-rate.service';

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
  /**
   * La operación salió bien, pero hay algo que decir.
   *
   * Existe por el alta con cuenta: el odontólogo queda creado y el correo
   * puede no salir. No es un error —deshacer el alta sería peor— pero quien
   * lo hizo tiene que enterarse de que esa persona todavía no puede entrar.
   */
  warning?: string;
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
  /**
   * Mensaje para `reason: 'DUPLICATE'` cuando el conflicto NO es un registro
   * repetido. El repositorio sólo distingue "conflicto" de "no existe", así
   * que el texto lo pone quien sabe qué significa el choque en su caso:
   * para un paciente es un teléfono repetido, para un añadido es que la cita
   * ya está cobrada. Sin esto, recepción leería "ya existe un registro con
   * ese appointmentId", que no describe nada de lo que pasó.
   */
  conflictMessage?: string;
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
          error:
            config.conflictMessage ??
            `Ya existe un registro con ese ${FIELD_LABEL[result.field] ?? result.field}.`,
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

/**
 * Separa los datos clínicos de la decisión «además, créale cuenta».
 *
 * `createAccount` es una instrucción para esta acción, no una columna de
 * `dentists`. Si se colara en el objeto que va al repositorio, Prisma
 * fallaría con un campo desconocido.
 */
function toDentistInput(data: DentistFormInput) {
  const { createAccount: _ignored, ...dentist } = data;
  return dentist;
}

/**
 * Alta de odontólogo, con o sin acceso al panel.
 *
 * Cuando se pide cuenta, no usa `runAction`: hay que generar una contraseña,
 * hashearla y pedirle a n8n que mande el correo, y el resultado del envío
 * tiene que llegar a la interfaz. `runAction` sólo sabe devolver ok/error.
 *
 * ORDEN DELIBERADO — primero la base, después el correo:
 * si se enviara antes, un fallo al guardar dejaría a alguien con una clave
 * por correo para una cuenta que no existe. Al revés, un fallo de correo deja
 * la cuenta creada y la interfaz avisa de que hay que dar la clave a mano.
 * El primer caso confunde a quien lo recibe; el segundo lo resuelve el
 * administrador en un minuto.
 */
/**
 * Explica un choque de número de colegio o correo diciendo QUIÉN lo ocupa.
 *
 * El mensaje genérico —«ya existe un registro con ese registro profesional»—
 * deja a quien da el alta sin salida: no puede ver la ficha que choca porque,
 * si está dada de baja, el panel no la lista. Y el caso más común es
 * justamente ese: alguien que trabajó aquí y vuelve.
 *
 * Crear una ficha nueva sería lo peor: su historial de citas y liquidaciones
 * cuelga de la ficha vieja, así que quedarían dos personas donde hay una.
 */
async function explicarChoque(
  data: DentistFormInput,
  field: string,
): Promise<ActionResult> {
  const existente = await repository.findDentistByLicenseOrEmail({
    licenseNumber: data.licenseNumber,
    email: data.email,
  });

  if (!existente) {
    return {
      ok: false,
      field,
      error: `Ya existe un registro con ese ${FIELD_LABEL[field] ?? field}.`,
    };
  }

  /*
   * El texto se redacta en torno a la FICHA y no a la persona: así no hay que
   * concordar en género con un nombre del que no se sabe nada. «Su ficha está
   * dada de baja» vale para cualquiera; «está dado/a de baja» obliga a
   * acertar, y acertar mal delante de quien trabaja aquí es feo.
   */
  if (existente.isDeleted) {
    return {
      ok: false,
      field,
      error:
        `Ese ${FIELD_LABEL[field] ?? field} ya lo tiene ${existente.fullName}, ` +
        'cuya ficha está dada de baja. No crees una ficha nueva: reactiva la suya ' +
        'desde «Dados de baja» y conserva todo su historial.',
    };
  }

  return {
    ok: false,
    field,
    error: `Ese ${FIELD_LABEL[field] ?? field} ya lo tiene ${existente.fullName}.`,
  };
}

export async function createDentistAction(input: unknown): Promise<ActionResult> {
  const validation = dentistFormSchema.safeParse(input);

  // Sin cuenta, el camino es el CRUD de siempre.
  if (!validation.success || !validation.data.createAccount) {
    const result = await runAction({
      minimumRole: 'SUPER_ADMIN',
      schema: dentistFormSchema,
      input,
      revalidate: '/odontologos',
      auditAction: 'dentist.created',
      handler: (data) => repository.createDentist(toDentistInput(data)),
    });

    /*
     * Si chocó un campo único, se sustituye el mensaje genérico por uno que
     * diga QUIÉN ocupa ese número. `runAction` no puede hacerlo: la consulta
     * es asíncrona y él sólo sabe traducir códigos de error.
     */
    if (!result.ok && result.field && validation.success) {
      return explicarChoque(validation.data, result.field);
    }

    return result;
  }

  const authorization = await checkApiRole('SUPER_ADMIN');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para dar de alta odontólogos.',
    };
  }

  const data = validation.data;

  try {
    // Se hashea FUERA de la transacción: Argon2 tarda ~80 ms y mantener la
    // transacción abierta ese rato no aporta nada.
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    const result = await repository.createDentistWithAccount({
      dentist: toDentistInput(data),
      passwordHash,
    });

    if (!result.ok) {
      if (result.reason === 'DUPLICATE') {
        return explicarChoque(data, result.field);
      }
      return { ok: false, error: 'No se pudo crear el odontólogo.' };
    }

    // Ya está en la base. El correo es el paso que puede fallar sin deshacer
    // nada de lo anterior.
    const delivery = await sendStaffInvite({
      email: data.email,
      fullName: data.fullName,
      temporaryPassword,
      role: 'Odontólogo',
      loginUrl: `${env.APP_ORIGIN}/login`,
    });

    revalidatePath('/odontologos');

    if (delivery.status !== 'SENT') {
      /*
       * La clave temporal NO se devuelve a la interfaz. Ya está hasheada en
       * la base y no hay forma de recuperarla: para reenviarla hay que
       * generar una nueva. Devolverla aquí la dejaría en el HTML, en el
       * historial del navegador y en cualquier captura de pantalla.
       */
      return {
        ok: true,
        warning:
          delivery.status === 'PENDING'
            ? 'El odontólogo quedó creado, pero el envío de correo no está configurado (STAFF_EMAIL_WEBHOOK_URL). Tendrás que restablecerle la clave para que pueda entrar.'
            : `El odontólogo quedó creado, pero el correo no se pudo enviar (${delivery.reason}). Tendrás que restablecerle la clave.`,
      };
    }

    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'dentist.create_with_account_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo crear el odontólogo. Intenta de nuevo.' };
  }
}

/**
 * Edita la ficha de un odontólogo.
 *
 * Recepción también entra: corrige un teléfono mal tecleado, añade una
 * especialidad o actualiza un correo, que es trabajo de mostrador y no tenía
 * por qué esperar al administrador.
 *
 * Lo que NO puede tocar es la COMISIÓN. Si el formulario viene de recepción,
 * el porcentaje se descarta y se conserva el que ya tenía — no se confía en
 * que el campo no venga, porque una Server Action es un endpoint público y
 * se le puede mandar cualquier cosa con curl.
 */
export async function updateDentistAction(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const parsedId = cuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Identificador inválido' };

  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para esto.',
    };
  }

  const esAdministrador = authorization.user.role === 'SUPER_ADMIN';

  // La comisión vigente, para poder devolverla intacta si edita recepción.
  const actual = esAdministrador
    ? null
    : await repository.findDentistById(parsedId.data);

  if (!esAdministrador && !actual) {
    return { ok: false, error: 'Ese odontólogo ya no existe.' };
  }

  /*
   * Se INYECTA la comisión guardada antes de validar, en vez de dejar que
   * llegue del formulario.
   *
   * Dos motivos: el esquema la exige —y el formulario de recepción no la
   * pinta, así que no la enviaría— y sobre todo, si viniera del cliente
   * habría que confiar en ella. Reescribirla aquí hace imposible cambiarla
   * desde recepción, mande lo que mande.
   */
  const entrada = esAdministrador
    ? input
    : {
        ...(typeof input === 'object' && input !== null ? input : {}),
        clinicCommissionPercent: actual!.clinicCommissionPercent,
      };

  const result = await runAction({
    minimumRole: 'ASSISTANT',
    schema: dentistFormSchema,
    input: entrada,
    revalidate: '/odontologos',
    auditAction: 'dentist.updated',
    /*
     * `toDentistInput` quita `createAccount`, que es una instrucción del
     * formulario y NO una columna de `dentists`. Sin esto, editar cualquier
     * odontóloga fallaba: Prisma recibía un campo desconocido.
     *
     * Al editar, la casilla ni se pinta —crear la cuenta de alguien que ya la
     * tiene es restablecerle la clave, que es otra operación—, pero el
     * esquema es el mismo para alta y edición, así que el campo llega igual.
     */
    handler: (data) => repository.updateDentist(parsedId.data, toDentistInput(data)),
  });

  // Si chocó un campo único, se explica QUIÉN lo ocupa (ver `explicarChoque`).
  const validation = dentistFormSchema.safeParse(entrada);
  if (!result.ok && result.field && validation.success) {
    return explicarChoque(validation.data, result.field);
  }

  return result;
}

/** Devuelve al servicio a alguien que estaba dado de baja. */
export async function reactivateDentistAction(id: string): Promise<ActionResult> {
  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: cuidSchema,
    input: id,
    revalidate: '/odontologos',
    auditAction: 'dentist.reactivated',
    handler: (validId, userId) => repository.reactivateDentist({ id: validId, userId }),
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
//  TRATAMIENTOS Y PRECIOS
//
//  Asistente o superior: recepción cotiza por teléfono y factura, así que es
//  la primera en enterarse de que un precio cambió. Obligarla a pedírselo al
//  administrador significaba cobrar con la lista vieja hasta que alguien se
//  acordara.
//
//  La COMISIÓN sigue siendo del administrador, y se toca en `/odontologos`:
//  cuánto cuesta algo y cómo se reparte son dos decisiones distintas.
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
    minimumRole: 'ASSISTANT',
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
    minimumRole: 'ASSISTANT',
    schema: treatmentFormSchema,
    input,
    revalidate: '/tratamientos',
    auditAction: 'treatment.price_updated',
    // `userId` se propaga para dejar constancia de QUIÉN cambió el precio.
    handler: (data, userId) =>
      repository.updateTreatment(parsedId.data, toTreatmentInput(data), userId),
  });
}

/**
 * Cambia SÓLO el precio de un tratamiento.
 *
 * Existe aparte de `updateTreatmentAction` porque se usa desde Tarifas, donde
 * lo único que se toca es el importe. Obligar a mandar el formulario entero
 * —código, categoría, duración, buffer— desde una tabla de precios haría que
 * un campo que ni se muestra pudiera pisarse con un valor viejo.
 *
 * Lee el tratamiento actual y sólo le cambia el precio, así que el historial
 * de precios y la auditoría se escriben igual que en la pantalla de siempre.
 */
export async function updateTreatmentPriceAction(input: {
  id: string;
  priceUsd: number;
}): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para cambiar precios.',
    };
  }

  const parsed = z
    .object({
      id: cuidSchema,
      // Mismo techo que el importador: por encima de eso casi siempre es un
      // separador decimal mal puesto, no un precio.
      priceUsd: z.coerce.number().min(0).max(100_000),
    })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Precio inválido' };
  }

  const actual = (await repository.listTreatments({ includeInactive: true })).find(
    (t) => t.id === parsed.data.id,
  );
  if (!actual) return { ok: false, error: 'Ese tratamiento ya no existe.' };

  const result = await repository.updateTreatment(
    parsed.data.id,
    {
      name: actual.name,
      code: actual.code,
      category: actual.category,
      basePriceCents: Math.round(parsed.data.priceUsd * 100),
      durationMinutes: actual.durationMinutes,
      bufferMinutes: actual.bufferMinutes,
      isActive: actual.isActive,
    },
    authorization.user.id,
  );

  if (!result.ok) return { ok: false, error: 'No se pudo cambiar el precio.' };

  // Las dos pantallas donde se ve, y el catálogo que lee el bot.
  revalidatePath('/tratamientos');
  revalidatePath('/tarifas');
  return { ok: true };
}

export async function deleteTreatmentAction(id: string): Promise<ActionResult> {
  return runAction({
    minimumRole: 'ASSISTANT',
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

/**
 * Alta de una cita con VARIOS tratamientos.
 *
 * «A veces una persona se hace más de una cosa»: viene a una limpieza, se le
 * ve una caries y se le hace también. La cita sigue teniendo un tratamiento
 * principal —el que fija la duración y el hueco en la agenda— y el resto
 * entran como procedimientos añadidos, que es como ya se cobraban.
 *
 * POR QUÉ NO SE MANDA EL PRECIO DE LOS EXTRAS
 * Lo decide el servidor, tratamiento a tratamiento: precio pactado con esa
 * odontóloga si lo hay, y si no el de lista. Si el precio viajara desde el
 * navegador, se podría agendar una corona a un dólar.
 *
 * Si un extra falla, la cita YA está creada y se dice cuáles entraron. Es
 * preferible a deshacer la cita entera: el hueco ya está apartado y el
 * paciente delante.
 */
export async function createAppointmentWithExtrasAction(
  input: unknown,
): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para agendar.',
    };
  }

  const datos = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  /*
   * Llegan como texto separado por comas.
   *
   * El formulario los manda así porque `Object.fromEntries` —lo que usa el
   * panel para armar el payload— se queda con la última de las claves
   * repetidas, así que varios inputs con el mismo nombre perderían todos
   * menos uno.
   */
  const extras = z
    .array(cuidSchema)
    .max(20, 'Demasiados tratamientos en una sola cita')
    .safeParse(
      typeof datos.extraTreatmentIds === 'string'
        ? datos.extraTreatmentIds.split(',').map((x) => x.trim()).filter(Boolean)
        : (datos.extraTreatmentIds ?? []),
    );
  if (!extras.success) {
    return { ok: false, error: extras.error.issues[0]?.message ?? 'Tratamientos inválidos' };
  }

  const validation = appointmentFormSchema.safeParse(datos);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return {
      ok: false,
      field: issue?.path[0] as string | undefined,
      error: issue?.message ?? 'Datos inválidos',
    };
  }

  const creada = await repository.createAppointmentFromPanel(validation.data);
  if (!creada.ok) {
    return {
      ok: false,
      // `createAppointmentFromPanel` no distingue el choque de horario: lo
      // reporta como NOT_FOUND igual que un id que no existe.
      error: 'No se pudo crear la cita. Revisa que el hueco siga libre.',
    };
  }

  // Los extras, uno a uno y con el precio que decide el servidor.
  const fallidos: string[] = [];
  for (const treatmentId of extras.data) {
    const añadido = await repository.addAppointmentAddon({
      appointmentId: creada.data.id,
      treatmentId,
      priceCents: null,
      notes: null,
      userId: authorization.user.id,
    });
    if (!añadido.ok) fallidos.push(treatmentId);
  }

  revalidatePath('/agenda');

  if (fallidos.length > 0) {
    return {
      ok: true,
      warning:
        `La cita quedó creada, pero ${fallidos.length} de los tratamientos añadidos no ` +
        'entraron. Añádelos desde «Procedimientos» en la propia cita.',
    };
  }

  return { ok: true };
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

/**
 * Añade un procedimiento a una cita ya agendada.
 *
 * El caso real: el paciente viene a una limpieza, el odontólogo ve una caries
 * y la obtura en la misma sesión. Se agendó por una cosa y se cobra por dos.
 *
 * No se toca `agreedPriceCents` de la cita: ése es el precio congelado al
 * agendar, y la diferencia entre lo cotizado y lo cobrado es justo el dato
 * que revela si el bot está cotizando mal.
 */
export async function addAppointmentAddonAction(input: unknown): Promise<ActionResult> {
  return runAction({
    minimumRole: 'ASSISTANT',
    schema: appointmentAddonSchema,
    input,
    revalidate: '/agenda',
    auditAction: 'appointment.addon_added',
    conflictMessage:
      'Esa cita ya está cobrada. Para añadir un procedimiento hay que anular el cobro primero.',
    handler: (data, userId) =>
      repository.addAppointmentAddon({
        appointmentId: data.appointmentId,
        treatmentId: data.treatmentId,
        priceCents: data.priceInPesos,
        notes: data.notes,
        userId,
      }),
  });
}

/** Quita un procedimiento añadido, mientras la cita no esté cobrada. */
export async function removeAppointmentAddonAction(id: string): Promise<ActionResult> {
  return runAction({
    minimumRole: 'ASSISTANT',
    schema: cuidSchema,
    input: id,
    revalidate: '/agenda',
    auditAction: 'appointment.addon_removed',
    conflictMessage: 'Esa cita ya está cobrada: sus conceptos no se pueden cambiar.',
    handler: (validId, userId) =>
      repository.removeAppointmentAddon({ id: validId, userId }),
  });
}

// ===========================================================================
//  TARIFAS PACTADAS POR ODONTÓLOGO
// ===========================================================================
//  «Los precios varían de acuerdo al tratamiento, y también según el
//  odontólogo.» El odontólogo PROPONE y el administrador APRUEBA.
//
//  Mientras la propuesta esté en `PENDING` no se aplica: se sigue cobrando el
//  precio de lista (`createPayment` sólo mira los `APPROVED`).
// ===========================================================================

/**
 * Guarda un acuerdo de precio.
 *
 * NO usa `runAction` porque dos cosas dependen del ROL de quien envía, y
 * ninguna puede salir del formulario:
 *
 *  · El ESTADO. El administrador guarda directamente en `APPROVED` —él es el
 *    aprobador—; el odontólogo sólo puede dejarlo en `PENDING`.
 *  · El ODONTÓLOGO. Un odontólogo sólo puede proponer para SÍ MISMO. El id
 *    se resuelve desde su sesión, no desde el campo del formulario: si no,
 *    bastaría con cambiar un id a mano para tocarle la tarifa a otro.
 */
export async function saveDentistTariffAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('DENTIST');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para esto.',
    };
  }

  const validation = dentistTreatmentSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const { user } = authorization;
  const data = validation.data;
  const esAdministrador = user.role === 'SUPER_ADMIN';

  let dentistId = data.dentistId;

  if (!esAdministrador) {
    // El odontólogo propone para su propia ficha, resuelta desde la sesión.
    const profile = await repository.findDentistByUserId(user.id);
    if (!profile) {
      return {
        ok: false,
        error: 'Tu usuario no está vinculado a una ficha de odontólogo.',
      };
    }

    /*
     * Se rechaza en vez de reescribir silenciosamente el id. Si el formulario
     * pide una tarifa para otra persona, o hay un error de programación o hay
     * un intento de manipulación: en ambos casos conviene que se note.
     */
    if (data.dentistId !== profile.id) {
      return { ok: false, error: 'Sólo puedes proponer tarifas para ti.' };
    }

    dentistId = profile.id;
  }

  try {
    const result = await repository.upsertDentistTreatment({
      dentistId,
      treatmentId: data.treatmentId,
      customPriceCents: data.customPriceInPesos,
      customCommissionPercent: data.customCommissionPercent,
      // Aquí está la regla entera: el rol decide si nace aprobado o pendiente.
      status: esAdministrador ? 'APPROVED' : 'PENDING',
      userId: user.id,
    });

    if (!result.ok) {
      return { ok: false, error: 'El odontólogo o el tratamiento ya no existen.' };
    }

    revalidatePath('/tarifas');
    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'tariff.save_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo guardar la tarifa.' };
  }
}

/** Aprueba o rechaza una propuesta. Sólo el administrador. */
export async function reviewDentistTariffAction(input: unknown): Promise<ActionResult> {
  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: tariffReviewSchema,
    input,
    revalidate: '/tarifas',
    auditAction: 'tariff.reviewed',
    handler: (data, userId) =>
      repository.reviewDentistTreatment({
        id: data.id,
        status: data.status,
        reviewNotes: data.reviewNotes,
        userId,
      }),
  });
}

/** Elimina un acuerdo: ese odontólogo vuelve al precio de lista. */
export async function deleteDentistTariffAction(id: string): Promise<ActionResult> {
  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: cuidSchema,
    input: id,
    revalidate: '/tarifas',
    auditAction: 'tariff.deleted',
    handler: (validId, userId) =>
      repository.deleteDentistTreatment({ id: validId, userId }),
  });
}

// ===========================================================================
//  LA DOCTORA AGENDA SUS PROPIAS CITAS
// ===========================================================================
//  Una odontóloga cierra citas por su cuenta —un paciente le escribe directo,
//  o acuerdan el control al terminar la consulta— y tiene que poder hacerlo
//  sin pasar por recepción. Ya podía por WhatsApp; esto es lo mismo desde el
//  panel.
//
//  Reutiliza `scheduleAppointment`, el MISMO servicio que usa el bot. No hay
//  una segunda vía de agendamiento con sus propias reglas: el solapamiento,
//  la duración, el precio congelado y la asignación de consultorio se
//  resuelven en un solo sitio.
// ===========================================================================

export async function createOwnAppointmentAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('DENTIST');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para agendar.',
    };
  }

  const { user } = authorization;

  // La ficha sale de la SESIÓN. Es lo que impide agendarle a una compañera.
  const profile = await repository.findDentistByUserId(user.id);
  if (!profile) {
    return {
      ok: false,
      error: 'Tu usuario no está vinculado a una ficha de odontólogo.',
    };
  }

  const validation = ownAppointmentSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const data = validation.data;

  try {
    const result = await scheduleAppointment({
      patientPhone: data.patientPhone,
      patientName: data.patientName,
      // Siempre ella. Nunca lo que venga en el formulario.
      dentistId: profile.id,
      treatmentCode: data.treatmentCode,
      startsAt: data.startsAt,
      notes: data.notes,
      /*
       * Llave de idempotencia derivada de lo que identifica la cita, no
       * aleatoria: si se hace doble clic en «Agendar», el segundo envío trae
       * la misma llave y el servicio devuelve la cita ya creada en vez de
       * duplicarla.
       */
      idempotencyKey: `panel-${profile.id}-${data.patientPhone}-${data.startsAt.toISOString()}`,
    });

    switch (result.outcome) {
      case 'CREATED':
      case 'ALREADY_EXISTS':
        revalidatePath('/agenda');
        return { ok: true };

      case 'TREATMENT_NOT_FOUND':
        return { ok: false, error: 'Ese tratamiento ya no está disponible.', field: 'treatmentCode' };

      case 'DENTIST_NOT_FOUND':
        return { ok: false, error: 'Tu ficha de odontólogo no está activa.' };

      case 'DENTIST_UNAVAILABLE':
        return {
          ok: false,
          field: 'startsAt',
          error: `Ya tienes una cita a esa hora.${formatSuggestions(result.suggestedSlots)}`,
        };

      case 'NO_ROOM_AVAILABLE':
        return {
          ok: false,
          field: 'startsAt',
          error: `No hay consultorio libre a esa hora.${formatSuggestions(result.suggestedSlots)}`,
        };
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'appointment.dentist_self_booking_failed',
        dentistId: profile.id,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo agendar. Intenta de nuevo.' };
  }
}

/**
 * Convierte los huecos alternativos en texto para el mensaje de error.
 *
 * Decir sólo «ocupado» obliga a probar horas a ciegas; con dos o tres
 * alternativas se resuelve al segundo intento.
 */
function formatSuggestions(slots: Date[]): string {
  if (slots.length === 0) return '';

  const formatter = new Intl.DateTimeFormat('es-VE', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Caracas',
  });

  return ` Libre: ${slots.slice(0, 3).map((slot) => formatter.format(slot)).join(', ')}.`;
}

// ===========================================================================
//  LIQUIDACIÓN DIARIA  («se paga al final del día»)
// ===========================================================================

/**
 * Marca como pagada la parte de un odontólogo por el día.
 *
 * Sólo Super Admin: es entregar dinero. Recepción registra los cobros y
 * cuenta la caja, pero decidir que se le paga a alguien es otra cosa.
 */
export async function settleDentistDayAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      dentistId: cuidSchema,
      businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
    })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  return runAction({
    minimumRole: 'SUPER_ADMIN',
    schema: z.object({}).passthrough(),
    input: {},
    revalidate: '/caja',
    auditAction: 'payout.daily_settled',
    handler: (_data, userId) =>
      repository.settleDentistDay({
        dentistId: parsed.data.dentistId,
        businessDate: parsed.data.businessDate,
        userId,
      }),
  }).then((result) =>
    result.ok
      ? result
      : {
          ...result,
          // `NOT_FOUND` aquí significa «no hay nada pendiente», no «no existe».
          error: 'No hay nada pendiente de pagarle a ese odontólogo hoy.',
        },
  );
}

// ===========================================================================
//  INSTRUMENTAL  («cada odontólogo tenga su inventario»)
// ===========================================================================
//  Es SU instrumental: el fórceps, la turbina, la cureta que trajo él. Lo
//  gestiona él mismo, y el administrador puede gestionar el de cualquiera.
//
//  El DUEÑO nunca sale del formulario: si lo envía un odontólogo, es él; si
//  lo envía el administrador, el que eligió. Así un odontólogo no puede
//  meterle instrumental a otro cambiando un id a mano.
// ===========================================================================

/**
 * Resuelve de quién es el instrumental que se está tocando.
 *
 * Devuelve el `dentistId` permitido o un error listo para devolver. Está
 * aparte porque las tres acciones (guardar, borrar, y la de horarios) hacen
 * exactamente la misma comprobación, y una que se olvidara sería el agujero.
 */
async function resolveOwnerDentistId(
  requestedDentistId: string | null,
): Promise<
  | { ok: true; dentistId: string; userId: string; isAdmin: boolean }
  | { ok: false; result: ActionResult }
> {
  const authorization = await checkApiRole('DENTIST');
  if (!authorization.authorized) {
    return {
      ok: false,
      result: {
        ok: false,
        error:
          authorization.status === 401
            ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
            : 'No tienes permiso para esto.',
      },
    };
  }

  const { user } = authorization;
  const isAdmin = user.role === 'SUPER_ADMIN';

  if (isAdmin) {
    if (!requestedDentistId) {
      return { ok: false, result: { ok: false, error: 'Elige un odontólogo.' } };
    }
    return { ok: true, dentistId: requestedDentistId, userId: user.id, isAdmin };
  }

  // Odontólogo: su ficha sale de la sesión, nunca del formulario.
  const profile = await repository.findDentistByUserId(user.id);
  if (!profile) {
    return {
      ok: false,
      result: { ok: false, error: 'Tu usuario no está vinculado a una ficha de odontólogo.' },
    };
  }

  // Se rechaza en vez de reescribirlo por lo bajo: o es un error de
  // programación o es un intento de tocar lo ajeno, y conviene que se note.
  if (requestedDentistId && requestedDentistId !== profile.id) {
    return {
      ok: false,
      result: { ok: false, error: 'Sólo puedes gestionar tu propio instrumental.' },
    };
  }

  return { ok: true, dentistId: profile.id, userId: user.id, isAdmin };
}

export async function saveInstrumentAction(
  id: string | null,
  dentistId: string | null,
  input: unknown,
): Promise<ActionResult> {
  const owner = await resolveOwnerDentistId(dentistId);
  if (!owner.ok) return owner.result;

  const validation = instrumentSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const result = await repository.saveInstrument({
    id,
    dentistId: owner.dentistId,
    data: validation.data,
    userId: owner.userId,
  });

  if (!result.ok) {
    return { ok: false, error: 'Ese instrumento no existe o no es tuyo.' };
  }

  revalidatePath('/instrumental');
  return { ok: true };
}

export async function deleteInstrumentAction(id: string): Promise<ActionResult> {
  const owner = await resolveOwnerDentistId(null);
  if (!owner.ok) return owner.result;

  const parsedId = cuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Identificador inválido' };

  /*
   * Se comprueba la propiedad ANTES de borrar. `deleteInstrument` recibe sólo
   * el id, así que sin esto un odontólogo podría borrar el instrumental de
   * otro conociendo su identificador.
   */
  if (!owner.isAdmin) {
    const propios = await repository.listInstruments({ dentistId: owner.dentistId });
    if (!propios.some((item) => item.id === parsedId.data)) {
      return { ok: false, error: 'Ese instrumento no es tuyo.' };
    }
  }

  const result = await repository.deleteInstrument({
    id: parsedId.data,
    userId: owner.userId,
  });

  if (!result.ok) return { ok: false, error: 'Ese instrumento ya no existe.' };

  revalidatePath('/instrumental');
  return { ok: true };
}

// ===========================================================================
//  HORARIOS  (el odontólogo propone la semana, administración aprueba)
// ===========================================================================

/** El odontólogo propone su semana. Sólo puede tener UNA solicitud esperando. */
export async function requestScheduleChangeAction(input: unknown): Promise<ActionResult> {
  const owner = await resolveOwnerDentistId(null);
  if (!owner.ok) return owner.result;

  const validation = scheduleRequestSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const result = await repository.createScheduleRequest({
    dentistId: owner.dentistId,
    weekStart: validation.data.weekStart,
    proposedBlocks: validation.data.proposedBlocks,
    reason: validation.data.reason,
    userId: owner.userId,
  });

  if (!result.ok) {
    // El índice único parcial de Postgres sólo sabe decir "conflicto"; aquí
    // se traduce a lo que de verdad pasó.
    return {
      ok: false,
      error:
        result.reason === 'DUPLICATE'
          ? 'Ya tienes una solicitud esperando para esa semana. Espera a que la revisen, o pide otra semana distinta.'
          : 'No se pudo enviar la solicitud.',
    };
  }

  revalidatePath('/horarios');
  return { ok: true };
}

/**
 * Recepción fija el horario BASE de un odontólogo.
 *
 * Es el que rige mientras nadie diga lo contrario y el que usa el bot para
 * ofrecer citas. Lo pone recepción, no el odontólogo: cambiarlo afecta a la
 * ocupación de los consultorios y a lo que se puede agendar.
 */
export async function setBaseScheduleAction(
  dentistId: string,
  input: unknown,
): Promise<ActionResult> {
  const parsedId = cuidSchema.safeParse(dentistId);
  if (!parsedId.success) return { ok: false, error: 'Identificador inválido' };

  return runAction({
    minimumRole: 'ASSISTANT',
    schema: baseScheduleSchema,
    input,
    revalidate: '/horarios',
    auditAction: 'schedule.base_set',
    handler: (data, userId) =>
      repository.setBaseSchedule({
        dentistId: parsedId.data,
        blocks: data.blocks,
        userId,
      }),
  });
}

/**
 * Aprueba o rechaza. Aprobar guarda la excepción DE ESA SEMANA en la misma
 * transacción; el horario base no se toca. Ver `reviewScheduleRequest`.
 */
export async function reviewScheduleChangeAction(input: unknown): Promise<ActionResult> {
  return runAction({
    minimumRole: 'ASSISTANT',
    schema: scheduleReviewSchema,
    input,
    revalidate: '/horarios',
    auditAction: 'schedule.reviewed',
    conflictMessage: 'Esa solicitud ya fue revisada.',
    handler: (data, userId) =>
      repository.reviewScheduleRequest({
        id: data.id,
        status: data.status,
        reviewNotes: data.reviewNotes,
        userId,
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
          aiAutoResumeHours: data.aiAutoResumeHours,
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

  const parsed = z.enum(['BCV', 'PARALELO', 'EURO']).safeParse(source);
  if (!parsed.success) return { ok: false, error: 'Fuente inválida' };

  const { refreshRate } = await import('@/backend/services/exchange-rate.service');
  const rate = await refreshRate(parsed.data);

  if (!rate) {
    return { ok: false, error: 'DolarAPI no respondió. Se mantiene la última tasa conocida.' };
  }

  revalidatePath('/tasa-cambio');
  revalidatePath('/dashboard');
  // La unidad cambia con la fuente: el euro son bolívares por EURO, no por
  // dólar. Decir «Bs/USD» siempre haría dudar de si se actualizó la correcta.
  const unidad = parsed.data === 'EURO' ? 'Bs/EUR' : 'Bs/USD';
  return { ok: true, message: `Tasa ${parsed.data} actualizada: ${rate.rate} ${unidad}` };
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

    const source = resolveRateSource(settings.preferredRateSource);
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
        commissionOverride: data.commissionOverride,
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
