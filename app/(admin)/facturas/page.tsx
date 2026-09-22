import Link from 'next/link';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { formatCents } from '@/backend/domain/money';
import { clinicDayKey } from '@/backend/domain/clinic-calendar';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Badge, Card, EmptyState } from '@/frontend/components/ui/primitives';
import { RegisterBackdatedSale } from '@/frontend/features/admin/RegisterBackdatedSale';

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

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; todas?: string }>;
}) {
  await requireRole('ASSISTANT');

  const { q, todas } = await searchParams;
  const busqueda = (q ?? '').trim().toLowerCase();
  /*
   * Por defecto las últimas 100: es lo que cabe en una pantalla y lo que se
   * consulta a diario. «Ver todas» quita el techo para buscar una factura
   * vieja de un paciente concreto, que es la otra pregunta que se hace aquí.
   */
  const verTodas = todas === '1';

  const [emitidas, dentists] = await Promise.all([
    repository.listInvoices({ limit: verTodas ? 10_000 : 100 }),
    repository.listDentists(),
  ]);

  // El filtro va sobre lo traído: son cien filas, o todas si se pidió, y el
  // nombre del paciente ya viene en cada una. No hace falta otra consulta.
  const invoices = busqueda
    ? emitidas.filter((i) => i.patientName.toLowerCase().includes(busqueda))
    : emitidas;
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
            busqueda
              ? `${invoices.length} de ${emitidas.length} coinciden con «${q}»`
              : porCobrar > 0
                ? `${pendientes.length} pendientes · ${formatCents(porCobrar)} por cobrar${verTodas ? ` · ${emitidas.length} en total` : ''}`
                : `${invoices.length} emitidas · nada pendiente`
          }
          actions={
            <RegisterBackdatedSale
              dentists={dentists.map((d) => ({ id: d.id, fullName: d.fullName }))}
              todayKey={clinicDayKey(new Date())}
            />
          }
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        {/*
          Buscar por paciente y ver todas. Formulario GET a propósito: la
          búsqueda queda en la URL, se puede recargar y compartir, y no hace
          falta JavaScript para que funcione.
        */}
        <Card>
          <form method="get" className="row row--wrap" style={{ gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="search"
              name="q"
              className="input"
              placeholder="Buscar facturas por paciente…"
              defaultValue={q ?? ''}
              style={{ flex: '1 1 240px' }}
              aria-label="Buscar facturas por paciente"
            />
            {verTodas && <input type="hidden" name="todas" value="1" />}
            <button type="submit" className="btn btn--primary">
              Buscar
            </button>
            {busqueda && (
              <Link href={verTodas ? '/facturas?todas=1' : '/facturas'} className="btn btn--ghost">
                Limpiar
              </Link>
            )}
            <Link
              href={
                verTodas
                  ? `/facturas${q ? `?q=${encodeURIComponent(q)}` : ''}`
                  : `/facturas?todas=1${q ? `&q=${encodeURIComponent(q)}` : ''}`
              }
              className="btn btn--ghost"
            >
              {verTodas ? 'Ver sólo las últimas 100' : 'Ver todas'}
            </Link>
          </form>
        </Card>
      </FadeIn>

      <FadeIn delay={0.08}>
        {invoices.length === 0 ? (
          <Card>
            <EmptyState>
              {busqueda
                ? `Ninguna factura de «${q}»${verTodas ? '' : ' entre las últimas 100. Prueba «Ver todas».'}`
                : 'Todavía no hay facturas.'}
              <br />
              Se emiten desde la agenda al cobrar una cita, o con «Registrar venta atrasada» si
              se te olvidó un día.
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
