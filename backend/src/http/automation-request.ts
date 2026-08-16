import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { verifyAutomationSignature } from '@/backend/auth/automation-key';
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/backend/http/rate-limit';
import {
  fail,
  failUnauthorized,
  failRateLimited,
  ErrorCode,
} from '@/backend/http/responses';

/**
 * ===========================================================================
 *  Preámbulo común de los endpoints de automatización
 * ===========================================================================
 *  Los cinco pasos que TODA petición de n8n atraviesa antes de que su ruta
 *  vea un solo dato:
 *
 *   1. Rate limit por IP.
 *   2. Tope de tamaño del cuerpo — antes de parsearlo, no después.
 *   3. Firma HMAC sobre el cuerpo EN CRUDO.
 *   4. Parseo del JSON.
 *   5. Registro del intento fallido, si lo hubo.
 *
 *  Se extrajo aquí porque estaba copiado en cada ruta. Copiado significa que
 *  el día que se añada un endpoint nuevo es fácil olvidarse de un paso — y el
 *  paso que se olvida es siempre el 3.
 *
 *  ORDEN IMPORTANTE: la firma se verifica sobre el texto crudo, nunca sobre
 *  el objeto reserializado. `JSON.parse` seguido de `JSON.stringify` puede
 *  reordenar claves y cambiar el espaciado, y entonces el HMAC no coincide
 *  aunque el contenido sea idéntico.
 * ===========================================================================
 */

type SignedBodyResult =
  | { ok: true; body: unknown; clientIp: string }
  | { ok: false; response: NextResponse };

export async function readSignedBody(
  request: NextRequest,
  options: {
    /** Nombre del endpoint, para separar los cubos del rate limit. */
    endpoint: string;
    /** Lecturas o escrituras: cambia el límite aplicado. */
    kind: 'read' | 'write';
    requestId: string;
    /** Tope del cuerpo en bytes. Por defecto 8 KB. */
    maxBytes?: number;
  },
): Promise<SignedBodyResult> {
  const clientIp = getClientIp(request);

  const limit = checkRateLimit(
    `automation:${options.endpoint}:${clientIp}`,
    options.kind === 'read' ? RATE_LIMITS.AUTOMATION_READ : RATE_LIMITS.AUTOMATION_WRITE,
  );
  if (!limit.allowed) {
    return { ok: false, response: failRateLimited(limit.retryAfterSeconds, options.requestId) };
  }

  const rawBody = await request.text();
  if (rawBody.length > (options.maxBytes ?? 8_192)) {
    return {
      ok: false,
      response: fail(ErrorCode.VALIDATION_ERROR, 'El cuerpo de la petición es demasiado grande', 413, {
        requestId: options.requestId,
      }),
    };
  }

  const auth = verifyAutomationSignature(request.headers, rawBody);
  if (!auth.ok) {
    // Se registra el motivo pero NO se devuelve: decirle a quien ataca si
    // falló la firma o el timestamp le da información para afinar.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'automation_auth_failed',
        endpoint: options.endpoint,
        requestId: options.requestId,
        reason: auth.reason,
        ip: clientIp,
      }),
    );
    return { ok: false, response: failUnauthorized(options.requestId) };
  }

  try {
    return { ok: true, body: JSON.parse(rawBody), clientIp };
  } catch {
    return {
      ok: false,
      response: fail(ErrorCode.VALIDATION_ERROR, 'El cuerpo no es JSON válido', 400, {
        requestId: options.requestId,
      }),
    };
  }
}
