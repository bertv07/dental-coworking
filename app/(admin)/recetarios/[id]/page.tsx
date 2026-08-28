import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { prescriptionElementsSchema } from '@/backend/domain/prescription';
import { PrescriptionEditor } from '@/frontend/features/prescriptions/PrescriptionEditor';

/**
 * ===========================================================================
 *  /recetarios/[id] — el editor
 * ===========================================================================
 *  Los elementos se validan AL LEERLOS, no sólo al guardarlos.
 *
 *  La columna es JSONB: puede contener lo que alguien haya metido ahí en una
 *  versión anterior del editor, o a mano. Si llegara al editor algo con la
 *  forma equivocada, la pantalla se caería entera y la odontóloga se quedaría
 *  sin poder recuperar su recetario. Validando aquí, lo que no encaja se
 *  descarta y el resto de la hoja sigue funcionando.
 * ===========================================================================
 */

export const dynamic = 'force-dynamic';

export default async function RecetarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole('DENTIST');
  const { id } = await params;

  const template = await repository.getPrescriptionTemplate(id);
  if (!template) notFound();

  /*
   * Una odontóloga sólo EDITA los suyos. Los de la clínica los ve y los
   * imprime, pero no los cambia: son de todos y nadie debería reordenárselos
   * a los demás sin avisar.
   */
  const perfil =
    user.role === 'DENTIST' ? await repository.findDentistByUserId(user.id) : null;

  if (user.role === 'DENTIST') {
    const esSuyo = template.dentistId && template.dentistId === perfil?.id;
    const esDeLaClinica = template.dentistId === null;
    if (!esSuyo && !esDeLaClinica) notFound();
  }

  const readOnly =
    user.role === 'DENTIST' && template.dentistId !== perfil?.id;

  const parsed = prescriptionElementsSchema.safeParse(template.elements);

  return (
    <div className="page-body">
      <Link href="/recetarios" className="text-sm subtle">
        ← Volver a recetarios
      </Link>

      <PrescriptionEditor
        template={{
          id: template.id,
          name: template.name,
          widthPx: template.widthPx,
          heightPx: template.heightPx,
          elements: parsed.success ? parsed.data : [],
          dentistName: template.dentistName,
        }}
        readOnly={readOnly}
      />
    </div>
  );
}
