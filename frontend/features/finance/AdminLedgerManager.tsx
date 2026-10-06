'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminLedgerEntry } from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import { saveAdminLedgerEntryAction, deleteAdminLedgerEntryAction } from '@/app/actions/admin-ledger.actions';
import { Modal } from '@/frontend/components/motion';
import { TextField, TextAreaField, FormFooter } from '@/frontend/components/ui/form';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';
import { IconPlus, IconEdit, IconTrash } from '@/frontend/components/ui/icons';

/**
 * Gastos Administrativos y Caja Chica: misma forma de fila (fecha,
 * descripción, ingreso O egreso, nota), así que un solo componente sirve
 * para las dos pestañas — el `book` que se le pasa decide en cuál se
 * guarda.
 */

function fechaCorta(k: string) {
  return new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${k}T12:00:00Z`));
}

export function AdminLedgerManager({
  book,
  filas,
  saldoLabel,
}: {
  book: 'GASTOS_ADMIN' | 'CAJA_CHICA';
  filas: AdminLedgerEntry[];
  /** "Total General" en Gastos, "Saldo" en Caja Chica: mismo cálculo, otro nombre. */
  saldoLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<AdminLedgerEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [campo, setCampo] = useState<{ field: string; message: string } | null>(null);

  const totalIngreso = filas.reduce((s, f) => s + f.incomeCents, 0);
  const totalEgreso = filas.reduce((s, f) => s + f.expenseCents, 0);
  const saldo = totalIngreso - totalEgreso;

  function abrir(f: AdminLedgerEntry | null) {
    setEditando(f);
    setError(null);
    setCampo(null);
    setAbierto(true);
  }

  function guardar(fd: FormData) {
    setError(null);
    setCampo(null);
    fd.set('book', book);
    startTransition(async () => {
      const r = await saveAdminLedgerEntryAction(editando?.id ?? null, Object.fromEntries(fd.entries()));
      if (!r.ok) {
        if (r.field) setCampo({ field: r.field, message: r.error ?? 'Valor inválido' });
        else setError(r.error ?? 'No se pudo guardar');
        return;
      }
      setAbierto(false);
      router.refresh();
    });
  }

  function borrar(f: AdminLedgerEntry) {
    const aviso = f.sourcePaymentId
      ? `Esta fila nació de un cobro real. Quitarla NO deshace el cobro ni afecta Caja — sólo borra la anotación de este libro. ¿Seguir?`
      : `¿Quitar «${f.description}»?`;
    if (!window.confirm(aviso)) return;
    startTransition(async () => {
      const r = await deleteAdminLedgerEntryAction(f.id);
      if (!r.ok) setError(r.error ?? 'No se pudo quitar');
      router.refresh();
    });
  }

  const errorDe = (f: string) => (campo?.field === f ? campo.message : undefined);

  return (
    <>
      <Card
        flush
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => abrir(null)}>
            <IconPlus size={15} /> Nueva fila
          </button>
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}
        {filas.length === 0 ? (
          <EmptyState>Sin filas todavía. Añade la primera.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Descripción</th>
                  <th className="table__num">Ingreso</th>
                  <th className="table__num">Egreso</th>
                  <th>Información</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td className="mono text-xs" data-label="Fecha">{fechaCorta(f.date)}</td>
                    <td data-label="Descripción">
                      <span className="table__strong">{f.description}</span>
                      {f.sourcePaymentId && (
                        <span title="Nació de un cobro real; se borra sola si el cobro se reversa.">
                          <Badge tone="neutral">Auto</Badge>
                        </span>
                      )}
                    </td>
                    <td className="table__num mono" data-label="Ingreso" style={{ color: f.incomeCents > 0 ? 'var(--color-success)' : undefined }}>
                      {f.incomeCents > 0 ? formatCents(f.incomeCents) : '—'}
                    </td>
                    <td className="table__num mono" data-label="Egreso" style={{ color: f.expenseCents > 0 ? 'var(--color-danger)' : undefined }}>
                      {f.expenseCents > 0 ? formatCents(f.expenseCents) : '—'}
                    </td>
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
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ fontWeight: 700, textAlign: 'right' }}>Totales</td>
                  <td className="table__num mono" style={{ fontWeight: 700 }}>{formatCents(totalIngreso)}</td>
                  <td className="table__num mono" style={{ fontWeight: 700 }}>{formatCents(totalEgreso)}</td>
                  <td />
                  <td />
                </tr>
                <tr>
                  <td colSpan={2} style={{ fontWeight: 700, textAlign: 'right' }}>{saldoLabel}</td>
                  <td colSpan={2} className="table__num mono" style={{ fontWeight: 700, color: saldo < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                    {formatCents(saldo)}
                  </td>
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
        title={editando ? 'Editar fila' : 'Nueva fila'}
        subtitle="Pon un ingreso o un egreso, no los dos."
        footer={
          <FormFooter isPending={isPending} onCancel={() => setAbierto(false)} formId="ledger-form" submitLabel={editando ? 'Guardar' : 'Añadir'} />
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}
        <form id="ledger-form" action={guardar} className="form-grid" key={editando?.id ?? 'nuevo'}>
          <TextField
            label="Descripción"
            name="description"
            required
            full
            placeholder="Ej: Propaganda Facebook"
            defaultValue={editando?.description ?? ''}
            error={errorDe('description')}
          />
          <TextField label="Fecha" name="date" type="date" required defaultValue={editando?.date ?? new Date().toISOString().slice(0, 10)} error={errorDe('date')} />
          <TextField label="Ingreso (USD)" name="incomeUsd" type="number" min={0} step={0.01} placeholder="0.00" defaultValue={editando ? editando.incomeCents / 100 : ''} error={errorDe('incomeUsd')} />
          <TextField label="Egreso (USD)" name="expenseUsd" type="number" min={0} step={0.01} placeholder="0.00" defaultValue={editando ? editando.expenseCents / 100 : ''} error={errorDe('expenseUsd')} />
          <TextAreaField label="Información" name="notes" placeholder="Opcional" defaultValue={editando?.notes ?? ''} />
        </form>
      </Modal>
    </>
  );
}
