'use client';

import { useState, useTransition } from 'react';
import type { DailySettlement } from '@/backend/repositories/types';
import { formatCents, formatBs, centsToBs } from '@/backend/domain/money';
import { settleDentistDayAction } from '@/app/actions/admin.actions';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Liquidación del día
 * ===========================================================================
 *  «Se paga al final del día»: cada odontólogo se lleva su parte de lo que
 *  produjo esa jornada, en vez de esperar a una quincena.
 *
 *  Lo que se paga es `dentistShareCents`, que ya viene calculado del cobro y
 *  no se recalcula aquí: ese número se congeló con la comisión vigente en el
 *  momento, y recalcularlo hoy con la comisión de hoy cambiaría lo que se le
 *  debe por trabajo ya hecho.
 *
 *  Pagar ENGANCHA los cobros a la liquidación, así que dejan de aparecer como
 *  pendientes. Es lo que impide pagar dos veces lo mismo — y por eso no hay
 *  botón de deshacer: se corrige con un ajuste, no borrando el rastro.
 * ===========================================================================
 */

interface DailySettlementsProps {
  settlements: DailySettlement[];
  /** 'YYYY-MM-DD' en hora de la clínica. */
  businessDate: string;
  /** Tasa vigente, para enseñar el equivalente en bolívares. */
  exchangeRate: number | null;
  /** Sólo el administrador entrega dinero. */
  canSettle: boolean;
}

export function DailySettlements({
  settlements,
  businessDate,
  exchangeRate,
  canSettle,
}: DailySettlementsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function settle(settlement: DailySettlement) {
    if (
      !window.confirm(
        `¿Pagarle ${formatCents(settlement.dentistShareCents)} a ${settlement.dentistName}?\n\n` +
          'Queda registrado y no se puede deshacer desde aquí.',
      )
    ) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await settleDentistDayAction({
        dentistId: settlement.dentistId,
        businessDate,
      });
      if (!result.ok) setError(result.error ?? 'No se pudo registrar el pago');
    });
  }

  const porPagar = settlements.filter((s) => s.dentistShareCents > 0);
  const totalPendiente = porPagar.reduce((suma, s) => suma + s.dentistShareCents, 0);

  return (
    <Card
      title="Liquidación del día"
      subtitle="Lo que le corresponde a cada odontólogo por lo cobrado hoy"
      actions={
        totalPendiente > 0 ? (
          <Badge tone="warning">{formatCents(totalPendiente)} por pagar</Badge>
        ) : (
          <Badge tone="success">Todo liquidado</Badge>
        )
      }
      flush
    >
      {error && <Notice tone="danger">{error}</Notice>}

      {settlements.length === 0 ? (
        <EmptyState>
          Todavía no hay cobros hoy, así que no hay nada que repartir.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table table--cards">
            <thead>
              <tr>
                <th>Odontólogo</th>
                <th className="table__num">Cobros</th>
                <th className="table__num">Producido</th>
                <th className="table__num">Clínica</th>
                <th className="table__num">Le corresponde</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((settlement) => (
                <tr key={settlement.dentistId}>
                  <td data-label="Odontólogo">
                    <div className="table__strong">{settlement.dentistName}</div>
                    {settlement.settledCents > 0 && (
                      <div className="text-xs subtle">
                        Ya pagado hoy: {formatCents(settlement.settledCents)}
                      </div>
                    )}
                  </td>
                  <td className="table__num mono" data-label="Cobros">
                    {settlement.paymentCount}
                  </td>
                  <td className="table__num mono" data-label="Producido">
                    {formatCents(settlement.grossCents)}
                  </td>
                  <td className="table__num mono muted" data-label="Clínica">
                    {formatCents(settlement.clinicShareCents)}
                  </td>
                  <td
                    className="table__num mono table__strong"
                    data-label="Le corresponde"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    {formatCents(settlement.dentistShareCents)}
                    {/*
                      El equivalente en bolívares, que es como se entrega el
                      dinero. Sin esto hay que hacer la multiplicación a mano
                      justo cuando se está contando efectivo.
                    */}
                    {exchangeRate !== null && settlement.dentistShareCents > 0 && (
                      <span className="amount-bs">
                        {formatBs(centsToBs(settlement.dentistShareCents, exchangeRate))}
                      </span>
                    )}
                  </td>
                  <td data-label="Acciones" style={{ textAlign: 'right' }}>
                    {settlement.dentistShareCents === 0 ? (
                      <Badge tone="success">Pagado</Badge>
                    ) : canSettle ? (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => settle(settlement)}
                        disabled={isPending}
                      >
                        Marcar pagado
                      </button>
                    ) : (
                      <span className="text-xs subtle">Lo paga administración</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
