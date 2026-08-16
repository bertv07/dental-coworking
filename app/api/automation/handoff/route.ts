import type { NextRequest } from 'next/server';
import { repository } from '@/backend/repositories';
import { readSignedBody } from '@/backend/http/automation-request';
import { handoffSchema } from '@/backend/validators/automation.schema';
import {
  ok,
  failValidation,
  failNotFound,
  failInternal,
  newRequestId,
} from '@/backend/http/responses';

/**
 * ===========================================================================
 *  POST /api/automation/handoff
 * ===========================================================================
 *  EL BOT PIDE AYUDA.
 *
 *  Hace DOS cosas de una vez, y las dos son necesarias:
 *
 *   1. APAGA la IA en ese chat.
 *   2. MARCA la conversación como «requiere atención» en el monitor.
 *
 *  Sólo marcar, sin apagar, dejaría al bot respondiendo mientras el aviso
 *  espera a que alguien lo lea — y el paciente recibiría respuestas
 *  automáticas justo cuando pidió hablar con una persona. Sólo apagar, sin
 *  marcar, dejaría el chat mudo sin que nadie sepa que hay alguien esperando.
 *
 *  Después de llamar aquí, el bot NO debe enviar nada más a ese número. Si
 *  acaso, un único mensaje de cortesía («te paso con una persona del equipo»)
 *  ANTES de esta llamada.
 *
 *  ---------------------------------------------------------------------
 *  CUÁNDO LLAMAR
 *  ---------------------------------------------------------------------
 *   · El paciente lo pide explícitamente.
 *   · Consulta clínica que requiere criterio profesional (dolor, urgencia,
 *     diagnóstico, medicación).
 *   · Reclamo, queja o discusión sobre un cobro.
 *   · El modelo no entiende tras dos intentos.
 *
 *  Reactivar la IA es una decisión HUMANA, desde el panel. El bot no puede
 *  volver a encenderse solo: si pudiera, se reactivaría en mitad de la
 *  conversación que un agente está atendiendo.
 *
 *  ---------------------------------------------------------------------
 *  CUERPO
 *  ---------------------------------------------------------------------
 *    { "phone": "+584141234567", "reason": "El paciente pide hablar con una persona" }
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const signed = await readSignedBody(request, {
      endpoint: 'handoff',
      kind: 'write',
      requestId,
    });
    if (!signed.ok) return signed.response;

    const validation = handoffSchema.safeParse(signed.body);
    if (!validation.success) return failValidation(validation.error, requestId);

    const result = await repository.requestHumanHandoff({
      phoneE164: validation.data.phone,
      reason: validation.data.reason,
    });

    // Escalar un número del que no hay conversación es un error del flujo:
    // significa que se llamó a handoff sin haber registrado el mensaje.
    if (!result) return failNotFound('Conversación', requestId);

    return ok({
      conversationId: result.conversationId,
      aiEnabled: result.aiEnabled,
      message: 'IA desactivada y conversación marcada para atención humana',
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
