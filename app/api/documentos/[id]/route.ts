import type { NextRequest } from 'next/server';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema } from '@/backend/validators/common';

/**
 * ===========================================================================
 *  GET /api/documentos/{id} — sirve un escaneo del paciente
 * ===========================================================================
 *  Material clínico. Va por una ruta autenticada y NO por un archivo estático
 *  a propósito: un PDF en `/public` lo lee cualquiera que adivine la URL, sin
 *  sesión y sin dejar rastro.
 *
 *  Aquí cada descarga pasa por el guard de rol, igual que el resto del panel.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return new Response('No autorizado', { status: authorization.status });
  }

  const { id } = await params;
  const parsed = cuidSchema.safeParse(id);
  if (!parsed.success) return new Response('Identificador inválido', { status: 400 });

  const doc = await repository.getPatientDocumentFile(parsed.data);
  if (!doc) return new Response('No encontrado', { status: 404 });

  return new Response(new Uint8Array(doc.content), {
    headers: {
      'Content-Type': doc.mimeType,
      /*
       * `inline`: el PDF se abre en el visor del navegador, que es desde
       * donde recepción imprime. Con `attachment` habría que descargarlo y
       * abrirlo a mano cada vez.
       *
       * El nombre va entre comillas y sin caracteres de control: viene de un
       * archivo subido por alguien, y sin sanear permitiría inyectar
       * cabeceras.
       */
      'Content-Disposition': `inline; filename="${doc.fileName.replace(/["\r\n]/g, '')}"`,
      // Material clínico: que no se quede en cachés intermedias.
      'Cache-Control': 'private, no-store',
      // El navegador no debe adivinar el tipo: si el archivo miente, que no
      // se ejecute como otra cosa.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
