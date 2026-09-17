import type { NextRequest } from 'next/server';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';

/**
 * ===========================================================================
 *  GET /api/medicamentos/{id}/imagen — la foto de la caja
 * ===========================================================================
 *  Se sirve por su propia ruta y no incrustada en la lista: son cientos de KB
 *  por medicamento, y la pantalla trae el vademécum entero. Mandarlas todas
 *  juntas haría que abrir «Medicamentos» descargara varios megas para pintar
 *  unas miniaturas.
 *
 *  Detrás de la sesión, como el resto: no es información sensible de nadie,
 *  pero tampoco hay motivo para que sea pública.
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
    return new Response(null, { status: authorization.status === 401 ? 401 : 403 });
  }

  const { id } = await params;
  const imagen = await repository.getMedicationImage(id);
  if (!imagen) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(imagen.content), {
    headers: {
      'Content-Type': imagen.mimeType,
      /*
       * Se cachea en el navegador: la foto de una caja no cambia, y sin esto
       * la hoja de impresión volvería a pedirlas todas al imprimir.
       */
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
