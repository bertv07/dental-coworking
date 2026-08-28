import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { getCurrentRate, resolveRateSource } from '@/backend/services/exchange-rate.service';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { InvoiceEditor } from '@/frontend/features/admin/InvoiceEditor';

/**
 * ===========================================================================
 *  /facturas/{id} — la factura de recepción
 * ===========================================================================
 *  ACCESO: asistente o superior. El odontólogo no factura ni cobra: su parte
 *  se la liquida la clínica y en su panel no viaja ningún importe.
 * ===========================================================================
 */

export const metadata = { title: 'Factura' };
export const dynamic = 'force-dynamic';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('ASSISTANT');

  const { id } = await params;
  const invoice = await repository.getInvoice(id);
  if (!invoice) notFound();

  const [treatments, paymentMethods, settings] = await Promise.all([
    repository.listTreatments(),
    repository.listPaymentMethods(),
    repository.getClinicSettings(),
  ]);

  const rateSource = resolveRateSource(settings.preferredRateSource);
  const rate = await getCurrentRate(rateSource);

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title={`Factura Nº ${invoice.number}`}
          subtitle={new Intl.DateTimeFormat('es-VE', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'America/Caracas',
          }).format(invoice.issuedAt)}
          actions={
            <Link href={`/imprimir/factura/${invoice.id}`} className="btn btn--ghost" target="_blank">
              Imprimir
            </Link>
          }
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <InvoiceEditor
          invoice={invoice}
          treatments={treatments}
          paymentMethods={paymentMethods}
          exchangeRate={rate?.rate ?? null}
          rateSource={rateSource}
        />
      </FadeIn>

      <FadeIn delay={0.12}>
        <p className="text-sm">
          <Link href="/facturas">Volver a facturas</Link>
        </p>
      </FadeIn>
    </div>
  );
}
