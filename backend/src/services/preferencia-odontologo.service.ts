import 'server-only';
import { createHmac } from 'node:crypto';
import { env } from '@/backend/config/env';
import { repository } from '@/backend/repositories';
import { deliverMessage } from '@/backend/services/whatsapp-outbound.service';

/**
 * ===========================================================================
 *  «¿Quieres seguir con la misma odontóloga?»
 * ===========================================================================
 *  Se le pregunta al paciente por WhatsApp justo cuando el odontólogo o
 *  recepción marcan la cita como atendida. Es el único momento en que la
 *  pregunta tiene sentido: acaba de salir del sillón y sabe perfectamente si
 *  quiere volver con esa persona o no.
 *
 *  Si dice que sí, el bot sólo le ofrecerá huecos de ella a partir de
 *  entonces (ver `Patient.preferredDentistId` y `buscarDisponibilidad`).
 *
 *  ---------------------------------------------------------------------
 *  DOS CAMINOS, SEGÚN LO QUE HAYA CONFIGURADO
 *  ---------------------------------------------------------------------
 *  1. Con `APPOINTMENT_COMPLETED_WEBHOOK_URL`: el panel sólo AVISA a n8n
 *     (evento `appointment.completed`, firmado) y es el bot quien pregunta,
 *     con botones «Sí, mantener / Me da igual». Es el camino bueno: un botón
 *     no se interpreta mal, y el bot trata al paciente de usted como en el
 *     resto de la conversación. El bot guarda el mensaje en el panel por
 *     `/api/automation/messages`, como todos los suyos.
 *
 *  2. Sin él: el panel redacta la pregunta en texto plano y la manda por el
 *     webhook de salida. Funciona igual, sólo que sin botones. Está para
 *     que la función no dependa de que alguien configure una variable más.
 *
 *  ---------------------------------------------------------------------
 *  LO QUE ESTA FUNCIÓN NO HACE
 *  ---------------------------------------------------------------------
 *  No interpreta la respuesta. El paciente contesta en lenguaje natural
 *  —«sí», «claro», «me da igual», «prefiero cualquiera»— y de eso se encarga
 *  la IA de n8n, que llama después a `/api/automation/preferred-dentist`.
 *  Meter aquí un `if (texto === 'si')` sería adivinar.
 *
 *  ---------------------------------------------------------------------
 *  NO PUEDE ROMPER EL CIERRE DE UNA CITA
 *  ---------------------------------------------------------------------
 *  La cita YA está marcada como atendida cuando esto corre. Si WhatsApp no
 *  responde, se registra y se sigue: nadie va a deshacer una consulta porque
 *  un mensaje no salió. Por eso no lanza nunca.
 * ===========================================================================
 */

/**
 * Cada cuánto se vuelve a preguntar a quien dijo que no.
 *
 * Preguntarlo en cada visita es acoso; no preguntarlo nunca más deja fuera a
 * quien cambió de opinión porque le atendió alguien con quien se encontró a
 * gusto. Tres meses es el orden de magnitud de un tratamiento largo.
 */
const DIAS_ENTRE_PREGUNTAS = 90;

export type ResultadoPregunta =
  | { estado: 'ENVIADA' }
  | { estado: 'OMITIDA'; motivo: string }
  | { estado: 'FALLO'; motivo: string };

export async function preguntarPorOdontologoDePreferencia(params: {
  appointmentId: string;
}): Promise<ResultadoPregunta> {
  try {
    const cita = await repository.findAppointmentById(params.appointmentId);
    if (!cita) return { estado: 'OMITIDA', motivo: 'La cita ya no existe' };

    // Por teléfono y no por id: es la consulta que ya existe, y el teléfono
    // es justo lo que hace falta después para escribirle.
    const paciente = await repository.findPatientByPhone(cita.patient.phoneE164);
    if (!paciente) return { estado: 'OMITIDA', motivo: 'El paciente ya no existe' };

    /*
     * Ya eligió a esta misma persona: no hay nada que preguntar. Se calla en
     * vez de confirmar lo que ya está decidido.
     */
    if (paciente.preferredDentistId === cita.dentistId) {
      return { estado: 'OMITIDA', motivo: 'Ya es su odontólogo de preferencia' };
    }

    if (paciente.preferredDentistAskedAt) {
      const dias =
        (Date.now() - paciente.preferredDentistAskedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (dias < DIAS_ENTRE_PREGUNTAS) {
        return { estado: 'OMITIDA', motivo: `Ya se le preguntó hace ${Math.round(dias)} días` };
      }
    }

    const odontologo = await repository.findDentistById(cita.dentistId);
    if (!odontologo) return { estado: 'OMITIDA', motivo: 'El odontólogo ya no existe' };

    /*
     * Camino 1: avisar a n8n y que pregunte el bot, con botones.
     *
     * La marca de «preguntado» se pone AQUÍ, al aceptar n8n el aviso, no al
     * entregarse el WhatsApp: si el bot falla después, es su reintento y no
     * el nuestro, y dos avisos seguidos serían dos preguntas al paciente.
     */
    const webhookUrl = process.env.APPOINTMENT_COMPLETED_WEBHOOK_URL;
    if (webhookUrl) {
      const aviso = await avisarCitaAtendida(webhookUrl, {
        phone: paciente.phoneE164,
        patientName: paciente.fullName,
        dentistId: odontologo.id,
        dentistName: odontologo.fullName,
        appointmentId: cita.id,
        treatment: cita.treatment.name,
      });
      if (aviso.ok) {
        await repository.marcarPreguntaDePreferencia({ patientId: paciente.id });
        return { estado: 'ENVIADA' };
      }
      // n8n no respondió: se cae al camino 2 en vez de dejar al paciente
      // sin pregunta. Peor que sin botones es sin nada.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'preferencia.webhook_fallido',
          appointmentId: cita.id,
          message: aviso.motivo,
        }),
      );
    }

    /*
     * Camino 2: la pregunta la escribe y la manda el panel.
     *
     * El mensaje se escribe aquí y no en n8n para que quede EN EL PANEL.
     *
     * `recordAutomationMessage` lo mete en el hilo del paciente, así que
     * recepción ve la pregunta en el monitor y entiende por qué el paciente
     * contesta «sí» de la nada media hora después. Un mensaje que sale por
     * fuera del panel es un hueco en la conversación.
     */
    /*
     * El texto NO da por supuesto el género de nadie.
     *
     * La ficha guarda el nombre, no el género, y la plantilla decía «te la
     * reservamos a ella» para cualquiera: al Dr. Perdomo le llegaba el
     * mensaje en femenino. Se habla de la persona por su nombre y en
     * segunda persona, que funciona con todo el mundo.
     */
    const texto =
      `¡Gracias por tu visita! 🦷\n\n` +
      `¿Quieres que tus próximas citas sean siempre con ${odontologo.fullName}?\n\n` +
      `Responde *Sí* y te reservamos con ${odontologo.fullName} de aquí en adelante, ` +
      `o *No* si prefieres el primer hueco disponible con quien sea.`;

    const guardado = await repository.recordAutomationMessage({
      phoneE164: paciente.phoneE164,
      direction: 'OUTBOUND',
      author: 'SYSTEM',
      body: texto,
    });

    const entrega = await deliverMessage({
      phoneE164: paciente.phoneE164,
      body: texto,
      conversationId: guardado.conversationId,
      messageId: guardado.messageId,
    });

    /*
     * La fecha se marca AUNQUE la entrega quede pendiente.
     *
     * El mensaje está escrito y guardado; si el webhook lo reintenta, no
     * queremos que el siguiente cierre de cita genere una segunda pregunta
     * idéntica. Preguntar de más es peor que preguntar de menos: son dos
     * WhatsApp seguidos al paciente diciendo lo mismo.
     */
    await repository.marcarPreguntaDePreferencia({ patientId: paciente.id });

    if (entrega.status === 'FAILED') {
      return { estado: 'FALLO', motivo: entrega.reason };
    }
    return { estado: 'ENVIADA' };
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'preferencia.pregunta_fallida',
        appointmentId: params.appointmentId,
        message: motivo,
      }),
    );
    return { estado: 'FALLO', motivo };
  }
}

/**
 * Le cuenta a n8n que una cita se atendió, con lo que hace falta para
 * preguntar: a quién y con quién. Misma firma que `notifyAiToggled`:
 * HMAC-SHA256 sobre `${timestamp}.${cuerpo}`.
 *
 * Devuelve el resultado en vez de lanzar: quien llama decide qué hacer si
 * n8n no contesta, y aquí ya se sabe que es caer al texto plano.
 */
async function avisarCitaAtendida(
  webhookUrl: string,
  datos: {
    phone: string;
    patientName: string;
    dentistId: string;
    dentistName: string;
    appointmentId: string;
    treatment: string;
  },
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const payload = JSON.stringify({
    event: 'appointment.completed',
    ...datos,
    at: new Date().toISOString(),
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', env.AUTOMATION_HMAC_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  try {
    const respuesta = await fetch(webhookUrl, {
      method: 'POST',
      // Corto: quien pulsó «Completar» está mirando la pantalla.
      signal: AbortSignal.timeout(5000),
      headers: {
        'Content-Type': 'application/json',
        'X-Automation-Timestamp': String(timestamp),
        'X-Automation-Signature': signature,
      },
      body: payload,
    });
    if (!respuesta.ok) return { ok: false, motivo: `n8n respondió ${respuesta.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, motivo: error instanceof Error ? error.message : String(error) };
  }
}
