'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Expense } from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import { saveExpenseAction, deleteExpenseAction } from '@/app/actions/expense.actions';
import { Modal } from '@/frontend/components/motion';
import { SelectField, TextField, TextAreaField, FormFooter } from '@/frontend/components/ui/form';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';
import { IconPlus, IconEdit, IconTrash } from '@/frontend/components/ui/icons';

/**
 * Lista y formulario de gastos. Es el mismo componente para la clínica y
 * para una odontóloga: la diferencia —de quién son— la decide el servidor
 * desde la sesión, así que aquí no hay ningún campo para elegirlo.
 */

export const CATEGORIAS_SUGERIDAS_CLINICA = [
  'Luz', 'Agua', 'Internet', 'Condominio', 'Alquiler', 'Publicidad',
  'Limpieza', 'Materiales', 'Nómina', 'Impuestos', 'Mantenimiento', 'Otro',
];
export const CATEGORIAS_SUGERIDAS_ODONTOLOGA = [
  'Materiales', 'Instrumental', 'Laboratorio', 'Cursos', 'Transporte', 'Otro',
];

const RECURRENCIA = { ONE_TIME: 'Pago único', MONTHLY: 'Cada mes' } as const;

function fechaCorta(k: string) {
  return new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${k}T12:00:00Z`));
}

export function ExpensesManager({
  filas,
  categorias,
  tituloPeriodo,
}: {
  /** Los gastos que cuentan en el periodo, con cuántas veces y cuánto suman. */
  filas: Array<{ gasto: Expense; veces: number; totalCents: number }>;
  categorias: string[];
  tituloPeriodo: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<Expense | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [campo, setCampo] = useState<{ field: string; message: string } | null>(null);
  const [recurrencia, setRecurrencia] = useState<'ONE_TIME' | 'MONTHLY'>('ONE_TIME');

  function abrir(g: Expense | null) {
    setEditando(g);
    setRecurrencia(g?.recurrence ?? 'ONE_TIME');
    setError(null);
    setCampo(null);
    setAbierto(true);
  }

  function guardar(fd: FormData) {
    setError(null);
    setCampo(null);
    startTransition(async () => {
      const r = await saveExpenseAction(editando?.id ?? null, Object.fromEntries(fd.entries()));
      if (!r.ok) {
        if (r.field) setCampo({ field: r.field, message: r.error ?? 'Valor inválido' });
        else setError(r.error ?? 'No se pudo guardar');
        return;
      }
      setAbierto(false);
      router.refresh();
    });
  }

  function borrar(g: Expense) {
    if (!window.confirm(`¿Quitar «${g.description}»?`)) return;
    startTransition(async () => {
      const r = await deleteExpenseAction(g.id);
      if (!r.ok) setError(r.error ?? 'No se pudo quitar');
      router.refresh();
    });
  }

  const errorDe = (f: string) => (campo?.field === f ? campo.message : undefined);

  return (
    <>
      <Card
        title="Gastos"
        subtitle={tituloPeriodo}
        flush
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => abrir(null)}>
            <IconPlus size={15} /> Nuevo gasto
          </button>
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}
        {filas.length === 0 ? (
          <EmptyState>
            Sin gastos en este periodo.
            <br />
            Añade lo que se paga —luz, condominio, materiales— y verás lo que queda de verdad.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Categoría</th>
                  <th>Tipo</th>
                  <th>Desde</th>
                  <th className="table__num">Monto</th>
                  <th className="table__num">En el periodo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.map(({ gasto, veces, totalCents }) => (
                  <tr key={gasto.id}>
                    <td data-label="Concepto">
                      <div className="table__strong">{gasto.description}</div>
                      {gasto.notes && <div className="text-xs subtle">{gasto.notes}</div>}
                    </td>
                    <td data-label="Categoría"><Badge tone="neutral">{gasto.category}</Badge></td>
                    <td data-label="Tipo" className="text-xs">
                      {RECURRENCIA[gasto.recurrence]}
                      {gasto.recurrence === 'MONTHLY' && (
                        <div className="subtle">
                          {gasto.endsOn ? `hasta ${fechaCorta(gasto.endsOn)}` : 'sin fin'}
                        </div>
                      )}
                    </td>
                    <td data-label="Desde" className="text-xs mono">{fechaCorta(gasto.startsOn)}</td>
                    <td data-label="Monto" className="table__num mono">{formatCents(gasto.amountCents)}</td>
                    <td data-label="En el periodo" className="table__num mono table__strong">
                      {formatCents(totalCents)}
                      {veces > 1 && <div className="text-xs subtle">×{veces} meses</div>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => abrir(gasto)} aria-label="Editar">
                          <IconEdit size={14} />
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => borrar(gasto)} disabled={isPending} aria-label="Quitar">
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={editando ? 'Editar gasto' : 'Nuevo gasto'}
        subtitle="En dólares. Un gasto mensual cuenta una vez en cada mes que esté vigente."
        footer={
          <FormFooter
            isPending={isPending}
            onCancel={() => setAbierto(false)}
            formId="gasto-form"
            submitLabel={editando ? 'Guardar' : 'Añadir'}
          />
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}
        <form id="gasto-form" action={guardar} className="form-grid" key={editando?.id ?? 'nuevo'}>
          <TextField
            label="Concepto"
            name="description"
            required
            full
            placeholder="Ej: Factura de luz de septiembre"
            defaultValue={editando?.description ?? ''}
            error={errorDe('description')}
          />
          <TextField
            label="Categoría"
            name="category"
            required
            placeholder="Luz, Condominio, Materiales…"
            suggestions={categorias}
            defaultValue={editando?.category ?? ''}
            error={errorDe('category')}
          />
          <TextField
            label="Monto (USD)"
            name="amountUsd"
            type="number"
            required
            min={0}
            step={0.01}
            placeholder="0.00"
            defaultValue={editando ? editando.amountCents / 100 : ''}
            error={errorDe('amountUsd')}
          />
          {/*
            Único o mensual. Se controla en estado para enseñar «hasta» sólo
            cuando tiene sentido: un pago único no tiene fin.
          */}
          <SelectField
            label="Tipo"
            name="recurrence"
            required
            defaultValue={recurrencia}
            onChange={(e) => setRecurrencia(e.target.value as 'ONE_TIME' | 'MONTHLY')}
            options={[
              { value: 'ONE_TIME', label: 'Pago único' },
              { value: 'MONTHLY', label: 'Cada mes (recurrente)' },
            ]}
          />
          <TextField
            label={recurrencia === 'MONTHLY' ? 'Primer mes' : 'Fecha del pago'}
            name="startsOn"
            type="date"
            required
            defaultValue={editando?.startsOn ?? new Date().toISOString().slice(0, 10)}
            error={errorDe('startsOn')}
          />
          {recurrencia === 'MONTHLY' && (
            <TextField
              label="Último mes (opcional)"
              name="endsOn"
              type="date"
              hint="Vacío = sigue vigente cada mes."
              defaultValue={editando?.endsOn ?? ''}
              error={errorDe('endsOn')}
            />
          )}
          <TextAreaField label="Notas" name="notes" placeholder="Opcional" defaultValue={editando?.notes ?? ''} />
        </form>
      </Modal>
    </>
  );
}
