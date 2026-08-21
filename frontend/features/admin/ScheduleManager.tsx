'use client';

import { useState, useTransition } from 'react';
import type { ScheduleBlock, ScheduleChangeRequest } from '@/backend/domain/types';
import {
  requestScheduleChangeAction,
  reviewScheduleChangeAction,
  setBaseScheduleAction,
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
 *  CÓMO FUNCIONA DE VERDAD EN LA CLÍNICA
 *  ---------------------------------------------------------------------
 *   · Recepción pone el horario BASE. Es el que rige mientras nadie diga lo
 *     contrario y el que usa el bot para ofrecer citas.
 *   · El odontólogo pide un cambio PARA UNA SEMANA CONCRETA («esta semana
 *     entro a las 10»). Recepción lo acepta.
 *   · Pasada esa semana se vuelve solo al base: no hay nada que deshacer,
 *     porque el base nunca se tocó.
 *
 *  Se propone la SEMANA ENTERA, no un bloque suelto. Se aprueba o se rechaza
 *  completa — una aprobación parcial dejaría un horario que nadie propuso.
 * ===========================================================================
 */

interface ScheduleManagerProps {
  requests: ScheduleChangeRequest[];
  /** Horario BASE de quien mira. Vacío en la vista de administración. */
  currentBlocks: ScheduleBlock[];
  /** `true` = puede aprobar, rechazar y fijar el horario base. */
  canApprove: boolean;
  /** `true` = puede proponer (es odontólogo con ficha). */
  canPropose: boolean;
  /** Para que recepción elija a quién le fija el base. */
  dentists?: Array<{ id: string; fullName: string }>;
  /** Horario base actual de cada odontólogo, para la vista de recepción. */
  baseByDentist?: Record<string, ScheduleBlock[]>;
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

/** Lunes de la semana que contiene ese día, en 'YYYY-MM-DD'. */
function lunesDe(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  const diaSemana = d.getUTCDay(); // 0 = domingo
  d.setUTCDate(d.getUTCDate() + (diaSemana === 0 ? -6 : 1 - diaSemana));
  return d.toISOString().slice(0, 10);
}

/**
 * Las próximas semanas que se pueden pedir, empezando por la actual.
 *
 * Se acota a ocho: pedir un cambio para dentro de medio año no es un caso
 * real, y una lista larga se vuelve difícil de recorrer.
 */
function semanasDisponibles(cuantas = 8): [
  { value: string; label: string },
  ...Array<{ value: string; label: string }>,
] {
  const hoy = new Date().toISOString().slice(0, 10);
  let lunes = lunesDe(hoy);
  const salida: Array<{ value: string; label: string }> = [];

  for (let i = 0; i < cuantas; i += 1) {
    const inicio = new Date(`${lunes}T12:00:00Z`);
    const fin = new Date(inicio);
    fin.setUTCDate(fin.getUTCDate() + 5);

    const fmt = new Intl.DateTimeFormat('es-VE', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

    salida.push({
      value: lunes,
      label:
        i === 0
          ? `Esta semana (${fmt.format(inicio)} – ${fmt.format(fin)})`
          : `${fmt.format(inicio)} – ${fmt.format(fin)}`,
    });

    const siguiente = new Date(`${lunes}T12:00:00Z`);
    siguiente.setUTCDate(siguiente.getUTCDate() + 7);
    lunes = siguiente.toISOString().slice(0, 10);
  }

  // El tipo dice que siempre hay al menos una: `cuantas` nunca es cero, y así
  // quien la usa no tiene que comprobar si la lista vino vacía.
  return salida as [
    { value: string; label: string },
    ...Array<{ value: string; label: string }>,
  ];
}

export function ScheduleManager({
  requests,
  currentBlocks,
  canApprove,
  canPropose,
  dentists = [],
  baseByDentist = {},
}: ScheduleManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setFormOpen] = useState(false);
  const [rejecting, setRejecting] = useState<ScheduleChangeRequest | null>(null);

  const semanas = semanasDisponibles();
  /** Semana a la que se refiere la propuesta. Por defecto, la actual. */
  const [weekStart, setWeekStart] = useState(semanas[0].value);

  /** Odontólogo cuyo horario base está editando recepción, o `null`. */
  const [editandoBase, setEditandoBase] = useState<string | null>(null);

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
        weekStart,
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

  /** Recepción guarda el horario base de un odontólogo. */
  function guardarBase() {
    if (!editandoBase) return;
    setError(null);
    startTransition(async () => {
      const result = await setBaseScheduleAction(editandoBase, {
        blocks: JSON.stringify(blocks),
      });
      if (result.ok) {
        setEditandoBase(null);
        return;
      }
      setError(result.error ?? 'No se pudo guardar el horario base');
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

      {/* El odontólogo ve primero SU horario base. */}
      {canPropose && (
        <Card
          title="Tu horario habitual"
          subtitle="Lo fija recepción. Es el que el bot usa para ofrecer citas"
        >
          <p className="text-sm">{formatWeek(currentBlocks)}</p>
        </Card>
      )}

      {/*
        Recepción fija el base de cada quien. Va arriba porque es su trabajo
        principal aquí: las solicitudes son la excepción, no la norma.
      */}
      {canApprove && dentists.length > 0 && (
        <Card
          title="Horario habitual del equipo"
          subtitle="El que rige mientras nadie pida un cambio"
          flush
        >
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th>Odontólogo</th>
                  <th>Horario</th>
                  <th style={{ textAlign: 'right' }} />
                </tr>
              </thead>
              <tbody>
                {dentists.map((dentist) => (
                  <tr key={dentist.id}>
                    <td data-label="Odontólogo">
                      <div className="table__strong">{dentist.fullName}</div>
                    </td>
                    <td className="text-sm muted" data-label="Horario">
                      {formatWeek(baseByDentist[dentist.id] ?? [])}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          const base = baseByDentist[dentist.id] ?? [];
                          setBlocks(
                            base.length > 0
                              ? base
                              : [{ weekday: 1, startMinute: 540, endMinute: 1080 }],
                          );
                          setEditandoBase(dentist.id);
                        }}
                      >
                        Fijar horario
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            subtitle={`Semana del ${new Intl.DateTimeFormat('es-VE', {
              day: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            }).format(new Date(`${request.weekStart}T12:00:00Z`))}`}
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
              <span className="muted">Su horario habitual: </span>
              {formatWeek(request.currentBlocks)}
            </div>
            <div className="text-sm" style={{ marginBottom: '0.5rem' }}>
              <span className="muted">Pide, sólo esa semana: </span>
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
                  Aprobar para esa semana
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
          {/*
            De qué semana se habla. Es lo primero porque cambia el significado
            de todo lo de abajo: los mismos bloques para otra semana son otra
            solicitud distinta.
          */}
          <div className="field form-grid--full">
            <label className="field__label" htmlFor="weekStart">
              Semana
            </label>
            <select
              id="weekStart"
              className="select"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
            >
              {semanas.map((semana) => (
                <option key={semana.value} value={semana.value}>
                  {semana.label}
                </option>
              ))}
            </select>
            <span className="field__hint">
              El cambio vale sólo para esa semana. Después vuelves a tu horario
              habitual sin hacer nada.
            </span>
          </div>

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
              Mientras no se apruebe, el bot sigue ofreciendo tu horario habitual.
              Puedes tener una solicitud esperando por cada semana.
            </Notice>
          </div>
        </form>
      </Modal>

      {/* --- Recepción fija el horario base ------------------------------ */}
      <Modal
        open={editandoBase !== null}
        onClose={() => setEditandoBase(null)}
        title="Horario habitual"
        subtitle={dentists.find((d) => d.id === editandoBase)?.fullName}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setEditandoBase(null)}
              disabled={isPending}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={guardarBase}
              disabled={isPending}
            >
              {isPending ? 'Guardando…' : 'Guardar horario'}
            </button>
          </>
        }
      >
        <div className="form-grid">
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

          <div className="form-grid--full">
            <Notice tone="info">
              Este es el horario de siempre. Los cambios de una semana suelta se
              piden aparte y no lo tocan.
            </Notice>
          </div>
        </div>
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
