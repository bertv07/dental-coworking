import type { NextRequest } from 'next/server';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema } from '@/backend/validators/common';

/**
 * ===========================================================================
 *  GET /api/whatsapp/adjuntos/:id
 * ===========================================================================
 *  El archivo que la clínica envió, para verlo en el propio hilo.
 *
 *  Es el gemelo de `/api/automation/media`, que sirve lo mismo a n8n: aquél
 *  se autentica con HMAC porque lo llama una máquina; éste con la sesión del
 *  navegador porque lo mira una persona. Mismo archivo, dos puertas, cada una
 *  con la llave que corresponde.
 *
 *  Sin esto, quien manda una radiografía por WhatsApp no puede volver a verla
 *  en el panel: sabría que envió «algo» y no qué.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return new Response(null, { status: authorization.status === 401 ? 401 : 403 });
  }

  const { id } = await params;
  const validation = cuidSchema.safeParse(id);
  if (!validation.success) return new Response(null, { status: 400 });

  const media = await repository.getOutboundMedia({ mediaId: validation.data });
  if (!media) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(media.content), {
    headers: {
      'Content-Type': media.mimeType,
      'Content-Length': String(media.sizeBytes),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(media.fileName)}`,
      /*
       * Privada y cacheable: el hilo se recarga entero tras cada envío, y sin
       * caché cada recarga volvería a bajar las fotos que ya se vieron.
       */
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
