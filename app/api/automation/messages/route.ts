import type { NextRequest } from 'next/server';
import { repository } from '@/backend/repositories';
import { readSignedBody } from '@/backend/http/automation-request';
import { recordMessageSchema } from '@/backend/validators/automation.schema';
import { ok, failValidation, failInternal, newRequestId } from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/messages
 * ===========================================================================
 *  ESPEJO DE LA CONVERSACIÓN EN EL PANEL.
 *
 *  n8n llama aquí DOS veces por turno: una con lo que escribió el paciente y
 *  otra con lo que respondió el bot.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ NO BASTA CON QUE WHATSAPP LO TENGA
 *  ---------------------------------------------------------------------
 *  Porque el monitor del panel es donde recepción decide si intervenir. Un
 *  monitor que sólo muestra los mensajes escritos desde el panel enseña una
 *  conversación a medias: se vería la respuesta del agente pero no la
 *  pregunta del paciente. Nadie puede retomar un chat así.
 *
 *  Además es lo que alimenta la lista de "requieren atención" y el contador
 *  de no leídos.
 *
 *  ---------------------------------------------------------------------
 *  AUDIOS E IMÁGENES
 *  ---------------------------------------------------------------------
 *  El sistema NO transcribe ni interpreta: eso lo hace n8n antes de llamar.
 *  Aquí se guarda el texto que resultó (la transcripción del audio o la
 *  descripción de la imagen) y la URL del archivo en `mediaUrl`, para que el
 *  agente humano pueda oír o ver el original si la transcripción es dudosa.
 *
 *  ---------------------------------------------------------------------
 *  CUERPO
 *  ---------------------------------------------------------------------
 *    {
 *      "phone":      "+584141234567",
 *      "direction":  "INBOUND" | "OUTBOUND",
 *      "author":     "PATIENT" | "AI_BOT" | "SYSTEM",
 *      "body":       "Hola, quiero una cita",
 *      "mediaUrl":   "https://...",        // opcional
 *      "externalId": "wamid.HBgM..."       // opcional pero MUY recomendable
 *    }
 *
 *  `externalId` es el id del mensaje en WhatsApp. Mandarlo hace la operación
 *  IDEMPOTENTE: si n8n reintenta, el mensaje no se duplica y la respuesta
 *  trae `"duplicate": true`.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const signed = await readSignedBody(request, {
      endpoint: 'messages',
      kind: 'write',
      requestId,
      // Más holgado que el resto: una transcripción de audio larga o la
      // descripción de una imagen ocupan bastante más que un texto suelto.
      maxBytes: 16_384,
    });
    if (!signed.ok) return signed.response;

    const validation = recordMessageSchema.safeParse(signed.body);
    if (!validation.success) return failValidation(validation.error, requestId);

    const data = validation.data;
    const result = await repository.recordAutomationMessage({
      phoneE164: data.phone,
      direction: data.direction,
      author: data.author,
      body: data.body,
      mediaUrl: data.mediaUrl ?? null,
      externalId: data.externalId ?? null,
    });

    // 200 y no 201 cuando es duplicado: no se creó nada nuevo. La distinción
    // le sirve a n8n para no contar dos veces en sus métricas.
    return ok(
      {
        conversationId: result.conversationId,
        messageId: result.messageId,
        duplicate: result.duplicate,
      },
      result.duplicate ? 200 : 201,
    );
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
