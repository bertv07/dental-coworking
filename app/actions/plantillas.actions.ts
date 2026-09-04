'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema, safeTextSchema } from '@/backend/validators/common';

/**
 * ===========================================================================
 *  Server Actions de las plantillas y del monitor
 * ===========================================================================
 *  ACCESO: asistente o superior. Es quien escribe a los pacientes y quien
 *  mejor sabe qué frase funciona; obligarla a pedirle al administrador que le
 *  corrija una plantilla garantiza que nadie la corrija nunca.
 * ===========================================================================
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
}

const plantillaSchema = z.object({
  id: z.union([cuidSchema, z.literal('')]).optional().transform((v) => v || null),

  /** Agrupador de la lista. Texto libre: la clínica inventa las que necesite. */
  category: safeTextSchema(60).pipe(z.string().min(2, 'Indica una categoría')),

  title: safeTextSchema(120).pipe(z.string().min(3, 'Ponle un nombre reconocible')),

  /**
   * El mensaje. NO se limpian los corchetes ni se toca el texto: son
   * marcadores que la asistente sustituye, y "arreglarlos" aquí rompería la
   * plantilla.
   *
   * 4096 es el límite de WhatsApp para un mensaje de texto. Permitir más
   * dejaría guardar plantillas que el proveedor rechaza al enviarlas.
   */
  body: safeTextSchema(4096).pipe(z.string().min(5, 'El mensaje es demasiado corto')),

  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.coerce.boolean().default(true),
});

export async function guardarPlantillaAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para editar plantillas.',
    };
  }

  const validation = plantillaSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const { id, ...data } = validation.data;
  const result = await repository.saveMessageTemplate({ id, data, userId: authorization.user.id });

  if (!result.ok) {
    return {
      ok: false,
      error: result.reason === 'NOT_FOUND' ? 'Esa plantilla ya no existe.' : 'No se pudo guardar.',
    };
  }

  revalidatePath('/plantillas');
  // El monitor pinta la lista en su selector: sin esto seguiría mostrando la
  // versión vieja hasta la siguiente recarga completa.
  revalidatePath('/whatsapp');
  return { ok: true };
}

export async function eliminarPlantillaAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return { ok: false, error: 'No tienes permiso para eliminar plantillas.' };
  }

  const parsed = z.object({ id: cuidSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };

  const borrada = await repository.deleteMessageTemplate(parsed.data.id, authorization.user.id);
  if (!borrada) return { ok: false, error: 'Esa plantilla ya no existe.' };

  revalidatePath('/plantillas');
  revalidatePath('/whatsapp');
  return { ok: true };
}

/**
 * Cuenta que una plantilla se usó.
 *
 * Se llama al insertarla en el compositor, no al enviar: lo que interesa medir
 * es qué busca la asistente, y una plantilla que se inserta y luego se
 * reescribe entera es justo la que está mal redactada.
 */
export async function registrarUsoPlantillaAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) return { ok: false };

  const parsed = z.object({ id: cuidSchema }).safeParse(input);
  if (!parsed.success) return { ok: false };

  await repository.registerTemplateUse(parsed.data.id);
  return { ok: true };
}

/* ==========================================================================
   MONITOR: ARCHIVAR Y ELIMINAR
   ========================================================================== */

export async function archivarConversacionAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return { ok: false, error: 'No tienes permiso para archivar conversaciones.' };
  }

  const parsed = z
    .object({ conversationId: cuidSchema, archived: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const hecho = await repository.setConversationArchived({
    ...parsed.data,
    userId: authorization.user.id,
  });
  if (!hecho) return { ok: false, error: 'Esa conversación ya no existe.' };

  revalidatePath('/whatsapp');
  return { ok: true };
}

/**
 * Elimina una conversación del monitor.
 *
 * Es un borrado LÓGICO: la fila y sus mensajes siguen en la base. Una
 * conversación es la prueba de lo que se le prometió a un paciente, y quien
 * la borra suele ser justo quien tiene motivos para hacerla desaparecer.
 * Queda en auditoría con el teléfono, quién y cuándo.
 */
export async function eliminarConversacionAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return { ok: false, error: 'No tienes permiso para eliminar conversaciones.' };
  }

  const parsed = z.object({ conversationId: cuidSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const hecho = await repository.softDeleteConversation({
    conversationId: parsed.data.conversationId,
    userId: authorization.user.id,
  });
  if (!hecho) return { ok: false, error: 'Esa conversación ya no existe.' };

  revalidatePath('/whatsapp');
  return { ok: true };
}
