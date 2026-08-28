'use server';

import { revalidatePath } from 'next/cache';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { toggleAiSchema, sendMessageSchema } from '@/backend/validators/appointment.schema';
import { notifyAiToggled } from '@/backend/services/whatsapp-outbound.service';

/**
 * ===========================================================================
 *  Server Actions del monitor de WhatsApp
 * ===========================================================================
 *  ⚠️  RECORDATORIO DE SEGURIDAD
 *  Una Server Action es un endpoint HTTP público con otro nombre. Que sólo
 *  se invoque desde un componente ya protegido NO la protege: cualquiera
 *  puede llamarla directamente conociendo su identificador.
 *
 *  Por eso cada acción repite el ciclo completo:
 *    1. Autenticar y autorizar
 *    2. Validar la entrada con Zod
 *    3. Ejecutar
 *    4. Auditar
 *    5. Revalidar la caché
 * ===========================================================================
 */

export interface ToggleAiResult {
  ok: boolean;
  error?: string;
  aiEnabled?: boolean;
}

/**
 * APAGA / ENCIENDE la IA en una conversación concreta.
 *
 * Es la acción más delicada del monitor: mientras `aiEnabled` sea `false`,
 * el webhook entrante NO debe generar respuestas automáticas. Si nadie
 * atiende ese chat, el paciente se queda esperando — de ahí que se exija un
 * motivo al apagarla y que quede registrado quién lo hizo.
 */
export async function toggleConversationAiAction(input: {
  conversationId: string;
  aiEnabled: boolean;
  reason?: string;
}): Promise<ToggleAiResult> {
  // --- 1. Autorización -----------------------------------------------------
  // Asistente o superior: recepción necesita poder tomar un chat sin
  // depender de que el Super Admin esté disponible.
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para modificar la IA de este chat.',
    };
  }

  // --- 2. Validación -------------------------------------------------------
  // El esquema exige un motivo cuando se APAGA la IA.
  const validation = toggleAiSchema.safeParse(input);
  if (!validation.success) {
    return {
      ok: false,
      error: validation.error.issues[0]?.message ?? 'Datos inválidos',
    };
  }

  const { conversationId, aiEnabled, reason } = validation.data;

  try {
    // --- 3. Ejecución ------------------------------------------------------
    const updated = await repository.setConversationAiEnabled({
      conversationId,
      aiEnabled,
      userId: authorization.user.id,
      reason: reason ?? null,
    });

    if (!updated) {
      return { ok: false, error: 'La conversación no existe' };
    }

    // --- 4. Auditoría ------------------------------------------------------
    // Apagar la IA tiene consecuencias para el paciente: debe quedar quién,
    // cuándo y por qué. En modo DB esto se escribe en `audit_logs`.
    console.info(
      JSON.stringify({
        level: 'info',
        event: aiEnabled ? 'whatsapp.ai_enabled' : 'whatsapp.ai_disabled',
        conversationId,
        userId: authorization.user.id,
        reason: reason ?? null,
        timestamp: new Date().toISOString(),
      }),
    );

    // --- 5. Aviso a la automatización --------------------------------------
    // Se lanza SIN esperar: n8n no debe poder retrasar la interfaz. Y aunque
    // este aviso se pierda, el bot sigue enterándose, porque consulta el
    // estado del chat en cada mensaje entrante.
    void notifyAiToggled({
      conversationId,
      phoneE164: updated.phoneE164,
      aiEnabled,
      reason: reason ?? null,
      changedBy: authorization.user.name,
    });

    // --- 6. Revalidación ---------------------------------------------------
    // Invalida la caché de la ruta para que el siguiente render traiga el
    // estado nuevo, sin recargar la página entera a mano.
    revalidatePath('/whatsapp');

    return { ok: true, aiEnabled: updated.aiEnabled };
  } catch (error) {
    // El detalle real va al log del servidor; al cliente sólo un mensaje
    // genérico, sin filtrar internos del sistema.
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'whatsapp.ai_toggle_failed',
        conversationId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo actualizar el estado de la IA' };
  }
}

// ===========================================================================
//  ENVÍO DE MENSAJES
// ===========================================================================

export interface SendMessageResult {
  ok: boolean;
  error?: string;
  /** Aviso cuando el mensaje se guardó pero no llegó a entregarse. */
  warning?: string;
}

/**
 * Lo que WhatsApp acepta, con su tope real en bytes.
 *
 * Se comprueba AQUÍ y no se deja para el proveedor: un archivo que Meta va a
 * rechazar se habría guardado ya en la base y el paciente vería un mensaje
 * fallido sin saber por qué. El tope por familia es el de la propia API.
 */
const TIPOS_WHATSAPP: Record<string, number> = {
  'image/jpeg': 5 * 1024 * 1024,
  'image/png': 5 * 1024 * 1024,
  'image/webp': 5 * 1024 * 1024,
  'audio/aac': 16 * 1024 * 1024,
  'audio/mp4': 16 * 1024 * 1024,
  'audio/mpeg': 16 * 1024 * 1024,
  'audio/amr': 16 * 1024 * 1024,
  'audio/ogg': 16 * 1024 * 1024,
  'video/mp4': 16 * 1024 * 1024,
  'video/3gpp': 16 * 1024 * 1024,
  'application/pdf': 16 * 1024 * 1024,
};

/** Los mismos límites, en palabras, para el mensaje de error. */
function limiteLegible(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Nombre del archivo, para usarlo de cuerpo cuando el mensaje va sin texto. */
function nombreDe(archivo: FormDataEntryValue | null): string {
  return archivo instanceof File && archivo.name ? archivo.name.slice(0, 120) : 'Archivo adjunto';
}

/**
 * Envía un mensaje de WhatsApp escrito por un humano desde el panel.
 *
 * ORDEN DE LAS OPERACIONES (importa):
 *   1. Se PERSISTE el mensaje como PENDING.
 *   2. Se intenta la entrega al proveedor.
 *   3. Se actualiza su estado según el resultado.
 *
 * Al revés —entregar primero y guardar después— un fallo entre ambos pasos
 * dejaría un mensaje ya recibido por el paciente que no aparece en el
 * historial. Así el peor caso es un mensaje registrado que no salió, y eso
 * la interfaz sí lo muestra.
 */
export async function sendWhatsAppMessageAction(
  input: { conversationId: string; body: string } | FormData,
): Promise<SendMessageResult> {
  // --- 1. Autorización ---------------------------------------------------
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para escribir en este chat.',
    };
  }

  // --- 2. Validación -----------------------------------------------------
  /*
   * Se admiten las dos formas: objeto para el mensaje de sólo texto, que es
   * el 95 % de los envíos, y `FormData` cuando lleva archivo. Obligar a
   * `FormData` siempre metería una copia y un multipart en cada «ok, te
   * espero».
   */
  const esFormulario = input instanceof FormData;
  const archivo = esFormulario ? input.get('file') : null;

  const validation = sendMessageSchema.safeParse(
    esFormulario
      ? {
          conversationId: String(input.get('conversationId') ?? ''),
          // Un adjunto puede ir sin texto: el pie es opcional en WhatsApp,
          // pero el esquema exige cuerpo. Se pone el nombre del archivo.
          body: String(input.get('body') ?? '').trim() || nombreDe(archivo),
        }
      : input,
  );
  if (!validation.success) {
    return { ok: false, error: validation.error.issues[0]?.message ?? 'Mensaje inválido' };
  }

  const { conversationId, body } = validation.data;

  // --- 2-bis. El archivo, si lo hay --------------------------------------
  let adjunto: { nombre: string; tipo: string; bytes: Buffer } | null = null;

  if (archivo instanceof File && archivo.size > 0) {
    const tope = TIPOS_WHATSAPP[archivo.type];
    if (!tope) {
      return {
        ok: false,
        error:
          'WhatsApp no acepta ese tipo de archivo. Puedes enviar fotos (JPG, PNG), ' +
          'PDF, audio o vídeo.',
      };
    }
    if (archivo.size > tope) {
      return {
        ok: false,
        error: `Ese archivo pasa de ${limiteLegible(tope)}, que es el máximo que admite WhatsApp para ese tipo.`,
      };
    }
    adjunto = {
      nombre: archivo.name.slice(0, 120) || 'archivo',
      tipo: archivo.type,
      bytes: Buffer.from(await archivo.arrayBuffer()),
    };
  }

  try {
    // --- 3. Persistir ----------------------------------------------------
    const created = await repository.createOutboundMessage({
      conversationId,
      body,
      userId: authorization.user.id,
    });

    if (!created.ok) return { ok: false, error: 'La conversación no existe.' };

    // --- 3-bis. Guardar el archivo ---------------------------------------
    /*
     * Antes de avisar a n8n: si se notificara primero, el flujo pediría el
     * adjunto por `/api/automation/media` y todavía no estaría ahí.
     */
    let mediaId: string | null = null;
    if (adjunto) {
      const guardado = await repository.attachOutboundMedia({
        messageId: created.data.id,
        fileName: adjunto.nombre,
        mimeType: adjunto.tipo,
        content: adjunto.bytes,
        userId: authorization.user.id,
      });

      if (!guardado.ok) {
        await repository.setMessageDelivery({
          messageId: created.data.id,
          status: 'FAILED',
          error: 'No se pudo guardar el archivo',
        });
        return { ok: false, error: 'No se pudo guardar el archivo. Intenta de nuevo.' };
      }
      mediaId = guardado.data.id;
    }

    // --- 4. Entregar -----------------------------------------------------
    const { deliverMessage } = await import('@/backend/services/whatsapp-outbound.service');

    const outcome = await deliverMessage({
      phoneE164: created.data.phoneE164,
      body,
      conversationId,
      messageId: created.data.id,
      media: adjunto
        ? { mediaId: mediaId!, mimeType: adjunto.tipo, filename: adjunto.nombre }
        : null,
    });

    // --- 5. Registrar el resultado ---------------------------------------
    await repository.setMessageDelivery({
      messageId: created.data.id,
      status: outcome.status,
      error: outcome.status === 'SENT' ? null : outcome.reason,
    });

    console.info(
      JSON.stringify({
        level: 'info',
        event: 'whatsapp.message_sent',
        conversationId,
        messageId: created.data.id,
        delivery: outcome.status,
        userId: authorization.user.id,
      }),
    );

    revalidatePath('/whatsapp');
    revalidatePath('/inicio');

    // El mensaje SE GUARDÓ, así que la operación es un éxito. Si no salió, se
    // avisa por separado en vez de fingir un fallo total.
    if (outcome.status !== 'SENT') {
      return {
        ok: true,
        warning:
          outcome.status === 'PENDING'
            ? 'Mensaje guardado, pero la salida a WhatsApp aún no está configurada.'
            : `Mensaje guardado, pero no se pudo entregar: ${outcome.reason}`,
      };
    }

    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'whatsapp.send_failed',
        conversationId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo enviar el mensaje.' };
  }
}
