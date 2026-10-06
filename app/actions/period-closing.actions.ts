'use server';

import { revalidatePath } from 'next/cache';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { safeTextSchema } from '@/backend/validators/common';
import { esPeriodoValido, obtenerCierre } from '@/backend/services/cierre.service';

/**
 * ===========================================================================
 *  Cierre mensual y anual de Administración
 * ===========================================================================
 *  Cerrar guarda la FOTO del periodo: cuánto entró, cuánto salió y cuánto se
 *  ganó, quién lo cerró y cuándo. Los números se calculan AQUÍ, con lo que
 *  hay en el libro en este momento; del navegador sólo llega qué periodo y
 *  la nota.
 *
 *  SÓLO Super Admin, como el resto de /administracion.
 * ===========================================================================
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function autorizar() {
  const auth = await checkApiRole('SUPER_ADMIN');
  if (!auth.authorized) {
    return {
      ok: false as const,
      error: auth.status === 401 ? 'Tu sesión expiró. Vuelve a iniciar sesión.' : 'No tienes permiso para esto.',
    };
  }
  return { ok: true as const, user: auth.user };
}

export async function closePeriodAction(period: unknown, notes: unknown): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!esPeriodoValido(period)) return { ok: false, error: 'Ese periodo no se puede cerrar.' };

  const nota = safeTextSchema(300).safeParse(typeof notes === 'string' ? notes : '');
  if (!nota.success) return { ok: false, error: nota.error.issues[0]?.message ?? 'Nota inválida' };

  const { cierre, cobrado } = await obtenerCierre(period);

  const r = await repository.savePeriodClosing({
    period,
    incomeCents: cierre.incomeCents,
    expenseCents: cierre.expenseCents,
    collectedCents: cobrado.totalCents,
    pettyCashCents: cierre.cajaChica.finalCents,
    notes: nota.data || null,
    userId: auth.user.id,
    userName: auth.user.name,
  });
  if (!r.ok) return { ok: false, error: 'No se pudo guardar el cierre.' };

  revalidatePath('/administracion');
  return { ok: true };
}

export async function reopenPeriodAction(period: unknown): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!esPeriodoValido(period)) return { ok: false, error: 'Periodo inválido.' };

  const r = await repository.deletePeriodClosing({ period, userId: auth.user.id });
  if (!r.ok) return { ok: false, error: 'Ese periodo no estaba cerrado.' };

  revalidatePath('/administracion');
  return { ok: true };
}
