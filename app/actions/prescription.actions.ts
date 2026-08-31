'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { prescriptionElementsSchema } from '@/backend/domain/prescription';

/**
 * ===========================================================================
 *  Recetarios
 * ===========================================================================
 *  Cada odontóloga sube SU recipe y lo edita dentro del panel.
 *
 *  ---------------------------------------------------------------------
 *  QUIÉN PUEDE TOCAR QUÉ
 *  ---------------------------------------------------------------------
 *  · La asistente y el admin: cualquiera. Recepción también monta recetarios,
 *    porque a menudo es quien tiene el escáner y el rato para hacerlo.
 *  · Una odontóloga: SÓLO los suyos. El membrete, el número de colegio y la
 *    firma de una compañera no son cosa suya — y esto se comprueba en el
 *    servidor, no escondiendo botones.
 *
 *  Esa comprobación vive en `puedeTocar()` y la repiten TODAS las acciones
 *  que escriben. Ponerla sólo al abrir el editor no serviría: cada acción es
 *  un endpoint HTTP que se puede llamar por su cuenta.
 * ===========================================================================
 */

export interface PrescriptionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** 8 MB: un recipe escaneado son kilobytes; ocho megas ya es una foto enorme. */
const TAMANO_MAXIMO = 8 * 1024 * 1024;

const TIPOS_ACEPTADOS = ['image/png', 'image/jpeg', 'image/webp'];

async function autorizar() {
  const authorization = await checkApiRole('DENTIST');
  if (!authorization.authorized) {
    return {
      ok: false as const,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para esto.',
    };
  }

  /*
   * Qué odontóloga es, si lo es.
   *
   * La sesión sólo trae la cuenta; la ficha de odontólogo es otra tabla. Se
   * consulta aquí y no se confía en nada que venga del formulario: es lo que
   * decide de qué recetarios es dueña.
   */
  const perfil =
    authorization.user.role === 'DENTIST'
      ? await repository.findDentistByUserId(authorization.user.id)
      : null;

  return {
    ok: true as const,
    userId: authorization.user.id,
    role: authorization.user.role,
    dentistId: perfil?.id ?? null,
  };
}

/**
 * ¿Puede esta persona editar este recetario?
 *
 * Devuelve el mensaje de error, o `null` si sí puede. Se le pasa el recetario
 * ya leído para no consultarlo dos veces.
 */
function puedeTocar(
  quien: { role: string; dentistId: string | null },
  plantilla: { dentistId: string | null },
): string | null {
  if (quien.role !== 'DENTIST') return null;
  if (plantilla.dentistId && plantilla.dentistId === quien.dentistId) return null;
  return 'Ese recetario no es tuyo.';
}

// ---------------------------------------------------------------------------
//  Crear
// ---------------------------------------------------------------------------

const crearSchema = z.object({
  name: z.string().trim().min(2, 'Ponle un nombre').max(80),
  widthPx: z.coerce.number().int().min(100).max(5000),
  heightPx: z.coerce.number().int().min(100).max(5000),
  /** A quién pertenece. Vacío = de la clínica. */
  dentistId: z.string().trim().max(40).optional(),
});

export async function createPrescriptionTemplateAction(
  formData: FormData,
): Promise<PrescriptionResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = crearSchema.safeParse({
    name: formData.get('name'),
    widthPx: formData.get('widthPx'),
    heightPx: formData.get('heightPx'),
    dentistId: formData.get('dentistId') ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  /*
   * Una odontóloga sólo puede crear recetarios SUYOS. Aunque el formulario no
   * enseñe el selector de dueño, la acción es un endpoint como cualquier otro
   * y podría llegarle el id de una compañera.
   */
  const dentistId =
    auth.role === 'DENTIST' ? auth.dentistId : parsed.data.dentistId || null;

  if (auth.role === 'DENTIST' && !dentistId) {
    return { ok: false, error: 'Tu cuenta no está enlazada a una ficha de odontólogo.' };
  }

  const result = await repository.createPrescriptionTemplate({
    dentistId,
    name: parsed.data.name,
    widthPx: parsed.data.widthPx,
    heightPx: parsed.data.heightPx,
    userId: auth.userId,
  });

  if (!result.ok) return { ok: false, error: 'No se pudo crear el recetario.' };

  revalidatePath('/recetarios');
  return { ok: true, id: result.data.id };
}

// ---------------------------------------------------------------------------
//  Guardar el diseño
// ---------------------------------------------------------------------------

const guardarSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(2).max(80),
  widthPx: z.number().int().min(100).max(5000),
  heightPx: z.number().int().min(100).max(5000),
  elements: prescriptionElementsSchema,
});

export async function savePrescriptionTemplateAction(
  input: unknown,
): Promise<PrescriptionResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = guardarSchema.safeParse(input);
  if (!parsed.success) {
    const problema = parsed.error.issues[0];
    return {
      ok: false,
      error: `No se pudo guardar: ${problema?.path.join('.')} — ${problema?.message}`,
    };
  }

  const actual = await repository.getPrescriptionTemplate(parsed.data.id);
  if (!actual) return { ok: false, error: 'Ese recetario ya no existe.' };

  const veto = puedeTocar(auth, actual);
  if (veto) return { ok: false, error: veto };

  const result = await repository.savePrescriptionTemplate({
    id: parsed.data.id,
    name: parsed.data.name,
    widthPx: parsed.data.widthPx,
    heightPx: parsed.data.heightPx,
    elements: parsed.data.elements,
    userId: auth.userId,
  });

  if (!result.ok) return { ok: false, error: 'No se pudo guardar el recetario.' };

  revalidatePath('/recetarios');
  revalidatePath(`/recetarios/${parsed.data.id}`);
  return { ok: true, id: parsed.data.id };
}

// ---------------------------------------------------------------------------
//  Subir una imagen (el recipe escaneado, un logo, una firma)
// ---------------------------------------------------------------------------

export interface UploadAssetResult {
  ok: boolean;
  error?: string;
  assetId?: string;
  widthPx?: number;
  heightPx?: number;
}

export async function uploadPrescriptionAssetAction(
  formData: FormData,
): Promise<UploadAssetResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const templateId = String(formData.get('templateId') ?? '');
  const file = formData.get('file');
  /*
   * El tamaño real de la imagen lo mide el navegador antes de subirla.
   *
   * Se hace así para no meter un decodificador de imágenes en el servidor
   * sólo para leer dos números. Si vinieran manipulados, lo único que pasa es
   * que la imagen se ve estirada en el editor y quien la subió la ajusta con
   * el ratón — no hay nada que romper con eso.
   */
  const naturalWidth = Number(formData.get('naturalWidth'));
  const naturalHeight = Number(formData.get('naturalHeight'));

  if (!templateId) return { ok: false, error: 'Falta el recetario.' };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Elige una imagen.' };
  }
  if (file.size > TAMANO_MAXIMO) {
    return { ok: false, error: 'La imagen no puede pasar de 8 MB.' };
  }
  if (!TIPOS_ACEPTADOS.includes(file.type)) {
    /*
     * Aquí sólo entran imágenes aunque la pantalla acepte PDF: el PDF se
     * convierte a PNG en el navegador antes de subirlo. El servidor no
     * necesita un lector de PDF y lo que se guarda es siempre pintable.
     */
    return { ok: false, error: 'Sube una imagen PNG, JPG o WEBP, o un PDF.' };
  }

  const plantilla = await repository.getPrescriptionTemplate(templateId);
  if (!plantilla) return { ok: false, error: 'Ese recetario ya no existe.' };

  const veto = puedeTocar(auth, plantilla);
  if (veto) return { ok: false, error: veto };

  const result = await repository.addPrescriptionAsset({
    templateId,
    fileName: file.name.slice(0, 120),
    mimeType: file.type,
    widthPx: Number.isFinite(naturalWidth) ? Math.round(naturalWidth) : 0,
    heightPx: Number.isFinite(naturalHeight) ? Math.round(naturalHeight) : 0,
    content: Buffer.from(await file.arrayBuffer()),
    userId: auth.userId,
  });

  if (!result.ok) return { ok: false, error: 'No se pudo subir la imagen.' };

  return {
    ok: true,
    assetId: result.data.id,
    widthPx: result.data.widthPx,
    heightPx: result.data.heightPx,
  };
}

// ---------------------------------------------------------------------------
//  Borrar
// ---------------------------------------------------------------------------

export async function deletePrescriptionTemplateAction(
  id: unknown,
): Promise<PrescriptionResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = z.string().min(1).max(40).safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };

  const actual = await repository.getPrescriptionTemplate(parsed.data);
  if (!actual) return { ok: false, error: 'Ese recetario ya no existe.' };

  const veto = puedeTocar(auth, actual);
  if (veto) return { ok: false, error: veto };

  const result = await repository.deletePrescriptionTemplate({
    id: parsed.data,
    userId: auth.userId,
  });
  if (!result.ok) return { ok: false, error: 'No se pudo borrar el recetario.' };

  revalidatePath('/recetarios');
  return { ok: true };
}
