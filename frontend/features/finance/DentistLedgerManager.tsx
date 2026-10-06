'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { DentistLedgerEntry } from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import { saveDentistLedgerEntryAction, deleteDentistLedgerEntryAction } from '@/app/actions/admin-ledger.actions';
import { Modal } from '@/frontend/components/motion';
import { TextField, TextAreaField, FormFooter } from '@/frontend/components/ui/form';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';
import { IconPlus, IconEdit, IconTrash } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  El libro de una odontóloga: presupuesto, abono y reparto por consulta
 * ===========================================================================
 *  En la hoja de cálculo original el reparto vivía en CUATRO columnas fijas
 *  —40 %, 50 % de ella; 50 %, 60 % de la clínica— porque sólo se usaban esos
 *  dos repartos. Aquí es un solo campo, «% que se queda ella», con el mismo
 *  dato exacto (qué porcentaje se aplicó en ESA fila) sin dar por sentado
 *  que nunca aparecerá un tercer reparto.
 * ===========================================================================
 */

function fechaCorta(k: string) {
  return new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${k}T12:00:00Z`));
}

export function DentistLedgerManager({
  dentistId,
  dentistName,
  filas,
  pacientes,
}: {
  dentistId: string;
  dentistName: string;
  filas: DentistLedgerEntry[];
  /** Sus pacientes registrados: con cita o factura con ella, o que la prefieren. */
  pacientes: Array<{ id: string; fullName: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<DentistLedgerEntry | null>(null);
  const [esCortesia, setEsCortesia] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campo, setCampo] = useState<{ field: string; message: string } | null>(null);

  const totalPresupuesto = filas.reduce((s, f) => s + f.budgetCents, 0);
  const totalDoctora = filas.reduce((s, f) => s + f.dentistShareCents, 0);
  const totalClinica = filas.reduce((s, f) => s + f.clinicShareCents, 0);

  function abrir(f: DentistLedgerEntry | null) {
    setEditando(f);
    setEsCortesia(f ? f.budgetCents === 0 : false);
    setError(null);
    setCampo(null);
    setAbierto(true);
  }

  function guardar(fd: FormData) {
    setError(null);
    setCampo(null);
    fd.set('dentistId', dentistId);
    if (esCortesia) {
      fd.set('budgetUsd', '0');
      fd.set('depositUsd', '0');
      fd.set('dentistPercent', '');
    }
    startTransition(async () => {
      const r = await saveDentistLedgerEntryAction(editando?.id ?? null, Object.fromEntries(fd.entries()));
      if (!r.ok) {
        if (r.field) setCampo({ field: r.field, message: r.error ?? 'Valor inválido' });
        else setError(r.error ?? 'No se pudo guardar');
        return;
      }
      setAbierto(false);
      router.refresh();
    });
  }

  function borrar(f: DentistLedgerEntry) {
    const aviso = f.sourcePaymentId
      ? `Esta fila nació de un cobro real. Quitarla NO deshace el cobro ni afecta Caja — sólo borra la anotación de este libro. ¿Seguir?`
      : `¿Quitar la fila de «${f.patientName}»?`;
    if (!window.confirm(aviso)) return;
    startTransition(async () => {
      const r = await deleteDentistLedgerEntryAction(f.id);
      if (!r.ok) setError(r.error ?? 'No se pudo quitar');
      router.refresh();
    });
  }

  const errorDe = (f: string) => (campo?.field === f ? campo.message : undefined);

  return (
    <>
      <Card
        title={dentistName}
        subtitle="Presupuesto, abono y reparto por consulta"
        flush
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => abrir(null)}>
            <IconPlus size={15} /> Nueva consulta
          </button>
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}
        {filas.length === 0 ? (
          <EmptyState>Sin consultas en este periodo.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Paciente</th>
                  <th className="table__num">Presupuesto</th>
                  <th className="table__num">Abono</th>
                  <th className="table__num">% Doctora</th>
                  <th className="table__num">Doctora</th>
                  <th className="table__num">Clínica</th>
                  <th>Información</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const cortesia = f.budgetCents === 0;
                  return (
                    <tr key={f.id}>
                      <td className="mono text-xs" data-label="Fecha">{fechaCorta(f.date)}</td>
                      <td data-label="Paciente">
                        <span className="table__strong">{f.patientName}</span>
                        {f.sourcePaymentId && (
                          <span title="Nació de un cobro real; se borra sola si el cobro se reversa.">
                            <Badge tone="neutral">Auto</Badge>
                          </span>
                        )}
                      </td>
                      <td className="table__num mono" data-label="Presupuesto">{cortesia ? <Badge tone="neutral">Cortesía</Badge> : formatCents(f.budgetCents)}</td>
                      <td className="table__num mono" data-label="Abono">{f.depositCents > 0 ? formatCents(f.depositCents) : '—'}</td>
                      <td className="table__num mono text-xs" data-label="% Doctora">{cortesia ? '—' : `${f.dentistPercent}%`}</td>
                      <td className="table__num mono" data-label="Doctora">{formatCents(f.dentistShareCents)}</td>
                      <td className="table__num mono" data-label="Clínica">{formatCents(f.clinicShareCents)}</td>
                      <td className="text-xs subtle" data-label="Información">{f.notes ?? ''}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => abrir(f)} aria-label="Editar">
                            <IconEdit size={14} />
                          </button>
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => borrar(f)} disabled={isPending} aria-label="Quitar">
                            <IconTrash size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ fontWeight: 700, textAlign: 'right' }}>Totales</td>
                  <td className="table__num mono" style={{ fontWeight: 700 }}>{formatCents(totalPresupuesto)}</td>
                  <td /><td />
                  <td className="table__num mono" style={{ fontWeight: 700 }}>{formatCents(totalDoctora)}</td>
                  <td className="table__num mono" style={{ fontWeight: 700 }}>{formatCents(totalClinica)}</td>
                  <td /><td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={editando ? 'Editar consulta' : 'Nueva consulta'}
        subtitle={dentistName}
        footer={<FormFooter isPending={isPending} onCancel={() => setAbierto(false)} formId="dentist-ledger-form" submitLabel={editando ? 'Guardar' : 'Añadir'} />}
      >
        {error && <Notice tone="danger">{error}</Notice>}
        <form id="dentist-ledger-form" action={guardar} className="form-grid" key={editando?.id ?? 'nuevo'}>
          <TextField
            label="Paciente"
            name="patientName"
            required
            full
            // Al escribir se ofrecen sus pacientes, pero se puede poner
            // cualquier nombre: el libro también lleva gente que no está
            // registrada en el sistema.
            suggestions={pacientes.map((p) => p.fullName)}
            hint={pacientes.length > 0 ? 'Empieza a escribir y elige de sus pacientes, o pon otro nombre.' : undefined}
            defaultValue={editando?.patientName ?? ''}
            error={errorDe('patientName')}
          />
          <TextField label="Fecha" name="date" type="date" required defaultValue={editando?.date ?? new Date().toISOString().slice(0, 10)} error={errorDe('date')} />

          {/* Checkbox controlado a mano: sólo decide qué campos se muestran,
              no viaja al servidor —por eso no usa el `name` del esquema. */}
          <label className="field form-grid--full" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={esCortesia}
              onChange={(e) => setEsCortesia(e.target.checked)}
            />
            <span>Paciente de cortesía (sin cobro)</span>
          </label>

          {!esCortesia && (
            <>
              <TextField label="Presupuesto total (USD)" name="budgetUsd" type="number" min={0} step={0.01} required={!esCortesia} defaultValue={editando ? editando.budgetCents / 100 : ''} error={errorDe('budgetUsd')} />
              <TextField label="Abono (USD, opcional)" name="depositUsd" type="number" min={0} step={0.01} defaultValue={editando && editando.depositCents > 0 ? editando.depositCents / 100 : ''} error={errorDe('depositUsd')} />
              <TextField
                label="% que se queda la doctora"
                name="dentistPercent"
                type="number"
                min={0}
                max={100}
                step={1}
                required={!esCortesia}
                hint="El resto queda para la clínica."
                defaultValue={editando && editando.budgetCents > 0 ? editando.dentistPercent : ''}
                error={errorDe('dentistPercent')}
              />
            </>
          )}
          <TextAreaField label="Información" name="notes" full placeholder="Opcional" defaultValue={editando?.notes ?? ''} />
        </form>
      </Modal>
    </>
  );
}
