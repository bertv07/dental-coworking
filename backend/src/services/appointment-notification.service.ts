import 'server-only';
import { createHmac } from 'node:crypto';
import { env } from '@/backend/config/env';
import { repository } from '@/backend/repositories';

/**
 * ===========================================================================
 *  Aviso por correo cuando se agenda una cita — lo manda n8n
 * ===========================================================================
 *  Igual que las invitaciones al personal (`staff-invite.service.ts`) y que
 *  los mensajes de WhatsApp: este proyecto NO habla con Gmail. Hace un POST
 *  al webhook de n8n, que es quien tiene la cuenta conectada.
 *
 *  Se reutiliza `STAFF_EMAIL_WEBHOOK_URL` a propósito, con un `type`
 *  distinto en el cuerpo. Un webhook por tipo de correo significaría una
 *  URL, un nodo y una credencial más que mantener cada vez que la clínica
 *  quiera avisar de algo nuevo; con un discriminador, n8n hace un switch y
 *  ya está.
 *
 *  ---------------------------------------------------------------------
 *  A QUIÉN SE LE AVISA Y POR QUÉ
 *  ---------------------------------------------------------------------
 *  Al ODONTÓLOGO al que le acaban de meter a alguien en su agenda. Es quien
 *  tiene que enterarse: recepción ya lo sabe —acaba de agendarlo— y el
 *  paciente se entera por WhatsApp.
 *
 *  Si la clínica tiene correo configurado, va en copia: así queda constancia
 *  en un buzón que no depende de que un odontólogo concreto lea el suyo.
 *
 *  ---------------------------------------------------------------------
 *  UN CORREO QUE FALLA NO PUEDE DESHACER UNA CITA
 *  ---------------------------------------------------------------------
 *  La cita YA está creada cuando esto corre. Si el webhook no responde, se
 *  registra y se sigue: el hueco está apartado y el paciente delante. Por eso
 *  esta función no lanza NUNCA — devuelve el resultado y el llamador decide
 *  si lo enseña.
 * ===========================================================================
 */

export type AppointmentNotificationOutcome =
  | { status: 'SENT' }
  | { status: 'PENDING'; reason: string }
  | { status: 'FAILED'; reason: string };

/** No se deja colgada la respuesta del alta esperando a un webhook lento. */
const WEBHOOK_TIMEOUT_MS = 8000;

/**
 * La fecha y la hora ya escritas para leer, en hora de CARACAS.
 *
 * Se formatea aquí y no en n8n: el flujo recibiría un instante UTC y tendría
 * que saber la zona de la clínica para escribirlo bien. Ese cálculo repetido
 * en dos sitios es exactamente como se acaba mandando un correo que anuncia
 * una cita una hora antes de la real.
 */
function fechaLegible(instante: Date): string {
  return new Intl.DateTimeFormat('es-VE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: env.CLINIC_TIMEZONE,
  }).format(instante);
}

/**
 * Avisa por correo al odontólogo de que tiene una cita nueva.
 *
 * @param appointmentId  La cita recién creada.
 * @param bookedByName   Quién la agendó, para que el correo lo diga.
 */
export async function notifyAppointmentScheduled(params: {
  appointmentId: string;
  bookedByName?: string;
}): Promise<AppointmentNotificationOutcome> {
  const webhookUrl = process.env.STAFF_EMAIL_WEBHOOK_URL;

  // Sin webhook no hay a dónde entregarlo. Se dice claramente en vez de
  // fingir que se mandó.
  if (!webhookUrl) {
    return { status: 'PENDING', reason: 'Falta configurar STAFF_EMAIL_WEBHOOK_URL' };
  }

  try {
    const cita = await repository.findAppointmentById(params.appointmentId);
    if (!cita) return { status: 'FAILED', reason: 'La cita no existe' };

    /*
     * El correo del odontólogo no viaja en `AppointmentWithRelations` —esa
     * forma lleva sólo id y nombre—, así que se busca aparte.
     */
    const [odontologo, ajustes] = await Promise.all([
      repository.findDentistById(cita.dentistId),
      repository.getClinicSettings(),
    ]);

    const destinatario = odontologo?.email?.trim();
    if (!destinatario) {
      return {
        status: 'PENDING',
        reason: `${cita.dentist.fullName} no tiene correo cargado en su ficha`,
      };
    }

    const payload = JSON.stringify({
      type: 'APPOINTMENT_SCHEDULED',
      to: destinatario,
      // En copia, si la clínica tiene buzón propio. `null` = sin copia.
      cc: ajustes.email?.trim() || null,

      dentistName: cita.dentist.fullName,
      patientName: cita.patient.fullName,
      patientPhone: cita.patient.phoneE164,
      treatment: cita.treatment.name,
      room: cita.room.code,

      /** Instante exacto, por si el flujo necesita calcular algo. */
      startsAt: cita.startsAt.toISOString(),
      /** Y el mismo instante ya escrito en hora de Caracas, para el cuerpo. */
      startsAtLabel: fechaLegible(cita.startsAt),
      durationMinutes: cita.treatment.durationMinutes,

      notes: cita.notes,
      bookedBy: params.bookedByName ?? null,
      clinicName: ajustes.clinicName,

      // Para que n8n descarte reenvíos si el mismo evento le llega dos veces.
      issuedAt: new Date().toISOString(),
    });

    // Misma firma HMAC que el resto de la integración.
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', env.AUTOMATION_HMAC_SECRET)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    const response = await fetch(webhookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'X-Automation-Timestamp': String(timestamp),
        'X-Automation-Signature': signature,
      },
      body: payload,
    });

    if (!response.ok) {
      return { status: 'FAILED', reason: `n8n respondió ${response.status}` };
    }

    return { status: 'SENT' };
  } catch (error) {
    // Se registra para el log del servidor, pero la cita sigue en pie.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'appointment.notification_failed',
        appointmentId: params.appointmentId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return {
      status: 'FAILED',
      reason: error instanceof Error ? error.message : 'Error desconocido',
    };
  }
}
