import { z } from 'zod';
import {
  cuidSchema,
  isoDateTimeSchema,
  phoneE164Schema,
  personNameSchema,
  safeTextSchema,
  idempotencyKeySchema,
  centsSchema,
} from '@/backend/validators/common';

/**
 * ===========================================================================
 *  Esquemas de agendamiento
 * ===========================================================================
 *  Contrato de entrada de los endpoints que consume la automatización.
 *
 *  Regla de diseño que atraviesa todo el archivo: el cliente envía INTENCIÓN,
 *  nunca CONSECUENCIAS. Pide "esta cita, a esta hora, este tratamiento". El
 *  servidor decide la duración, el precio y la comisión.
 *
 *  Si se dejara al bot enviar `endsAt` o `agreedPriceCents`, un flujo de n8n
 *  mal configurado —o alguien con la llave HMAC— podría agendar una
 *  ortodoncia de 5 minutos por $0.
 * ===========================================================================
 */

/**
 * POST /api/automation/appointments — crear cita desde WhatsApp.
 *
 * ⚠️  Nótese lo que NO está aquí: `endsAt`, `agreedPriceCents`, `status`.
 *  Los calcula el servidor. Ver `scheduling.service.ts`.
 */
export const createAppointmentSchema = z.object({
  /**
   * Teléfono del paciente. Es la llave con la que se le encuentra o se le
   * crea: el bot conoce el número de WhatsApp, no el id interno.
   */
  patientPhone: phoneE164Schema,

  /**
   * Nombre, sólo necesario si el paciente aún no existe.
   * En un primer contacto, el bot lo pregunta y lo manda aquí.
   */
  patientName: personNameSchema.optional(),

  /** Odontólogo solicitado. Si se omite, el servidor asigna uno disponible. */
  dentistId: cuidSchema.optional(),

  /**
   * Tratamiento por CÓDIGO estable ("ORTHO_CTRL"), no por nombre.
   * Así renombrar "Limpieza" a "Profilaxis" en el panel no rompe los flujos
   * de n8n que ya están en producción.
   */
  treatmentCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,40}$/, 'Código de tratamiento inválido'),

  /** Inicio solicitado, ISO 8601 con zona horaria obligatoria. */
  startsAt: isoDateTimeSchema,

  /** Consultorio preferido. Si se omite, el servidor busca uno libre. */
  roomId: cuidSchema.optional(),

  notes: safeTextSchema(500).optional(),

  /** Obligatoria: n8n reintenta y sin esto se duplican citas. */
  idempotencyKey: idempotencyKeySchema,
})
  /**
   * Regla de negocio: no se agenda en el pasado.
   *
   * Se conceden 5 minutos de margen para absorber desfases de reloj entre
   * n8n y el servidor. Sin ese margen, una petición legítima enviada "ahora
   * mismo" puede rechazarse porque el reloj del emisor va 30 s atrasado.
   */
  .refine((data) => data.startsAt.getTime() > Date.now() - 5 * 60 * 1000, {
    message: 'No se pueden agendar citas en el pasado',
    path: ['startsAt'],
  })
  /** Techo de 12 meses: bloquea agendamientos absurdos por error de formato. */
  .refine(
    (data) => data.startsAt.getTime() < Date.now() + 365 * 24 * 60 * 60 * 1000,
    { message: 'No se pueden agendar citas con más de un año de antelación', path: ['startsAt'] },
  );

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/**
 * GET/POST /api/automation/availability — consultar huecos libres.
 * El bot llama a esto ANTES de proponerle horarios al paciente.
 */
export const checkAvailabilitySchema = z.object({
  treatmentCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,40}$/, 'Código de tratamiento inválido'),

  /** Día a consultar (se evalúa completo en la zona horaria de la clínica). */
  date: isoDateTimeSchema,

  /** Filtrar por un odontólogo concreto, si el paciente lo pidió por nombre. */
  dentistId: cuidSchema.optional(),

  /** Máximo de huecos a devolver. Acotado: el bot sólo puede ofrecer unos pocos. */
  maxSlots: z.number().int().min(1).max(20).default(6),
});

export type CheckAvailabilityInput = z.infer<typeof checkAvailabilitySchema>;

/**
 * POST /api/automation/payments — reportar un pago.
 *
 * `amountCents` SÍ se acepta del cliente aquí (a diferencia del precio al
 * agendar) porque el monto real cobrado puede diferir del pactado: descuento,
 * copago del seguro, abono parcial. Aun así el servidor valida que sea
 * coherente con la cita y calcula el reparto 40/60 por su cuenta.
 */
export const reportPaymentSchema = z.object({
  appointmentId: cuidSchema,
  amountCents: centsSchema,
  method: z.enum(['CASH', 'CARD', 'TRANSFER', 'INSURANCE']),
  /** Referencia de la pasarela o número de voucher. */
  externalReference: safeTextSchema(120).optional(),
  idempotencyKey: idempotencyKeySchema,
});

export type ReportPaymentInput = z.infer<typeof reportPaymentSchema>;

/** PATCH — cambiar el estado de una cita (confirmar, cancelar, no-show). */
export const updateAppointmentStatusSchema = z.object({
  appointmentId: cuidSchema,
  status: z.enum(['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
  cancellationReason: safeTextSchema(300).optional(),
})
  /** Cancelar sin motivo deja la operación sin trazabilidad. */
  .refine(
    (data) => data.status !== 'CANCELLED' || Boolean(data.cancellationReason),
    { message: 'Se requiere un motivo para cancelar', path: ['cancellationReason'] },
  );

/** Toggle de la IA en una conversación. Lo usa el panel, no la automatización. */
export const toggleAiSchema = z.object({
  conversationId: cuidSchema,
  aiEnabled: z.boolean(),
  /** Al APAGAR se pide motivo: sin él nadie sabe por qué el bot está mudo. */
  reason: safeTextSchema(200).optional(),
}).refine((data) => data.aiEnabled || Boolean(data.reason), {
  message: 'Indica el motivo por el que desactivas la IA',
  path: ['reason'],
});

/**
 * Mensaje saliente escrito por un humano en el monitor de WhatsApp.
 *
 * Sobre el cuerpo: se valida longitud y caracteres de control, pero NO se
 * "limpia" el HTML. React escapa al renderizar, y un filtro de etiquetas
 * aquí sólo conseguiría mutilar mensajes legítimos — un paciente que escribe
 * "cuesta <200$" no está atacando a nadie.
 */
export const sendMessageSchema = z.object({
  conversationId: cuidSchema,

  body: z
    .string()
    .trim()
    .min(1, 'El mensaje no puede estar vacío')
    // 4096 es el límite de WhatsApp para mensajes de texto. Rechazarlo aquí
    // evita un fallo del proveedor a mitad de la operación.
    .max(4096, 'WhatsApp admite como máximo 4096 caracteres')
    // Se permiten \n y \t: los saltos de línea son legítimos en un mensaje.
    // eslint-disable-next-line no-control-regex
    .refine((value) => !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(value), {
      message: 'El mensaje contiene caracteres no permitidos',
    }),
});
