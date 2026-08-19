'use client';

import { useState, useTransition } from 'react';
import type { AppointmentWithRelations, Treatment } from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import { totalCitaCents } from '@/backend/domain/pricing';
import {
  addAppointmentAddonAction,
  removeAppointmentAddonAction,
} from '@/app/actions/admin.actions';
import { Modal } from '@/frontend/components/motion';
import { TextField, SelectField, TextAreaField } from '@/frontend/components/ui/form';
import { Badge, EmptyState, Notice } from '@/frontend/components/ui/primitives';
import { IconPlus, IconTrash } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Procedimientos añadidos a una cita
 * ===========================================================================
 *  El caso que resuelve, tal cual lo describió la clínica: el paciente viene
 *  a una limpieza, el odontólogo ve una caries y se la obtura en la misma
 *  sesión. Se agendó por una cosa y hay que cobrar por dos.
 *
 *  POR QUÉ NO SE EDITA EL PRECIO DE LA CITA
 *  ---------------------------------------------------------------------
 *  Sería lo más rápido: subir `agreedPriceCents` de $30 a $60 y cobrar. Pero
 *  ese campo es el precio CONGELADO al agendar, y la diferencia entre lo que
 *  se cotizó y lo que se acabó cobrando es justo el dato que revela si el bot
 *  está cotizando mal. Machacarlo borra la evidencia.
 *
 *  Además cada línea puede repartirse distinto: una limpieza va al 40/60 y
 *  una radiografía se la queda entera la clínica. Un único importe no puede
 *  representar dos repartos, así que los conceptos van separados y el
 *  servidor reparte línea a línea (`domain/pricing.ts`).
 *
 *  LO QUE ESTA PANTALLA NO DECIDE
 *  ---------------------------------------------------------------------
 *  El porcentaje de comisión. No hay campo para él y la acción tampoco lo
 *  acepta: lo deriva el servidor del tratamiento y del acuerdo aprobado con
 *  el odontólogo. Si viajara en el formulario, se podría añadir una
 *  radiografía marcada como repartible y cobrar comisión por un trabajo que
 *  hizo la clínica.
 * ===========================================================================
 */

interface AddonsModalProps {
  /** Cita que se está editando, o `null` con el modal cerrado. */
  appointment: AppointmentWithRelations | null;
  treatments: Treatment[];
  /** `true` si la cita ya tiene cobro: entonces esto es sólo de lectura. */
  isPaid: boolean;
  onClose: () => void;
}

export function AddonsModal({ appointment, treatments, isPaid, onClose }: AddonsModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [treatmentId, setTreatmentId] = useState('');

  const activos = treatments.filter((treatment) => treatment.isActive);
  const elegido = activos.find((treatment) => treatment.id === treatmentId);

  const addons = appointment?.addons ?? [];

  // Lo que de verdad se va a cobrar: la cita más lo añadido. Es el número que
  // recepción necesita tener delante, y no está en ningún campo de la cita.
  const totalCents = appointment ? totalCitaCents(appointment) : 0;

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addAppointmentAddonAction(Object.fromEntries(formData.entries()));
      if (!result.ok) {
        setError(result.error ?? 'No se pudo añadir el procedimiento');
        return;
      }
      // El formulario se vacía pero el modal sigue abierto: lo normal es
      // añadir dos o tres cosas seguidas al salir el paciente de consulta.
      setTreatmentId('');
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeAppointmentAddonAction(id);
      if (!result.ok) setError(result.error ?? 'No se pudo quitar el procedimiento');
    });
  }

  return (
    <Modal
      open={appointment !== null}
      onClose={onClose}
      title="Procedimientos de la cita"
      subtitle={
        appointment
          ? `${appointment.patient.fullName} · ${appointment.treatment.name}`
          : undefined
      }
      footer={
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={isPending}>
          Cerrar
        </button>
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}

      {appointment && (
        <>
          {isPaid && (
            <Notice tone="warning">
              Esta cita ya está cobrada, así que sus conceptos no se pueden cambiar: el
              cobro congeló el reparto entre la clínica y el odontólogo. Para corregirla
              hay que anular el cobro primero.
            </Notice>
          )}

          {/* --- Lo que ya lleva la cita ---------------------------------- */}
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Reparto</th>
                  <th className="table__num">Precio</th>
                  <th style={{ textAlign: 'right' }} />
                </tr>
              </thead>
              <tbody>
                {/*
                  La cita original va como una fila más, sin botón de quitar.
                  Verla junto a los añadidos es lo que hace que el total tenga
                  sentido; enseñar sólo los extras obligaría a sumar de cabeza.
                */}
                <tr>
                  <td data-label="Concepto">
                    <div className="table__strong">{appointment.treatment.name}</div>
                    <div className="text-xs subtle">Motivo de la cita</div>
                  </td>
                  <td data-label="Reparto">
                    <Badge tone="neutral">Según odontólogo</Badge>
                  </td>
                  <td className="table__num mono" data-label="Precio">
                    {formatCents(appointment.agreedPriceCents)}
                  </td>
                  <td />
                </tr>

                {addons.map((addon) => (
                  <tr key={addon.id}>
                    <td data-label="Concepto">
                      <div className="table__strong">{addon.treatmentName}</div>
                      {addon.notes && <div className="text-xs subtle">{addon.notes}</div>}
                    </td>
                    <td data-label="Reparto">
                      {/*
                        El 100 % se señala aparte porque es la excepción que
                        más se presta a discusión con el odontólogo a fin de
                        mes: conviene que se vea al añadirlo, no después.
                      */}
                      {addon.commissionPercent === 100 ? (
                        <Badge tone="warning">100 % clínica</Badge>
                      ) : (
                        <Badge tone="neutral">{addon.commissionPercent} % clínica</Badge>
                      )}
                    </td>
                    <td className="table__num mono" data-label="Precio">
                      {formatCents(addon.priceCents)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!isPaid && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => remove(addon.id)}
                          disabled={isPending}
                          aria-label={`Quitar ${addon.treatmentName}`}
                        >
                          <IconTrash size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className="row row--between"
            style={{
              borderTop: '1px solid var(--color-border)',
              paddingTop: '0.75rem',
              marginTop: '0.75rem',
            }}
          >
            <span className="text-sm muted">Total a cobrar</span>
            <span
              className="mono"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary)' }}
            >
              {formatCents(totalCents)}
            </span>
          </div>

          {addons.length === 0 && !isPaid && (
            <EmptyState>
              Todavía no se ha añadido nada. Si la consulta se quedó en lo agendado, no
              hace falta tocar esto.
            </EmptyState>
          )}

          {/* --- Añadir uno nuevo ----------------------------------------- */}
          {!isPaid && (
            <form
              action={submit}
              className="form-grid"
              style={{ marginTop: '1rem' }}
              // `key` con el número de añadidos: al guardar uno, React monta
              // un formulario nuevo y los campos quedan vacíos solos.
              key={`addon-form-${addons.length}`}
            >
              <input type="hidden" name="appointmentId" value={appointment.id} />

              <SelectField
                label="Procedimiento"
                name="treatmentId"
                required
                full
                defaultValue=""
                options={[
                  { value: '', label: 'Elige un procedimiento…' },
                  ...activos.map((treatment) => ({
                    value: treatment.id,
                    label: `${treatment.name} · ${formatCents(treatment.basePriceCents)}${
                      treatment.clinicKeepsAll ? ' · 100 % clínica' : ''
                    }`,
                  })),
                ]}
                onChange={(event) => setTreatmentId(event.target.value)}
              />

              <TextField
                label="Precio en dólares"
                name="priceInPesos"
                type="number"
                min={0}
                step={0.01}
                placeholder={
                  elegido ? (elegido.basePriceCents / 100).toFixed(2) : 'Precio de lista'
                }
                hint={
                  elegido?.isPriceVariable
                    ? 'Este tratamiento no tiene precio cerrado: escribe el que se pactó en consulta.'
                    : 'Vacío = el precio de lista o el pactado con el odontólogo.'
                }
              />

              <TextAreaField
                label="Nota"
                name="notes"
                placeholder="Pieza tratada, motivo…"
              />

              {/*
                Aviso, no bloqueo. El precio variable se puede dejar vacío: se
                cobra la referencia. Pero conviene decirlo antes, no al ver la
                factura.
              */}
              {elegido?.isPriceVariable && (
                <div className="form-grid--full">
                  <Notice tone="info">
                    <strong>{elegido.name}</strong> se cotiza «desde{' '}
                    {formatCents(elegido.basePriceCents)}»: el precio final depende de lo
                    que se vea en consulta.
                  </Notice>
                </div>
              )}

              <div className="form-grid--full">
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={isPending || treatmentId === ''}
                >
                  <IconPlus size={16} /> {isPending ? 'Añadiendo…' : 'Añadir procedimiento'}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
