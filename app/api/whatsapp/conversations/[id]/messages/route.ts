import type { NextRequest } from 'next/server';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema } from '@/backend/validators/common';
import {
  ok,
  fail,
  failUnauthorized,
  failForbidden,
  failInternal,
  newRequestId,
  ErrorCode,
} from '@/backend/http/responses';

/**
 * ===========================================================================
 *  GET /api/whatsapp/conversations/:id/messages
 * ===========================================================================
 *  Endpoint INTERNO del panel: lo llama el monitor al cambiar de chat.
 *
 *  A diferencia de /api/automation/*, este SÍ usa sesión de navegador:
 *   · Autenticación → cookie de sesión (NextAuth), no HMAC.
 *   · CSRF          → es un GET sin efectos secundarios; además la cookie
 *                     es SameSite=lax, así que no viaja en peticiones
 *                     cross-site que no sean navegación de nivel superior.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  // En Next.js 15 los params de ruta son asíncronos.
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();

  try {
    // --- Autorización -----------------------------------------------------
    const authorization = await checkApiRole('ASSISTANT');
    if (!authorization.authorized) {
      return authorization.status === 401
        ? failUnauthorized(requestId)
        : failForbidden(requestId);
    }

    // --- Validación del parámetro de ruta ---------------------------------
    // Los params de URL son entrada del usuario igual que el cuerpo. Se
    // valida la forma antes de usarlos.
    const { id } = await params;
    const validation = cuidSchema.safeParse(id);
    if (!validation.success) {
      return fail(ErrorCode.VALIDATION_ERROR, 'Identificador de conversación inválido', 400, {
        requestId,
      });
    }

    const messages = await repository.getConversationMessages(validation.data);

    return ok({
      conversationId: validation.data,
      messages: messages.map((message) => ({
        id: message.id,
        conversationId: message.conversationId,
        direction: message.direction,
        author: message.author,
        body: message.body,
        mediaUrl: message.mediaUrl,
        // Permite a la UI marcar los mensajes que no llegaron a entregarse.
        deliveryStatus: message.deliveryStatus,
        deliveryError: message.deliveryError,
        // ISO string: `Date` no es serializable a JSON de forma estable.
        sentAt: message.sentAt.toISOString(),
      })),
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}
