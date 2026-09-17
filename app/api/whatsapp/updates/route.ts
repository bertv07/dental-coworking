import type { NextRequest } from 'next/server';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema } from '@/backend/validators/common';
import {
  ok,
  failUnauthorized,
  failForbidden,
  failInternal,
  newRequestId,
} from '@/backend/http/responses';

/**
 * ===========================================================================
 *  GET /api/whatsapp/updates — lo que ha cambiado desde la última vuelta
 * ===========================================================================
 *  El monitor lo llama cada pocos segundos para que un mensaje que acaba de
 *  entrar aparezca solo, sin recargar la página.
 *
 *  POR QUÉ SONDEO Y NO SSE / WEBSOCKET
 *  -----------------------------------
 *  Quien escribe los mensajes entrantes es n8n, contra la API, en otro
 *  proceso: el panel no tiene forma de "enterarse" salvo preguntándole a
 *  Postgres. Empujar desde el servidor obligaría a que ese otro proceso
 *  avisara a éste (una cola, LISTEN/NOTIFY, un bus) para acabar dando el
 *  mismo resultado, y una conexión abierta por recepcionista es justo lo que
 *  más fácil rompe un proxy inverso por delante —se queda muda sin error y
 *  el chat parece congelado, que es peor que recargar—.
 *
 *  Con dos o tres personas en el mostrador esto son dos consultas cada
 *  cuatro segundos. Si algún día hay veinte, entonces sí toca un bus.
 *
 *  Devuelve DOS cosas:
 *   · `conversations` — la lista entera, para reordenarla y actualizar los
 *     avisos aunque el chat abierto sea otro.
 *   · `messages`      — SÓLO los posteriores a `since`, para no traerse las
 *     doscientas líneas del hilo en cada vuelta.
 *
 *  Autenticación por cookie de sesión, como el resto de `/api/whatsapp/*`.
 *  Es un GET sin efectos secundarios.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const authorization = await checkApiRole('ASSISTANT');
    if (!authorization.authorized) {
      return authorization.status === 401
        ? failUnauthorized(requestId)
        : failForbidden(requestId);
    }

    const params = request.nextUrl.searchParams;

    // Activas y archivadas son dos listas distintas: el monitor dice en cuál
    // está para que el sondeo no le meta en la lista chats que no ve.
    const archived = params.get('archivadas') === '1';

    /*
     * El chat abierto y hasta dónde lo tiene ya el navegador.
     *
     * Los dos son opcionales y se validan por separado: sin `since` no hay
     * nada que comparar, así que no se devuelven mensajes. Vale más no
     * mandar nada que mandar el hilo entero y que el monitor lo duplique.
     */
    const conversationId = cuidSchema.safeParse(params.get('conversationId') ?? '');
    const sinceRaw = params.get('since') ?? '';
    const since = sinceRaw ? new Date(sinceRaw) : null;
    const sinceValido = since !== null && !Number.isNaN(since.getTime());

    const [conversations, messages] = await Promise.all([
      repository.listConversations({ limit: 50, archived }),
      conversationId.success && sinceValido
        ? repository.getConversationMessagesSince(conversationId.data, since)
        : Promise.resolve([]),
    ]);

    return ok({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        phoneE164: conversation.phoneE164,
        displayName: conversation.displayName,
        patientName: conversation.patientName,
        patientId: conversation.patientId,
        aiEnabled: conversation.aiEnabled,
        aiDisabledReason: conversation.aiDisabledReason,
        aiAutoResumeAt: conversation.aiAutoResumeAt?.toISOString() ?? null,
        needsHumanAttention: conversation.needsHumanAttention,
        lastMessagePreview: conversation.lastMessagePreview,
        lastMessageAuthor: conversation.lastMessageAuthor,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        archivedAt: conversation.archivedAt?.toISOString() ?? null,
      })),
      messages: messages.map((message) => ({
        id: message.id,
        conversationId: message.conversationId,
        direction: message.direction,
        author: message.author,
        body: message.body,
        mediaUrl: message.mediaUrl,
        mediaType: message.mediaType,
        attachmentId: message.attachmentId,
        deliveryStatus: message.deliveryStatus,
        deliveryError: message.deliveryError,
        sentAt: message.sentAt.toISOString(),
      })),
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}
