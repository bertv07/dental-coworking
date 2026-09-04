import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { PlantillasManager } from '@/frontend/features/plantillas/PlantillasManager';

/**
 * /plantillas — respuestas rápidas de recepción.
 *
 * ACCESO: asistente o superior. Es quien escribe a los pacientes y quien mejor
 * sabe qué frase funciona; si tuviera que pedirle al administrador que le
 * corrija una plantilla, nadie la corregiría nunca.
 */

export const metadata = { title: 'Plantillas' };
export const dynamic = 'force-dynamic';

export default async function PlantillasPage() {
  await requireRole('ASSISTANT');

  // Se piden las inactivas también: desactivar una plantilla es guardarla para
  // más tarde, no perderla de vista.
  const plantillas = await repository.listMessageTemplates({ includeInactive: true });

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Plantillas de respuesta"
          subtitle={`${plantillas.length} mensajes listos para usar en el monitor de WhatsApp`}
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <PlantillasManager plantillas={plantillas} />
      </FadeIn>
    </div>
  );
}
