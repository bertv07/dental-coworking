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
