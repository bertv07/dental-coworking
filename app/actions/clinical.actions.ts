'use server';

import { revalidatePath } from 'next/cache';
import { checkApiRole } from '@/backend/auth/guards';
import { Prisma } from '@prisma/client';
import { prisma } from '@/backend/db/client';
import {
  clinicalRecordSchema,
  clinicalEntrySchema,
} from '@/backend/validators/admin.schema';
import { clinicWallClockToInstant } from '@/backend/domain/clinic-calendar';

/**
 * ===========================================================================
 *  Server Actions del expediente clínico
 * ===========================================================================
 *  Las usa la asistente para pasar al sistema el papel que rellenó el
 *  odontólogo.
 *
 *  ACCESO: asistente o superior. El odontólogo NO escribe aquí — él rellena
 *  el papel; recepción transcribe. Mantener una sola vía de entrada evita el
 *  caso de dos versiones del mismo expediente que no coinciden.
 *
 *  Todo queda registrado con quién lo transcribió: el papel lo firma el
 *  odontólogo, pero la responsabilidad de que el sistema diga lo mismo que el
 *  papel es de quien lo copió.
 * ===========================================================================
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
}

export async function saveClinicalRecordAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para editar expedientes.',
    };
  }

  const validation = clinicalRecordSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const { patientId, odontogram, ...datos } = validation.data;

  /*
   * Prisma exige un tipo propio para las columnas JSON y no acepta `null` a
   * secas: hay que decirle explícitamente que se quiere guardar NULL en la
   * base, distinto de "no toques este campo".
   */
  const odontogramaParaPrisma = odontogram === null ? Prisma.DbNull : (odontogram as Prisma.InputJsonValue);

  try {
    /*
     * `upsert`: el expediente puede no existir todavía. Se crea en la primera
     * transcripción, no al dar de alta al paciente — un expediente vacío para
     * cada paciente que sólo pidió precios no aporta nada.
     */
    await prisma.clinicalRecord.upsert({
      where: { patientId },
      update: {
        ...datos,
        odontogram: odontogramaParaPrisma,
        updatedByUserId: authorization.user.id,
      },
      create: {
        patientId,
        ...datos,
        odontogram: odontogramaParaPrisma,
        createdByUserId: authorization.user.id,
        updatedByUserId: authorization.user.id,
      },
    });

    revalidatePath(`/pacientes/${patientId}/expediente`);
    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'clinical_record.save_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo guardar el expediente.' };
  }
}

/** Añade una línea a la hoja de evolución. */
export async function addClinicalEntryAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return { ok: false, error: 'No tienes permiso para editar expedientes.' };
  }

  const validation = clinicalEntrySchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const { patientId, performedOn, ...datos } = validation.data;

  try {
    // El expediente tiene que existir para colgarle la evolución. Si es la
    // primera vez, se crea vacío aquí.
    const record = await prisma.clinicalRecord.upsert({
      where: { patientId },
      update: {},
      create: { patientId, createdByUserId: authorization.user.id },
      select: { id: true },
    });

    await prisma.clinicalEntry.create({
      data: {
        recordId: record.id,
        // Mediodía en hora de la clínica: la fecha del papel es un DÍA, no un
        // instante, y a mediodía ningún desfase horario la mueve de día.
        performedOn: clinicWallClockToInstant(performedOn, 12 * 60),
        ...datos,
        createdByUserId: authorization.user.id,
      },
    });

    revalidatePath(`/pacientes/${patientId}/expediente`);
    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'clinical_entry.add_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo guardar la evolución.' };
  }
}
