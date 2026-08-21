import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { env } from '@/backend/config/env';
import { formatCents } from '@/backend/domain/money';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { Stat } from '@/frontend/components/ui/primitives';
import { TreatmentsManager } from '@/frontend/features/admin/TreatmentsManager';
import { FadeIn, Stagger, StaggerItem, HoverCard } from '@/frontend/components/motion';

/**
 * ===========================================================================
 *  /tratamientos — Configuración de precios
 * ===========================================================================
 *  ACCESO: asistente o superior.
 *
 *  Recepción también los edita: es quien cotiza por teléfono y quien factura,
 *  así que cuando un precio cambia es la primera en enterarse. Obligarla a
 *  pedirle al administrador que lo toque significaba cobrar con la lista
 *  vieja hasta que alguien se acordara.
 *
 *  Lo que sigue siendo del administrador es la COMISIÓN, que se define en
 *  `/odontologos`: cuánto cuesta un tratamiento y cómo se reparte son dos
 *  decisiones distintas.
 *
 *  Cada cambio de precio queda registrado en `TreatmentPriceHistory` y en
 *  `audit_logs` (ver `prismaRepository.updateTreatment`). Poder responder
 *  "¿cuánto costaba la limpieza en marzo y quién lo cambió?" es un requisito
 *  contable, no un extra.
 *
 *  Las citas YA agendadas conservan su `agreedPriceCents`: subir una tarifa
 *  hoy no reescribe lo que se le prometió ayer a un paciente.
 * ===========================================================================
 */

export const metadata = { title: 'Precios' };
export const dynamic = 'force-dynamic';

export default async function TreatmentsPage() {
  await requireRole('ASSISTANT');

  const treatments = await repository.listTreatments({ includeInactive: true });
  const active = treatments.filter((treatment) => treatment.isActive);

  // Se calcula sobre los ACTIVOS: incluir tratamientos retirados distorsiona
  // el precio medio que el admin usa como referencia.
  const averagePriceCents =
    active.length > 0
      ? Math.round(active.reduce((sum, t) => sum + t.basePriceCents, 0) / active.length)
      : 0;

  const mostExpensive = active.reduce<(typeof active)[number] | null>(
    (top, treatment) => (!top || treatment.basePriceCents > top.basePriceCents ? treatment : top),
    null,
  );

  const categories = new Set(active.map((treatment) => treatment.category));

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Configuración de precios"
          subtitle="Tarifas, duración y códigos del catálogo de tratamientos"
        />
      </FadeIn>

      <Stagger className="stat-grid">
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Tratamientos activos"
              value={String(active.length)}
              meta={`en ${categories.size} categorías`}
              featured
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Precio promedio"
              value={formatCents(averagePriceCents)}
              meta="sobre tratamientos activos"
              compact
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Tarifa más alta"
              value={formatCents(mostExpensive?.basePriceCents ?? 0)}
              meta={mostExpensive?.name ?? '—'}
              compact
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Comisión estándar"
              value={`${env.DEFAULT_CLINIC_COMMISSION_PERCENT}%`}
              meta={`clínica / ${100 - env.DEFAULT_CLINIC_COMMISSION_PERCENT}% odontólogo`}
            />
          </HoverCard>
        </StaggerItem>
      </Stagger>

      <FadeIn delay={0.12}>
        <TreatmentsManager
          treatments={treatments}
          defaultCommissionPercent={env.DEFAULT_CLINIC_COMMISSION_PERCENT}
        />
      </FadeIn>
    </div>
  );
}
