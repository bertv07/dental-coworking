import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { PromotionsManager } from '@/frontend/features/admin/PromotionsManager';

/**
 * ===========================================================================
 *  /descuentos — promociones de la clínica
 * ===========================================================================
 *  ACCESO: asistente o superior. Recepción es quien negocia en el mostrador y
 *  quien sabe qué se está ofreciendo esta semana.
 *
 *  El bot lee estas mismas promociones por `/api/automation/promotions`, así
 *  que lo que se escriba aquí es literalmente lo que ofrecerá por WhatsApp.
 * ===========================================================================
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Descuentos' };

export default async function DescuentosPage() {
  await requireRole('ASSISTANT');

  const [promotions, treatments] = await Promise.all([
    repository.listPromotions(),
    repository.listTreatments(),
  ]);

  const vigentes = promotions.filter((p) => p.isActive).length;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Descuentos y promociones"
          subtitle={`${vigentes} activas · el bot las ofrece por WhatsApp · se aplican desde cada factura`}
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <PromotionsManager
          promotions={promotions}
          treatments={treatments.map((t) => ({ code: t.code, name: t.name }))}
        />
      </FadeIn>
    </div>
  );
}
