import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { repository } from '@/backend/repositories';
import { readSignedBody } from '@/backend/http/automation-request';
import { phoneE164Schema } from '@/backend/validators/common';
import {
  ok,
  fail,
  failValidation,
  failInternal,
  newRequestId,
  ErrorCode,
} from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/preferred-dentist
 * ===========================================================================
 *  El paciente contesta a «¿quieres que tus próximas citas sean con la
 *  Dra. X?» y el bot registra aquí la decisión.
 *
 *  La pregunta la manda el panel al marcar una cita como atendida
 *  (`preferencia-odontologo.service.ts`). Este endpoint es la otra mitad.
 *
 *  CUERPO
 *  ------
 *    {
 *      "phone":     "+584121234567",
 *      "keep":      true,                  // false = «me da igual»
 *      "dentistId": "cdent000002xxx"       // sólo si keep = true
 *    }
 *
 *  `dentistId` es OPCIONAL incluso diciendo que sí: si no viene, se toma el
 *  odontólogo de la última cita atendida del paciente, que es justo la que
 *  motivó la pregunta. Así el bot no tiene que acordarse de un id entre dos
 *  mensajes —que es exactamente lo que no consigue hacer de forma fiable con
 *  el estado del workflow—.
 *
 *  RESPUESTAS
 *  ----------
 *    200 → decisión guardada. Trae `dentistName` para poder confirmárselo.
 *    404 → ese teléfono no es de ningún paciente.
 *    409 → dijo que sí pero no hay ninguna cita atendida de la que deducir
 *          con quién; el bot tiene que preguntar el nombre.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cuerpoSchema = z.object({
  phone: phoneE164Schema,
  /** `true` = seguir con el mismo; `false` = le da igual quién le atienda. */
  keep: z.boolean(),
  dentistId: z.string().trim().min(1).max(40).optional(),
});

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const signed = await readSignedBody(request, {
      endpoint: 'preferred-dentist',
      kind: 'write',
      requestId,
    });
    if (!signed.ok) return signed.response;

    const validacion = cuerpoSchema.safeParse(signed.body);
    if (!validacion.success) return failValidation(validacion.error, requestId);

    const { phone, keep } = validacion.data;

    const paciente = await repository.findPatientByPhone(phone);
    if (!paciente) {
      return fail(ErrorCode.NOT_FOUND, 'Ese número no es de ningún paciente', 404, { requestId });
    }

    /*
     * «No» es un caso cerrado: se borra la preferencia y se deja constancia
     * de que contestó, para no volver a preguntárselo en la próxima cita.
     */
    if (!keep) {
      await repository.fijarOdontologoDePreferencia({
        patientId: paciente.id,
        dentistId: null,
      });
      return ok({
        preferredDentistId: null,
        dentistName: null,
        message: 'Listo, te seguiremos ofreciendo el primer hueco disponible.',
      });
    }

    /*
     * Dijo que sí. ¿Con quién?
     *
     * Si el bot manda el id, se usa. Si no —lo normal, porque acordarse de
     * un id entre dos mensajes es justo lo que no le sale bien—, se deduce
     * de su última cita atendida: es la que provocó la pregunta.
     */
    let dentistId = validacion.data.dentistId ?? null;

    if (!dentistId) {
      const ultima = await repository.findLastCompletedAppointment(paciente.id);
      dentistId = ultima?.dentistId ?? null;
    }

    if (!dentistId) {
      return fail(
        ErrorCode.CONFLICT,
        'No sé con qué odontólogo quiere seguir: no tiene ninguna cita atendida',
        409,
        { requestId },
      );
    }

    const odontologo = await repository.findDentistById(dentistId);
    if (!odontologo || !odontologo.isActive) {
      return fail(
        ErrorCode.NOT_FOUND,
        'Ese odontólogo no existe o ya no atiende en la clínica',
        404,
        { requestId },
      );
    }

    const guardado = await repository.fijarOdontologoDePreferencia({
      patientId: paciente.id,
      dentistId: odontologo.id,
    });
    if (!guardado.ok) {
      return fail(ErrorCode.NOT_FOUND, 'Ese paciente ya no existe', 404, { requestId });
    }

    return ok({
      preferredDentistId: odontologo.id,
      dentistName: odontologo.fullName,
      specialties: odontologo.specialties,
      message: `Perfecto, tus próximas citas serán con ${odontologo.fullName}.`,
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
