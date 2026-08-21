'use server';

import { revalidatePath } from 'next/cache';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { patientDocumentSchema } from '@/backend/validators/admin.schema';
import { cuidSchema } from '@/backend/validators/common';

/**
 * ===========================================================================
 *  Documentos escaneados del paciente
 * ===========================================================================
 *  Recepción imprime el formulario en blanco, el paciente lo rellena y lo
 *  firma, y aquí se sube el escaneo. No se transcribe nada: el original es el
 *  papel.
 *
 *  ACCESO: asistente o superior. El odontólogo NO sube ni consulta — los
 *  documentos son de toda la clínica y quien los custodia es recepción.
 * ===========================================================================
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
}

/**
 * Lo que se acepta de un escáner o de un teléfono.
 *
 * Lista blanca, no negra: enumerar lo prohibido deja fuera todo lo que aún no
 * se ha inventado, y la ficha de un paciente no es sitio para subir un
 * ejecutable.
 */
const TIPOS_PERMITIDOS = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** 20 MB. Un escaneo normal no se acerca; sin tope, uno enorme tumba la petición. */
const TAMANO_MAXIMO = 20 * 1024 * 1024;

export async function uploadPatientDocumentAction(
  formData: FormData,
): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para subir documentos.',
    };
  }

  const validation = patientDocumentSchema.safeParse({
    patientId: formData.get('patientId'),
    kind: formData.get('kind') ?? 'EXPEDIENTE',
    notes: formData.get('notes') ?? '',
  });

  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Elige un archivo.', field: 'file' };
  }

  /*
   * El tipo se comprueba en el SERVIDOR aunque el `<input accept>` ya filtre:
   * ese atributo es una comodidad del navegador, y esta acción es un endpoint
   * HTTP al que se puede llamar con curl.
   */
  if (!TIPOS_PERMITIDOS.has(file.type)) {
    return {
      ok: false,
      error: 'Sólo se aceptan PDF o imágenes (JPG, PNG, WEBP).',
      field: 'file',
    };
  }

  if (file.size > TAMANO_MAXIMO) {
    return {
      ok: false,
      error: `El archivo pesa ${Math.round(file.size / 1024 / 1024)} MB y el máximo son 20 MB.`,
      field: 'file',
    };
  }

  try {
    const content = new Uint8Array(await file.arrayBuffer());

    const result = await repository.savePatientDocument({
      patientId: validation.data.patientId,
      kind: validation.data.kind,
      // El nombre se recorta: viene del equipo de quien sube y podría traer
      // una ruta entera.
      fileName: file.name.slice(-120),
      mimeType: file.type,
      content,
      notes: validation.data.notes,
      userId: authorization.user.id,
    });

    if (!result.ok) {
      return { ok: false, error: 'No se pudo guardar el documento.' };
    }

    revalidatePath(`/pacientes/${validation.data.patientId}/expediente`);
    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'patient_document.upload_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo subir el documento. Intenta de nuevo.' };
  }
}

export async function deletePatientDocumentAction(id: string): Promise<ActionResult> {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return { ok: false, error: 'No tienes permiso para esto.' };
  }

  const parsedId = cuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Identificador inválido' };

  const result = await repository.deletePatientDocument({
    id: parsedId.data,
    userId: authorization.user.id,
  });

  if (!result.ok) return { ok: false, error: 'Ese documento ya no existe.' };

  // Sin el id del paciente a mano: se revalida la sección entera, que es
  // barata y evita tener que pasarlo sólo para esto.
  revalidatePath('/pacientes', 'layout');
  return { ok: true };
}
