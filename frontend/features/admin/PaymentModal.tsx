'use client';

import { useState, useTransition } from 'react';
import type { AppointmentWithRelations, PaymentMethodOption } from '@/backend/domain/types';
import { formatCents, formatBs, centsToBs } from '@/backend/domain/money';
import { registerPaymentAction } from '@/app/actions/admin.actions';
import { Modal } from '@/frontend/components/motion';
import { TextField, SelectField } from '@/frontend/components/ui/form';
import { Notice } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Modal de cobro
 * ===========================================================================
 *  La pantalla que usa recepción cuando el paciente paga. Es el punto por el
 *  que entra TODO el dinero al sistema.
 *
 *  DOS DECISIONES DE DISEÑO:
 *
 *  1. El equivalente en bolívares se calcula EN VIVO mientras se escribe el
 *     monto. Recepción cobra en Bs; obligarla a hacer la multiplicación
 *     mentalmente es pedir errores.
 *
 *  2. El reparto 40/60 se muestra pero NO se envía. Lo calcula el servidor
 *     con el porcentaje vigente del odontólogo. Aquí sólo se previsualiza
 *     para que quien cobra vea la consecuencia de lo que registra.
 * ===========================================================================
 */

interface PaymentModalProps {
  appointment: AppointmentWithRelations | null;
  /** Tasa Bs/USD vigente. `null` bloquea el cobro. */
  exchangeRate: number | null;
  rateSource: string;
  /** Comisión de la clínica para este odontólogo, sólo para previsualizar. */
  commissionPercent: number;
  /**
   * Medios de pago configurados en `/configuracion`.
   *
   * Son los mismos que el bot le ofrece al paciente por WhatsApp. Tener aquí
   * una lista distinta llevaría a que recepción registre "Transferencia" para
   * un pago que el paciente hizo por Zelle, y el arqueo dejaría de cuadrar
   * con la realidad.
   */
  paymentMethods: PaymentMethodOption[];
  onClose: () => void;
}

/**
 * Respaldo para cuando no hay ningún medio configurado.
 *
 * Sin esto, la lista saldría vacía y no se podría cobrar — un panel a medio
 * configurar no debe bloquear el mostrador.
 */
const FALLBACK_METHODS: PaymentMethodOption[] = [
  { id: '', label: 'Efectivo', kind: 'CASH', instructions: null, currency: 'VES', sortOrder: 0, isActive: true },
  { id: '', label: 'Transferencia / Pago móvil', kind: 'TRANSFER', instructions: null, currency: 'VES', sortOrder: 1, isActive: true },
  { id: '', label: 'Tarjeta', kind: 'CARD', instructions: null, currency: 'VES', sortOrder: 2, isActive: true },
  { id: '', label: 'Seguro', kind: 'INSURANCE', instructions: null, currency: 'VES', sortOrder: 3, isActive: true },
];

export function PaymentModal({
  appointment,
  exchangeRate,
  rateSource,
  commissionPercent,
  paymentMethods,
  onClose,
}: PaymentModalProps) {
  const methods = paymentMethods.length > 0 ? paymentMethods : FALLBACK_METHODS;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /*
   * Importe propuesto: el precio pactado, que es el caso normal. Sigue siendo
   * editable para descuentos y abonos.
   *
   * Se reajusta al CAMBIAR de cita en vez de sólo al inicializar porque este
   * componente no se desmonta: vive siempre montado en la agenda y sólo se
   * abre y se cierra su modal. Con un `useState(...)` a secas, el valor
   * inicial se calculaba una única vez —con `appointment` todavía en `null`—
   * y el campo salía vacío en todos los cobros, con el botón deshabilitado
   * hasta teclear el importe a mano.
   *
   * Es el patrón de React para ajustar estado cuando cambian las props: se
   * corrige durante el render, sin `useEffect`, así no hay un primer pintado
   * con el importe de la cita anterior.
   */
  const [amountUsd, setAmountUsd] = useState('');
  const [lastAppointmentId, setLastAppointmentId] = useState<string | null>(null);

  if (appointment && appointment.id !== lastAppointmentId) {
    setLastAppointmentId(appointment.id);
    setAmountUsd((appointment.agreedPriceCents / 100).toFixed(2));
  }

  /*
   * El campo cubre SÓLO la cita principal. Los procedimientos añadidos
   * durante la consulta los suma el servidor con su propio precio y su propio
   * reparto, así que aquí hay que hacer lo mismo para previsualizar: si se
   * mostrara el importe tecleado como total, recepción cobraría de menos en
   * cuanto la cita llevara un añadido.
   */
  const cents = Math.round((Number.parseFloat(amountUsd) || 0) * 100);
  const addons = appointment?.addons ?? [];
  const addonsCents = addons.reduce((suma, addon) => suma + addon.priceCents, 0);
  const totalCents = cents + addonsCents;

  /*
   * Reparto línea a línea, igual que en `domain/pricing.ts`: cada añadido
   * puede tener su propio porcentaje. Sumar los porcentajes no significaría
   * nada, porque se aplican sobre bases distintas.
   */
  const clinicCents =
    Math.round((cents * commissionPercent) / 100) +
    addons.reduce(
      (suma, addon) => suma + Math.round((addon.priceCents * addon.commissionPercent) / 100),
      0,
    );
  const dentistCents = totalCents - clinicCents;

  /** Porcentaje EFECTIVO sobre el total, que es el que describe el dinero. */
  const effectivePercent =
    totalCents === 0 ? commissionPercent : Math.round((clinicCents / totalCents) * 100);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      // Se parte "TRANSFER|Zelle" en los dos campos que espera el servidor.
      const entries = Object.fromEntries(formData.entries());
      const [kind, ...labelParts] = String(entries.methodChoice ?? '').split('|');
      const result = await registerPaymentAction({
        ...entries,
        method: kind,
        methodLabel: labelParts.join('|'),
      });
      if (result.ok) {
        onClose();
        return;
      }
      setError(result.error ?? 'No se pudo registrar el cobro');
    });
  }

  return (
    <Modal
      open={appointment !== null}
      onClose={onClose}
      title="Registrar cobro"
      subtitle={
        appointment
          ? `${appointment.patient.fullName} · ${appointment.treatment.name}`
          : undefined
      }
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </button>
          <button
            type="submit"
            form="payment-form"
            className="btn btn--primary"
            disabled={isPending || exchangeRate === null || cents <= 0}
          >
            {isPending ? 'Registrando…' : 'Registrar cobro'}
          </button>
        </>
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}

      {exchangeRate === null && (
        <Notice tone="danger">
          No hay tasa de cambio disponible. Actualízala en «Tasa de cambio» antes de cobrar:
          sin ella no se puede registrar el importe en bolívares.
        </Notice>
      )}

      {appointment && (
        <form id="payment-form" action={submit} className="form-grid" key={appointment.id}>
          <input type="hidden" name="appointmentId" value={appointment.id} />

          <TextField
            label="Monto en dólares"
            name="amountInUsd"
            type="number"
            required
            min={0}
            step={0.01}
            hint={`Precio pactado: ${formatCents(appointment.agreedPriceCents)}`}
            defaultValue={amountUsd}
            // Controlado en paralelo para poder recalcular el equivalente en
            // Bs mientras se escribe.
            onChange={(event) => setAmountUsd((event.target as HTMLInputElement).value)}
          />

          {/*
            El valor combina categoría contable y etiqueta ("TRANSFER|Zelle").
            La acción lo parte en dos: `method` clasifica para la caja,
            `methodLabel` describe lo que de verdad pasó. Un `<select>` sólo
            puede mandar un valor, y separarlo en dos campos obligaría a
            sincronizarlos con JavaScript.
          */}
          <SelectField
            label="Medio de pago"
            name="methodChoice"
            required
            defaultValue={`${methods[0]?.kind}|${methods[0]?.label}`}
            options={methods.map((method) => ({
              value: `${method.kind}|${method.label}`,
              label: method.currency === 'USD' ? `${method.label} ($)` : method.label,
            }))}
          />

          {/*
            Reparto puntual. Se deja vacío casi siempre; sólo se rellena
            cuando se pacta algo distinto con el odontólogo, como el 50/50.

            Va aquí y no en la ficha del odontólogo porque es una decisión de
            ESTA visita: cambiarle la comisión general afectaría a todas las
            citas pasadas y futuras.
          */}
          <TextField
            label="Reparto de esta cita (% clínica)"
            name="commissionOverride"
            type="number"
            placeholder={String(commissionPercent)}
            hint={`Vacío = ${commissionPercent}% habitual. Escribe 50 para un 50/50.`}
          />

          <TextField
            label="Referencia"
            name="externalReference"
            full
            placeholder="Nº de operación, voucher…"
            hint="Opcional. Útil para conciliar transferencias."
          />

          {/* --- Previsualización: lo que va a quedar registrado --- */}
          {exchangeRate !== null && cents > 0 && (
            <div
              className="form-grid--full"
              style={{
                background: 'var(--color-surface-soft)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                padding: '1rem',
              }}
            >
              {/*
                El desglose sólo aparece si hubo añadidos. En la cita normal
                sería ruido: el importe tecleado ya es el total.
              */}
              {addons.length > 0 && (
                <div
                  style={{
                    marginBottom: '0.75rem',
                    paddingBottom: '0.5rem',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <div className="row row--between text-xs">
                    <span className="muted">{appointment.treatment.name}</span>
                    <span className="mono">{formatCents(cents)}</span>
                  </div>
                  {addons.map((addon) => (
                    <div className="row row--between text-xs" key={addon.id}>
                      <span className="muted">
                        {addon.treatmentName}
                        {addon.commissionPercent === 100 && ' · 100 % clínica'}
                      </span>
                      <span className="mono">{formatCents(addon.priceCents)}</span>
                    </div>
                  ))}
                  <div
                    className="row row--between text-xs"
                    style={{ marginTop: '0.35rem', fontWeight: 700 }}
                  >
                    <span>Total</span>
                    <span className="mono">{formatCents(totalCents)}</span>
                  </div>
                </div>
              )}

              <div className="row row--between" style={{ marginBottom: '0.5rem' }}>
                <span className="text-sm muted">Cobrar en bolívares</span>
                <span
                  className="mono"
                  style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary)' }}
                >
                  {formatBs(centsToBs(totalCents, exchangeRate))}
                </span>
              </div>

              <div className="text-xs subtle" style={{ marginBottom: '0.75rem' }}>
                Tasa {rateSource} {exchangeRate.toLocaleString('es-VE', { minimumFractionDigits: 4 })} Bs/USD
                · queda congelada en este cobro
              </div>

              <div
                className="row row--between text-xs"
                style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem' }}
              >
                <span className="muted">Clínica ({effectivePercent}%)</span>
                <span className="mono">{formatCents(clinicCents)}</span>
              </div>
              <div className="row row--between text-xs">
                <span className="muted">
                  {appointment.dentist.fullName} ({100 - effectivePercent}%)
                </span>
                <span className="mono">{formatCents(dentistCents)}</span>
              </div>

              {/*
                Con añadidos, el porcentaje mostrado es el EFECTIVO sobre el
                total y no coincide con el del odontólogo. Sin esta línea
                parecería que se le ha cambiado la comisión.
              */}
              {addons.length > 0 && effectivePercent !== commissionPercent && (
                <div className="text-xs subtle" style={{ marginTop: '0.35rem' }}>
                  Su comisión sigue siendo {commissionPercent}%; el porcentaje efectivo
                  cambia porque algún añadido se reparte distinto.
                </div>
              )}
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
