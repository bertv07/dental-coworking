import { notFound } from 'next/navigation';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PrintOnLoad } from '@/frontend/features/admin/PrintOnLoad';

/**
 * ===========================================================================
 *  /imprimir/recetario/[id] — la hoja sola, lista para el papel
 * ===========================================================================
 *  Fuera del grupo (admin) a propósito: aquí NO va el menú lateral ni la
 *  barra superior. Una hoja de impresión con el menú del panel encima sale
 *  impresa con el menú del panel encima.
 *
 *  Lo que se imprime es la IMAGEN que subió la odontóloga, sin nada colocado
 *  encima. Antes esta página repintaba los elementos del editor con los
 *  mismos estilos en línea; al quitarse el editor, no hay nada que repintar
 *  y tampoco hay dos sitios que puedan acabar dibujando distinto.
 * ===========================================================================
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Imprimir recetario' };

export default async function ImprimirRecetarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole('DENTIST');
  const { id } = await params;

  const template = await repository.getPrescriptionTemplate(id);
  if (!template) notFound();

  // El mismo filtro que en el panel: los de otra odontóloga no se imprimen.
  if (user.role === 'DENTIST') {
    const perfil = await repository.findDentistByUserId(user.id);
    const esSuyo = template.dentistId && template.dentistId === perfil?.id;
    const esDeLaClinica = template.dentistId === null;
    if (!esSuyo && !esDeLaClinica) notFound();
  }

  // Sin imagen no hay nada que imprimir: se trata como inexistente en vez de
  // abrir el diálogo de impresión sobre una hoja en blanco.
  if (template.imageAssetId === null) notFound();

  return (
    <main className="print-recipe">
      <PrintOnLoad />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="print-recipe__sheet"
        src={`/api/recetarios/${template.id}/imagen/${template.imageAssetId}`}
        alt={template.name}
      />
    </main>
  );
}
