import type { NextRequest } from 'next/server';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';

/**
 * ===========================================================================
 *  GET /api/recetarios/:id/imagen/:assetId
 * ===========================================================================
 *  Sirve una imagen de un recetario: el recipe escaneado, un logo, una firma.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ NO ES UNA URL PÚBLICA
 *  ---------------------------------------------------------------------
 *  En esas imágenes va la FIRMA de una profesional. Servirlas sin sesión
 *  significaría que cualquiera con el enlace puede descargarse una firma
 *  médica y estamparla donde quiera. Por eso pasa por el mismo control que el
 *  resto del panel.
 *
 *  El id del recetario viaja en la ruta y se comprueba contra el que dice el
 *  asset: sin eso, `/recetarios/EL_MIO/imagen/EL_SUYO` serviría la firma de
 *  otra persona a través de un recetario propio.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const authorization = await checkApiRole('DENTIST');
  if (!authorization.authorized) {
    return new Response(null, { status: authorization.status === 401 ? 401 : 403 });
  }

  const { id, assetId } = await params;
  const asset = await repository.getPrescriptionAsset(assetId);
  if (!asset || asset.templateId !== id) {
    return new Response(null, { status: 404 });
  }

  /*
   * Una odontóloga sólo ve las imágenes de SUS recetarios. La misma regla que
   * en las acciones: aquí también, porque esta ruta se puede pedir sola.
   */
  if (authorization.user.role === 'DENTIST') {
    const plantilla = await repository.getPrescriptionTemplate(id);
    const perfil = await repository.findDentistByUserId(authorization.user.id);
    const esSuyo = plantilla?.dentistId && plantilla.dentistId === perfil?.id;
    if (!esSuyo) return new Response(null, { status: 403 });
  }

  return new Response(new Uint8Array(asset.content), {
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.content.byteLength),
      /*
       * Privada y con caché: el editor pide la misma imagen en cada repintado
       * mientras se arrastra un elemento. Sin caché, mover una caja dispararía
       * decenas de descargas de la misma hoja escaneada.
       */
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
