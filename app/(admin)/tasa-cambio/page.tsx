import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { getAllRates, getRateHistory } from '@/backend/services/exchange-rate.service';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { ExchangeRatePanel } from '@/frontend/features/admin/ExchangeRatePanel';

/**
 * ===========================================================================
 *  /tasa-cambio — Control cambiario
 * ===========================================================================
 *  ACCESO: asistente o superior. Quien cobra en el mostrador necesita ver la
 *  tasa del día y poder refrescarla; no es información reservada.
 *
 *  POR QUÉ ESTA PANTALLA EXISTE:
 *  Los precios se guardan en USD (unidad estable) pero se cobran en
 *  bolívares. La tasa es, por tanto, un parámetro operativo diario: si está
 *  desactualizada, la clínica cobra de menos o de más en cada cita. Merece
 *  su propio lugar, no estar escondida en un ajuste.
 * ===========================================================================
 */

export const metadata = { title: 'Tasa de cambio' };
export const dynamic = 'force-dynamic';

export default async function ExchangeRatePage() {
  await requireRole('ASSISTANT');

  const [{ bcv, paralelo }, history, treatments] = await Promise.all([
    getAllRates(),
    getRateHistory('BCV', 20),
    repository.listTreatments(),
  ]);

  // Muestra de tratamientos para la tabla de equivalencias: los seis más
  // representativos, del más barato al más caro, para que se vea el rango.
  const samples = [...treatments]
    .sort((a, b) => a.basePriceCents - b.basePriceCents)
    .filter((_, index, all) => index % Math.max(1, Math.floor(all.length / 6)) === 0)
    .slice(0, 6)
    .map((treatment) => ({ name: treatment.name, usdCents: treatment.basePriceCents }));

  // Las fechas se serializan a ISO: `Date` no cruza limpio la frontera
  // servidor→cliente en las props de un Client Component.
  const serialize = (rate: Awaited<ReturnType<typeof getAllRates>>['bcv']) =>
    rate
      ? {
          source: rate.source,
          rate: rate.rate,
          publishedAt: rate.publishedAt.toISOString(),
          fetchedAt: rate.fetchedAt.toISOString(),
          isStale: rate.isStale,
        }
      : null;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Tasa de cambio"
          subtitle="Los precios se fijan en dólares y se cobran en bolívares a la tasa BCV"
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <ExchangeRatePanel
          bcv={serialize(bcv)}
          paralelo={serialize(paralelo)}
          history={history.map((row) => ({
            id: row.id,
            rate: row.rate,
            publishedAt: row.publishedAt.toISOString(),
            isCurrent: row.isCurrent,
          }))}
          samples={samples}
        />
      </FadeIn>
    </div>
  );
}
