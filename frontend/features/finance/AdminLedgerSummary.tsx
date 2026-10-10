import Link from 'next/link';
import type { LedgerSummary } from '@/backend/domain/ledger-summary';
import { formatCents } from '@/backend/domain/money';
import { Avatar, Card, EmptyState, Stat } from '@/frontend/components/ui/primitives';
import { CountUp, FadeIn } from '@/frontend/components/motion';

/**
 * ===========================================================================
 *  El libro de Administración, en el dashboard
 * ===========================================================================
 *  Las mismas filas de /administracion —las escritas a mano, las cargadas
 *  desde Excel y las que nacen solas de un cobro—, resumidas por mes.
 *
 *  Componente de presentación, como el resto del dashboard: recibe el
 *  resumen ya calculado y no consulta nada.
 * ===========================================================================
 */

function nombreDelMes(mes: string): string {
  return new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${mes}-15T12:00:00Z`));
}

/** Verde si queda, rojo si falta: el signo es lo primero que se busca. */
function colorDeSaldo(cents: number): string | undefined {
  if (cents === 0) return undefined;
  return cents < 0 ? 'var(--color-danger)' : 'var(--color-success)';
}

export function AdminLedgerSummary({ resumen }: { resumen: LedgerSummary }) {
  const mes = nombreDelMes(resumen.month);
  const total = resumen.incomeCents - resumen.expenseCents;

  return (
    <>
      <FadeIn delay={0.1}>
        <Card
          title="Administración"
          subtitle={`El libro de la clínica en ${mes}`}
          actions={
            <Link href="/administracion" className="btn btn--ghost btn--sm">
              Abrir el libro
            </Link>
          }
        >
          <div className="stat-grid">
            <Stat
              label="Ingresos del libro"
              value={<CountUp value={resumen.incomeCents} format="currency" />}
              meta={`${resumen.filas} filas en ${mes}`}
              compact
            />
            <Stat
              label="Egresos del libro"
              value={<CountUp value={resumen.expenseCents} format="currency" />}
              meta="gastos y pagos a doctoras"
              compact
            />
            <Stat
              label="Total general"
              value={<span style={{ color: colorDeSaldo(total) }}>{formatCents(total)}</span>}
              meta="ingresos menos egresos"
              compact
            />
            <Stat
              label="Caja chica"
              value={
                <span style={{ color: colorDeSaldo(resumen.pettyCashBalanceCents) }}>
                  {formatCents(resumen.pettyCashBalanceCents)}
                </span>
              }
              meta="saldo de hoy"
              compact
            />
          </div>
        </Card>
      </FadeIn>

      <div className="grid-2">
        <FadeIn delay={0.14}>
          <Card title="Libro por mes" subtitle="Gastos Generales — toca un mes para verlo arriba" flush>
            {resumen.months.every((m) => m.incomeCents === 0 && m.expenseCents === 0) ? (
              <EmptyState>El libro todavía no tiene filas.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Mes</th>
                      <th className="table__num">Ingreso</th>
                      <th className="table__num">Egreso</th>
                      <th className="table__num">Total general</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.months.map((m) => {
                      const saldo = m.incomeCents - m.expenseCents;
                      const elegido = m.month === resumen.month;
                      return (
                        <tr key={m.month} style={elegido ? { background: 'var(--color-surface-soft)' } : undefined}>
                          <td>
                            <Link
                              href={`/dashboard?mes=${m.month}`}
                              className="table__strong"
                              aria-current={elegido ? 'true' : undefined}
                            >
                              {nombreDelMes(m.month)}
                            </Link>
                          </td>
                          <td className="table__num mono">{formatCents(m.incomeCents)}</td>
                          <td className="table__num mono">{formatCents(m.expenseCents)}</td>
                          <td className="table__num mono table__strong" style={{ color: colorDeSaldo(saldo) }}>
                            {formatCents(saldo)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </FadeIn>

        <FadeIn delay={0.18}>
          <Card title="Libro por odontóloga" subtitle={`Lo anotado en sus pestañas en ${mes}`} flush>
            {resumen.dentists.length === 0 ? (
              <EmptyState>Ninguna odontóloga tiene filas en {mes}.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Odontóloga</th>
                      <th className="table__num">Consultas</th>
                      <th className="table__num">Presupuesto</th>
                      <th className="table__num">Doctora</th>
                      <th className="table__num">Clínica</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.dentists.map((d) => (
                      <tr key={d.dentistId}>
                        <td>
                          <Link href={`/administracion?tab=dr-${d.dentistId}`} className="row">
                            <Avatar name={d.dentistName} small />
                            <span className="table__strong">{d.dentistName}</span>
                          </Link>
                        </td>
                        <td className="table__num muted">{d.consultas}</td>
                        <td className="table__num mono">{formatCents(d.budgetCents)}</td>
                        <td className="table__num mono muted">{formatCents(d.dentistShareCents)}</td>
                        <td className="table__num mono" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                          {formatCents(d.clinicShareCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--color-surface-soft)' }}>
                      <td className="table__strong">Total</td>
                      <td className="table__num muted">{resumen.dentists.reduce((s, d) => s + d.consultas, 0)}</td>
                      <td className="table__num mono table__strong">
                        {formatCents(resumen.dentists.reduce((s, d) => s + d.budgetCents, 0))}
                      </td>
                      <td className="table__num mono table__strong">
                        {formatCents(resumen.dentists.reduce((s, d) => s + d.dentistShareCents, 0))}
                      </td>
                      <td className="table__num mono table__strong">
                        {formatCents(resumen.dentists.reduce((s, d) => s + d.clinicShareCents, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </FadeIn>
      </div>
    </>
  );
}
