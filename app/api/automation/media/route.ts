import type { NextRequest } from 'next/server';
import { repository } from '@/backend/repositories';
import { readSignedBody } from '@/backend/http/automation-request';
import { mediaRequestSchema } from '@/backend/validators/automation.schema';
import { failValidation, failNotFound, failInternal, newRequestId } from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/media
 * ===========================================================================
 *  EL ARCHIVO QUE LA CLÍNICA QUIERE ENVIAR POR WHATSAPP.
 *
 *  n8n lo pide, lo sube a la Media API de Meta y manda el mensaje por
 *  `media_id`. Un endpoint más, con las mismas tres cabeceras que el resto.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ ASÍ Y NO CON UNA URL TEMPORAL
 *  ---------------------------------------------------------------------
 *  Una URL con token sería una credencial más que generar, caducar, hacer de
 *  un solo uso y vigilar para que no acabe en un log. Y una radiografía de un
 *  paciente detrás de un enlace que alguien reenvió por error es un problema
 *  serio. El HMAC ya existe, ya funciona y no está atado a que el cuerpo
 *  tenga contenido — `/catalog` se firma con `{}`.
 *
 *  Mandar el archivo dentro del webhook tampoco: lo infla un 33 % en base64 y
 *  deja radiografías en el cuerpo de las peticiones y en el historial de
 *  ejecuciones de n8n.
 *
 *  ---------------------------------------------------------------------
 *  CUERPO
 *  ---------------------------------------------------------------------
 *    { "mediaId": "c..." }      ó      { "messageId": "c..." }
 *
 *  Los dos llegan en el webhook de salida; se acepta cualquiera de ellos para
 *  que el flujo no tenga que arrastrar el que no usa.
 *
 *  Opcional: `"format": "base64"` devuelve
 *    { "mediaId", "messageId", "filename", "mimeType", "sizeBytes", "base64" }
 *  en vez del binario. Por defecto va el binario, que es un 33 % menos de
 *  bytes por el cable.
 *
 *  ---------------------------------------------------------------------
 *  SÓLO LO QUE SALE
 *  ---------------------------------------------------------------------
 *  Se sirven únicamente adjuntos de mensajes SALIENTES: lo que la clínica ha
 *  decidido enviar. Lo que entra de un paciente no tiene por qué poder
 *  descargarse desde la automatización, aunque la petición venga firmada.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const signed = await readSignedBody(request, {
      endpoint: 'media',
      /*
       * `read`: no cambia nada. Su propio cubo de rate limit porque estas
       * respuestas pesan megas y no deben competir con las consultas baratas
       * de disponibilidad.
       */
      kind: 'read',
      requestId,
    });
    if (!signed.ok) return signed.response;

    const validation = mediaRequestSchema.safeParse(signed.body);
    if (!validation.success) return failValidation(validation.error, requestId);

    const { mediaId, messageId, format } = validation.data;

    const media = await repository.getOutboundMedia({ mediaId, messageId });
    if (!media) return failNotFound('Adjunto', requestId);

    if (media.direction !== 'OUTBOUND') {
      // Mismo 404 que si no existiera: distinguirlos diría a quien pregunta
      // que el identificador es válido pero de otro tipo.
      return failNotFound('Adjunto', requestId);
    }

    if (format === 'base64') {
      return Response.json({
        ok: true,
        data: {
          mediaId: media.id,
          messageId: media.messageId,
          filename: media.fileName,
          mimeType: media.mimeType,
          sizeBytes: media.sizeBytes,
          base64: media.content.toString('base64'),
        },
      });
    }

    return new Response(new Uint8Array(media.content), {
      headers: {
        'Content-Type': media.mimeType,
        'Content-Length': String(media.sizeBytes),
        /*
         * El nombre va en cabecera propia además de en `Content-Disposition`:
         * leer una cabecera suelta en n8n es un paso; parsear el
         * `Content-Disposition` son tres y una expresión regular.
         */
        'X-Media-Id': media.id,
        'X-Media-Filename': encodeURIComponent(media.fileName),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(media.fileName)}`,
        // Contenido clínico: que no se quede en ninguna caché intermedia.
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
