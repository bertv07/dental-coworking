'use client';

import { useState, useTransition } from 'react';
import type { ScheduleBlock, ScheduleChangeRequest } from '@/backend/domain/types';
import {
  requestScheduleChangeAction,
  reviewScheduleChangeAction,
} from '@/app/actions/admin.actions';
import { Modal } from '@/frontend/components/motion';
import { TextAreaField, FormFooter } from '@/frontend/components/ui/form';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';
import { IconPlus, IconTrash } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Horarios: el odontólogo propone, administración aprueba
 * ===========================================================================
 *  El horario semanal es lo que el bot usa para ofrecer huecos. Por eso no lo
 *  cambia el odontólogo por su cuenta: mover su disponibilidad afecta a las
 *  citas que se van a agendar y a la ocupación de los consultorios.
 *
 *  Se propone la SEMANA ENTERA, no un cambio suelto. Se aprueba o se rechaza
 *  completa — una aprobación parcial dejaría un horario que nadie propuso.
 *
 *  Al aprobar, el horario se APLICA en la misma transacción. Separar las dos
 *  cosas dejaría una solicitud aprobada con el bot ofreciendo todavía las
 *  horas viejas, y nadie mirando la pantalla notaría la diferencia.
 * ===========================================================================
 */

interface ScheduleManagerProps {
  requests: ScheduleChangeRequest[];
  /** Horario vigente de quien mira. Vacío en la vista de administración. */
  currentBlocks: ScheduleBlock[];
  /** `true` = puede aprobar y rechazar. */
  canApprove: boolean;
  /** `true` = puede proponer (es odontólogo con ficha). */
  canPropose: boolean;
}

const DAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
];

const STATUS: Record<
  ScheduleChangeRequest['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' }
> = {
  APPROVED: { label: 'Aprobada', tone: 'success' },
  PENDING: { label: 'Por aprobar', tone: 'warning' },
  REJECTED: { label: 'Rechazada', tone: 'danger' },
};

/** 540 → "09:00". El horario se guarda en minutos desde medianoche. */
function minuteToLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function labelToMinute(label: string): number {
  const [h, m] = label.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Agrupa los bloques por día para poder leerlos de un vistazo. */
function formatWeek(blocks: ScheduleBlock[]): string {
  if (blocks.length === 0) return 'Sin horario definido';

  return DAYS.filter((day) => blocks.some((b) => b.weekday === day.value))
    .map((day) => {
      const horas = blocks
        .filter((b) => b.weekday === day.value)
        .sort((a, b) => a.startMinute - b.startMinute)
        .map((b) => `${minuteToLabel(b.startMinute)}–${minuteToLabel(b.endMinute)}`)
        .join(', ');
      return `${day.label}: ${horas}`;
    })
    .join(' · ');
}

export function ScheduleManager({
  requests,
  currentBlocks,
  canApprove,
  canPropose,
}: ScheduleManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setFormOpen] = useState(false);
  const [rejecting, setRejecting] = useState<ScheduleChangeRequest | null>(null);

  /*
   * Los bloques del formulario se editan en memoria y viajan como JSON en un
   * campo oculto: un formulario HTML no sabe enviar una lista de objetos, y
   * montar `blocks[0][weekday]` sería más frágil que serializar una vez.
   *
   * Arranca con el horario vigente para que proponer un cambio sea editar lo
   * que ya hay, no reescribir la semana desde cero.
   */
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(
    currentBlocks.length > 0
      ? currentBlocks
      : [{ weekday: 1, startMinute: 540, endMinute: 1080 }],
  );

  const pendientes = requests.filter((r) => r.status === 'PENDING');

  function addBlock() {
    setBlocks((prev) => [...prev, { weekday: 1, startMinute: 540, endMinute: 1080 }]);
  }

  function updateBlock(index: number, patch: Partial<ScheduleBlock>) {
    setBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function removeBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await requestScheduleChangeAction({
        proposedBlocks: JSON.stringify(blocks),
        reason: formData.get('reason') ?? '',
      });
      if (result.ok) {
        setFormOpen(false);
        return;
      }
      setError(result.error ?? 'No se pudo enviar la solicitud');
    });
  }

  function approve(request: ScheduleChangeRequest) {
    setError(null);
    startTransition(async () => {
      const result = await reviewScheduleChangeAction({ id: request.id, status: 'APPROVED' });
      if (!result.ok) setError(result.error ?? 'No se pudo aprobar');
    });
  }

  function reject(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await reviewScheduleChangeAction({
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

  return (
    <>
      <div className="row row--between" style={{ marginBottom: '0.25rem' }}>
        <p className="text-sm muted">
          {requests.length === 0
            ? 'Sin solicitudes de cambio.'
            : `${requests.length} ${requests.length === 1 ? 'solicitud' : 'solicitudes'}`}
        </p>
        {canPropose && (
          <button type="button" className="btn btn--primary" onClick={() => setFormOpen(true)}>
            <IconPlus size={16} /> Proponer horario
          </button>
        )}
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {canApprove && pendientes.length > 0 && (
        <Notice tone="warning">
          Hay <strong>{pendientes.length}</strong>{' '}
          {pendientes.length === 1 ? 'solicitud' : 'solicitudes'} esperando. Hasta
          aprobarlas, el bot sigue ofreciendo el horario actual.
        </Notice>
      )}

      {/* El odontólogo ve primero SU horario vigente. */}
      {canPropose && (
        <Card title="Tu horario actual" subtitle="Es el que el bot usa para ofrecer citas">
          <p className="text-sm">{formatWeek(currentBlocks)}</p>
        </Card>
      )}

      {requests.length === 0 ? (
        <Card>
          <EmptyState>
            No hay solicitudes de cambio de horario.
            {canPropose && (
              <>
                <br />
                Si necesitas cambiar tus días u horas, proponlo aquí.
              </>
            )}
          </EmptyState>
        </Card>
      ) : (
        requests.map((request) => (
          <Card
            key={request.id}
            title={canApprove ? request.dentistName : 'Solicitud'}
            subtitle={new Intl.DateTimeFormat('es-VE', {
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/Caracas',
            }).format(request.createdAt)}
            actions={
              <Badge tone={STATUS[request.status].tone}>
                {STATUS[request.status].label}
              </Badge>
            }
          >
            {/*
              Se enseñan los DOS horarios, el de ahora y el propuesto. Sin el
              actual delante, aprobar es decidir a ciegas.
            */}
            <div className="text-sm" style={{ marginBottom: '0.5rem' }}>
              <span className="muted">Ahora: </span>
              {formatWeek(request.currentBlocks)}
            </div>
            <div className="text-sm" style={{ marginBottom: '0.5rem' }}>
              <span className="muted">Propone: </span>
              <strong>{formatWeek(request.proposedBlocks)}</strong>
            </div>

            {request.reason && (
              <p className="text-xs subtle">Motivo: {request.reason}</p>
            )}
            {request.status === 'REJECTED' && request.reviewNotes && (
              <Notice tone="danger">Rechazada: {request.reviewNotes}</Notice>
            )}

            {canApprove && request.status === 'PENDING' && (
              <div className="row" style={{ gap: '0.5rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => approve(request)}
                  disabled={isPending}
                >
                  Aprobar y aplicar
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setRejecting(request)}
                  disabled={isPending}
                >
                  Rechazar
                </button>
              </div>
            )}
          </Card>
        ))
      )}

      {/* --- Proponer semana ------------------------------------------- */}
      <Modal
        open={isFormOpen}
        onClose={() => setFormOpen(false)}
        title="Proponer horario"
        subtitle="La semana completa. Se aprueba o se rechaza entera."
        footer={
          <FormFooter
            isPending={isPending}
            onCancel={() => setFormOpen(false)}
            formId="schedule-form"
            submitLabel="Enviar solicitud"
          />
        }
      >
        <form id="schedule-form" action={submit} className="form-grid">
          <div className="form-grid--full">
            {blocks.map((block, index) => (
              <div
                key={index}
                className="row"
                style={{ gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}
              >
                <select
                  className="select"
                  style={{ width: 'auto' }}
                  value={block.weekday}
                  onChange={(e) => updateBlock(index, { weekday: Number(e.target.value) })}
                  aria-label="Día"
                >
                  {DAYS.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>

                <input
                  type="time"
                  className="input"
                  style={{ width: 'auto' }}
                  value={minuteToLabel(block.startMinute)}
                  onChange={(e) =>
                    updateBlock(index, { startMinute: labelToMinute(e.target.value) })
                  }
                  aria-label="Hora de inicio"
                />
                <span className="muted">a</span>
                <input
                  type="time"
                  className="input"
                  style={{ width: 'auto' }}
                  value={minuteToLabel(block.endMinute)}
                  onChange={(e) =>
                    updateBlock(index, { endMinute: labelToMinute(e.target.value) })
                  }
                  aria-label="Hora de fin"
                />

                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => removeBlock(index)}
                  aria-label="Quitar bloque"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            ))}

            <button type="button" className="btn btn--ghost btn--sm" onClick={addBlock}>
              <IconPlus size={14} /> Añadir bloque
            </button>
          </div>

          <TextAreaField
            label="Motivo"
            name="reason"
            placeholder="Por qué necesitas el cambio…"
          />

          <div className="form-grid--full">
            <Notice tone="info">
              Mientras no se apruebe, el bot sigue ofreciendo tu horario actual. Sólo
              puedes tener una solicitud esperando a la vez.
            </Notice>
          </div>
        </form>
      </Modal>

      {/* --- Rechazo: exige motivo -------------------------------------- */}
      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Rechazar solicitud"
        subtitle={rejecting?.dentistName}
        footer={
          <FormFooter
            isPending={isPending}
            onCancel={() => setRejecting(null)}
            formId="schedule-reject-form"
            submitLabel="Rechazar"
          />
        }
      >
        {rejecting && (
          <form id="schedule-reject-form" action={reject} className="form-grid">
            <input type="hidden" name="id" value={rejecting.id} />
            <TextAreaField
              label="Motivo"
              name="reviewNotes"
              placeholder="Por qué no se puede dar ese horario…"
            />
            <div className="form-grid--full">
              <Notice tone="info">
                El motivo lo lee el odontólogo. Sin él, volverá a pedir lo mismo.
              </Notice>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
