'use client';

import type { Treatment } from '@/backend/domain/types';
import { formatCents, splitCents } from '@/backend/domain/money';
import {
  createTreatmentAction,
  updateTreatmentAction,
  deleteTreatmentAction,
} from '@/app/actions/admin.actions';
import { Modal, MotionRow, AnimatePresence } from '@/frontend/components/motion';
import {
  useCrud,
  TextField,
  CheckboxField,
  FormFooter,
} from '@/frontend/components/ui/form';
import { Badge, EmptyState, Notice } from '@/frontend/components/ui/primitives';

/**
 * Configuración de precios de tratamientos.
 *
 * Dos cosas que esta pantalla hace y conviene no perder al modificarla:
 *
 *  1. Muestra el REPARTO resultante (40/60) junto a cada precio. Editar un
 *     precio sin ver cuánto acaba en cada bolsillo es editar a ciegas.
 *
 *  2. El `code` se marca como inmutable en la práctica: es la llave que usa
 *     n8n. Se puede cambiar, pero la interfaz avisa de la consecuencia.
 */

interface TreatmentsManagerProps {
  treatments: Treatment[];
  /** Comisión por defecto de la clínica, para previsualizar el reparto. */
  defaultCommissionPercent: number;
}

export function TreatmentsManager({
  treatments,
  defaultCommissionPercent,
}: TreatmentsManagerProps) {
  const crud = useCrud<Treatment>({
    create: createTreatmentAction,
    update: updateTreatmentAction,
    remove: deleteTreatmentAction,
  });

  const editing = crud.mode.kind === 'edit' ? crud.mode.item : null;
  const errorFor = (field: string) =>
    crud.fieldName === field ? crud.fieldError ?? undefined : undefined;

  // Agrupación por categoría: un listado plano de 12+ tratamientos mezclando
  // ortodoncia con cirugía es difícil de recorrer.
  const byCategory = new Map<string, Treatment[]>();
  for (const treatment of treatments) {
    byCategory.set(treatment.category, [...(byCategory.get(treatment.category) ?? []), treatment]);
  }

  return (
    <>
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Catálogo de tratamientos</h2>
            <p className="card__subtitle">
              {treatments.filter((t) => t.isActive).length} activos · {byCategory.size} categorías
            </p>
          </div>
          <button type="button" className="btn btn--primary" onClick={crud.openCreate}>
            + Nuevo tratamiento
          </button>
        </div>

        <div className="card__body card__body--flush">
          {treatments.length === 0 ? (
            <EmptyState>Aún no hay tratamientos en el catálogo.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tratamiento</th>
                    <th>Código</th>
                    <th className="table__num">Duración</th>
                    <th className="table__num">Precio</th>
                    <th className="table__num">Clínica</th>
                    <th className="table__num">Odontólogo</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {treatments.map((treatment, index) => {
                      // Se usa la MISMA función que producción, así que la
                      // previsualización coincide exactamente con lo que se
                      // registrará al cobrar.
                      const split = splitCents(
                        treatment.basePriceCents,
                        defaultCommissionPercent,
                      );

                      return (
                        <MotionRow key={treatment.id} index={index}>
                          <td>
                            <div className="table__strong">{treatment.name}</div>
                            <div className="text-xs subtle">{treatment.category}</div>
                          </td>
                          <td>
                            <Badge tone="neutral">{treatment.code}</Badge>
                          </td>
                          <td className="table__num muted text-xs">
                            {treatment.durationMinutes} min
                            {treatment.bufferMinutes > 0 && (
                              <span className="subtle"> +{treatment.bufferMinutes}</span>
                            )}
                          </td>
                          <td className="table__num mono table__strong">
                            {formatCents(treatment.basePriceCents)}
                          </td>
                          <td
                            className="table__num mono text-xs"
                            style={{ color: 'var(--color-primary)' }}
                          >
                            {formatCents(split.clinicShareCents)}
                          </td>
                          <td className="table__num mono text-xs muted">
                            {formatCents(split.dentistShareCents)}
                          </td>
                          <td>
                            {treatment.isActive ? (
                              <Badge tone="success">Activo</Badge>
                            ) : (
                              <Badge tone="neutral">Inactivo</Badge>
                            )}
                          </td>
                          <td>
                            <div className="table__actions">
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => crud.openEdit(treatment)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                onClick={() => crud.remove(treatment, treatment.name)}
                                disabled={crud.isPending}
                              >
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </MotionRow>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={crud.mode.kind !== 'closed'}
        onClose={crud.close}
        title={editing ? 'Editar tratamiento' : 'Nuevo tratamiento'}
        subtitle={editing?.name ?? 'Define precio, duración y código'}
        footer={<FormFooter onCancel={crud.close} isPending={crud.isPending} />}
      >
        {crud.formError && <Notice tone="danger">{crud.formError}</Notice>}

        {editing && (
          <Notice tone="warning">
            Cambiar el <strong>código</strong> rompe los flujos de n8n que ya lo usan. Las
            citas existentes conservan el precio con el que se agendaron.
          </Notice>
        )}

        <form id="crud-form" action={crud.submit} className="form-grid" key={editing?.id ?? 'new'}>
          <TextField
            label="Nombre"
            name="name"
            required
            full
            defaultValue={editing?.name}
            error={errorFor('name')}
          />
          <TextField
            label="Código (para la automatización)"
            name="code"
            required
            placeholder="LIMPIEZA"
            hint="Mayúsculas, números y guion bajo"
            defaultValue={editing?.code}
            error={errorFor('code')}
          />
          <TextField
            label="Categoría"
            name="category"
            required
            placeholder="PREVENTIVO"
            defaultValue={editing?.category}
            error={errorFor('category')}
          />
          <TextField
            label="Precio (pesos)"
            name="priceInPesos"
            type="number"
            required
            min={0}
            step={1000}
            hint="Se almacena en centavos internamente"
            // Se convierte de centavos a pesos para mostrarlo en el campo.
            defaultValue={editing ? editing.basePriceCents / 100 : ''}
            error={errorFor('priceInPesos')}
          />
          <TextField
            label="Duración (minutos)"
            name="durationMinutes"
            type="number"
            required
            min={5}
            max={480}
            step={5}
            defaultValue={editing?.durationMinutes ?? 30}
            error={errorFor('durationMinutes')}
          />
          <TextField
            label="Buffer entre citas (minutos)"
            name="bufferMinutes"
            type="number"
            min={0}
            max={120}
            step={5}
            hint="Bloquea la sala pero no se le cobra al paciente"
            defaultValue={editing?.bufferMinutes ?? 10}
            error={errorFor('bufferMinutes')}
          />
          <CheckboxField
            label="Tratamiento activo"
            name="isActive"
            hint="Los inactivos no aparecen para el bot ni al agendar."
            defaultChecked={editing?.isActive ?? true}
          />
        </form>
      </Modal>
    </>
  );
}
