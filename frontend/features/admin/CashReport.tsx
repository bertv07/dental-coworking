import { formatCents, formatBs } from '@/backend/domain/money';
import type { CashReport as CashReportData } from '@/backend/repositories/types';
import { Card, Stat, Badge, EmptyState } from '@/frontend/components/ui/primitives';
import { FadeIn, Stagger, StaggerItem, HoverCard } from '@/frontend/components/motion';

/**
 * ===========================================================================
 *  Informe de Caja para un periodo: totales, desgloses y todos los cobros
 * ===========================================================================
 *  Los desgloses son barras de UNA sola tinta: aquí la pregunta es «cuánto»,
 *  no «cuál es cuál» —el nombre ya está escrito al lado—, así que no hay
 *  leyenda ni un color por categoría. Los números van en tinta de texto,
 *  nunca en el color de la barra, y cada barra lleva su valor directo.
 * ===========================================================================
 */

export const METHOD_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  INSURANCE: 'Seguro',
  CREDIT: 'Bonificación',
};

function Barras({
  filas,
  total,
}: {
  filas: Array<{ id: string; label: string; cents: number; detalle: string }>;
  total: number;
}) {
  if (filas.length === 0) return <EmptyState>Sin movimientos en este periodo.</EmptyState>;
  const max = Math.max(...filas.map((f) => f.cents), 1);
  return (
    <div className="barras" role="list">
      {filas.map((f) => {
        const pct = total > 0 ? Math.round((f.cents / total) * 100) : 0;
        return (
          <div key={f.id} className="barra" role="listitem" title={`${f.label}: ${formatCents(f.cents)} (${pct}%)`}>
            <div className="barra__cab">
              <span className="barra__label">{f.label}</span>
              <span className="barra__valor mono">
                {formatCents(f.cents)} <span className="subtle">· {pct}%</span>
              </span>
            </div>
            <div className="barra__pista" aria-hidden="true">
              <div className="barra__relleno" style={{ width: `${(f.cents / max) * 100}%` }} />
            </div>
            <div className="barra__detalle text-xs subtle">{f.detalle}</div>
          </div>
        );
      })}
    </div>
  );
}

export function CashReport({ report, tituloPeriodo }: { report: CashReportData; tituloPeriodo: string }) {
  const fechaHora = new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Caracas',
  });
  const diaCorto = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', timeZone: 'America/Caracas' });

  return (
    <>
      <Stagger className="stat-grid">
        <StaggerItem>
          <HoverCard>
            <Stat label="Cobros" value={String(report.paymentCount)} meta={tituloPeriodo} compact />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat label="Ventas USD" value={formatCents(report.totalCents)} meta="suma de lo cobrado" featured compact />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat label="Ventas Bs" value={formatBs(report.totalBs)} meta="a la tasa de cada cobro" compact />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat label="Queda en la clínica" value={formatCents(report.clinicShareCents)} meta="comisión retenida" compact />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat label="Para odontólogos" value={formatCents(report.dentistShareCents)} meta="devengado" compact />
          </HoverCard>
        </StaggerItem>
      </Stagger>

      <div className="grid-2">
        <FadeIn delay={0.1}>
          <Card title="Por medio de pago" subtitle="Cuánto entró por cada vía">
            <Barras
              total={report.totalCents}
              filas={report.byMethod
                .slice()
                .sort((a, b) => b.cents - a.cents)
                .map((m) => ({
                  id: m.method,
                  label: METHOD_LABEL[m.method] ?? m.method,
                  cents: m.cents,
                  detalle: `${m.count} ${m.count === 1 ? 'cobro' : 'cobros'} · ${formatBs(m.bs)}`,
                }))}
            />
          </Card>
        </FadeIn>
        <FadeIn delay={0.14}>
          <Card title="Por odontólogo" subtitle="Lo cobrado y la parte que es suya">
            <Barras
              total={report.totalCents}
              filas={report.byDentist.map((d) => ({
                id: d.dentistId ?? 'sin',
                label: d.dentistName,
                cents: d.cents,
                detalle: `${d.count} ${d.count === 1 ? 'cobro' : 'cobros'} · le corresponde ${formatCents(d.dentistShareCents)}`,
              }))}
            />
          </Card>
        </FadeIn>
      </div>

      {report.byDay.length > 1 && (
        <FadeIn delay={0.18}>
          <Card title="Por día" subtitle={`${report.byDay.length} días con cobros`}>
            <Barras
              total={report.totalCents}
              filas={report.byDay.map((d) => ({
                id: d.day,
                label: diaCorto.format(new Date(`${d.day}T12:00:00-04:00`)),
                cents: d.cents,
                detalle: `${d.count} ${d.count === 1 ? 'cobro' : 'cobros'}`,
              }))}
            />
          </Card>
        </FadeIn>
      )}

      <FadeIn delay={0.22}>
        <Card title="Cobros del periodo" subtitle="Del más reciente al más antiguo" flush>
          {report.payments.length === 0 ? (
            <EmptyState>No hay cobros en este periodo.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table table--cards">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Paciente</th>
                    <th>Tratamiento</th>
                    <th>Medio</th>
                    <th className="table__num">USD</th>
                    <th className="table__num">Bolívares</th>
                  </tr>
                </thead>
                <tbody>
                  {report.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="mono text-xs" data-label="Fecha">{fechaHora.format(p.paidAt)}</td>
                      <td data-label="Paciente">
                        <div className="table__strong">{p.patientName}</div>
                        <div className="text-xs subtle">{p.dentistName}</div>
                      </td>
                      <td className="muted text-xs" data-label="Tratamiento">{p.treatmentName}</td>
                      <td data-label="Medio">
                        <Badge tone="neutral">{METHOD_LABEL[p.method] ?? p.method}</Badge>
                      </td>
                      <td className="table__num mono table__strong" data-label="USD">{formatCents(p.amountCents)}</td>
                      <td className="table__num mono" style={{ color: 'var(--color-primary)' }} data-label="Bolívares">
                        {formatBs(p.amountBs)}
                        <span className="amount-bs">@ {p.exchangeRate.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </FadeIn>
    </>
  );
}
