import { z } from 'zod';
import {
  cuidSchema,
  emailSchema,
  personNameSchema,
  phoneE164Schema,
  safeTextSchema,
  centsSchema,
  percentSchema,
} from '@/backend/validators/common';
import { PASSWORD_POLICY } from '@/backend/auth/password';

/**
 * ===========================================================================
 *  Esquemas de los CRUD del panel
 * ===========================================================================
 *  Se usan en AMBOS lados:
 *    · Cliente → feedback inmediato en el formulario (UX)
 *    · Servidor → la validación que de verdad cuenta (seguridad)
 *
 *  La del cliente es una cortesía; la del servidor es la que protege. Nunca
 *  se confía en que el cliente haya validado, porque el cliente puede ser
 *  curl. Por eso este archivo NO lleva `server-only`: es intencional que se
 *  comparta.
 *
 *  Nota sobre `.strip()` implícito: Zod descarta por defecto las claves no
 *  declaradas. Eso es en sí una defensa — un `{"isActive":true}` colado en
 *  el envío de un formulario de paciente simplemente desaparece.
 * ===========================================================================
 */

// --- Pacientes --------------------------------------------------------------

export const patientFormSchema = z.object({
  fullName: personNameSchema,
  phoneE164: phoneE164Schema,

  /**
   * Campos opcionales: el formulario envía "" cuando están vacíos, pero la
   * base de datos espera `null`. La transformación ocurre aquí y no en cada
   * llamada, para que ningún camino se olvide de hacerla.
   */
  email: z
    .union([emailSchema, z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),

  documentId: z
    .union([safeTextSchema(30), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),

  birthDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD'), z.literal('')])
    .optional()
    .transform((value) => (value ? new Date(`${value}T00:00:00Z`) : null))
    // Una fecha de nacimiento futura es siempre un error de captura.
    .refine((date) => date === null || date <= new Date(), {
      message: 'La fecha de nacimiento no puede ser futura',
    }),

  notes: z
    .union([safeTextSchema(1000), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),

  /** Consentimiento explícito para mensajería automatizada (habeas data). */
  marketingConsent: z.coerce.boolean().default(false),
});

export type PatientFormInput = z.infer<typeof patientFormSchema>;

// --- Odontólogos ------------------------------------------------------------

export const dentistFormSchema = z.object({
  fullName: personNameSchema,
  licenseNumber: safeTextSchema(40).pipe(z.string().min(3, 'Registro profesional requerido')),
  email: emailSchema,
  phone: phoneE164Schema,

  /**
   * Se recibe como texto separado por comas ("ORTODONCIA, ESTÉTICA") porque
   * es lo natural de escribir en un input. Aquí se normaliza a array en
   * mayúsculas, sin vacíos ni duplicados.
   */
  specialties: z
    .string()
    .max(300)
    .transform((value) =>
      [
        ...new Set(
          value
            .split(',')
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean),
        ),
      ],
    )
    .refine((list) => list.length > 0, { message: 'Indica al menos una especialidad' }),

  /**
   * Porcentaje que retiene la CLÍNICA. El odontólogo recibe (100 - este).
   *
   * Se acota a 0-100 en el esquema, y además hay un CHECK constraint en
   * Postgres. Doble barrera deliberada: es el número que determina cuánto
   * dinero recibe una persona real cada quincena.
   */
  clinicCommissionPercent: percentSchema,

  isActive: z.coerce.boolean().default(true),

  /**
   * Crear también su cuenta de acceso al panel y enviarle las credenciales.
   *
   * Es opcional porque un odontólogo puede existir en el sistema sin entrar
   * nunca: se le agendan citas y se le liquida igual. Forzar una cuenta a
   * todos crearía accesos que nadie usa, y cada acceso vivo es superficie de
   * ataque.
   *
   * La contraseña NO se pide aquí: la genera el servidor. Si la escribiera
   * quien da de alta, la sabrían dos personas desde el primer día.
   */
  createAccount: z.coerce.boolean().default(false),
});

export type DentistFormInput = z.infer<typeof dentistFormSchema>;

// --- Tratamientos -----------------------------------------------------------

export const treatmentFormSchema = z.object({
  name: safeTextSchema(120).pipe(z.string().min(3, 'El nombre es demasiado corto')),

  /**
   * Código ESTABLE con el que la automatización identifica el tratamiento.
   * Se fuerza a mayúsculas y se restringe el alfabeto: si n8n depende de
   * "LIMPIEZA", renombrar el tratamiento en el panel no debe romper el flujo.
   */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,40}$/, 'Sólo mayúsculas, números y guion bajo'),

  category: safeTextSchema(60).pipe(z.string().min(2, 'Indica una categoría')),

  /**
   * El formulario pide PESOS (más natural de escribir); aquí se convierte a
   * CENTAVOS, que es como se almacena. Ver `domain/money.ts`.
   */
  priceInPesos: z.coerce
    .number()
    .min(0, 'El precio no puede ser negativo')
    .max(100_000_000, 'Precio fuera de rango')
    .transform((pesos) => Math.round(pesos * 100))
    .pipe(centsSchema),

  durationMinutes: z.coerce
    .number()
    .int()
    .min(5, 'Mínimo 5 minutos')
    .max(480, 'Máximo 8 horas'),

  /** Minutos de limpieza entre citas: bloquean la sala pero no se cobran. */
  bufferMinutes: z.coerce.number().int().min(0).max(120).default(10),

  isActive: z.coerce.boolean().default(true),
});

export type TreatmentFormInput = z.infer<typeof treatmentFormSchema>;

// --- Consultorios -----------------------------------------------------------

export const roomFormSchema = z.object({
  name: safeTextSchema(60).pipe(z.string().min(3, 'El nombre es demasiado corto')),

  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, 'Código corto: mayúsculas, números o guion'),

  /** Equipamiento como lista separada por comas. */
  equipment: z
    .string()
    .max(400)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),

  /**
   * Odontólogo dueño del consultorio. Vacío = ROTATIVO.
   *
   * Lo ajusta recepción, que es quien conoce la rotación real por
   * especialidades. No bloquea la agenda: es una preferencia fuerte, no un
   * candado — bloquearlo dejaría el consultorio vacío los días que su dueño
   * no viene, justo lo contrario de lo que quiere un coworking.
   */
  assignedDentistId: z
    .union([cuidSchema, z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),

  notes: z
    .union([safeTextSchema(300), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),

  isActive: z.coerce.boolean().default(true),
});

export type RoomFormInput = z.infer<typeof roomFormSchema>;

// --- Identificador para editar / eliminar -----------------------------------

export const entityIdSchema = z.object({ id: cuidSchema });

// --- Citas (desde el panel) -------------------------------------------------

/**
 * Alta y reprogramación de citas desde el panel.
 *
 * ⚠️  Nótese lo que NO está aquí: `endsAt`, `agreedPriceCents` ni `status`.
 *  Igual que en el endpoint del bot, el cliente envía INTENCIÓN y el
 *  servidor deriva las consecuencias a partir del tratamiento. Aceptarlos
 *  permitiría agendar una endodoncia de 5 minutos por $0 desde el navegador.
 */
export const appointmentFormSchema = z.object({
  patientId: cuidSchema,
  dentistId: cuidSchema,
  roomId: cuidSchema,
  treatmentId: cuidSchema,

  /**
   * `datetime-local` del navegador entrega "2026-08-15T14:00" SIN zona.
   * Se interpreta en la zona de la clínica, no en la del servidor: si no,
   * un despliegue en otra región desplazaría todas las citas varias horas.
   */
  startsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Fecha y hora requeridas')
    // -05:00 = America/Bogota. Fijo a propósito: la clínica es una sola y
    // está en una única zona. Si algún día hay sedes en varias, esto pasa a
    // ser un campo de la sede, no una constante.
    .transform((value) => new Date(`${value}:00-05:00`)),

  notes: z
    .union([safeTextSchema(500), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),
});

export type AppointmentFormInput = z.infer<typeof appointmentFormSchema>;

/** Cambio de estado de una cita. */
export const appointmentStatusSchema = z
  .object({
    id: cuidSchema,
    status: z.enum(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
    cancellationReason: z
      .union([safeTextSchema(300), z.literal('')])
      .optional()
      .transform((value) => (value ? value : null)),
  })
  // Cancelar sin motivo deja la operación sin trazabilidad.
  .refine((data) => data.status !== 'CANCELLED' || Boolean(data.cancellationReason), {
    message: 'Indica el motivo de la cancelación',
    path: ['cancellationReason'],
  });

/**
 * Procedimiento añadido a una cita durante la consulta.
 *
 * ⚠️  Igual que en el alta: NO se acepta `commissionPercent`. El reparto lo
 *  decide el servidor a partir del tratamiento y del acuerdo aprobado con el
 *  odontólogo. Si viajara en el formulario, cualquiera podría añadir una
 *  radiografía marcándola como repartible y cobrar comisión por un trabajo
 *  que hizo la clínica.
 *
 *  El precio SÍ se acepta, y vacío significa "el que corresponda". Es la
 *  única forma de cotizar un conducto, que no tiene precio cerrado hasta ver
 *  la radiografía.
 */
export const appointmentAddonSchema = z.object({
  appointmentId: cuidSchema,
  treatmentId: cuidSchema,

  priceInPesos: z
    .union([z.string(), z.number()])
    .optional()
    // Vacío → `null`: se aplica el precio de lista o el pactado. Distinto de
    // un 0, que sería un procedimiento regalado y es una decisión explícita.
    .transform((value) => (value === '' || value == null ? null : Number(value)))
    .refine((value) => value === null || (Number.isFinite(value) && value >= 0), {
      message: 'El precio no puede ser negativo',
    })
    .refine((value) => value === null || value <= 1_000_000, {
      message: 'Precio fuera de rango',
    })
    .transform((value) => (value === null ? null : Math.round(value * 100))),

  notes: z
    .union([safeTextSchema(300), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),
});

export type AppointmentAddonInput = z.infer<typeof appointmentAddonSchema>;

// --- Cita agendada por el propio odontólogo ---------------------------------

/**
 * La doctora agenda desde su propia agenda.
 *
 * ⚠️  Lo que NO está aquí, y es el punto entero:
 *
 *  · `dentistId` — es ELLA. Sale de la sesión. Si viniera del formulario,
 *    podría meterle una cita a una compañera en su horario.
 *  · `roomId` — lo asigna el servidor, y desde que existen los consultorios
 *    fijos prueba primero el suyo. Elegir sala a mano permitiría ocupar la
 *    de otra persona.
 *  · `endsAt` y el precio — los deriva el servidor del tratamiento. Es la
 *    misma regla que aplica al bot: el cliente manda intención, el servidor
 *    decide las consecuencias.
 *
 * El paciente se identifica por TELÉFONO, no por un selector: el odontólogo
 * no tiene acceso al listado de pacientes de la clínica y no debe tenerlo.
 * Si el número ya existe se reutiliza la ficha; si no, se crea. Es
 * exactamente lo que hace el bot.
 */
export const ownAppointmentSchema = z.object({
  patientPhone: phoneE164Schema,

  patientName: z
    .union([personNameSchema, z.literal('')])
    .optional()
    .transform((value) => (value ? value : undefined)),

  treatmentCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,40}$/, 'Elige un tratamiento'),

  /** `datetime-local` del navegador: "2026-08-20T14:00", sin zona. */
  startsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Fecha y hora requeridas')
    // -04:00 = America/Caracas. Igual que en el alta desde recepción.
    .transform((value) => new Date(`${value}:00-04:00`)),

  notes: z
    .union([safeTextSchema(500), z.literal('')])
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type OwnAppointmentInput = z.infer<typeof ownAppointmentSchema>;

// --- Instrumental del odontólogo --------------------------------------------

/**
 * Una pieza del instrumental. Es SUYA: el fórceps, la turbina, la cureta.
 *
 * ⚠️  No lleva `dentistId`: el dueño lo decide el servidor. Cuando lo edita el
 *  propio odontólogo es él; cuando lo hace el administrador, el que eligió en
 *  el desplegable. Aceptarlo del formulario dejaría meterle instrumental a
 *  otro cambiando un id a mano.
 */
export const instrumentSchema = z.object({
  name: safeTextSchema(120).pipe(z.string().min(2, 'Escribe el nombre del instrumento')),

  category: z
    .union([safeTextSchema(60), z.literal('')])
    .optional()
    .transform((value) => (value ? value.toUpperCase() : null)),

  quantity: z.coerce
    .number()
    .int('Tiene que ser un número entero')
    .min(0, 'No puede ser negativo')
    .max(9999, 'Cantidad fuera de rango')
    .default(1),

  serialNumber: z
    .union([safeTextSchema(80), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),

  condition: z
    .enum(['GOOD', 'NEEDS_SERVICE', 'OUT_OF_SERVICE', 'LOST'])
    .default('GOOD'),

  location: z
    .union([safeTextSchema(80), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),

  notes: z
    .union([safeTextSchema(300), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),

  /** Fecha del último mantenimiento. 'YYYY-MM-DD' o vacío. */
  lastServicedOn: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'), z.literal('')])
    .optional()
    // Mediodía en hora de la clínica: es un DÍA, no un instante, y a mediodía
    // ningún desfase horario lo mueve de fecha.
    .transform((value) => (value ? new Date(`${value}T12:00:00-04:00`) : null)),
});

export type InstrumentFormInput = z.infer<typeof instrumentSchema>;

// --- Solicitud de cambio de horario -----------------------------------------

/** Un bloque de la semana propuesta. */
const scheduleBlockSchema = z
  .object({
    weekday: z.coerce.number().int().min(0, 'Día inválido').max(6, 'Día inválido'),
    startMinute: z.coerce.number().int().min(0).max(1440),
    endMinute: z.coerce.number().int().min(0).max(1440),
  })
  .refine((block) => block.endMinute > block.startMinute, {
    message: 'La hora de fin tiene que ser posterior a la de inicio',
    path: ['endMinute'],
  });

/**
 * Semana completa propuesta por un odontólogo.
 *
 * Se envía ENTERA, no como un delta, porque se aprueba o se rechaza entera:
 * una aprobación parcial dejaría un horario que nadie propuso.
 *
 * `proposedBlocks` llega como JSON en un campo oculto: un formulario HTML no
 * sabe mandar una lista de objetos, y montar `blocks[0][weekday]` sería más
 * frágil que serializar una vez.
 */
export const scheduleRequestSchema = z.object({
  proposedBlocks: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Horario mal formado' });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(scheduleBlockSchema)
        .min(1, 'Añade al menos un bloque horario')
        .max(21, 'Demasiados bloques'),
    )
    // Dos bloques que se pisan el mismo día harían ambiguo el horario: el bot
    // no sabría cuál de los dos ofrecer.
    .refine(
      (blocks) =>
        !blocks.some((a, i) =>
          blocks.some(
            (b, j) =>
              i !== j &&
              a.weekday === b.weekday &&
              a.startMinute < b.endMinute &&
              b.startMinute < a.endMinute,
          ),
        ),
      { message: 'Hay bloques que se solapan el mismo día' },
    ),

  reason: z
    .union([safeTextSchema(300), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),
});

/** Aprobación o rechazo de un cambio de horario. */
export const scheduleReviewSchema = z
  .object({
    id: cuidSchema,
    status: z.enum(['APPROVED', 'REJECTED']),
    reviewNotes: z
      .union([safeTextSchema(300), z.literal('')])
      .optional()
      .transform((value) => (value ? value : null)),
  })
  .refine((data) => data.status !== 'REJECTED' || Boolean(data.reviewNotes), {
    message: 'Indica por qué se rechaza',
    path: ['reviewNotes'],
  });

// --- Cambio de contraseña ---------------------------------------------------

/**
 * Cambio de contraseña de la propia cuenta.
 *
 * ⚠️  No lleva `userId`: la cuenta que se modifica es SIEMPRE la de la
 *  sesión. Aceptarlo del formulario convertiría esto en «cambiar la
 *  contraseña de cualquiera sabiendo su id».
 *
 * La política sigue a NIST SP 800-63B: manda la LONGITUD. No se exige
 * mayúscula + número + símbolo porque esas reglas empujan a `Password1!`.
 */
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Escribe tu contraseña actual'),

    newPassword: z
      .string()
      .min(
        PASSWORD_POLICY.minLength,
        `La contraseña nueva debe tener al menos ${PASSWORD_POLICY.minLength} caracteres`,
      )
      .max(PASSWORD_POLICY.maxLength, 'La contraseña es demasiado larga'),

    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Las dos contraseñas no coinciden',
    path: ['confirmPassword'],
  })
  // Cambiarla por la misma no cierra las sesiones de nadie: si el motivo era
  // que alguien la conocía, seguiría conociéndola.
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'La contraseña nueva tiene que ser distinta de la actual',
    path: ['newPassword'],
  });

export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

// --- Tarifas pactadas por odontólogo ----------------------------------------

/**
 * Precio y reparto pactados para un odontólogo y un tratamiento.
 *
 * ⚠️  Nótese lo que NO está aquí: `status`. Lo decide el servidor a partir
 *  del ROL de quien envía —el administrador guarda aprobado, el odontólogo
 *  sólo puede proponer—. Si viajara en el formulario, un odontólogo podría
 *  aprobarse su propia tarifa y cambiar lo que se le cobra a los pacientes.
 *
 * Los dos campos son opcionales por separado: se puede pactar sólo el precio
 * (manteniendo la comisión general), sólo la comisión, o ambos.
 */
export const dentistTreatmentSchema = z
  .object({
    dentistId: cuidSchema,
    treatmentId: cuidSchema,

    customPriceInPesos: z
      .union([z.string(), z.number()])
      .optional()
      .transform((value) => (value === '' || value == null ? null : Number(value)))
      .refine((value) => value === null || (Number.isFinite(value) && value >= 0), {
        message: 'El precio no puede ser negativo',
      })
      .refine((value) => value === null || value <= 1_000_000, {
        message: 'Precio fuera de rango',
      })
      .transform((value) => (value === null ? null : Math.round(value * 100))),

    customCommissionPercent: z
      .union([z.string(), z.number()])
      .optional()
      .transform((value) => (value === '' || value == null ? null : Number(value)))
      .refine(
        (value) =>
          value === null || (Number.isInteger(value) && value >= 0 && value <= 100),
        { message: 'El porcentaje debe ser un entero entre 0 y 100' },
      ),
  })
  // Un acuerdo que no cambia ni el precio ni el reparto no es un acuerdo:
  // guardarlo sólo añadiría una fila que no hace nada.
  .refine(
    (data) => data.customPriceInPesos !== null || data.customCommissionPercent !== null,
    {
      message: 'Indica al menos un precio o una comisión distintos de los de lista',
      path: ['customPriceInPesos'],
    },
  );

export type DentistTreatmentFormInput = z.infer<typeof dentistTreatmentSchema>;

/** Aprobación o rechazo de una propuesta de tarifa. */
export const tariffReviewSchema = z
  .object({
    id: cuidSchema,
    status: z.enum(['APPROVED', 'REJECTED']),
    reviewNotes: z
      .union([safeTextSchema(300), z.literal('')])
      .optional()
      .transform((value) => (value ? value : null)),
  })
  // Rechazar sin motivo garantiza que se vuelva a proponer lo mismo.
  .refine((data) => data.status !== 'REJECTED' || Boolean(data.reviewNotes), {
    message: 'Indica por qué se rechaza',
    path: ['reviewNotes'],
  });

// --- Ajustes de la clínica --------------------------------------------------

export const clinicSettingsSchema = z
  .object({
    clinicName: safeTextSchema(120).pipe(z.string().min(2, 'Nombre requerido')),
    taxId: z.union([safeTextSchema(30), z.literal('')]).optional().transform((v) => v || null),
    address: z.union([safeTextSchema(200), z.literal('')]).optional().transform((v) => v || null),
    phone: z.union([safeTextSchema(30), z.literal('')]).optional().transform((v) => v || null),
    email: z.union([emailSchema, z.literal('')]).optional().transform((v) => v || null),

    /** Comisión por defecto para odontólogos nuevos. */
    defaultCommissionPercent: percentSchema,

    /** Jornada en HH:MM; se convierte a minutos desde medianoche. */
    openingTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'Formato HH:MM')
      .transform((v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5))),
    closingTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'Formato HH:MM')
      .transform((v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5))),

    slotMinutes: z.coerce.number().int().min(5).max(120),

    /** Moneda en la que se muestran los importes por defecto. */
    displayCurrency: z.enum(['USD', 'VES']),
    /** Fuente de tasa para convertir a bolívares. */
    preferredRateSource: z.enum(['BCV', 'PARALELO']),
  })
  // Una jornada que cierra antes de abrir dejaría la agenda sin huecos y
  // el motivo sería invisible desde la UI.
  .refine((d) => d.closingTime > d.openingTime, {
    message: 'La hora de cierre debe ser posterior a la de apertura',
    path: ['closingTime'],
  });

export type ClinicSettingsFormInput = z.infer<typeof clinicSettingsSchema>;

// --- Cobros -----------------------------------------------------------------

/**
 * Registro de un cobro desde el mostrador.
 *
 * ⚠️  Lo que NO se acepta del cliente: el reparto 40/60 y la tasa de cambio.
 *  Ambos los calcula el servidor — el reparto con el porcentaje vigente del
 *  odontólogo, la tasa con la última del BCV. Aceptarlos del formulario
 *  permitiría alterar la contabilidad desde el navegador.
 *
 *  `amountCents` SÍ se acepta porque el monto real puede diferir del pactado:
 *  descuento, copago de seguro, abono parcial.
 */
export const paymentFormSchema = z.object({
  appointmentId: cuidSchema,

  /** El formulario pide DÓLARES; aquí se convierte a centavos. */
  amountInUsd: z.coerce
    .number()
    .min(0, 'El monto no puede ser negativo')
    .max(1_000_000, 'Monto fuera de rango')
    .transform((usd) => Math.round(usd * 100))
    .pipe(centsSchema),

  method: z.enum(['CASH', 'CARD', 'TRANSFER', 'INSURANCE']),

  /**
   * Etiqueta del medio concreto ("Pago móvil Banesco").
   *
   * Se acepta del formulario pero NO se confía para nada contable: el reparto
   * y la caja se agrupan por `method`, que es el enum. Esto es descripción,
   * no clasificación.
   */
  methodLabel: z
    .union([safeTextSchema(60), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),

  /**
   * Reparto puntual distinto al habitual: el 50/50 que a veces se pacta.
   *
   * Vacío = reglas normales. Se acepta del formulario —a diferencia del
   * reparto calculado, que jamás— porque es una decisión de negocio que toma
   * recepción con el paciente delante. Queda registrada en la auditoría junto
   * con quién la hizo.
   */
  commissionOverride: z
    .union([percentSchema, z.literal('')])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),

  externalReference: z
    .union([safeTextSchema(120), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),
});

export type PaymentFormInput = z.infer<typeof paymentFormSchema>;

/**
 * Cierre de caja del día.
 *
 * Sólo se acepta lo que recepción CUENTA A MANO. Lo esperado, la diferencia y
 * los totales los calcula el servidor a partir de los cobros registrados: si
 * el navegador pudiera mandar el importe esperado, un descuadre se taparía
 * cambiando un número en las herramientas de desarrollo, que es exactamente
 * lo que un arqueo existe para impedir.
 */
export const cashClosingSchema = z.object({
  /** Día que se cierra, 'YYYY-MM-DD' en hora de la clínica. */
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),

  /** Efectivo contado en la gaveta, en BOLÍVARES. */
  countedCashBs: z.coerce
    .number()
    .min(0, 'El efectivo contado no puede ser negativo')
    // Techo alto pero finito: con la inflación venezolana un día normal puede
    // superar el millón de bolívares, pero mil millones es un dedo pegado.
    .max(1_000_000_000, 'Importe fuera de rango'),

  notes: z
    .union([safeTextSchema(300), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),
});

export type CashClosingFormInput = z.infer<typeof cashClosingSchema>;

/**
 * Medio de pago configurable.
 *
 * `instructions` es texto libre porque cada medio necesita campos distintos:
 * un pago móvil pide banco, teléfono y cédula; un Zelle sólo un correo. Una
 * tabla de columnas fijas dejaría la mitad vacías en cada fila.
 *
 * No se sanitiza el HTML: este texto se pinta con React —que escapa— y se le
 * dicta al paciente por WhatsApp, donde no hay HTML que ejecutar. Filtrar
 * caracteres aquí sólo conseguiría mutilar un número de cuenta legítimo.
 */
export const paymentMethodSchema = z.object({
  label: safeTextSchema(60),

  /** Categoría contable. Es lo que agrupa el cierre de caja. */
  kind: z.enum(['CASH', 'CARD', 'TRANSFER', 'INSURANCE']),

  instructions: z
    .union([safeTextSchema(500), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),

  currency: z.enum(['VES', 'USD']),

  sortOrder: z.coerce.number().int().min(0).max(99).default(0),

  isActive: z.coerce.boolean().default(true),
});

export type PaymentMethodFormInput = z.infer<typeof paymentMethodSchema>;

/**
 * Expediente clínico transcrito por la asistente.
 *
 * Casi todo es opcional a propósito: el papel llega a medio llenar y hay que
 * poder guardarlo igual. Un formulario que exigiera todos los campos obligaría
 * a inventarse datos clínicos para poder guardar, que es peor que un
 * expediente incompleto.
 */
export const clinicalRecordSchema = z.object({
  patientId: cuidSchema,

  // Banderas de riesgo. Van como casillas y no dentro del texto libre porque
  // tienen que poder consultarse antes de un procedimiento.
  hypertension: z.coerce.boolean().default(false),
  diabetes: z.coerce.boolean().default(false),
  heartDisease: z.coerce.boolean().default(false),
  anticoagulants: z.coerce.boolean().default(false),
  pregnant: z.coerce.boolean().default(false),

  allergies: z.union([safeTextSchema(500), z.literal('')]).optional().transform((v) => v || null),
  currentMedications: z.union([safeTextSchema(500), z.literal('')]).optional().transform((v) => v || null),
  medicalNotes: z.union([safeTextSchema(1000), z.literal('')]).optional().transform((v) => v || null),
  chiefComplaint: z.union([safeTextSchema(500), z.literal('')]).optional().transform((v) => v || null),
  treatmentPlan: z.union([safeTextSchema(2000), z.literal('')]).optional().transform((v) => v || null),

  /**
   * Odontograma serializado desde el formulario.
   *
   * Llega como JSON en un campo oculto porque son 32 piezas: mandarlas como 32
   * campos sueltos haría el formulario ilegible y el parseo frágil.
   *
   * Se valida la FORMA, no sólo que sea JSON: sin esto, cualquiera podría
   * guardar un objeto arbitrario en una columna que luego se pinta.
   */
  odontogram: z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    })
    .pipe(
      z
        .record(
          // Clave: notación FDI de dos dígitos.
          z.string().regex(/^[1-8][1-8]$/),
          z.object({
            estado: z.enum([
              'SANO', 'CARIES', 'OBTURADO', 'CORONA',
              'AUSENTE', 'EXTRACCION', 'IMPLANTE', 'ENDODONCIA',
            ]),
            notas: safeTextSchema(120).optional(),
          }),
        )
        .nullable(),
    ),
});

export type ClinicalRecordFormInput = z.infer<typeof clinicalRecordSchema>;

/** Una línea de la hoja de evolución. */
export const clinicalEntrySchema = z.object({
  patientId: cuidSchema,
  /** Fecha del PAPEL, no la de hoy: se transcribe con días de retraso. */
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  dentistId: z.union([cuidSchema, z.literal('')]).optional().transform((v) => v || null),
  procedure: safeTextSchema(300).pipe(z.string().min(3, 'Describe el procedimiento')),
  /** Piezas tratadas, separadas por coma o espacio: "16, 17". */
  teeth: z
    .string()
    .optional()
    .transform((raw) =>
      (raw ?? '')
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter((t) => /^[1-8][1-8]$/.test(t)),
    ),
  notes: z.union([safeTextSchema(500), z.literal('')]).optional().transform((v) => v || null),
});
