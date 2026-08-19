'use client';

import { useState, useTransition } from 'react';
import type {
  Dentist,
  DentistTreatmentAgreement,
  Treatment,
} from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import {
  saveDentistTariffAction,
  reviewDentistTariffAction,
  deleteDentistTariffAction,
} from '@/app/actions/admin.actions';
import { Modal, MotionRow, AnimatePresence } from '@/frontend/components/motion';
import {
  SelectField,
  TextField,
  TextAreaField,
  FormFooter,
} from '@/frontend/components/ui/form';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';
import { IconPlus, IconTrash } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Tarifas pactadas por odontólogo
 * ===========================================================================
 *  «Los precios varían de acuerdo al tratamiento, y también según el
 *  odontólogo.» Un cirujano con veinte años cobra la exodoncia distinto que
 *  quien acaba de entrar, y la clínica pacta con cada uno.
 *
 *  UNA PANTALLA, DOS VISTAS — igual que `/agenda`, y por el mismo motivo:
 *  son dos trabajos distintos.
 *
 *   · **Administrador**: ve las de todos, aprueba o rechaza lo pendiente, y
 *     lo que guarda él nace ya aprobado, porque él es el aprobador.
 *   · **Odontólogo**: ve y propone SÓLO las suyas. Lo que envía queda
 *     pendiente hasta que alguien lo revise.
 *
 *  La diferencia no la decide este componente: `dentistId` y el estado los
 *  resuelve el servidor desde la sesión. Aquí sólo se pinta en consecuencia,
 *  porque ocultar un botón no es una medida de seguridad.
 *
 *  MIENTRAS ESTÉ PENDIENTE, NO SE APLICA. Se sigue cobrando el precio de
 *  lista. Es lo que impide que tener cuenta de odontólogo baste para cambiar
 *  lo que se le cobra a un paciente.
 * ===========================================================================
 */

interface TariffsManagerProps {
  agreements: DentistTreatmentAgreement[];
  treatments: Treatment[];
  /** Vacío en la vista del odontólogo: no elige persona, es él. */
  dentists: Dentist[];
  /** `true` si quien mira puede aprobar. Sólo cambia lo que se pinta. */
  canApprove: boolean;
  /** Ficha del odontólogo que mira, o `null` si es administración. */
  ownDentistId: string | null;
  /** Comisión general de cada odontólogo, para comparar con lo pactado. */
  commissionByDentist: Record<string, number>;
}

const STATUS_LABEL: Record<
  DentistTreatmentAgreement['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' }
> = {
  APPROVED: { label: 'Aprobada', tone: 'success' },
  PENDING: { label: 'Por aprobar', tone: 'warning' },
  REJECTED: { label: 'Rechazada', tone: 'danger' },
};

export function TariffsManager({
  agreements,
  treatments,
  dentists,
  canApprove,
  ownDentistId,
  commissionByDentist,
}: TariffsManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setFormOpen] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(
    null,
  );
  /** Propuesta que se está rechazando: el rechazo exige motivo. */
  const [rejecting, setRejecting] = useState<DentistTreatmentAgreement | null>(null);

  const activos = treatments.filter((treatment) => treatment.isActive);
  const pendientes = agreements.filter((agreement) => agreement.status === 'PENDING');

  function save(formData: FormData) {
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const result = await saveDentistTariffAction(Object.fromEntries(formData.entries()));
      if (result.ok) {
        setFormOpen(false);
        return;
      }
      if (result.field) {
        setFieldError({ field: result.field, message: result.error ?? 'Valor inválido' });
        return;
      }
      setError(result.error ?? 'No se pudo guardar la tarifa');
    });
  }

  function approve(agreement: DentistTreatmentAgreement) {
    setError(null);
    startTransition(async () => {
      const result = await reviewDentistTariffAction({
        id: agreement.id,
        status: 'APPROVED',
      });
      if (!result.ok) setError(result.error ?? 'No se pudo aprobar');
    });
  }

  function reject(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await reviewDentistTariffAction({
        ...Object.fromEntries(formData.entries()),
        status: 'REJECTED',
      });
      if (result.ok) {
        setRejecting(null);
        return;
      }
      setError(result.error ?? 'No se pudo rechazar');
    });
  }

  function remove(agreement: DentistTreatmentAgreement) {
    if (
      !window.confirm(
        `¿Quitar la tarifa de ${agreement.treatmentName} para ${agreement.dentistName}?\n\n` +
          'Volverá a cobrarse el precio de lista.',
      )
    ) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await deleteDentistTariffAction(agreement.id);
      if (!result.ok) setError(result.error ?? 'No se pudo eliminar');
    });
  }

  /** Comisión que acaba aplicándose, para no obligar a deducirla. */
  function comisionEfectiva(agreement: DentistTreatmentAgreement): number {
    return agreement.customCommissionPercent ?? commissionByDentist[agreement.dentistId] ?? 40;
  }

  return (
    <>
      <div className="row row--between" style={{ marginBottom: '0.25rem' }}>
        <p className="text-sm muted">
          {agreements.length === 0
            ? 'Sin tarifas pactadas: todos cobran el precio de lista.'
            : `${agreements.length} ${agreements.length === 1 ? 'tarifa pactada' : 'tarifas pactadas'}`}
        </p>
        <button type="button" className="btn btn--primary" onClick={() => setFormOpen(true)}>
          <IconPlus size={16} /> {canApprove ? 'Nueva tarifa' : 'Proponer tarifa'}
        </button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {/*
        Aviso sólo para quien puede actuar. Al odontólogo el estado ya se lo
        dice la etiqueta de su fila; repetirlo aquí sería ruido.
      */}
      {canApprove && pendientes.length > 0 && (
        <Notice tone="warning">
          Hay <strong>{pendientes.length}</strong>{' '}
          {pendientes.length === 1 ? 'propuesta' : 'propuestas'} esperando aprobación.
          Mientras tanto se cobra el precio de lista.
        </Notice>
      )}

      {!canApprove && (
        <Notice tone="info">
          Lo que propongas aquí no se aplica hasta que lo apruebe la administración.
          Hasta entonces se cobra el precio de lista.
        </Notice>
      )}

      {agreements.length === 0 ? (
        <Card>
          <EmptyState>
            No hay ninguna tarifa pactada todavía.
            <br />
            Sin acuerdos, cada tratamiento se cobra a su precio de lista.
          </EmptyState>
        </Card>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  {canApprove && <th>Odontólogo</th>}
                  <th>Tratamiento</th>
                  <th className="table__num">Lista</th>
                  <th className="table__num">Pactado</th>
                  <th>Reparto</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {agreements.map((agreement, index) => (
                    <MotionRow key={agreement.id} index={index}>
                      {canApprove && (
                        <td data-label="Odontólogo">
                          <div className="table__strong">{agreement.dentistName}</div>
                        </td>
                      )}
                      <td data-label="Tratamiento">
                        <div className="table__strong">{agreement.treatmentName}</div>
                        {/*
                          El motivo del rechazo se enseña en la fila y no en un
                          detalle aparte: si no se ve, se vuelve a proponer lo
                          mismo y la conversación se repite.
                        */}
                        {agreement.status === 'REJECTED' && agreement.reviewNotes && (
                          <div className="text-xs subtle">
                            Motivo: {agreement.reviewNotes}
                          </div>
                        )}
                      </td>
                      <td className="table__num mono muted" data-label="Lista">
                        {formatCents(agreement.treatmentBasePriceCents)}
                      </td>
                      <td className="table__num mono" data-label="Pactado">
                        {agreement.customPriceCents === null ? (
                          <span className="subtle">Sin cambio</span>
                        ) : (
                          <span className="table__strong">
                            {formatCents(agreement.customPriceCents)}
                          </span>
                        )}
                      </td>
                      <td data-label="Reparto">
                        <Badge tone="neutral">{comisionEfectiva(agreement)} % clínica</Badge>
                        {agreement.customCommissionPercent === null && (
                          <div className="text-xs subtle">Su comisión general</div>
                        )}
                      </td>
                      <td data-label="Estado">
                        <Badge tone={STATUS_LABEL[agreement.status].tone}>
                          {STATUS_LABEL[agreement.status].label}
                        </Badge>
                      </td>
                      <td data-label="Acciones">
                        <div className="table__actions">
                          {canApprove && agreement.status === 'PENDING' && (
                            <>
                              <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                onClick={() => approve(agreement)}
                                disabled={isPending}
                              >
                                Aprobar
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => setRejecting(agreement)}
                                disabled={isPending}
                              >
                                Rechazar
                              </button>
                            </>
                          )}

                          {canApprove && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => remove(agreement)}
                              disabled={isPending}
                              aria-label={`Quitar tarifa de ${agreement.treatmentName}`}
                            >
                              <IconTrash size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </MotionRow>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* --- Alta / propuesta -------------------------------------------- */}
      <Modal
        open={isFormOpen}
        onClose={() => setFormOpen(false)}
        title={canApprove ? 'Nueva tarifa' : 'Proponer tarifa'}
        subtitle={
          canApprove
            ? 'Lo que guardes se aplica de inmediato'
            : 'Queda pendiente de aprobación'
        }
        footer={
          <FormFooter
            isPending={isPending}
            onCancel={() => setFormOpen(false)}
            formId="tariff-form"
            submitLabel={canApprove ? 'Guardar tarifa' : 'Enviar propuesta'}
          />
        }
      >
        <form id="tariff-form" action={save} className="form-grid">
          {/*
            El odontólogo no elige persona: es él. El campo viaja oculto y el
            servidor lo comprueba de todas formas contra su sesión.
          */}
          {canApprove ? (
            <SelectField
              label="Odontólogo"
              name="dentistId"
              required
              options={dentists
                .filter((dentist) => dentist.isActive)
                .map((dentist) => ({ value: dentist.id, label: dentist.fullName }))}
            />
          ) : (
            <input type="hidden" name="dentistId" value={ownDentistId ?? ''} />
          )}

          <SelectField
            label="Tratamiento"
            name="treatmentId"
            required
            options={activos.map((treatment) => ({
              value: treatment.id,
              label: `${treatment.name} · ${formatCents(treatment.basePriceCents)}`,
            }))}
          />

          <TextField
            label="Precio pactado en dólares"
            name="customPriceInPesos"
            type="number"
            min={0}
            step={0.01}
            placeholder="Precio de lista"
            hint="Vacío = se cobra el precio de lista."
            error={
              fieldError?.field === 'customPriceInPesos' ? fieldError.message : undefined
            }
          />

          <TextField
            label="Reparto (% clínica)"
            name="customCommissionPercent"
            type="number"
            min={0}
            max={100}
            placeholder="Su comisión general"
            hint="Vacío = la comisión habitual de ese odontólogo."
            error={
              fieldError?.field === 'customCommissionPercent'
                ? fieldError.message
                : undefined
            }
          />

          <div className="form-grid--full">
            <Notice tone="info">
              Se puede pactar sólo el precio, sólo el reparto, o ambos. Lo que se deje
              vacío sigue las reglas normales.
            </Notice>
          </div>
        </form>
      </Modal>

      {/* --- Rechazo: exige motivo --------------------------------------- */}
      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Rechazar propuesta"
        subtitle={
          rejecting ? `${rejecting.dentistName} · ${rejecting.treatmentName}` : undefined
        }
        footer={
          <FormFooter
            isPending={isPending}
            onCancel={() => setRejecting(null)}
            formId="tariff-reject-form"
            submitLabel="Rechazar"
          />
        }
      >
        {rejecting && (
          <form id="tariff-reject-form" action={reject} className="form-grid">
            <input type="hidden" name="id" value={rejecting.id} />
            <TextAreaField
              label="Motivo"
              name="reviewNotes"
              placeholder="Por qué no se acepta esta tarifa…"
            />
            <div className="form-grid--full">
              <Notice tone="info">
                El motivo lo lee el odontólogo. Sin él, lo normal es que vuelva a
                proponer exactamente lo mismo.
              </Notice>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
