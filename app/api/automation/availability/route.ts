import type { NextRequest } from 'next/server';
import { verifyAutomationSignature } from '@/backend/auth/automation-key';
import { checkAvailabilitySchema } from '@/backend/validators/appointment.schema';
import { buscarDisponibilidad } from '@/backend/services/scheduling.service';
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/backend/http/rate-limit';
import { env } from '@/backend/config/env';
import {
  ok,
  fail,
  failUnauthorized,
  failValidation,
  failRateLimited,
  failInternal,
  newRequestId,
  ErrorCode,
} from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/availability
 * ===========================================================================
 *  CONSULTA DE DISPONIBILIDAD PARA EL BOT
 *
 *  Primer endpoint del flujo conversacional: el bot lo llama para saber qué
 *  horarios puede ofrecerle al paciente, ANTES de intentar agendar.
 *
 *  ¿Por qué POST y no GET, si sólo lee?
 *  Porque la firma HMAC cubre el CUERPO de la petición. Con GET habría que
 *  firmar la query string, que es más frágil (orden de parámetros, encoding)
 *  y además acabaría con datos de pacientes en los logs de acceso de todos
 *  los proxies intermedios. Es una lectura, pero con cuerpo firmado.
 *
 *  ---------------------------------------------------------------------
 *  CONTRATO PARA n8n
 *  ---------------------------------------------------------------------
 *  Cabeceras: las mismas que en /api/automation/appointments
 *
 *  Cuerpo:
 *    {
 *      "treatmentCode": "LIMPIEZA",                    // requerido
 *      "date":          "2026-08-15T00:00:00-05:00",   // día a consultar
 *      "dentistId":     "c...",                        // opcional
 *      "maxSlots":      6                              // opcional (1-20)
 *    }
 *
 *  Respuesta 200:
 *    {
 *      "ok": true,
 *      "data": {
 *        "treatmentCode": "LIMPIEZA",
 *        "durationMinutes": 45,
 *        "priceCents": 12000000,
 *        "slots": [
 *          {
 *            "startsAt": "2026-08-15T14:00:00.000Z",
 *            "endsAt":   "2026-08-15T14:45:00.000Z",
 *            "dentistId": "c...", "dentistName": "Dra. Laura Mejía",
 *            "roomId": "c...", "roomCode": "C2"
 *          }
 *        ]
 *      }
 *    }
 *
 *  Un array `slots` vacío NO es un error: significa que ese día está lleno.
 *  El bot debe ofrecer otra fecha.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * La fecha de hoy en la clínica, en ISO corto.
 *
 * Va en TODAS las respuestas. El agente pidió una vez el «17 de enero de
 * 2026» estando en septiembre: no sabía en qué día vivía y lo dedujo mal. Es
 * un dato de dos líneas que evita una conversación entera perdida.
 */
function hoyEnLaClinica(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.CLINIC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    // Límite más holgado que en escritura: el bot consulta disponibilidad
    // varias veces por conversación y estas peticiones sólo leen.
    const clientIp = getClientIp(request);
    const limit = checkRateLimit(
      `automation:availability:${clientIp}`,
      RATE_LIMITS.AUTOMATION_READ,
    );
    if (!limit.allowed) return failRateLimited(limit.retryAfterSeconds, requestId);

    const rawBody = await request.text();
    if (rawBody.length > 8_192) {
      return fail(ErrorCode.VALIDATION_ERROR, 'El cuerpo de la petición es demasiado grande', 413, {
        requestId,
      });
    }

    const authResult = verifyAutomationSignature(request.headers, rawBody);
    if (!authResult.ok) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'automation_auth_failed',
          requestId,
          reason: authResult.reason,
          ip: clientIp,
        }),
      );
      return failUnauthorized(requestId);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return fail(ErrorCode.VALIDATION_ERROR, 'El cuerpo no es JSON válido', 400, { requestId });
    }

    const validation = checkAvailabilitySchema.safeParse(parsedBody);
    if (!validation.success) return failValidation(validation.error, requestId);

    const { slots, motivo } = await buscarDisponibilidad(validation.data);

    /*
     * Cuando no hay huecos se dice POR QUÉ y con qué palabras contarlo.
     *
     * Antes una lista vacía significaba siempre «ese día está lleno», y el
     * bot le soltaba eso a un paciente que había pedido una fecha ya pasada
     * o un domingo. El flujo de n8n no tenía forma de distinguirlo.
     */
    const explicacion: Record<string, string> = {
      PASADO:
        'Esa fecha ya pasó. Confirma el día que quiere el paciente y vuelve a consultar; ' +
        'hoy es ' + hoyEnLaClinica() + '.',
      CERRADO: 'Ese día la clínica no atiende. Ofrece otro día de la semana.',
      LLENO: 'Ese día está lleno. No es un error: ofrécele otra fecha.',
    };

    return ok({
      treatmentCode: validation.data.treatmentCode,
      date: validation.data.date.toISOString(),
      /** La fecha de hoy, para que el bot no tenga que adivinarla. */
      today: hoyEnLaClinica(),
      ...(slots.length === 0 && motivo
        ? { reason: motivo, message: explicacion[motivo] }
        : {}),
      slots: slots.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        dentistId: slot.dentistId,
        dentistName: slot.dentistName,
        roomId: slot.roomId,
        roomCode: slot.roomCode,
      })),
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
