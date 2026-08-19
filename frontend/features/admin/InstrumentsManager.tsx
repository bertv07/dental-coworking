'use client';

import { useState, useTransition } from 'react';
import type { Dentist, DentistInstrument } from '@/backend/domain/types';
import {
  saveInstrumentAction,
  deleteInstrumentAction,
} from '@/app/actions/admin.actions';
import { Modal, MotionRow, AnimatePresence } from '@/frontend/components/motion';
import {
  SelectField,
  TextField,
  TextAreaField,
  FormFooter,
} from '@/frontend/components/ui/form';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';
import { IconPlus, IconEdit, IconTrash } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Instrumental del odontólogo
 * ===========================================================================
 *  «Cada odontólogo tenga su inventario» — y son SUS instrumentos: el fórceps,
 *  la turbina, la cureta que trajo él y que se lleva si se va.
 *
 *  NO es un almacén de insumos que se descuenta al usarlo. Aquí no hay
 *  consumo: hay una lista de bienes con dueño. Un coworking lo necesita justo
 *  por eso — el instrumental es de cada quien pero convive en salas
 *  compartidas, y cuando algo se pierde o aparece roto hay que saber de quién
 *  era.
 *
 *  Dos vistas, como en `/tarifas`: el odontólogo ve y edita lo suyo; el
 *  administrador ve el de todos y elige de quién es lo que da de alta.
 * ===========================================================================
 */

interface InstrumentsManagerProps {
  instruments: DentistInstrument[];
  /** Vacío en la vista del odontólogo: no elige dueño, es él. */
  dentists: Dentist[];
  /** `true` = administración: ve y gestiona el de todos. */
  isAdmin: boolean;
  /** Nombre por odontólogo, para la columna de dueño. */
  dentistNames: Record<string, string>;
}

const CONDITION: Record<
  DentistInstrument['condition'],
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  GOOD: { label: 'En buen estado', tone: 'success' },
  NEEDS_SERVICE: { label: 'Necesita servicio', tone: 'warning' },
  OUT_OF_SERVICE: { label: 'Fuera de servicio', tone: 'danger' },
  LOST: { label: 'Extraviado', tone: 'danger' },
};

/** 'YYYY-MM-DD' para `<input type="date">`, en hora de la clínica. */
function toDateInput(date: Date | null): string {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(date);
}

export function InstrumentsManager({
  instruments,
  dentists,
  isAdmin,
  dentistNames,
}: InstrumentsManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(
    null,
  );
  /** `null` = cerrado; `'new'` = alta; un objeto = edición. */
  const [editing, setEditing] = useState<DentistInstrument | 'new' | null>(null);

  const item = editing === 'new' ? null : editing;

  function submit(formData: FormData) {
    setError(null);
    setFieldError(null);
    const entries = Object.fromEntries(formData.entries());
    const dentistId = isAdmin ? String(entries.dentistId ?? '') : null;

    startTransition(async () => {
      const result = await saveInstrumentAction(item?.id ?? null, dentistId, entries);
      if (result.ok) {
        setEditing(null);
        return;
      }
      if (result.field) {
        setFieldError({ field: result.field, message: result.error ?? 'Valor inválido' });
        return;
      }
      setError(result.error ?? 'No se pudo guardar');
    });
  }

  function remove(instrument: DentistInstrument) {
    if (!window.confirm(`¿Quitar "${instrument.name}" del inventario?`)) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteInstrumentAction(instrument.id);
      if (!result.ok) setError(result.error ?? 'No se pudo quitar');
    });
  }

  const errorFor = (field: string) =>
    fieldError?.field === field ? fieldError.message : undefined;

  // Agrupado por categoría: una lista plana de 60 piezas no se recorre.
  const byCategory = new Map<string, DentistInstrument[]>();
  for (const instrument of instruments) {
    const key = instrument.category ?? 'Sin categoría';
    byCategory.set(key, [...(byCategory.get(key) ?? []), instrument]);
  }

  // Lo que necesita atención: se avisa arriba en vez de obligar a recorrer.
  const requierenAtencion = instruments.filter(
    (instrument) => instrument.condition !== 'GOOD',
  );

  return (
    <>
      <div className="row row--between" style={{ marginBottom: '0.25rem' }}>
        <p className="text-sm muted">
          {instruments.length === 0
            ? 'Sin instrumental registrado.'
            : `${instruments.length} ${instruments.length === 1 ? 'pieza' : 'piezas'}`}
        </p>
        <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
          <IconPlus size={16} /> Añadir instrumento
        </button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {requierenAtencion.length > 0 && (
        <Notice tone="warning">
          <strong>{requierenAtencion.length}</strong>{' '}
          {requierenAtencion.length === 1 ? 'pieza necesita' : 'piezas necesitan'} atención:{' '}
          {requierenAtencion
            .slice(0, 3)
            .map((instrument) => instrument.name)
            .join(', ')}
          {requierenAtencion.length > 3 && '…'}
        </Notice>
      )}

      {instruments.length === 0 ? (
        <Card>
          <EmptyState>
            Todavía no hay instrumental registrado.
            <br />
            Sirve para saber de quién es cada pieza cuando algo se pierde o aparece roto.
          </EmptyState>
        </Card>
      ) : (
        [...byCategory.entries()].map(([category, items]) => (
          <Card key={category} title={category} subtitle={`${items.length} piezas`} flush>
            <div className="table-wrap">
              <table className="table table--cards">
                <thead>
                  <tr>
                    <th>Instrumento</th>
                    {isAdmin && <th>Dueño</th>}
                    <th className="table__num">Cantidad</th>
                    <th>Estado</th>
                    <th>Ubicación</th>
                    <th>Último servicio</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {items.map((instrument, index) => (
                      <MotionRow key={instrument.id} index={index}>
                        <td data-label="Instrumento">
                          <div className="table__strong">{instrument.name}</div>
                          {instrument.serialNumber && (
                            <div className="text-xs subtle mono">
                              Serie: {instrument.serialNumber}
                            </div>
                          )}
                          {instrument.notes && (
                            <div className="text-xs subtle">{instrument.notes}</div>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="muted" data-label="Dueño">
                            {dentistNames[instrument.dentistId] ?? '—'}
                          </td>
                        )}
                        <td className="table__num mono" data-label="Cantidad">
                          {instrument.quantity}
                        </td>
                        <td data-label="Estado">
                          <Badge tone={CONDITION[instrument.condition].tone}>
                            {CONDITION[instrument.condition].label}
                          </Badge>
                        </td>
                        <td className="muted text-xs" data-label="Ubicación">
                          {instrument.location ?? '—'}
                        </td>
                        <td className="muted text-xs mono" data-label="Último servicio">
                          {instrument.lastServicedOn
                            ? toDateInput(instrument.lastServicedOn)
                            : '—'}
                        </td>
                        <td data-label="Acciones">
                          <div className="table__actions">
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => setEditing(instrument)}
                              aria-label={`Editar ${instrument.name}`}
                            >
                              <IconEdit size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => remove(instrument)}
                              disabled={isPending}
                              aria-label={`Quitar ${instrument.name}`}
                            >
                              <IconTrash size={14} />
                            </button>
                          </div>
                        </td>
                      </MotionRow>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={item ? 'Editar instrumento' : 'Añadir instrumento'}
        subtitle={item?.name ?? 'Una pieza del instrumental'}
        footer={
          <FormFooter
            isPending={isPending}
            onCancel={() => setEditing(null)}
            formId="instrument-form"
          />
        }
      >
        <form
          id="instrument-form"
          action={submit}
          className="form-grid"
          key={item?.id ?? 'new'}
        >
          {/*
            El dueño sólo lo elige la administración. Al odontólogo ni se le
            pinta: el servidor lo resuelve desde su sesión.
          */}
          {isAdmin && (
            <SelectField
              label="Dueño"
              name="dentistId"
              required
              full
              defaultValue={item?.dentistId}
              options={dentists
                .filter((dentist) => dentist.isActive)
                .map((dentist) => ({ value: dentist.id, label: dentist.fullName }))}
            />
          )}

          <TextField
            label="Instrumento"
            name="name"
            required
            placeholder="Turbina, fórceps 151, cureta Gracey…"
            defaultValue={item?.name}
            error={errorFor('name')}
          />

          <TextField
            label="Categoría"
            name="category"
            placeholder="ROTATORIO, CIRUGÍA, ORTODONCIA…"
            hint="Sólo agrupa la lista. Libre."
            defaultValue={item?.category ?? ''}
            error={errorFor('category')}
          />

          <TextField
            label="Cantidad"
            name="quantity"
            type="number"
            min={0}
            defaultValue={item?.quantity ?? 1}
            error={errorFor('quantity')}
          />

          <TextField
            label="Número de serie"
            name="serialNumber"
            placeholder="Opcional"
            hint="Distingue tu pieza de otras iguales en la clínica."
            defaultValue={item?.serialNumber ?? ''}
            error={errorFor('serialNumber')}
          />

          <SelectField
            label="Estado"
            name="condition"
            defaultValue={item?.condition ?? 'GOOD'}
            options={[
              { value: 'GOOD', label: 'En buen estado' },
              { value: 'NEEDS_SERVICE', label: 'Necesita servicio' },
              { value: 'OUT_OF_SERVICE', label: 'Fuera de servicio' },
              { value: 'LOST', label: 'Extraviado' },
            ]}
          />

          <TextField
            label="Ubicación"
            name="location"
            placeholder="Maletín, Consultorio 2, casillero…"
            defaultValue={item?.location ?? ''}
            error={errorFor('location')}
          />

          <TextField
            label="Último servicio"
            name="lastServicedOn"
            type="date"
            hint="Cuándo se mandó a mantenimiento por última vez."
            defaultValue={toDateInput(item?.lastServicedOn ?? null)}
            error={errorFor('lastServicedOn')}
          />

          <TextAreaField
            label="Notas"
            name="notes"
            placeholder="Detalles, marca, quién lo reparó…"
            defaultValue={item?.notes ?? ''}
          />
        </form>
      </Modal>
    </>
  );
}
