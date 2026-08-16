import 'server-only';
import { env } from '@/backend/config/env';

/**
 * ===========================================================================
 *  Envío de mensajes a WhatsApp
 * ===========================================================================
 *  SEPARACIÓN CLAVE: registrar un mensaje y ENTREGARLO son dos cosas
 *  distintas.
 *
 *  El mensaje se guarda siempre en la base de datos —así el historial de la
 *  conversación queda completo aunque el proveedor falle— y la entrega se
 *  intenta después. Si falla, el mensaje queda marcado como `FAILED` y el
 *  agente lo ve en la interfaz. Lo contrario (no guardar hasta que se
 *  entregue) haría que un fallo de red borrara lo que la persona escribió.
 *
 *  ---------------------------------------------------------------------
 *  CÓMO SE ENTREGA
 *  ---------------------------------------------------------------------
 *  Este proyecto NO habla directamente con la API de Meta: el bot ya vive en
 *  n8n, que es quien tiene las credenciales y la sesión de WhatsApp.
 *  Duplicar esa integración aquí significaría mantener dos caminos de salida
 *  y dos juegos de credenciales.
 *
 *  En su lugar se hace un POST al webhook de n8n definido en
 *  `WHATSAPP_OUTBOUND_WEBHOOK_URL`, firmado con el MISMO HMAC que usan los
 *  endpoints entrantes. n8n lo relaya a WhatsApp.
 *
 *  Si la variable no está configurada, el mensaje se guarda y se marca
 *  `PENDING`: el sistema es usable para dejar constancia interna, y la
 *  interfaz avisa de que la entrega no está conectada. Nunca se finge que
 *  se envió.
 * ===========================================================================
 */

import { createHmac } from 'node:crypto';

export type DeliveryOutcome =
  | { status: 'SENT' }
  | { status: 'PENDING'; reason: string }
  | { status: 'FAILED'; reason: string };

/** Límite de WhatsApp para mensajes de texto. */
export const WHATSAPP_MAX_LENGTH = 4096;

/** Corta la espera: el agente no debe quedarse mirando un spinner eterno. */
const DELIVERY_TIMEOUT_MS = 8000;

/**
 * Entrega un mensaje saliente a través del webhook de n8n.
 *
 * Nunca lanza: devuelve el resultado para que el llamador lo persista. Un
 * fallo de entrega no debe tumbar la petición ni perder el mensaje.
 */
export async function deliverMessage(params: {
  phoneE164: string;
  body: string;
  conversationId: string;
  messageId: string;
}): Promise<DeliveryOutcome> {
  const webhookUrl = process.env.WHATSAPP_OUTBOUND_WEBHOOK_URL;

  // Sin webhook configurado no se puede entregar. Se dice claramente en vez
  // de marcarlo como enviado.
  if (!webhookUrl) {
    return {
      status: 'PENDING',
      reason: 'Falta configurar WHATSAPP_OUTBOUND_WEBHOOK_URL',
    };
  }

  const payload = JSON.stringify({
    conversationId: params.conversationId,
    messageId: params.messageId,
    to: params.phoneE164,
    body: params.body,
  });

  // Misma firma HMAC que los endpoints entrantes: n8n ya sabe verificarla,
  // así que la integración es simétrica y no hay un segundo esquema de
  // autenticación que mantener.
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', env.AUTOMATION_HMAC_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'X-Automation-Timestamp': String(timestamp),
        'X-Automation-Signature': signature,
      },
      body: payload,
    });

    if (!response.ok) {
      return {
        status: 'FAILED',
        // Se guarda el código, no el cuerpo: la respuesta de un proveedor
        // externo puede traer datos que no queremos persistir.
        reason: `El proveedor respondió ${response.status}`,
      };
    }

    return { status: 'SENT' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'whatsapp.delivery_failed',
        conversationId: params.conversationId,
        messageId: params.messageId,
        message,
      }),
    );

    return {
      status: 'FAILED',
      reason: message.includes('timeout') ? 'Tiempo de espera agotado' : 'Error de conexión',
    };
  }
}

/** ¿Está configurada la salida hacia WhatsApp? Lo consulta la UI para avisar. */
export function isOutboundConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_OUTBOUND_WEBHOOK_URL);
}

/**
 * Avisa a n8n de que alguien movió el interruptor de la IA desde el panel.
 *
 * ---------------------------------------------------------------------
 * ESTO ES UN AVISO, NO LA FUENTE DE LA VERDAD
 * ---------------------------------------------------------------------
 * El bot debe consultar `POST /api/automation/conversation` en CADA mensaje
 * entrante; ése es el mecanismo fiable. Este webhook sólo permite que n8n
 * reaccione en el momento —cerrar una espera, cancelar un seguimiento
 * programado, apuntarlo en su propio registro— sin tener que esperar al
 * siguiente mensaje del paciente.
 *
 * Si se confiara SÓLO en este aviso, un webhook perdido dejaría al bot
 * contestando en un chat que un agente ya tomó, y nadie se enteraría.
 *
 * Nunca lanza: que falle el aviso no puede impedir que el agente apague la
 * IA. El interruptor ya está guardado en la base cuando esto se ejecuta.
 */
export async function notifyAiToggled(params: {
  conversationId: string;
  phoneE164: string;
  aiEnabled: boolean;
  reason: string | null;
  changedBy: string;
}): Promise<void> {
  const webhookUrl = process.env.WHATSAPP_EVENTS_WEBHOOK_URL;
  if (!webhookUrl) return;

  const payload = JSON.stringify({
    event: params.aiEnabled ? 'ai.enabled' : 'ai.disabled',
    conversationId: params.conversationId,
    phone: params.phoneE164,
    aiEnabled: params.aiEnabled,
    reason: params.reason,
    changedBy: params.changedBy,
    at: new Date().toISOString(),
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', env.AUTOMATION_HMAC_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      // Corto: el agente está esperando a que la interfaz responda. Este
      // aviso no puede retrasar el apagado de la IA.
      signal: AbortSignal.timeout(4000),
      headers: {
        'Content-Type': 'application/json',
        'X-Automation-Timestamp': String(timestamp),
        'X-Automation-Signature': signature,
      },
      body: payload,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'whatsapp.toggle_notify_failed',
        conversationId: params.conversationId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
