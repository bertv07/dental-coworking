'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema } from '@/backend/validators/common';
import { safeTextSchema } from '@/backend/validators/common';

/**
 * ===========================================================================
 *  Server Actions del vademécum
 * ===========================================================================
 *  La lista de lo que la clínica receta habitualmente, para que recepción la
 *  imprima en limpio en vez de dictarla en el mostrador.
 *
 *  ACCESO: asistente o superior. Es quien atiende al paciente al salir y
 *  quien imprime la hoja; pedir Super Admin para añadir un analgésico dejaría
 *  la lista congelada el día que entre uno nuevo.
 *
 *  ⚠️  Esto NO es una receta legal. La receta la firma la odontóloga en su
 *   recetario; esta hoja es las indicaciones en limpio para la farmacia.
 * ===========================================================================
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
}

const medicamentoSchema = z.object({
  name: safeTextSchema(120).pipe(z.string().min(3, 'El nombre es demasiado corto')),
  presentation: z
    .union([safeTextSchema(120), z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),
  posology: z
    .union([safeTextSchema(200), z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),
  category: z
    .union([safeTextSchema(60), z.literal('')])
    .optional()
    .transform((v) => (v ? v : 'General')),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.coerce.boolean().default(true),
});

async function autorizar() {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false as const,
      result: {
        ok: false,
        error:
          authorization.status === 401
            ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
            : 'No tienes permiso para esto.',
      } satisfies ActionResult,
    };
  }
  return { ok: true as const, userId: authorization.user.id };
}

export async function saveMedicationAction(
  id: string | null,
  input: unknown,
): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  if (id !== null && !cuidSchema.safeParse(id).success) {
    return { ok: false, error: 'Identificador inválido' };
  }

  const validation = medicamentoSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const result = await repository.saveMedication({
    id,
    data: validation.data,
    userId: auth.userId,
  });

  if (!result.ok) return { ok: false, error: 'No se pudo guardar el medicamento.' };

  revalidatePath('/medicamentos');
  return { ok: true };
}

export async function deleteMedicationAction(id: string): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const parsed = cuidSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };

  const result = await repository.deleteMedication({ id: parsed.data, userId: auth.userId });
  if (!result.ok) return { ok: false, error: 'Ese medicamento ya no existe.' };

  revalidatePath('/medicamentos');
  return { ok: true };
}
