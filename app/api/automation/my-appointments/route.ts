import type { NextRequest } from 'next/server';
import { repository } from '@/backend/repositories';
import { readSignedBody } from '@/backend/http/automation-request';
import { myAppointmentsSchema } from '@/backend/validators/automation.schema';
import { env } from '@/backend/config/env';
import { ok, failValidation, failInternal, newRequestId } from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/my-appointments
 * ===========================================================================
 *  QUÉ TIENE PENDIENTE ESTE PACIENTE.
 *
 *  Es el primer paso para reagendar: el paciente escribe «quiero cambiar mi
 *  cita» y el bot tiene que poder enseñarle cuál, sin pedirle un id que no
 *  conoce ni hacerle describir de memoria el día y la hora.
 *
 *  ---------------------------------------------------------------------
 *  SÓLO LAS QUE SE PUEDEN MOVER
 *  ---------------------------------------------------------------------
 *  Futuras y vivas (pendiente o confirmada). Una cancelada o ya atendida no
 *  se reagenda: se agenda otra. Devolverlas aquí sólo daría a elegir algo
 *  que después el endpoint de mover va a rechazar.
 *
 *  ---------------------------------------------------------------------
 *  CUERPO
 *  ---------------------------------------------------------------------
 *    { "phone": "+584141234567" }
 *
 *  RESPUESTA 200
 *    { "ok": true, "data": { "today": "2026-09-16", "appointments": [ {
 *        "appointmentId", "startsAt", "startsAtLabel",
 *        "treatment", "dentistId", "dentistName", "room", "status" } ] } }
 *
 *  Una lista vacía NO es un error: ese paciente no tiene nada pendiente y el
 *  bot debe ofrecerle agendar una nueva.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const signed = await readSignedBody(request, {
      endpoint: 'my-appointments',
      kind: 'read',
      requestId,
    });
    if (!signed.ok) return signed.response;

    const validation = myAppointmentsSchema.safeParse(signed.body);
    if (!validation.success) return failValidation(validation.error, requestId);

    const citas = await repository.listUpcomingAppointmentsByPhone({
      phoneE164: validation.data.phone,
      limit: 5,
    });

    /*
     * La fecha y la hora ya escritas, en hora de CARACAS.
     *
     * Se formatea aquí y no en el flujo por lo mismo de siempre: si n8n
     * convierte el instante por su cuenta, basta con que tenga otra zona
     * configurada para que le diga al paciente una hora que no es la suya.
     */
    const etiqueta = (d: Date) =>
      new Intl.DateTimeFormat('es-VE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: env.CLINIC_TIMEZONE,
      }).format(d);

    return ok({
      today: new Intl.DateTimeFormat('en-CA', { timeZone: env.CLINIC_TIMEZONE }).format(new Date()),
      appointments: citas.map((c) => ({
        appointmentId: c.id,
        startsAt: c.startsAt.toISOString(),
        startsAtLabel: etiqueta(c.startsAt),
        treatment: c.treatment.name,
        durationMinutes: c.treatment.durationMinutes,
        dentistId: c.dentistId,
        dentistName: c.dentist.fullName,
        room: c.room.code,
        status: c.status,
      })),
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
