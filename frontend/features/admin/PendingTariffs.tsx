'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewDentistTariffAction } from '@/app/actions/admin.actions';
import { formatCents } from '@/backend/domain/money';
import { Card, Notice, EmptyState, Badge } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Tarifas esperando aprobación — la bandeja de recepción
 * ===========================================================================
 *  Una odontóloga propone cobrar $60 por algo que en lista está a $45. Hasta
 *  que alguien lo apruebe, el mostrador sigue facturando $45: la propuesta no
 *  hace nada por sí sola.
 *
 *  Antes eso sólo se podía revisar desde la pantalla de administración, y las
 *  propuestas se quedaban ahí sin que nadie se enterara. Esta bandeja es la
 *  misma decisión puesta donde se nota: al lado de quien cotiza.
 *
 *  ⚠️  NO se enseña el reparto. Cuánto de ese precio se queda la clínica es
 *   una negociación entre ella y el odontólogo, y el dato ni siquiera llega
 *   al navegador: la página lo recorta campo a campo antes de pasarlo.
 * ===========================================================================
 */

export interface PendingTariff {
  id: string;
  dentistName: string;
  treatmentName: string;
  /** Lo que cuesta ese tratamiento en la lista general. */
  listPriceCents: number;
  /** Lo que propone cobrar el odontólogo. `null` = sólo cambia el reparto. */
  proposedPriceCents: number | null;
  /** Notas de una revisión anterior: por qué se rechazó la vez pasada. */
  notes: string | null;
}

export function PendingTariffs({ tariffs }: { tariffs: PendingTariff[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Qué fila se está resolviendo: para deshabilitar sólo sus botones y no
  // los de toda la lista.
  const [enCurso, setEnCurso] = useState<string | null>(null);
  // Motivo del rechazo, por fila. Rechazar sin decir por qué deja a la
  // odontóloga sin saber qué corregir.
  const [motivos, setMotivos] = useState<Record<string, string>>({});

  function resolver(id: string, status: 'APPROVED' | 'REJECTED') {
    setError(null);
    setEnCurso(id);
    startTransition(async () => {
      const r = await reviewDentistTariffAction({
        id,
        status,
        reviewNotes: motivos[id]?.trim() || undefined,
      });
      setEnCurso(null);
      if (!r.ok) {
        setError(r.error ?? 'No se pudo registrar la decisión');
        return;
      }
      router.refresh();
    });
  }

  if (tariffs.length === 0) {
    return (
      <Card title="Tarifas por aprobar" subtitle="Propuestas de los odontólogos">
        <EmptyState>No hay ninguna propuesta pendiente.</EmptyState>
      </Card>
    );
  }

  return (
    <Card
      title="Tarifas por aprobar"
      subtitle={`${tariffs.length} propuesta${tariffs.length === 1 ? '' : 's'} esperando`}
    >
      {error && <Notice tone="danger">{error}</Notice>}

      <Notice tone="warning">
        Hasta que las apruebes se sigue facturando el precio de lista. Si dudas de
        alguna, recházala con un motivo y habla con el odontólogo.
      </Notice>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Odontólogo</th>
              <th>Tratamiento</th>
              <th className="table__num">Lista</th>
              <th className="table__num">Propone</th>
              <th>Motivo del rechazo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tariffs.map((t) => {
              const ocupada = isPending && enCurso === t.id;
              return (
                <tr key={t.id}>
                  <td className="table__strong">{t.dentistName}</td>
                  <td>
                    {t.treatmentName}
                    {t.notes && <div className="muted text-sm">{t.notes}</div>}
                  </td>
                  <td className="table__num mono">{formatCents(t.listPriceCents)}</td>
                  <td className="table__num mono">
                    {t.proposedPriceCents === null ? (
                      <Badge>Sin cambio de precio</Badge>
                    ) : (
                      <strong>{formatCents(t.proposedPriceCents)}</strong>
                    )}
                  </td>
                  <td>
                    <input
                      type="text"
                      className="input"
                      placeholder="Sólo si rechazas"
                      value={motivos[t.id] ?? ''}
                      onChange={(e) =>
                        setMotivos((prev) => ({ ...prev, [t.id]: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => resolver(t.id, 'APPROVED')}
                        disabled={ocupada}
                      >
                        {ocupada ? '…' : 'Aprobar'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => resolver(t.id, 'REJECTED')}
                        disabled={ocupada}
                      >
                        Rechazar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
