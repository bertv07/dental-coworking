'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema, safeTextSchema } from '@/backend/validators/common';
import { parseDayKey } from '@/backend/domain/clinic-calendar';
import {
  huellaDeFila,
  leerLibroDentista,
  leerLibroGeneral,
  type FilaDentistaLeida,
  type FilaGeneralLeida,
} from '@/backend/services/ledger-import.service';

/**
 * ===========================================================================
 *  Cargar el libro de Administración desde Excel
 * ===========================================================================
 *  DOS PASOS, como la lista de precios: `previewLedgerImportAction` lee el
 *  archivo y enseña qué entraría; `applyLedgerImportAction` guarda lo que ya
 *  se vio. Entre uno y otro no se escribe nada.
 *
 *  EL DESTINO se elige al subir: Gastos Administrativos, Caja Chica o el
 *  libro de una odontóloga. Una hoja, un destino.
 *
 *  SUBIR LA MISMA HOJA DOS VECES NO DUPLICA. Lo normal es que la hoja del
 *  mes se suba varias veces según crece, así que cada fila se compara con lo
 *  que ya hay en ese libro (fecha + texto + importes) y las que ya están se
 *  marcan y se dejan fuera.
 *
 *  SÓLO Super Admin, igual que el resto de /administracion.
 * ===========================================================================
 */

export type EstadoImportada = 'NUEVA' | 'YA_ESTA' | 'ERROR';

export type FilaImportadaLibro = (FilaGeneralLeida | FilaDentistaLeida) & { estado: EstadoImportada };

export interface LedgerPreviewResult {
  ok: boolean;
  error?: string;
  /** 'gastos' | 'caja-chica' | 'dr-<id>' — el mismo id que la pestaña. */
  destino?: string;
  destinoLabel?: string;
  hojas?: string[];
  hoja?: string;
  filas?: FilaImportadaLibro[];
}

export interface LedgerApplyResult {
  ok: boolean;
  error?: string;
  creadas?: number;
  /** Las que llegaron pero ya estaban en el libro. */
  repetidas?: number;
}

const TAMANO_MAXIMO = 5 * 1024 * 1024;
const MAXIMO_FILAS = 1000;

type Destino =
  | { tipo: 'GENERAL'; id: string; book: 'GASTOS_ADMIN' | 'CAJA_CHICA'; label: string; pistas: string[] }
  | { tipo: 'DENTISTA'; id: string; dentistId: string; label: string; pistas: string[] };

async function autorizar() {
  const auth = await checkApiRole('SUPER_ADMIN');
  if (!auth.authorized) {
    return {
      ok: false as const,
      error: auth.status === 401 ? 'Tu sesión expiró. Vuelve a iniciar sesión.' : 'No tienes permiso para esto.',
    };
  }
  return { ok: true as const, userId: auth.user.id };
}

async function resolverDestino(valor: unknown): Promise<Destino | null> {
  if (valor === 'gastos') {
    return { tipo: 'GENERAL', id: 'gastos', book: 'GASTOS_ADMIN', label: 'Gastos Administrativos', pistas: ['general', 'gasto', 'admin'] };
  }
  if (valor === 'caja-chica') {
    return { tipo: 'GENERAL', id: 'caja-chica', book: 'CAJA_CHICA', label: 'Caja Chica', pistas: ['caja', 'chica'] };
  }
  if (typeof valor !== 'string' || !valor.startsWith('dr-')) return null;
  const dentistId = valor.slice('dr-'.length);
  if (!cuidSchema.safeParse(dentistId).success) return null;
  const dentist = (await repository.listDentists()).find((d) => d.id === dentistId);
  if (!dentist) return null;
  return {
    tipo: 'DENTISTA',
    id: valor,
    dentistId,
    label: dentist.fullName,
    // «Dra. Emilmar Palma Faneite» → la hoja suele llamarse «Palma».
    pistas: dentist.fullName.split(/\s+/).filter((p) => !/^(dra?|dr)\.?$/i.test(p)),
  };
}

const huellaGeneral = (f: { date: string; description: string; incomeCents: number; expenseCents: number }) =>
  huellaDeFila(f.date, f.description, f.incomeCents, f.expenseCents);

const huellaDentista = (f: { date: string; patientName: string; budgetCents: number }) =>
  huellaDeFila(f.date, f.patientName, f.budgetCents);

/**
 * Marca cuáles ya están en el libro.
 *
 * Se CUENTA, no se mira sólo si existe: dos botellones de agua el mismo día
 * por el mismo precio son dos filas de verdad. Si el libro tiene una y la
 * hoja trae dos, la segunda es nueva.
 */
function marcarRepetidas<F extends object>(
  filas: F[],
  huella: (f: F) => string,
  huellasExistentes: string[],
): Array<F & { estado: EstadoImportada }> {
  const disponibles = new Map<string, number>();
  for (const h of huellasExistentes) disponibles.set(h, (disponibles.get(h) ?? 0) + 1);

  return filas.map((f) => {
    if ('error' in f && f.error) return { ...f, estado: 'ERROR' };
    const h = huella(f);
    const quedan = disponibles.get(h) ?? 0;
    if (quedan > 0) {
      disponibles.set(h, quedan - 1);
      return { ...f, estado: 'YA_ESTA' };
    }
    return { ...f, estado: 'NUEVA' };
  });
}

/** Lee el archivo y dice qué entraría. NO toca la base. */
export async function previewLedgerImportAction(formData: FormData): Promise<LedgerPreviewResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const destino = await resolverDestino(formData.get('destino'));
  if (!destino) return { ok: false, error: 'Elige a dónde va: General, Caja Chica o una odontóloga.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Elige un archivo.' };
  if (file.size > TAMANO_MAXIMO) return { ok: false, error: 'El archivo no puede pasar de 5 MB.' };

  const nombre = file.name.toLowerCase();
  if (!nombre.endsWith('.xlsx') && !nombre.endsWith('.csv')) {
    return {
      ok: false,
      error: nombre.endsWith('.xls')
        ? 'Ese es el formato antiguo de Excel (.xls). Ábrelo y usa «Guardar como» → Libro de Excel (.xlsx).'
        : 'Sube un Excel (.xlsx) o un CSV.',
    };
  }

  const hojaPedida = formData.get('hoja');
  const opciones = {
    hoja: typeof hojaPedida === 'string' && hojaPedida ? hojaPedida : null,
    pistas: destino.pistas,
  };

  try {
    const contenido = await file.arrayBuffer();
    const comun = { destino: destino.id, destinoLabel: destino.label };

    if (destino.tipo === 'GENERAL') {
      const leido = await leerLibroGeneral(contenido, file.name, opciones);
      if (leido.error) return { ok: false, error: leido.error, ...comun, hojas: leido.hojas, hoja: leido.hoja };
      const existentes = await repository.listAdminLedgerEntries({ book: destino.book });
      return {
        ok: true,
        ...comun,
        hojas: leido.hojas,
        hoja: leido.hoja,
        filas: marcarRepetidas(leido.filas, huellaGeneral, existentes.map(huellaGeneral)),
      };
    }

    const leido = await leerLibroDentista(contenido, file.name, opciones);
    if (leido.error) return { ok: false, error: leido.error, ...comun, hojas: leido.hojas, hoja: leido.hoja };
    const existentes = await repository.listDentistLedgerEntries({ dentistId: destino.dentistId });
    return {
      ok: true,
      ...comun,
      hojas: leido.hojas,
      hoja: leido.hoja,
      filas: marcarRepetidas(leido.filas, huellaDentista, existentes.map(huellaDentista)),
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'ledger_import.preview_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo leer el archivo. Intenta de nuevo.' };
  }
}

const fecha = z.string().refine((v) => parseDayKey(v) !== null);
const centavos = z.number().int().min(0).max(1_000_000_00);
const nota = z.union([safeTextSchema(300), z.null()]).transform((v) => (v ? v : null));

const filaGeneralSchema = z
  .object({
    date: fecha,
    description: safeTextSchema(200).pipe(z.string().min(2)),
    incomeCents: centavos,
    expenseCents: centavos,
    notes: nota,
  })
  // Ingreso O egreso, nunca los dos ni ninguno: la misma regla que a mano.
  .refine((f) => (f.incomeCents > 0) !== (f.expenseCents > 0));

const filaDentistaSchema = z
  .object({
    date: fecha,
    patientName: safeTextSchema(120).pipe(z.string().min(2)),
    budgetCents: centavos,
    depositCents: centavos,
    dentistPercent: z.number().int().min(0).max(100),
    dentistShareCents: centavos,
    notes: nota,
  })
  .refine((f) => f.dentistShareCents <= f.budgetCents);

/**
 * Guarda las filas ya revisadas.
 *
 * Recibe las filas de la vista previa, no el archivo otra vez, para que lo
 * que se guarda sea exactamente lo que se enseñó. Pero NO se confía en ellas:
 * se vuelven a validar una a una y se vuelven a comparar con el libro, así un
 * doble clic —o la misma hoja abierta en dos pestañas— no la carga dos veces.
 */
export async function applyLedgerImportAction(destinoId: unknown, filas: unknown): Promise<LedgerApplyResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const destino = await resolverDestino(destinoId);
  if (!destino) return { ok: false, error: 'Ese destino ya no existe. Vuelve a revisar el archivo.' };

  if (!Array.isArray(filas) || filas.length === 0) return { ok: false, error: 'No hay nada que guardar.' };
  if (filas.length > MAXIMO_FILAS) {
    return { ok: false, error: `Demasiadas filas de una vez (máximo ${MAXIMO_FILAS}). Sube la hoja por meses.` };
  }

  let resultado;
  let recibidas: number;

  if (destino.tipo === 'GENERAL') {
    const validas = filas.flatMap((f) => {
      const v = filaGeneralSchema.safeParse(f);
      return v.success ? [v.data] : [];
    });
    recibidas = validas.length;
    const existentes = await repository.listAdminLedgerEntries({ book: destino.book });
    const nuevas = marcarRepetidas(validas, huellaGeneral, existentes.map(huellaGeneral)).filter(
      (f) => f.estado === 'NUEVA',
    );
    if (nuevas.length === 0) {
      return recibidas > 0
        ? { ok: true, creadas: 0, repetidas: recibidas }
        : { ok: false, error: 'No hay filas válidas que guardar.' };
    }
    resultado = await repository.importAdminLedgerEntries({
      userId: auth.userId,
      filas: nuevas.map((f) => ({
        book: destino.book,
        date: f.date,
        description: f.description,
        incomeCents: f.incomeCents,
        expenseCents: f.expenseCents,
        notes: f.notes,
      })),
    });
  } else {
    const validas = filas.flatMap((f) => {
      const v = filaDentistaSchema.safeParse(f);
      return v.success ? [v.data] : [];
    });
    recibidas = validas.length;
    const existentes = await repository.listDentistLedgerEntries({ dentistId: destino.dentistId });
    const nuevas = marcarRepetidas(validas, huellaDentista, existentes.map(huellaDentista)).filter(
      (f) => f.estado === 'NUEVA',
    );
    if (nuevas.length === 0) {
      return recibidas > 0
        ? { ok: true, creadas: 0, repetidas: recibidas }
        : { ok: false, error: 'No hay filas válidas que guardar.' };
    }
    resultado = await repository.importDentistLedgerEntries({
      userId: auth.userId,
      filas: nuevas.map((f) => ({
        dentistId: destino.dentistId,
        date: f.date,
        patientName: f.patientName,
        budgetCents: f.budgetCents,
        depositCents: f.depositCents,
        dentistPercent: f.dentistPercent,
        dentistShareCents: f.dentistShareCents,
        // Se recalcula aquí: la parte de la clínica es lo que no se queda ella.
        clinicShareCents: f.budgetCents - f.dentistShareCents,
        notes: f.notes,
      })),
    });
  }

  if (!resultado.ok) return { ok: false, error: 'No se pudieron guardar las filas. No se guardó ninguna.' };

  revalidatePath('/administracion');
  // El dashboard resume este mismo libro.
  revalidatePath('/dashboard');
  // Y los egresos del libro cuentan en Gastos.
  revalidatePath('/gastos');
  return { ok: true, creadas: resultado.data.creadas, repetidas: recibidas - resultado.data.creadas };
}
