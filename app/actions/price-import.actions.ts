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
  /**
   * Los que están activos en el sistema y NO aparecen en el archivo.
   *
   * Se enseñan con nombre, no como un número: «se desactivan 11» no permite
   * decidir nada, y entre esos 11 puede estar algo que la clínica sí hace y
   * que simplemente no cabía en la hoja.
   */
  sobran?: Array<{ code: string; name: string }>;
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  creados?: number;
  actualizados?: number;
  desactivados?: number;
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
      (t) => ({
        code: t.code,
        basePriceCents: t.basePriceCents,
        name: t.name,
        category: t.category,
        description: t.description,
        durationMinutes: t.durationMinutes,
        bufferMinutes: t.bufferMinutes,
      }),
    );

    const { filas, error } = await leerArchivoDePrecios(
      await file.arrayBuffer(),
      file.name,
      existentes,
    );

    if (error) return { ok: false, error };

    // Los que están activos y no vienen en el archivo. Sólo se informan: no
    // se toca nada hasta que alguien lo pida expresamente al aplicar.
    const enElArchivo = new Set(filas.filter((f) => f.estado !== 'ERROR').map((f) => f.code));
    const activos = await repository.listTreatments();
    const sobran = activos
      .filter((t) => !enElArchivo.has(t.code))
      .map((t) => ({ code: t.code, name: t.name }));

    return {
      ok: true,
      filas,
      sobran,
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
export async function applyPriceImportAction(
  filas: unknown,
  opciones?: {
    /**
     * Desactivar los tratamientos que no vengan en el archivo.
     *
     * OPCIONAL Y APAGADO POR DEFECTO. Una lista de precios incompleta es lo
     * más normal del mundo —se sube sólo la parte que cambió— y dar por hecho
     * que lo que falta ya no se hace vaciaría el catálogo de un golpe.
     *
     * Desactiva, nunca borra: las citas y facturas que cuelgan de esos
     * tratamientos siguen intactas y se pueden reactivar con un clic.
     */
    desactivarSobrantes?: boolean;
    /**
     * TODOS los códigos válidos del archivo, incluidos los que no cambian.
     *
     * Hace falta aparte porque `filas` sólo trae los que se van a escribir:
     * si se dedujera de ahí, los tratamientos que el archivo deja IGUAL se
     * verían como ausentes y se desactivarían. Justo al revés de lo que pide
     * quien sube su lista completa sin tocar la mitad de los precios.
     */
    codigosDelArchivo?: unknown;
  },
): Promise<ApplyResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  /*
   * Puede no haber NADA que escribir y aun así haber trabajo: es el caso de
   * quien sube su lista definitiva, que ya coincide con los precios, sólo
   * para apagar lo que sobra. Rechazarlo por «lista vacía» dejaba el botón
   * muerto justo en ese caso.
   */
  if (!Array.isArray(filas)) {
    return { ok: false, error: 'No hay nada que aplicar.' };
  }
  if (filas.length === 0 && !opciones?.desactivarSobrantes) {
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

  if (validas.length === 0 && !opciones?.desactivarSobrantes) {
    return { ok: false, error: 'No hay filas válidas que aplicar.' };
  }

  /*
   * Se recalcula aquí qué sobra, con los códigos del archivo. No se acepta
   * una lista de «códigos a desactivar» del cliente: eso permitiría desactivar
   * el catálogo entero con una petición hecha a mano.
   */
  let desactivarCodigos: string[] = [];
  if (opciones?.desactivarSobrantes) {
    const codigos = Array.isArray(opciones.codigosDelArchivo)
      ? opciones.codigosDelArchivo.filter(
          (c): c is string => typeof c === 'string' && /^[A-Z0-9_]{2,40}$/.test(c),
        )
      : [];

    if (codigos.length === 0) {
      return { ok: false, error: 'No se pudo determinar qué contiene el archivo.' };
    }


    const enElArchivo = new Set(codigos);
    desactivarCodigos = (await repository.listTreatments())
      .filter((t) => !enElArchivo.has(t.code))
      .map((t) => t.code);
  }

  try {
    const result = await repository.importTreatmentPrices({
      desactivarCodigos,
      filas: validas.map((f) => ({
        code: f.code,
        name: f.name,
        category: f.category,
        // Se recorta aquí: es texto libre que llega de un archivo.
        description: f.description ? f.description.slice(0, 500) : null,
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
    return {
      ok: true,
      creados: result.creados,
      actualizados: result.actualizados,
      desactivados: result.desactivados,
    };
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
