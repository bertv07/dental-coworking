'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema, safeTextSchema } from '@/backend/validators/common';
import { parseDayKey } from '@/backend/domain/clinic-calendar';

/**
 * ===========================================================================
 *  Gastos: lo que la clínica o cada odontóloga paga para trabajar
 * ===========================================================================
 *  Dos dueños posibles y cada uno sólo toca lo suyo:
 *   · SUPER_ADMIN → los gastos de la CLÍNICA (luz, condominio, publicidad…).
 *   · DENTIST     → sus PROPIOS gastos (materiales, lo que compra).
 *
 *  El `scope` y el `dentistId` NO llegan del formulario: salen de la sesión.
 *  Si vinieran del cliente, una odontóloga podría cargarle gastos a otra —o
 *  a la clínica— y mover el resultado de la liquidación.
 * ===========================================================================
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
}

const gastoSchema = z.object({
  category: safeTextSchema(60).pipe(z.string().min(2, 'Pon una categoría')),
  description: safeTextSchema(160).pipe(z.string().min(2, 'Describe el gasto')),
  amountUsd: z.coerce
    .number({ invalid_type_error: 'Pon el monto' })
    .min(0, 'No puede ser negativo')
    .max(1_000_000, 'Demasiado grande'),
  recurrence: z.enum(['ONE_TIME', 'MONTHLY']),
  startsOn: z.string().refine((v) => parseDayKey(v) !== null, 'Pon la fecha'),
  endsOn: z
    .union([z.string(), z.literal('')])
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || parseDayKey(v) !== null, 'Fecha de fin inválida'),
  notes: z
    .union([safeTextSchema(300), z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),
});

/** Quién es y de quién son los gastos que puede tocar. */
async function quien(): Promise<
  | { ok: true; userId: string; scope: 'CLINIC' | 'DENTIST'; dentistId: string | null }
  | { ok: false; result: ActionResult }
> {
  const auth = await checkApiRole('DENTIST');
  if (!auth.authorized) {
    return {
      ok: false,
      result: {
        ok: false,
        error: auth.status === 401 ? 'Tu sesión expiró. Vuelve a iniciar sesión.' : 'No tienes permiso.',
      },
    };
  }
  const { user } = auth;
  if (user.role === 'SUPER_ADMIN') return { ok: true, userId: user.id, scope: 'CLINIC', dentistId: null };
  if (user.role === 'DENTIST') {
    const perfil = await repository.findDentistByUserId(user.id);
    if (!perfil) {
      return { ok: false, result: { ok: false, error: 'Tu usuario no está vinculado a una ficha de odontólogo.' } };
    }
    return { ok: true, userId: user.id, scope: 'DENTIST', dentistId: perfil.id };
  }
  // Recepción no lleva gastos: no son suyos ni de la clínica que administra.
  return { ok: false, result: { ok: false, error: 'Los gastos los lleva administración o cada odontólogo.' } };
}

/** El gasto es de quien lo pide: si no, no se toca. */
async function esSuyo(id: string, q: { scope: 'CLINIC' | 'DENTIST'; dentistId: string | null }) {
  const lista = await repository.listExpenses({ scope: q.scope, dentistId: q.dentistId ?? undefined });
  return lista.some((g) => g.id === id);
}

export async function saveExpenseAction(id: string | null, input: unknown): Promise<ActionResult> {
  const q = await quien();
  if (!q.ok) return q.result;

  if (id !== null) {
    if (!cuidSchema.safeParse(id).success) return { ok: false, error: 'Identificador inválido' };
    if (!(await esSuyo(id, q))) return { ok: false, error: 'Ese gasto no es tuyo.' };
  }

  const v = gastoSchema.safeParse(input);
  if (!v.success) {
    const issue = v.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }
  const d = v.data;
  if (d.recurrence === 'MONTHLY' && d.endsOn && d.endsOn < d.startsOn) {
    return { ok: false, error: 'El fin no puede ser antes del inicio.', field: 'endsOn' };
  }

  const r = await repository.saveExpense({
    id,
    userId: q.userId,
    data: {
      scope: q.scope,
      dentistId: q.dentistId,
      category: d.category,
      description: d.description,
      amountCents: Math.round(d.amountUsd * 100),
      recurrence: d.recurrence,
      startsOn: d.startsOn,
      // Un gasto único no tiene fin: la fecha es la del pago.
      endsOn: d.recurrence === 'MONTHLY' ? d.endsOn : null,
      notes: d.notes,
    },
  });
  if (!r.ok) return { ok: false, error: 'No se pudo guardar el gasto.' };

  revalidatePath('/gastos');
  return { ok: true };
}

export async function deleteExpenseAction(id: string): Promise<ActionResult> {
  const q = await quien();
  if (!q.ok) return q.result;
  if (!cuidSchema.safeParse(id).success) return { ok: false, error: 'Identificador inválido' };
  if (!(await esSuyo(id, q))) return { ok: false, error: 'Ese gasto no es tuyo.' };

  const r = await repository.deleteExpense({ id, userId: q.userId });
  if (!r.ok) return { ok: false, error: 'Ese gasto ya no existe.' };

  revalidatePath('/gastos');
  return { ok: true };
}
