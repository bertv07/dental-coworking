import type { NextRequest } from 'next/server';
import { verifyAutomationSignature } from '@/backend/auth/automation-key';
import { reportPaymentSchema } from '@/backend/validators/appointment.schema';
import { checkRateLimit, RATE_LIMITS, getClientIp } from '@/backend/http/rate-limit';
import { splitCents } from '@/backend/domain/money';
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
 *  POST /api/automation/payments
 * ===========================================================================
 *  REPORTE DE PAGOS DESDE LA AUTOMATIZACIÓN
 *
 *  Lo llama n8n cuando una pasarela confirma un cobro, o cuando recepción
 *  registra un pago en efectivo desde un flujo automatizado.
 *
 *  ---------------------------------------------------------------------
 *  ESTADO: ESQUELETO LISTO PARA CONECTAR
 *  ---------------------------------------------------------------------
 *  La seguridad (HMAC, rate limit, validación) está COMPLETA y es idéntica
 *  a la del endpoint de agendamiento. Lo que falta es la persistencia, que
 *  depende de `DATA_SOURCE=db`: el reparto 40/60 debe escribirse dentro de
 *  una transacción junto con el cambio de estado de la cita, y eso no tiene
 *  sentido simularlo contra arrays en memoria.
 *
 *  Los puntos exactos a completar están marcados con `TODO(db)`.
 *
 *  ---------------------------------------------------------------------
 *  CONTRATO PARA n8n
 *  ---------------------------------------------------------------------
 *  Cuerpo:
 *    {
 *      "appointmentId":     "c...",        // requerido
 *      "amountCents":       12000000,      // requerido, ENTERO de centavos
 *      "method":            "CARD",        // CASH | CARD | TRANSFER | INSURANCE
 *      "externalReference": "TX-99182",    // opcional
 *      "idempotencyKey":    "pay-tx-99182" // requerido
 *    }
 *
 *  ⚠️  `amountCents` va en CENTAVOS. $120.000 se envía como 12000000, no
 *   como 120000 ni como 120000.00. Un error aquí multiplica o divide por
 *   100 los ingresos de la clínica.
 *
 *  ⚠️  El reparto 40/60 NO se envía: lo calcula el servidor con el
 *   porcentaje vigente del odontólogo. Aceptarlo del cliente permitiría que
 *   un flujo mal configurado alterase la contabilidad.
 *
 *  Respuestas:
 *    201 → pago registrado (devuelve el reparto calculado)
 *    200 → idempotencia: ese pago ya estaba registrado
 *    404 → la cita no existe
 *    409 → la cita ya tiene un pago registrado
 *    422 → el monto no es coherente con la cita
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    // --- Misma cadena de seguridad que en /appointments -------------------
    const clientIp = getClientIp(request);
    const limit = checkRateLimit(
      `automation:payments:${clientIp}`,
      RATE_LIMITS.AUTOMATION_WRITE,
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

    const validation = reportPaymentSchema.safeParse(parsedBody);
    if (!validation.success) return failValidation(validation.error, requestId);

    const input = validation.data;

    // =====================================================================
    //  TODO(db): PERSISTENCIA — implementar al activar DATA_SOURCE=db
    // =====================================================================
    //
    //  Debe ejecutarse ENTERO dentro de una transacción. Si el pago se
    //  registra pero la cita no pasa a COMPLETED, la contabilidad y la
    //  agenda quedan en desacuerdo permanente.
    //
    //  await prisma.$transaction(async (tx) => {
    //
    //    // 1. Idempotencia DENTRO de la transacción, no fuera: comprobarlo
    //    //    antes de abrirla deja una ventana de carrera.
    //    const existing = await tx.payment.findUnique({
    //      where: { idempotencyKey: input.idempotencyKey },
    //    });
    //    if (existing) return { outcome: 'ALREADY_EXISTS', payment: existing };
    //
    //    // 2. Cita + odontólogo. El porcentaje se lee AHORA, no se confía
    //    //    en ningún valor que venga del cliente.
    //    const appointment = await tx.appointment.findUnique({
    //      where: { id: input.appointmentId },
    //      include: { dentist: { select: { clinicCommissionPercent: true } }, payment: true },
    //    });
    //    if (!appointment) return { outcome: 'NOT_FOUND' };
    //    if (appointment.payment) return { outcome: 'ALREADY_PAID' };
    //
    //    // 3. Coherencia del monto: se tolera hasta un 20% de diferencia
    //    //    (descuentos, copagos). Por encima, se marca para revisión
    //    //    manual en vez de aceptarlo en silencio.
    //    const deviation =
    //      Math.abs(input.amountCents - appointment.agreedPriceCents) /
    //      Math.max(appointment.agreedPriceCents, 1);
    //    if (deviation > 0.2) return { outcome: 'AMOUNT_MISMATCH' };
    //
    //    // 4. Reparto 40/60 calculado en el SERVIDOR.
    //    const split = splitCents(
    //      input.amountCents,
    //      appointment.dentist.clinicCommissionPercent,
    //    );
    //
    //    // 5. Alta del pago con el snapshot de la comisión.
    //    const payment = await tx.payment.create({
    //      data: {
    //        appointmentId: appointment.id,
    //        amountCents: split.totalCents,
    //        commissionPercentApplied: split.clinicPercent,
    //        clinicShareCents: split.clinicShareCents,
    //        dentistShareCents: split.dentistShareCents,
    //        method: input.method,
    //        status: 'PAID',
    //        paidAt: new Date(),
    //        externalReference: input.externalReference ?? null,
    //        idempotencyKey: input.idempotencyKey,
    //      },
    //    });
    //
    //    // 6. La cita pasa a COMPLETED.
    //    await tx.appointment.update({
    //      where: { id: appointment.id },
    //      data: { status: 'COMPLETED' },
    //    });
    //
    //    // 7. Auditoría: el dinero siempre deja rastro.
    //    await tx.auditLog.create({
    //      data: {
    //        action: 'payment.recorded',
    //        entityType: 'Payment',
    //        entityId: payment.id,
    //        after: { amountCents: split.totalCents, split },
    //        ipAddress: clientIp,
    //      },
    //    });
    //
    //    return { outcome: 'CREATED', payment };
    //  });
    //
    // =====================================================================

    // --- Respuesta provisional en modo mock -------------------------------
    // Se devuelve el reparto REAL calculado con la misma función que usará
    // producción. Así el flujo de n8n se puede probar de extremo a extremo
    // hoy mismo, y la forma de la respuesta ya es la definitiva.
    const PLACEHOLDER_COMMISSION_PERCENT = 40;
    const split = splitCents(input.amountCents, PLACEHOLDER_COMMISSION_PERCENT);

    console.info(
      JSON.stringify({
        level: 'info',
        event: 'payment_reported_mock',
        requestId,
        appointmentId: input.appointmentId,
        amountCents: input.amountCents,
      }),
    );

    return ok(
      {
        appointmentId: input.appointmentId,
        amountCents: split.totalCents,
        commissionPercentApplied: split.clinicPercent,
        clinicShareCents: split.clinicShareCents,
        dentistShareCents: split.dentistShareCents,
        method: input.method,
        status: 'PAID',
        // Bandera explícita: quien integre debe saber que esto todavía no
        // toca la base de datos.
        persisted: false,
      },
      201,
    );
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
