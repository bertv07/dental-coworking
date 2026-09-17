import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Notice } from '@/frontend/components/ui/primitives';
import { MedicationsManager } from '@/frontend/features/admin/MedicationsManager';

/**
 * ===========================================================================
 *  /medicamentos — el vademécum de la clínica
 * ===========================================================================
 *  ACCESO: asistente o superior. Recepción es quien atiende al paciente al
 *  salir de consulta y quien imprime la hoja.
 *
 *  Se ven TODOS, activos e inactivos: recepción tiene que poder reactivar uno
 *  retirado sin pedírselo a nadie. Los inactivos salen marcados.
 * ===========================================================================
 */

export const metadata = { title: 'Medicamentos' };
export const dynamic = 'force-dynamic';

export default async function MedicamentosPage() {
  await requireRole('ASSISTANT');

  const medications = await repository.listMedications();

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Medicamentos"
          subtitle="Marca lo indicado e imprime la hoja para el paciente"
        />
      </FadeIn>

      <FadeIn delay={0.06}>
        <Notice tone="info">
          Esta hoja <strong>no sustituye a la receta</strong>: la receta la firma la
          odontóloga en su recetario. Aquí sale lo indicado en limpio y legible, para
          que el paciente lo lleve a la farmacia.
        </Notice>
      </FadeIn>

      <FadeIn delay={0.1}>
        <MedicationsManager medications={medications} />
      </FadeIn>
    </div>
  );
}
