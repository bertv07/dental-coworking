'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { OutstandingDebt, PayoutRecord } from '@/backend/repositories/types';
import { formatCents, formatBs, centsToBs } from '@/backend/domain/money';
import { settleDentistPendingAction } from '@/app/actions/admin.actions';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Deudas pendientes con odontólogos — de cualquier día
 * ===========================================================================
 *  La liquidación del día sólo ve los cobros de ESE día. Si una tarde no se
 *  le pagó a alguien, la deuda seguía sumando en el dashboard sin decir de
 *  quién era ni dónde saldarla.
 *
 *  Aquí está toda, con nombre y por día, y se paga cuando se quiera: todo lo
 *  de una odontóloga de una vez, o un día suelto. Cada pago queda en «Pagos
 *  entregados» — el registro de qué se le dio a quién y cuándo.
 *
 *  Igual que en la liquidación diaria, no hay deshacer: pagar engancha los
 *  cobros al pago y eso es lo que impide pagarlos dos veces.
 * ===========================================================================
 */

function fechaCorta(k: string) {
  return new Intl.DateTimeFormat('es-VE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${k}T12:00:00Z`));
}

const fechaHora = new Intl.DateTimeFormat('es-VE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'America/Caracas',
});

export function OutstandingDebts({
  debts,
  payouts,
  exchangeRate,
  canSettle,
}: {
  debts: OutstandingDebt[];
  payouts: PayoutRecord[];
  /** Tasa vigente, para enseñar el equivalente en bolívares. */
  exchangeRate: number | null;
  /** Sólo el administrador entrega dinero. */
  canSettle: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const total = debts.reduce((suma, d) => suma + d.totalCents, 0);

  function pagar(deuda: OutstandingDebt, businessDate: string | null, cents: number) {
    if (!deuda.dentistId) return;
    const dentistId = deuda.dentistId;
    const que = businessDate ? `lo del ${fechaCorta(businessDate)}` : 'todo lo pendiente';
    if (
      !window.confirm(
        `¿Pagarle ${formatCents(cents)} a ${deuda.dentistName} (${que})?\n\n` +
          'Queda registrado y no se puede deshacer desde aquí.',
      )
    ) {
      return;
    }

    setError(null);
    setHecho(null);
    startTransition(async () => {
      const result = await settleDentistPendingAction({ dentistId, businessDate });
      if (!result.ok) {
        setError(result.error ?? 'No se pudo registrar el pago');
        return;
      }
      setHecho(`Pago de ${formatCents(cents)} a ${deuda.dentistName} registrado.`);
    });
  }

  return (
    <Card
      title="Deudas pendientes con odontólogos"
      subtitle="Lo que falta por pagarles, de cualquier día. Se paga cuando quieras."
      actions={
        total > 0 ? (
          <Badge tone="warning">{formatCents(total)} por pagar</Badge>
        ) : (
          <Badge tone="success">Sin deudas</Badge>
        )
      }
      flush
    >
      {error && <Notice tone="danger">{error}</Notice>}
      {hecho && <Notice tone="info">{hecho}</Notice>}

      {debts.length === 0 ? (
        <EmptyState>No se le debe nada a nadie.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table table--cards">
            <thead>
              <tr>
                <th>A quién / de qué día</th>
                <th className="table__num">Cobros</th>
                <th className="table__num">Producido</th>
                <th className="table__num">Se le debe</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            {debts.map((deuda) => (
              <tbody key={deuda.dentistId ?? 'sin-odontologo'}>
                <tr style={{ background: 'var(--color-surface-soft)' }}>
                  <td data-label="A quién">
                    <div className="table__strong">{deuda.dentistName}</div>
                    {!deuda.dentistId && (
                      <div className="text-xs subtle">
                        Cobros con parte de odontólogo pero sin odontólogo: revisa esas facturas.
                      </div>
                    )}
                  </td>
                  <td className="table__num mono" data-label="Cobros">{deuda.paymentCount}</td>
                  <td className="table__num mono" data-label="Producido">
                    {formatCents(deuda.dias.reduce((s, d) => s + d.grossCents, 0))}
                  </td>
                  <td className="table__num mono table__strong" data-label="Se le debe" style={{ color: 'var(--color-warning)' }}>
                    {formatCents(deuda.totalCents)}
                    {exchangeRate !== null && (
                      <span className="amount-bs">{formatBs(centsToBs(deuda.totalCents, exchangeRate))}</span>
                    )}
                  </td>
                  <td data-label="Acciones" style={{ textAlign: 'right' }}>
                    {!deuda.dentistId ? (
                      <span className="text-xs subtle">No se puede pagar</span>
                    ) : canSettle ? (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => pagar(deuda, null, deuda.totalCents)}
                        disabled={isPending}
                      >
                        Pagar todo
                      </button>
                    ) : (
                      <span className="text-xs subtle">Lo paga administración</span>
                    )}
                  </td>
                </tr>
                {deuda.dias.map((dia) => (
                  <tr key={dia.businessDate}>
                    <td data-label="Día" style={{ paddingLeft: '1.75rem' }}>
                      <Link href={`/caja?fecha=${dia.businessDate}`} className="text-sm">
                        {fechaCorta(dia.businessDate)}
                      </Link>
                    </td>
                    <td className="table__num mono muted" data-label="Cobros">{dia.paymentCount}</td>
                    <td className="table__num mono muted" data-label="Producido">{formatCents(dia.grossCents)}</td>
                    <td className="table__num mono" data-label="Se le debe">{formatCents(dia.dentistShareCents)}</td>
                    <td data-label="Acciones" style={{ textAlign: 'right' }}>
                      {deuda.dentistId && canSettle && deuda.dias.length > 1 && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => pagar(deuda, dia.businessDate, dia.dentistShareCents)}
                          disabled={isPending}
                        >
                          Pagar este día
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {payouts.length > 0 && (
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--color-border)' }}>
          <div className="text-sm" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Pagos entregados</div>
          <div className="stack" style={{ gap: '0.4rem' }}>
            {payouts.map((p) => (
              <div key={p.id} className="row row--between text-sm">
                <div>
                  <span className="table__strong">{p.dentistName}</span>
                  <div className="text-xs subtle">
                    {fechaHora.format(p.paidAt)}
                    {p.notes && ` · ${p.notes}`}
                  </div>
                </div>
                <span className="mono">{formatCents(p.totalCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
