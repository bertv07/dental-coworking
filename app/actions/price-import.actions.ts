'use server';

import { revalidatePath } from 'next/cache';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import {
  leerArchivoDePrecios,
  type FilaImportada,
} from '@/backend/services/price-import.service';

/**
 * ===========================================================================
 *  Importar la lista de precios desde Excel
 * ===========================================================================
 *  DOS PASOS, y son dos a propósito:
 *
 *   1. `previewPriceImportAction` — lee el archivo y devuelve qué cambiaría.
 *      No escribe nada.
 *   2. `applyPriceImportAction`   — aplica lo que ya se vio.
 *
 *  Aplicar de una sola vez sería más cómodo y mucho peor: una columna corrida
 *  o un separador decimal mal puesto cambiaría toda la lista sin que nadie lo
 *  note hasta que un paciente pregunte por qué le cobran diez veces más.
 *
 *  ACCESO: asistente o superior, igual que editar un precio a mano — es la
 *  misma operación, sólo que en lote.
 * ===========================================================================
 */

export interface PreviewResult {
  ok: boolean;
  error?: string;
  filas?: FilaImportada[];
  resumen?: { nuevos: number; actualizan: number; sinCambio: number; errores: number };
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  creados?: number;
  actualizados?: number;
}

/** 5 MB: una lista de precios son kilobytes, no megas. */
const TAMANO_MAXIMO = 5 * 1024 * 1024;

async function autorizar() {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false as const,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para esto.',
    };
  }
  return { ok: true as const, userId: authorization.user.id };
}

/** Lee el archivo y dice qué pasaría. NO toca la base. */
export async function previewPriceImportAction(formData: FormData): Promise<PreviewResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Elige un archivo.' };
  }

  if (file.size > TAMANO_MAXIMO) {
    return { ok: false, error: 'El archivo no puede pasar de 5 MB.' };
  }

  const nombre = file.name.toLowerCase();
  if (!nombre.endsWith('.xlsx') && !nombre.endsWith('.csv')) {
    return { ok: false, error: 'Sube un Excel (.xlsx) o un CSV.' };
  }

  try {
    // El catálogo actual, para poder decir «esta sube de $30 a $45».
    const existentes = (await repository.listTreatments({ includeInactive: true })).map(
      (t) => ({ code: t.code, basePriceCents: t.basePriceCents }),
    );

    const { filas, error } = await leerArchivoDePrecios(
      await file.arrayBuffer(),
      file.name,
      existentes,
    );

    if (error) return { ok: false, error };

    return {
      ok: true,
      filas,
      resumen: {
        nuevos: filas.filter((f) => f.estado === 'NUEVO').length,
        actualizan: filas.filter((f) => f.estado === 'ACTUALIZA').length,
        sinCambio: filas.filter((f) => f.estado === 'SIN_CAMBIO').length,
        errores: filas.filter((f) => f.estado === 'ERROR').length,
      },
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'price_import.preview_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo leer el archivo. Intenta de nuevo.' };
  }
}

/**
 * Aplica los cambios ya revisados.
 *
 * Recibe las filas que devolvió la vista previa, no el archivo otra vez:
 * volver a leerlo abriría la puerta a aplicar algo distinto de lo que se
 * enseñó, si alguien cambia el archivo entre un paso y otro.
 *
 * Aun así NO se confía en lo que llega: el precio se vuelve a acotar y las
 * filas con error se descartan aquí también. Esto es un endpoint público como
 * cualquier otro.
 */
export async function applyPriceImportAction(filas: unknown): Promise<ApplyResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  if (!Array.isArray(filas) || filas.length === 0) {
    return { ok: false, error: 'No hay nada que aplicar.' };
  }

  if (filas.length > 500) {
    return { ok: false, error: 'Demasiadas filas de una vez (máximo 500).' };
  }

  const validas = filas.filter(
    (f): f is FilaImportada =>
      typeof f === 'object' &&
      f !== null &&
      typeof (f as FilaImportada).code === 'string' &&
      /^[A-Z0-9_]{2,40}$/.test((f as FilaImportada).code) &&
      typeof (f as FilaImportada).name === 'string' &&
      (f as FilaImportada).name.length >= 3 &&
      Number.isInteger((f as FilaImportada).priceCents) &&
      (f as FilaImportada).priceCents >= 0 &&
      (f as FilaImportada).priceCents <= 100_000_00 &&
      // Lo que no cambia no se toca: escribir por escribir sólo genera ruido
      // en el historial de precios.
      ((f as FilaImportada).estado === 'NUEVO' || (f as FilaImportada).estado === 'ACTUALIZA'),
  );

  if (validas.length === 0) {
    return { ok: false, error: 'No hay filas válidas que aplicar.' };
  }

  try {
    const result = await repository.importTreatmentPrices({
      filas: validas.map((f) => ({
        code: f.code,
        name: f.name,
        category: f.category,
        basePriceCents: f.priceCents,
        durationMinutes: Math.min(Math.max(f.durationMinutes, 5), 480),
        bufferMinutes: Math.min(Math.max(f.bufferMinutes, 0), 120),
      })),
      userId: auth.userId,
    });

    revalidatePath('/tratamientos');
    // Las tarifas por odontologa parten del precio de lista: si no se
    // revalida, ahi seguiria viendose el anterior.
    revalidatePath('/tarifas');
    return { ok: true, creados: result.creados, actualizados: result.actualizados };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'price_import.apply_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudieron aplicar los cambios.' };
  }
}
