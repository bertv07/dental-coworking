import Link from 'next/link';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { formatCents } from '@/backend/domain/money';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Badge, Card, EmptyState } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  /facturas — lo emitido, con las pendientes arriba
 * ===========================================================================
 *  Las pendientes primero porque son las únicas que piden una acción: alguien
 *  debe todavía ese dinero. Las saldadas son consulta.
 * ===========================================================================
 */

export const metadata = { title: 'Facturas' };
export const dynamic = 'force-dynamic';

const ESTADO = {
  PAID: { label: 'Saldada', tone: 'success' as const },
  OPEN: { label: 'Pendiente', tone: 'warning' as const },
  VOID: { label: 'Anulada', tone: 'danger' as const },
};

export default async function InvoicesPage() {
  await requireRole('ASSISTANT');

  const invoices = await repository.listInvoices({ limit: 100 });
  const pendientes = invoices.filter((i) => i.status === 'OPEN');
  const porCobrar = pendientes.reduce((suma, i) => suma + i.balanceCents, 0);

  const fecha = new Intl.DateTimeFormat('es-VE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Caracas',
  });

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Facturas"
          subtitle={
            porCobrar > 0
              ? `${pendientes.length} pendientes · ${formatCents(porCobrar)} por cobrar`
              : `${invoices.length} emitidas · nada pendiente`
          }
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        {invoices.length === 0 ? (
          <Card>
            <EmptyState>
              Todavía no hay facturas.
              <br />
              Se emiten desde la agenda, al cobrar una cita.
            </EmptyState>
          </Card>
        ) : (
          <Card flush>
            <div className="table-wrap">
              <table className="table table--cards">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Paciente</th>
                    <th>Odontólogo</th>
                    <th>Fecha</th>
                    <th className="table__num">Total</th>
                    <th className="table__num">Falta</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="mono" data-label="Nº">
                        <Link href={`/facturas/${invoice.id}`}>{invoice.number}</Link>
                      </td>
                      <td data-label="Paciente">
                        <Link href={`/facturas/${invoice.id}`} className="table__strong">
                          {invoice.patientName}
                        </Link>
                      </td>
                      <td className="muted text-xs" data-label="Odontólogo">
                        {invoice.dentistName ?? '—'}
                      </td>
                      <td className="muted text-xs" data-label="Fecha">
                        {fecha.format(invoice.issuedAt)}
                      </td>
                      <td className="table__num mono" data-label="Total">
                        {formatCents(invoice.totalCents)}
                      </td>
                      <td className="table__num mono" data-label="Falta">
                        {invoice.balanceCents > 0 ? (
                          <strong style={{ color: 'var(--color-primary)' }}>
                            {formatCents(invoice.balanceCents)}
                          </strong>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>
                      <td data-label="Estado">
                        <Badge tone={ESTADO[invoice.status].tone}>
                          {ESTADO[invoice.status].label}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </FadeIn>
    </div>
  );
}
