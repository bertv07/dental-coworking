'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PeriodClosing } from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import { closePeriodAction, reopenPeriodAction } from '@/app/actions/period-closing.actions';
import { Badge, Card, Notice } from '@/frontend/components/ui/primitives';

/**
 * El botón de cerrar el mes o el año, y el registro de cuándo se cerró.
 *
 * Cerrar guarda la foto; no bloquea el libro. Si después se corrige una
 * fila, aquí se ve que lo de hoy ya no coincide con lo cerrado y se puede
 * volver a cerrar para actualizarla.
 */

const fechaHora = new Intl.DateTimeFormat('es-VE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'America/Caracas',
});

export function ClosePeriodPanel({
  period,
  nombre,
  closing,
  totalHoyCents,
  enCurso,
}: {
  period: string;
  /** «septiembre de 2026», «el año 2026». */
  nombre: string;
  closing: PeriodClosing | null;
  /** Lo que da el libro AHORA, para compararlo con lo cerrado. */
  totalHoyCents: number;
  /** El periodo todavía no ha terminado. */
  enCurso: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState('');

  const totalCerrado = closing ? closing.incomeCents - closing.expenseCents : 0;
  const cambio = closing !== null && totalCerrado !== totalHoyCents;

  function cerrar() {
    const aviso =
      (closing ? `¿Volver a cerrar ${nombre} con los números de hoy?` : `¿Cerrar ${nombre}?`) +
      `\n\nSe guarda que se ganó ${formatCents(totalHoyCents)}.` +
      (enCurso ? '\n\nOjo: este periodo todavía no ha terminado; lo que entre después no estará en el cierre.' : '');
    if (!window.confirm(aviso)) return;
    setError(null);
    startTransition(async () => {
      const r = await closePeriodAction(period, nota);
      if (!r.ok) setError(r.error ?? 'No se pudo cerrar');
      else setNota('');
      router.refresh();
    });
  }

  function reabrir() {
    if (!window.confirm(`¿Quitar el cierre de ${nombre}? El libro no cambia; sólo se borra el registro del cierre.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await reopenPeriodAction(period);
      if (!r.ok) setError(r.error ?? 'No se pudo reabrir');
      router.refresh();
    });
  }

  return (
    <Card
      title={`Cierre de ${nombre}`}
      subtitle={
        closing
          ? `Cerrado el ${fechaHora.format(new Date(closing.closedAt))} por ${closing.closedByName}`
          : 'Todavía sin cerrar'
      }
      actions={closing ? <Badge tone="success">Cerrado</Badge> : <Badge tone="warning">Abierto</Badge>}
    >
      {error && <Notice tone="danger">{error}</Notice>}

      {closing && (
        <p className="text-sm" style={{ marginBottom: '0.75rem' }}>
          Al cerrar se ganó <strong>{formatCents(totalCerrado)}</strong> (ingresos {formatCents(closing.incomeCents)},
          egresos {formatCents(closing.expenseCents)}).
          {closing.notes && <span className="subtle"> Nota: {closing.notes}</span>}
        </p>
      )}

      {cambio && (
        <Notice tone="warning">
          El libro cambió después del cierre: hoy da <strong>{formatCents(totalHoyCents)}</strong>. Vuelve a cerrar
          para guardar los números de hoy.
        </Notice>
      )}

      {(!closing || cambio) && (
        <div className="row row--wrap" style={{ gap: '0.5rem', marginTop: '0.75rem' }}>
          <input
            className="input"
            style={{ flex: '1 1 16rem' }}
            placeholder="Nota del cierre (opcional)"
            value={nota}
            maxLength={300}
            onChange={(e) => setNota(e.target.value)}
            aria-label="Nota del cierre"
          />
          <button type="button" className="btn btn--primary" onClick={cerrar} disabled={isPending}>
            {isPending ? 'Guardando…' : closing ? 'Volver a cerrar' : `Cerrar ${period.length === 4 ? 'el año' : 'el mes'}`}
          </button>
        </div>
      )}

      {closing && (
        <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: '0.75rem' }} onClick={reabrir} disabled={isPending}>
          Quitar el cierre
        </button>
      )}
    </Card>
  );
}
