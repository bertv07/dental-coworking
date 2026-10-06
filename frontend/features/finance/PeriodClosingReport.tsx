import Link from 'next/link';
import type { PeriodClosing } from '@/backend/domain/types';
import type { CierreCompleto } from '@/backend/services/cierre.service';
import { formatCents } from '@/backend/domain/money';
import { Badge, Card, EmptyState, Stat } from '@/frontend/components/ui/primitives';
import { IconChevronLeft, IconChevronRight } from '@/frontend/components/ui/icons';
import { ClosePeriodPanel } from '@/frontend/features/finance/ClosePeriodPanel';

/**
 * ===========================================================================
 *  Cierre mensual y anual
 * ===========================================================================
 *  Todo lo de Administración de un mes o de un año, en una pantalla: cuánto
 *  se ganó, de dónde salió, y el detalle —día por día en el mes, mes por mes
 *  en el año— para poder responder «¿cuánto se ganó tal día?».
 *
 *  Presentación pura: recibe el cierre ya calculado.
 * ===========================================================================
 */

function nombreDelMes(mes: string, conAnio = true): string {
  return new Intl.DateTimeFormat('es-VE', { month: 'long', ...(conAnio ? { year: 'numeric' } : {}), timeZone: 'UTC' })
    .format(new Date(`${mes}-15T12:00:00Z`));
}

function nombreDelDia(dia: string): string {
  return new Intl.DateTimeFormat('es-VE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${dia}T12:00:00Z`));
}

function colorDeSaldo(cents: number): string | undefined {
  if (cents === 0) return undefined;
  return cents < 0 ? 'var(--color-danger)' : 'var(--color-success)';
}

function mover(period: string, pasos: number): string {
  if (period.length === 4) return String(Number(period) + pasos);
  const total = Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1 + pasos;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

const url = (period: string) => `/administracion?tab=cierre&periodo=${period}`;

export function PeriodClosingReport({
  datos,
  closing,
  closings,
  periodoActual,
}: {
  datos: CierreCompleto;
  /** El cierre guardado de ESTE periodo, si lo hay. */
  closing: PeriodClosing | null;
  /** Los cierres guardados del año, para marcar qué meses ya se cerraron. */
  closings: PeriodClosing[];
  /** El mes ('YYYY-MM') en curso, para no ofrecer el futuro. */
  periodoActual: string;
}) {
  const { cierre, cobrado } = datos;
  const { period, esAnual } = cierre;
  const total = cierre.incomeCents - cierre.expenseCents;
  const anio = period.slice(0, 4);
  const nombre = esAnual ? `el año ${period}` : nombreDelMes(period);
  const tope = periodoActual.slice(0, period.length);
  const cerrados = new Set(closings.map((c) => c.period));

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      {/* --- Qué periodo ------------------------------------------------- */}
      <div className="row row--between row--wrap" style={{ gap: '0.75rem' }}>
        <div className="row" style={{ gap: '0.5rem' }}>
          <Link href={url(esAnual ? periodoActual.slice(0, 7) : period)} className={`btn btn--sm ${esAnual ? 'btn--ghost' : 'btn--primary'}`}>
            Cierre mensual
          </Link>
          <Link href={url(anio)} className={`btn btn--sm ${esAnual ? 'btn--primary' : 'btn--ghost'}`}>
            Cierre anual
          </Link>
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          <Link href={url(mover(period, -1))} className="btn btn--ghost btn--sm">
            <IconChevronLeft size={15} /> Anterior
          </Link>
          <strong style={{ textTransform: 'capitalize' }}>{esAnual ? period : nombreDelMes(period)}</strong>
          {period < tope && (
            <Link href={url(mover(period, 1))} className="btn btn--ghost btn--sm">
              Siguiente <IconChevronRight size={15} />
            </Link>
          )}
        </div>
      </div>

      {/* --- Cuánto se ganó ---------------------------------------------- */}
      <div className="stat-grid">
        <Stat
          label={esAnual ? 'Se ganó en el año' : 'Se ganó en el mes'}
          value={formatCents(total)}
          meta={total < 0 ? 'salió más de lo que entró' : 'ingresos menos egresos'}
          featured
          compact
        />
        <Stat label="Ingresos" value={formatCents(cierre.incomeCents)} meta={`${cierre.filas} filas en el libro`} compact />
        <Stat
          label="Egresos"
          value={formatCents(cierre.expenseCents)}
          meta={`${formatCents(cierre.pagosDoctorasCents)} a doctoras · ${formatCents(cierre.gastosCents)} en gastos`}
          compact
        />
        <Stat
          label="Cobrado en Caja"
          value={formatCents(cobrado.totalCents)}
          meta={`${cobrado.paymentCount} cobros · ${formatCents(cobrado.clinicShareCents)} para la clínica`}
          compact
        />
      </div>

      <ClosePeriodPanel
        period={period}
        nombre={nombre}
        closing={closing}
        totalHoyCents={total}
        enCurso={period === tope}
      />

      {/* --- Día por día / mes por mes ----------------------------------- */}
      <Card
        title={esAnual ? 'Mes por mes' : 'Día por día'}
        subtitle={esAnual ? 'Toca un mes para ver su cierre' : 'Cuánto se ganó cada día, según el libro'}
        flush
      >
        {cierre.desglose.length === 0 ? (
          <EmptyState>El libro no tiene filas en {nombre}.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{esAnual ? 'Mes' : 'Día'}</th>
                  <th className="table__num">Ingreso</th>
                  <th className="table__num">Egreso</th>
                  <th className="table__num">Se ganó</th>
                  {!esAnual && <th className="table__num">Cobrado en Caja</th>}
                  {esAnual && <th>Cierre</th>}
                </tr>
              </thead>
              <tbody>
                {cierre.desglose.map((d) => {
                  const saldo = d.incomeCents - d.expenseCents;
                  return (
                    <tr key={d.clave}>
                      <td style={{ textTransform: 'capitalize' }}>
                        {esAnual ? (
                          <Link href={url(d.clave)} className="table__strong">{nombreDelMes(d.clave, false)}</Link>
                        ) : (
                          <Link href={`/caja?fecha=${d.clave}`} className="table__strong">{nombreDelDia(d.clave)}</Link>
                        )}
                      </td>
                      <td className="table__num mono">{d.incomeCents > 0 ? formatCents(d.incomeCents) : '—'}</td>
                      <td className="table__num mono">{d.expenseCents > 0 ? formatCents(d.expenseCents) : '—'}</td>
                      <td className="table__num mono table__strong" style={{ color: colorDeSaldo(saldo) }}>
                        {formatCents(saldo)}
                      </td>
                      {!esAnual && (
                        <td className="table__num mono muted">
                          {cobrado.porDia.has(d.clave) ? formatCents(cobrado.porDia.get(d.clave)!) : '—'}
                        </td>
                      )}
                      {esAnual && (
                        <td>
                          {cerrados.has(d.clave) ? <Badge tone="success">Cerrado</Badge> : <Badge tone="neutral">Abierto</Badge>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--color-surface-soft)' }}>
                  <td className="table__strong">Total</td>
                  <td className="table__num mono table__strong">{formatCents(cierre.incomeCents)}</td>
                  <td className="table__num mono table__strong">{formatCents(cierre.expenseCents)}</td>
                  <td className="table__num mono table__strong" style={{ color: colorDeSaldo(total) }}>{formatCents(total)}</td>
                  {!esAnual && <td className="table__num mono table__strong">{formatCents(cobrado.totalCents)}</td>}
                  {esAnual && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="grid-2">
        {/* --- Odontólogas ----------------------------------------------- */}
        <Card title="Por odontóloga" subtitle="Lo anotado en el libro de cada una" flush>
          {cierre.dentists.length === 0 ? (
            <EmptyState>Ninguna odontóloga tiene filas en {nombre}.</EmptyState>
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
                  {cierre.dentists.map((d) => (
                    <tr key={d.dentistId}>
                      <td className="table__strong">{d.dentistName}</td>
                      <td className="table__num muted">{d.consultas}</td>
                      <td className="table__num mono">{formatCents(d.budgetCents)}</td>
                      <td className="table__num mono muted">{formatCents(d.dentistShareCents)}</td>
                      <td className="table__num mono" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                        {formatCents(d.clinicShareCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="stack" style={{ gap: 'var(--space-5)' }}>
          {/* --- Caja chica ---------------------------------------------- */}
          <Card title="Caja chica" subtitle={`Movimiento en ${nombre}`}>
            <div className="stack">
              <div className="row row--between text-sm">
                <span className="muted">Saldo al empezar</span>
                <span className="mono">{formatCents(cierre.cajaChica.inicialCents)}</span>
              </div>
              <div className="row row--between text-sm">
                <span className="muted">Entró</span>
                <span className="mono">{formatCents(cierre.cajaChica.entroCents)}</span>
              </div>
              <div className="row row--between text-sm">
                <span className="muted">Salió</span>
                <span className="mono">{formatCents(cierre.cajaChica.salioCents)}</span>
              </div>
              <div className="row row--between" style={{ borderTop: '2px solid var(--color-border-strong)', paddingTop: '0.75rem' }}>
                <span style={{ fontWeight: 700 }}>Saldo al cerrar</span>
                <span className="mono" style={{ fontWeight: 700, color: colorDeSaldo(cierre.cajaChica.finalCents) }}>
                  {formatCents(cierre.cajaChica.finalCents)}
                </span>
              </div>
            </div>
          </Card>

          {/* --- En qué se fue ------------------------------------------- */}
          <Card title="Mayores gastos" subtitle="Sin contar los pagos a doctoras">
            {cierre.mayoresGastos.length === 0 ? (
              <EmptyState>Sin gastos en {nombre}.</EmptyState>
            ) : (
              <div className="stack" style={{ gap: '0.5rem' }}>
                {cierre.mayoresGastos.map((g) => (
                  <div key={g.description} className="row row--between text-sm">
                    <span>
                      {g.description}
                      {g.veces > 1 && <span className="subtle"> ×{g.veces}</span>}
                    </span>
                    <span className="mono table__strong">{formatCents(g.cents)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
