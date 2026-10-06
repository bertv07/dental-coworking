'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema, safeTextSchema } from '@/backend/validators/common';
import { parseDayKey } from '@/backend/domain/clinic-calendar';

/**
 * ===========================================================================
 *  Administración: el libro que Deimara llevaba en Excel
 * ===========================================================================
 *  SÓLO Super Admin. Es dinero de la clínica y de cada odontóloga —lo mismo
 *  que ya está oculto a recepción en el reparto de cada factura—, y aquí es
 *  la pantalla entera, no un dato dentro de otra.
 * ===========================================================================
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
}

async function autorizar() {
  const auth = await checkApiRole('SUPER_ADMIN');
  if (!auth.authorized) {
    return {
      ok: false as const,
      result: {
        ok: false,
        error: auth.status === 401 ? 'Tu sesión expiró. Vuelve a iniciar sesión.' : 'No tienes permiso para esto.',
      } satisfies ActionResult,
    };
  }
  return { ok: true as const, userId: auth.user.id };
}

// --- Gastos Administrativos / Caja Chica ------------------------------------

const filaGeneralSchema = z.object({
  book: z.enum(['GASTOS_ADMIN', 'CAJA_CHICA']),
  date: z.string().refine((v) => parseDayKey(v) !== null, 'Pon la fecha'),
  description: safeTextSchema(200).pipe(z.string().min(2, 'Describe la fila')),
  incomeUsd: z.coerce.number().min(0, 'No puede ser negativo').max(1_000_000).default(0),
  expenseUsd: z.coerce.number().min(0, 'No puede ser negativo').max(1_000_000).default(0),
  notes: z.union([safeTextSchema(300), z.literal('')]).optional().transform((v) => (v ? v : null)),
});

export async function saveAdminLedgerEntryAction(id: string | null, input: unknown): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;
  if (id !== null && !cuidSchema.safeParse(id).success) return { ok: false, error: 'Identificador inválido' };

  const v = filaGeneralSchema.safeParse(input);
  if (!v.success) {
    const issue = v.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }
  const d = v.data;
  // Una fila es ingreso O egreso, nunca las dos — igual que en la hoja.
  if (d.incomeUsd > 0 && d.expenseUsd > 0) {
    return { ok: false, error: 'Una fila es ingreso o egreso, no las dos.', field: 'expenseUsd' };
  }

  const r = await repository.saveAdminLedgerEntry({
    id,
    userId: auth.userId,
    data: {
      book: d.book,
      date: d.date,
      description: d.description,
      incomeCents: Math.round(d.incomeUsd * 100),
      expenseCents: Math.round(d.expenseUsd * 100),
      notes: d.notes,
    },
  });
  if (!r.ok) return { ok: false, error: 'No se pudo guardar la fila.' };

  revalidatePath('/administracion');
  revalidatePath('/gastos');
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function deleteAdminLedgerEntryAction(id: string): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;
  if (!cuidSchema.safeParse(id).success) return { ok: false, error: 'Identificador inválido' };

  const r = await repository.deleteAdminLedgerEntry({ id, userId: auth.userId });
  if (!r.ok) return { ok: false, error: 'Esa fila ya no existe.' };

  revalidatePath('/administracion');
  revalidatePath('/gastos');
  revalidatePath('/dashboard');
  return { ok: true };
}

// --- El libro de cada odontóloga --------------------------------------------

const filaDentistaSchema = z.object({
  dentistId: cuidSchema,
  date: z.string().refine((v) => parseDayKey(v) !== null, 'Pon la fecha'),
  patientName: safeTextSchema(120).pipe(z.string().min(2, 'Pon el nombre del paciente')),
  budgetUsd: z.coerce.number().min(0, 'No puede ser negativo').max(1_000_000).default(0),
  depositUsd: z.coerce.number().min(0, 'No puede ser negativo').max(1_000_000).default(0),
  /** `''` = cortesía (todo en cero); si no, el % que se quedó ELLA. */
  dentistPercent: z.union([z.coerce.number().min(0).max(100), z.literal('')]).default(''),
  notes: z.union([safeTextSchema(300), z.literal('')]).optional().transform((v) => (v ? v : null)),
});

export async function saveDentistLedgerEntryAction(id: string | null, input: unknown): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;
  if (id !== null && !cuidSchema.safeParse(id).success) return { ok: false, error: 'Identificador inválido' };

  const v = filaDentistaSchema.safeParse(input);
  if (!v.success) {
    const issue = v.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }
  const d = v.data;
  const budgetCents = Math.round(d.budgetUsd * 100);
  const dentistPercent = d.dentistPercent === '' ? 0 : d.dentistPercent;
  const dentistShareCents = Math.round((budgetCents * dentistPercent) / 100);

  const r = await repository.saveDentistLedgerEntry({
    id,
    userId: auth.userId,
    data: {
      dentistId: d.dentistId,
      date: d.date,
      patientName: d.patientName,
      budgetCents,
      depositCents: Math.round(d.depositUsd * 100),
      dentistPercent,
      dentistShareCents,
      // Lo que no se queda ella, se lo queda la clínica. Nunca al revés: el
      // presupuesto entero pasa por la caja de la clínica primero.
      clinicShareCents: budgetCents - dentistShareCents,
      notes: d.notes,
    },
  });
  if (!r.ok) return { ok: false, error: 'No se pudo guardar la fila.' };

  revalidatePath('/administracion');
  revalidatePath('/gastos');
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function deleteDentistLedgerEntryAction(id: string): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;
  if (!cuidSchema.safeParse(id).success) return { ok: false, error: 'Identificador inválido' };

  const r = await repository.deleteDentistLedgerEntry({ id, userId: auth.userId });
  if (!r.ok) return { ok: false, error: 'Esa fila ya no existe.' };

  revalidatePath('/administracion');
  revalidatePath('/gastos');
  revalidatePath('/dashboard');
  return { ok: true };
}
