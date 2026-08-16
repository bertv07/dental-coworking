import { z } from 'zod';
import { phoneE164Schema, personNameSchema, safeTextSchema } from '@/backend/validators/common';

/**
 * ===========================================================================
 *  Esquemas de los endpoints de conversación
 * ===========================================================================
 *  Contrato de entrada de lo que n8n manda al panel sobre los chats.
 *
 *  Misma regla que en el agendamiento: el cliente manda HECHOS observados
 *  ("este número escribió esto"), nunca CONSECUENCIAS ("marca este chat como
 *  leído", "pon la IA en este estado"). El estado lo decide el servidor.
 * ===========================================================================
 */

/** POST /api/automation/conversation — ¿puedo contestar a este número? */
export const conversationStateSchema = z.object({
  phone: phoneE164Schema,

  /**
   * Nombre del perfil de WhatsApp. Sólo se usa si el número es nuevo y no
   * corresponde a ningún paciente: sirve para que el monitor no muestre una
   * fila que dice sólo "+584141234567".
   *
   * Nunca pisa el nombre de un paciente ya registrado — el nombre de la ficha
   * es el bueno, no el que cada quien se puso en WhatsApp.
   */
  displayName: personNameSchema.optional(),
});

/** POST /api/automation/messages — espejo del mensaje en el panel. */
export const recordMessageSchema = z.object({
  phone: phoneE164Schema,

  direction: z.enum(['INBOUND', 'OUTBOUND']),

  /**
   * Quién lo escribió.
   *
   * `HUMAN_AGENT` NO se acepta aquí a propósito: un mensaje de agente humano
   * nace en el panel, con la sesión de esa persona detrás. Si la
   * automatización pudiera declararlo, el historial no distinguiría lo que
   * dijo el bot de lo que dijo una persona — y esa distinción es justo lo que
   * hace auditable la conversación.
   */
  author: z.enum(['PATIENT', 'AI_BOT', 'SYSTEM']),

  body: z
    .string()
    .trim()
    .min(1, 'El mensaje no puede estar vacío')
    // Holgado: aquí caben transcripciones de audio y descripciones de imagen,
    // que son bastante más largas que un mensaje escrito.
    .max(8000, 'Mensaje demasiado largo')
    // eslint-disable-next-line no-control-regex
    .refine((value) => !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(value), {
      message: 'El mensaje contiene caracteres no permitidos',
    }),

  /**
   * URL del adjunto original (nota de voz, foto).
   *
   * Se restringe a http/https: sin esta comprobación, un `javascript:` o un
   * `data:` acabaría en un `href` del monitor.
   */
  mediaUrl: z
    .string()
    .url('URL de adjunto inválida')
    .refine((value) => /^https?:\/\//i.test(value), {
      message: 'El adjunto debe ser http o https',
    })
    .optional(),

  /** Id del mensaje en WhatsApp (`wamid...`). Hace la operación idempotente. */
  externalId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_\-=.:]+$/, 'Identificador externo inválido')
    .optional(),
});

/** POST /api/automation/handoff — el bot se calla y pide un humano. */
export const handoffSchema = z.object({
  phone: phoneE164Schema,

  /**
   * Motivo, obligatorio.
   *
   * Aparece en el monitor antes de que el agente abra el chat: llegar y leer
   * "el paciente reclama por un cobro" ahorra los treinta segundos de
   * reconstruir la conversación desde cero. Un escalamiento sin motivo
   * obliga a hacerlo siempre.
   */
  reason: safeTextSchema(200),
});
