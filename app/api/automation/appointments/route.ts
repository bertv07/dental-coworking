import type { NextRequest } from 'next/server';
import { verifyAutomationSignature } from '@/backend/auth/automation-key';
import { createAppointmentSchema } from '@/backend/validators/appointment.schema';
import { scheduleAppointment } from '@/backend/services/scheduling.service';
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/backend/http/rate-limit';
import {
  ok,
  fail,
  failUnauthorized,
  failValidation,
  failRateLimited,
  failSlotUnavailable,
  failInternal,
  newRequestId,
  ErrorCode,
} from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/appointments
 * ===========================================================================
 *  ENDPOINT DE AGENDAMIENTO PARA LA AUTOMATIZACIÓN (n8n / bot de WhatsApp)
 *
 *  Es el endpoint más expuesto del sistema: lo llama una máquina, sin sesión
 *  de navegador, y escribe en la agenda. Por eso lleva el mayor número de
 *  controles.
 *
 *  ---------------------------------------------------------------------
 *  CADENA DE SEGURIDAD (en orden de ejecución)
 *  ---------------------------------------------------------------------
 *  1. Rate limit por IP        → frena el abuso antes de gastar CPU
 *  2. Verificación HMAC        → autentica el emisor y la integridad del body
 *  3. Anti-replay (timestamp)  → una firma capturada caduca en 5 minutos
 *  4. Validación Zod           → forma, tipos y reglas de negocio
 *  5. Idempotencia             → los reintentos de n8n no duplican citas
 *  6. Lógica de negocio        → el servidor decide duración, precio y sala
 *  7. Constraint de Postgres   → árbitro final ante concurrencia
 *  8. Respuesta saneada        → sin stack traces ni internos del sistema
 *
 *  ---------------------------------------------------------------------
 *  CONTRATO PARA n8n
 *  ---------------------------------------------------------------------
 *  POST /api/automation/appointments
 *
 *  Cabeceras:
 *    Content-Type: application/json
 *    X-Automation-Key-Id: dck_live_xxxxxxx
 *    X-Automation-Timestamp: 1786000000          (epoch en SEGUNDOS)
 *    X-Automation-Signature: <hex de HMAC-SHA256("{timestamp}.{body}")>
 *
 *  Cuerpo:
 *    {
 *      "patientPhone":   "+573001234567",   // requerido, E.164
 *      "patientName":    "Juan Herrera",    // opcional (sólo si es nuevo)
 *      "treatmentCode":  "LIMPIEZA",        // requerido, código estable
 *      "startsAt":       "2026-08-15T14:00:00-05:00", // ISO 8601 CON zona
 *      "dentistId":      "c...",            // opcional
 *      "roomId":         "c...",            // opcional
 *      "notes":          "...",             // opcional
 *      "idempotencyKey": "wa-msg-4821"      // requerido, único por intención
 *    }
 *
 *  ⚠️  NO se envían `endsAt` ni `agreedPriceCents`. Los calcula el servidor
 *   a partir del tratamiento. Enviarlos no produce error: se ignoran.
 *
 *  Respuestas:
 *    201 → cita creada
 *    200 → la llave de idempotencia ya existía; se devuelve la cita original
 *    400 → validación fallida (`error.details` indica qué campo)
 *    401 → firma ausente, inválida o caducada
 *    404 → el `treatmentCode` o el `dentistId` no existen
 *    409 → el horario ya no está libre (incluye `suggestedSlots`)
 *    429 → rate limit (respetar la cabecera `Retry-After`)
 *    500 → error interno (usar `error.requestId` para el soporte)
 * ===========================================================================
 */

/**
 * Fuerza el runtime Node.js: el Edge Runtime no trae `node:crypto`, que es
 * necesario para `timingSafeEqual` en la verificación HMAC.
 */
export const runtime = 'nodejs';

/** Nunca cachear: cada petición escribe en la agenda. */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // `requestId` se genera al principio y acompaña a la petición de extremo a
  // extremo: es lo que permite reconstruir el caso desde los logs cuando
  // alguien reporta un fallo.
  const requestId = newRequestId();

  try {
    // ---------------------------------------------------------------------
    //  1. RATE LIMIT — antes de cualquier trabajo costoso
    // ---------------------------------------------------------------------
    //  Se limita ANTES de verificar la firma a propósito: calcular un HMAC
    //  es barato, pero no gratis. Si alguien lanza 10.000 peticiones con
    //  firmas basura, el límite corta el gasto de CPU en la puerta.
    const clientIp = getClientIp(request);
    const limit = checkRateLimit(
      `automation:appointments:${clientIp}`,
      RATE_LIMITS.AUTOMATION_WRITE,
    );

    if (!limit.allowed) {
      return failRateLimited(limit.retryAfterSeconds, requestId);
    }

    // ---------------------------------------------------------------------
    //  2. CUERPO CRUDO — obligatorio para verificar la firma
    // ---------------------------------------------------------------------
    //  Se lee como TEXTO, no con `request.json()`. La firma se calculó sobre
    //  los bytes exactos que envió n8n; parsear y volver a serializar
    //  cambiaría el orden de las claves o el espaciado y la firma dejaría de
    //  coincidir.
    const rawBody = await request.text();

    // Cota de tamaño: sin ella, un cuerpo de 500 MB consume memoria antes de
    // que ninguna validación llegue a ejecutarse.
    if (rawBody.length > 16_384) {
      return fail(ErrorCode.VALIDATION_ERROR, 'El cuerpo de la petición es demasiado grande', 413, {
        requestId,
      });
    }

    // ---------------------------------------------------------------------
    //  3. AUTENTICACIÓN HMAC + ANTI-REPLAY
    // ---------------------------------------------------------------------
    const authResult = verifyAutomationSignature(request.headers, rawBody);

    if (!authResult.ok) {
      // El MOTIVO exacto se registra en el servidor pero NUNCA se devuelve.
      // Distinguir "firma inválida" de "timestamp caducado" le daría al
      // atacante información para afinar su intento.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'automation_auth_failed',
          requestId,
          reason: authResult.reason,
          keyId: authResult.keyId,
          ip: clientIp,
        }),
      );
      return failUnauthorized(requestId);
    }

    // TODO(producción): verificar además que `authResult.keyId` corresponde a
    // una `AutomationApiKey` activa (no revocada, no expirada) y que incluye
    // el scope "appointment:create". Requiere una consulta a la DB, así que
    // se deja para cuando `DATA_SOURCE=db` esté activo.

    // ---------------------------------------------------------------------
    //  4. PARSEO Y VALIDACIÓN
    // ---------------------------------------------------------------------
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return fail(ErrorCode.VALIDATION_ERROR, 'El cuerpo no es JSON válido', 400, {
        requestId,
      });
    }

    // Zod valida Y transforma: normaliza el teléfono a E.164, convierte
    // `startsAt` a `Date` y descarta cualquier campo no declarado en el
    // esquema. Ese descarte es en sí una defensa: un `{"role":"SUPER_ADMIN"}`
    // colado en el cuerpo simplemente desaparece.
    const validation = createAppointmentSchema.safeParse(parsedBody);
    if (!validation.success) {
      return failValidation(validation.error, requestId);
    }

    // ---------------------------------------------------------------------
    //  5. LÓGICA DE NEGOCIO
    // ---------------------------------------------------------------------
    const result = await scheduleAppointment(validation.data);

    // ---------------------------------------------------------------------
    //  6. TRADUCCIÓN A HTTP
    // ---------------------------------------------------------------------
    //  El `switch` sobre la unión discriminada es exhaustivo: si mañana el
    //  servicio añade un caso nuevo, TypeScript falla aquí en compilación en
    //  vez de devolver `undefined` en producción.
    switch (result.outcome) {
      case 'CREATED':
        console.info(
          JSON.stringify({
            level: 'info',
            event: 'appointment_created',
            requestId,
            appointmentId: result.appointment.id,
            source: 'WHATSAPP_AI',
            keyId: authResult.keyId,
          }),
        );
        return ok(
          {
            appointmentId: result.appointment.id,
            status: result.appointment.status,
            startsAt: result.appointment.startsAt.toISOString(),
            endsAt: result.appointment.endsAt.toISOString(),
            dentistId: result.appointment.dentistId,
            roomId: result.appointment.roomId,
            priceCents: result.appointment.agreedPriceCents,
          },
          201,
        );

      case 'ALREADY_EXISTS':
        // 200 y no 201: no se creó nada nuevo. n8n reintentó y recibe la
        // misma cita — que es exactamente el comportamiento deseado.
        return ok(
          {
            appointmentId: result.appointment.id,
            status: result.appointment.status,
            startsAt: result.appointment.startsAt.toISOString(),
            endsAt: result.appointment.endsAt.toISOString(),
            dentistId: result.appointment.dentistId,
            roomId: result.appointment.roomId,
            priceCents: result.appointment.agreedPriceCents,
            idempotent: true,
          },
          200,
        );

      case 'TREATMENT_NOT_FOUND':
        return fail(
          ErrorCode.NOT_FOUND,
          'El tratamiento solicitado no existe o no está activo',
          404,
          { requestId },
        );

      case 'DENTIST_NOT_FOUND':
        return fail(ErrorCode.NOT_FOUND, 'El odontólogo solicitado no existe', 404, {
          requestId,
        });

      case 'DENTIST_UNAVAILABLE':
      case 'NO_ROOM_AVAILABLE': {
        // 409 con alternativas: el bot puede seguir la conversación en vez de
        // devolverle al paciente un error sin salida.
        const response = failSlotUnavailable(requestId);
        const body = await response.json();
        return Response.json(
          {
            ...body,
            error: {
              ...body.error,
              suggestedSlots: result.suggestedSlots.map((slot) => slot.toISOString()),
            },
          },
          { status: 409, headers: { 'Cache-Control': 'no-store' } },
        );
      }
    }
  } catch (error) {
    // ---------------------------------------------------------------------
    //  7. RED DE SEGURIDAD
    // ---------------------------------------------------------------------
    //  Cualquier excepción no prevista acaba aquí. `failInternal` registra el
    //  detalle real en el servidor y devuelve al cliente sólo un código y el
    //  `requestId`. Nunca un stack trace: revelaría rutas del sistema de
    //  archivos, versiones de dependencias y estructura interna.

    // Caso especial: violación del constraint EXCLUDE de Postgres. Significa
    // que otra petición ganó la carrera por el mismo hueco entre nuestra
    // comprobación y el INSERT. No es un fallo del sistema — es el
    // comportamiento correcto bajo concurrencia — así que se traduce a 409.
    const { isOverlapViolation } = await import('@/backend/db/client');
    if (isOverlapViolation(error)) {
      return failSlotUnavailable(requestId);
    }

    return failInternal(error, requestId);
  }
}

/**
 * Cualquier otro método devuelve 405 con la cabecera `Allow`, en lugar del
 * 404 por defecto de Next.js. Es la respuesta correcta según el RFC y le
 * ahorra a quien integre media hora de depuración.
 */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
