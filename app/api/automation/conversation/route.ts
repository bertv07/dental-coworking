import type { NextRequest } from 'next/server';
import { repository } from '@/backend/repositories';
import { readSignedBody } from '@/backend/http/automation-request';
import { conversationStateSchema } from '@/backend/validators/automation.schema';
import { ok, failValidation, failInternal, newRequestId } from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/conversation
 * ===========================================================================
 *  ¿PUEDO CONTESTAR A ESTE NÚMERO?
 *
 *  La PRIMERA llamada de todo el flujo, en cada mensaje entrante y sin
 *  excepción. Devuelve si la IA sigue encendida en ese chat.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ SE CONSULTA SIEMPRE, Y NO SE CACHEA
 *  ---------------------------------------------------------------------
 *  Porque el interruptor está en el panel y lo mueve una persona. Si
 *  recepción apaga la IA en mitad de una conversación difícil y el bot sigue
 *  con su copia en caché, el paciente recibe dos respuestas que se
 *  contradicen: una de la persona y otra del robot. Eso es peor que no tener
 *  bot.
 *
 *  El coste de preguntar es una consulta indexada por teléfono. El coste de
 *  no preguntar lo paga el paciente.
 *
 *  Si el número no tenía conversación, se CREA aquí — y si el teléfono ya
 *  pertenece a un paciente registrado, nace vinculada a su ficha.
 *
 *  ---------------------------------------------------------------------
 *  CUERPO
 *  ---------------------------------------------------------------------
 *    { "phone": "+584141234567", "displayName": "Juan" }   // displayName opcional
 *
 *  RESPUESTA 200
 *    {
 *      "ok": true,
 *      "data": {
 *        "conversationId": "c...",
 *        "phone": "+584141234567",
 *        "aiEnabled": false,              ← SI ES false, NO RESPONDER
 *        "aiDisabledReason": "Un agente tomó la conversación",
 *        "needsHumanAttention": true,
 *        "patientId": "c..." | null,
 *        "patientName": "Juan Pablo Marcano" | null,
 *        "isNewConversation": false,
 *        "contact": {
 *          "role": "PATIENT" | "DENTIST" | "ASSISTANT" | "ADMIN" | "UNKNOWN",
 *          "name": "Dra. Gabriela Ferreira" | null,
 *          "dentistId": "c..." | null
 *        }
 *      }
 *    }
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const signed = await readSignedBody(request, {
      endpoint: 'conversation',
      kind: 'read',
      requestId,
    });
    if (!signed.ok) return signed.response;

    const validation = conversationStateSchema.safeParse(signed.body);
    if (!validation.success) return failValidation(validation.error, requestId);

    const state = await repository.getConversationStateByPhone({
      phoneE164: validation.data.phone,
      displayName: validation.data.displayName ?? null,
    });

    return ok({
      conversationId: state.conversationId,
      phone: state.phoneE164,
      aiEnabled: state.aiEnabled,
      aiDisabledReason: state.aiDisabledReason,
      needsHumanAttention: state.needsHumanAttention,
      patientId: state.patientId,
      patientName: state.patientName,
      isNewConversation: state.isNewConversation,
      // Con quién habla el bot. Cambia el guion por completo: a un paciente
      // se le ofrece cita; a un odontólogo se le dice su horario.
      contact: state.contact,
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
