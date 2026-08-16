'use client';

import { useState } from 'react';
import type { AppointmentWithRelations, PaymentMethodOption } from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import { Card, Badge, EmptyState } from '@/frontend/components/ui/primitives';
import { IconCurrency } from '@/frontend/components/ui/icons';
import { PaymentModal } from '@/frontend/features/admin/PaymentModal';

/**
 * ===========================================================================
 *  Cobros pendientes del día
 * ===========================================================================
 *  Lo que falta por cobrar, en la misma pantalla donde se cierra la caja.
 *
 *  Antes esto sólo se podía hacer desde la agenda, y la agenda muestra los
 *  próximos catorce días: para cobrar lo de hoy había que buscar entre
 *  ochenta citas. Peor aún, al cerrar caja no había forma de saber si faltaba
 *  algo por registrar — el arqueo cuadraba con lo registrado, no con lo
 *  atendido, y una cita sin cobrar aparecía como dinero que "sobra" en la
 *  gaveta sin explicación.
 *
 *  Aquí sale la lista corta: las citas atendidas de hoy que todavía no tienen
 *  cobro. Cuando queda vacía, el día está listo para cerrar.
 * ===========================================================================
 */

interface PendingChargesProps {
  appointments: AppointmentWithRelations[];
  exchangeRate: number | null;
  rateSource: string;
  commissionByDentist: Record<string, number>;
  /** Si el día ya se cerró, cobrar más descuadraría el arqueo firmado. */
  isClosed: boolean;
  /** Medios de pago configurados; se ofrecen tal cual al cobrar. */
  paymentMethods: PaymentMethodOption[];
}

export function PendingCharges({
  appointments,
  exchangeRate,
  rateSource,
  commissionByDentist,
  isClosed,
  paymentMethods,
}: PendingChargesProps) {
  const [payingFor, setPayingFor] = useState<AppointmentWithRelations | null>(null);

  const timeFormatter = new Intl.DateTimeFormat('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Caracas',
  });

  return (
    <>
      <Card
        title="Pendientes de cobro"
        subtitle={
          appointments.length === 0
            ? 'Todo lo atendido está cobrado'
            : `${appointments.length} ${appointments.length === 1 ? 'cita' : 'citas'} sin registrar`
        }
        actions={
          appointments.length > 0 ? (
            <Badge tone="warning">{appointments.length}</Badge>
          ) : (
            <Badge tone="success">Al día</Badge>
          )
        }
      >
        {appointments.length === 0 ? (
          <EmptyState>
            No queda ninguna cita atendida sin cobrar.
            <br />
            La caja se puede cerrar.
          </EmptyState>
        ) : (
          <div>
            {appointments.map((appointment) => (
              <div key={appointment.id} className="pending-charge">
                <div className="pending-charge__info">
                  <div className="table__strong">{appointment.patient.fullName}</div>
                  <div className="text-xs subtle">
                    {timeFormatter.format(appointment.startsAt)} · {appointment.treatment.name}
                  </div>
                </div>

                <div className="row" style={{ gap: '0.75rem', alignItems: 'center' }}>
                  <span className="mono text-sm">{formatCents(appointment.agreedPriceCents)}</span>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => setPayingFor(appointment)}
                    // Cobrar después de firmar el arqueo dejaría un cobro que
                    // no está en ningún cierre. Primero se reabre el día.
                    disabled={isClosed}
                    title={isClosed ? 'La caja de este día ya está cerrada' : undefined}
                  >
                    <IconCurrency size={14} /> Cobrar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <PaymentModal
        appointment={payingFor}
        exchangeRate={exchangeRate}
        rateSource={rateSource}
        commissionPercent={payingFor ? (commissionByDentist[payingFor.dentistId] ?? 40) : 40}
        paymentMethods={paymentMethods}
        onClose={() => setPayingFor(null)}
      />
    </>
  );
}
