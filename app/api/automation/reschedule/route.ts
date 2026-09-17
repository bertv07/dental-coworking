import type { NextRequest } from 'next/server';
import { repository } from '@/backend/repositories';
import { readSignedBody } from '@/backend/http/automation-request';
import { rescheduleSchema } from '@/backend/validators/automation.schema';
import { rescheduleAppointment } from '@/backend/services/scheduling.service';
import { env } from '@/backend/config/env';
import {
  ok,
  fail,
  failValidation,
  failSlotUnavailable,
  failInternal,
  newRequestId,
  ErrorCode,
} from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/reschedule
 * ===========================================================================
 *  MOVER UNA CITA QUE YA EXISTE.
 *
 *  Mover no es editar una fila: es AGENDAR otra vez. Se vuelve a comprobar
 *  que el odontólogo esté libre, que haya consultorio y que el hueco no lo
 *  haya tomado alguien mientras el paciente decidía. Un update a secas se
 *  saltaría las tres cosas y pondría a dos pacientes a la misma hora.
 *
 *  ---------------------------------------------------------------------
 *  LO QUE NO CAMBIA AL MOVER
 *  ---------------------------------------------------------------------
 *  El paciente, el tratamiento y el precio pactado. Si hace falta otro
 *  tratamiento, eso es una cita distinta — y con otro precio, que es
 *  justamente lo que no se puede cambiar por debajo.
 *
 *  ---------------------------------------------------------------------
 *  CUERPO
 *  ---------------------------------------------------------------------
 *    {
 *      "appointmentId":  "c...",              // de /my-appointments
 *      "startsAt":       "2026-09-18T13:00:00.000Z",  // de /availability
 *      "dentistId":      "c...",              // opcional: cambiar de odontóloga
 *      "idempotencyKey": "wa-msg-9931"        // requerido
 *    }
 *
 *  RESPUESTAS
 *    200 → movida (trae la cita ya con su nueva fecha)
 *    400 → validación
 *    404 → esa cita no existe
 *    409 → no se puede mover, o el hueco está ocupado (trae `suggestedSlots`)
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const signed = await readSignedBody(request, {
      endpoint: 'reschedule',
      kind: 'write',
      requestId,
    });
    if (!signed.ok) return signed.response;

    const validation = rescheduleSchema.safeParse(signed.body);
    if (!validation.success) return failValidation(validation.error, requestId);

    const d = validation.data;
    const result = await rescheduleAppointment({
      appointmentId: d.appointmentId,
      startsAt: d.startsAt,
      dentistId: d.dentistId,
    });

    if (result.outcome === 'NOT_FOUND') {
      return fail(ErrorCode.NOT_FOUND, 'Esa cita ya no existe', 404, { requestId });
    }

    /*
     * Cancelada, atendida o ya pasada: no se mueve.
     *
     * Se dice POR QUÉ y no un 404 genérico: el bot tiene que poder responder
     * «esa cita ya se atendió, ¿le agendo una nueva?» en vez de dejar al
     * paciente pensando que se perdió su cita.
     */
    if (result.outcome === 'NOT_MOVABLE') {
      return fail(
        ErrorCode.CONFLICT,
        'Esa cita ya no se puede mover: ofrécele agendar una nueva',
        409,
        { requestId, details: [{ field: 'status', message: result.status }] },
      );
    }

    if (result.outcome !== 'RESCHEDULED') {
      /*
       * 409 CON alternativas, igual que al agendar: el bot puede seguir la
       * conversación —«esa hora ya está tomada, ¿le sirve alguna de estas?»—
       * en vez de devolverle al paciente un error sin salida.
       */
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

    const cita = result.appointment;
    return ok({
      appointmentId: cita.id,
      status: cita.status,
      startsAt: cita.startsAt.toISOString(),
      startsAtLabel: new Intl.DateTimeFormat('es-VE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: env.CLINIC_TIMEZONE,
      }).format(cita.startsAt),
      endsAt: cita.endsAt.toISOString(),
      dentistId: cita.dentistId,
      roomId: cita.roomId,
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
