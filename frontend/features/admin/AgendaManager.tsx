'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type {
  AppointmentWithRelations,
  Dentist,
  Patient,
  PaymentMethodOption,
  Room,
  Treatment,
} from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import { totalCitaCents } from '@/backend/domain/pricing';
import {
  createAppointmentAction,
  updateAppointmentAction,
  setAppointmentStatusAction,
} from '@/app/actions/admin.actions';
import { openInvoiceAction } from '@/app/actions/invoice.actions';
import { Modal, MotionRow, AnimatePresence } from '@/frontend/components/motion';
import {
  useCrud,
  SelectField,
  TextField,
  TextAreaField,
  FormFooter,
} from '@/frontend/components/ui/form';
import {
  Card,
  Badge,
  EmptyState,
  Notice,
  AppointmentStatusBadge,
  SourceBadge,
} from '@/frontend/components/ui/primitives';
import { IconEdit, IconPlus, IconCurrency, IconTooth } from '@/frontend/components/ui/icons';
import { PaymentModal } from '@/frontend/features/admin/PaymentModal';
import { AddonsModal } from '@/frontend/features/admin/AddonsModal';

/**
 * ===========================================================================
 *  Agenda editable — vista de recepción
 * ===========================================================================
 *  Permite crear, reprogramar, cambiar el estado y cobrar las citas de TODA
 *  la clínica.
 *
 *  El odontólogo NO usa esta pantalla: tiene su propio calendario semanal en
 *  `frontend/features/dentist/DentistCalendar.tsx`, en modo lectura y sin
 *  importes. Son dos trabajos distintos y compartir un componente obligaba a
 *  sembrarlo de condicionales `isDentistView` — y cada una de ellas era una
 *  ocasión de olvidarse una y filtrar precios.
 *
 *  DOS REGLAS QUE NO SE PUEDEN SALTAR DESDE AQUÍ:
 *
 *  1. El formulario NO envía `endsAt` ni el precio. El servidor los deriva
 *     del tratamiento elegido. Es la misma regla que aplica al bot: el
 *     cliente manda intención, el servidor decide las consecuencias.
 *
 *  2. El solapamiento lo rechaza el servidor (y en Postgres, un constraint
 *     EXCLUDE). Aquí sólo se muestra el error de forma legible.
 * ===========================================================================
 */

interface AgendaManagerProps {
  appointments: AppointmentWithRelations[];
  patients: Patient[];
  dentists: Dentist[];
  rooms: Room[];
  treatments: Treatment[];
  /** Tasa Bs/USD vigente, para el modal de cobro. */
  exchangeRate: number | null;
  rateSource: string;
  /** Comisión de la clínica por odontólogo, para previsualizar el reparto. */
  commissionByDentist: Record<string, number>;
  /** Ids de citas que YA tienen cobro: no se pueden volver a cobrar. */
  paidAppointmentIds: string[];
  /** Medios de pago configurados; se ofrecen tal cual al cobrar. */
  paymentMethods: PaymentMethodOption[];
}

/** Estados a los que se puede pasar con un clic desde la tabla. */
const QUICK_STATUSES = [
  { value: 'CONFIRMED', label: 'Confirmar' },
  { value: 'IN_PROGRESS', label: 'En curso' },
  { value: 'COMPLETED', label: 'Completar' },
  { value: 'NO_SHOW', label: 'No asistió' },
  { value: 'CANCELLED', label: 'Cancelar' },
] as const;

/**
 * Convierte una fecha al formato que espera `<input type="datetime-local">`
 * ("2026-08-15T14:00"), expresada en la zona de la clínica.
 *
 * No se puede usar `toISOString().slice(0,16)`: eso da UTC y el campo
 * mostraría la hora desplazada cinco horas.
 */
function toLocalInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Caracas',
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function AgendaManager({
  appointments,
  patients,
  dentists,
  rooms,
  treatments,
  exchangeRate,
  rateSource,
  commissionByDentist,
  paidAppointmentIds,
  paymentMethods,
}: AgendaManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusError, setStatusError] = useState<string | null>(null);
  /** Cita que se está cobrando, o `null` si el modal está cerrado. */
  const [payingFor, setPayingFor] = useState<AppointmentWithRelations | null>(null);
  /**
   * Cita a la que se le están añadiendo procedimientos, por ID.
   *
   * Se guarda el id y no el objeto a propósito: al añadir un procedimiento el
   * servidor revalida `/agenda` y llegan `appointments` nuevos. Un objeto
   * capturado en el estado seguiría siendo el de antes, así que el modal
   * mostraría la lista sin lo que se acaba de añadir. Con el id se vuelve a
   * leer de la fuente en cada render.
   */
  const [addonsForId, setAddonsForId] = useState<string | null>(null);
  const editingAddonsFor =
    appointments.find((appointment) => appointment.id === addonsForId) ?? null;

  // `Set` para que la comprobación por fila sea O(1) en vez de recorrer el
  // array completo en cada una de las 80 citas.
  const paidIds = new Set(paidAppointmentIds);

  const crud = useCrud<AppointmentWithRelations>({
    create: createAppointmentAction,
    update: updateAppointmentAction,
    // La agenda no borra: una cita se CANCELA, y eso conserva el registro.
    remove: async () => ({ ok: false, error: 'Usa "Cancelar" en vez de eliminar' }),
  });

  const editing = crud.mode.kind === 'edit' ? crud.mode.item : null;
  const errorFor = (field: string) =>
    crud.fieldName === field ? crud.fieldError ?? undefined : undefined;

  /**
   * Abre la factura de una cita y navega a ella.
   *
   * Sustituye al modal de cobro directo: ahora el dinero entra CONTRA UNA
   * FACTURA, que es lo que permite editarla si en consulta se hizo algo más,
   * marcar descuentos y cobrar en dos partes.
   */
  function abrirFactura(appointment: AppointmentWithRelations) {
    setStatusError(null);
    startTransition(async () => {
      const result = await openInvoiceAction(appointment.id);
      if (!result.ok || !result.invoiceId) {
        setStatusError(result.error ?? 'No se pudo abrir la factura');
        return;
      }
      router.push(`/facturas/${result.invoiceId}`);
    });
  }

  /** Cambio rápido de estado desde la tabla. */
  function changeStatus(appointment: AppointmentWithRelations, status: string) {
    setStatusError(null);

    // Cancelar exige motivo; el servidor lo valida igualmente.
    let cancellationReason: string | undefined;
    if (status === 'CANCELLED') {
      const input = window.prompt('Motivo de la cancelación:');
      if (input === null) return; // canceló el diálogo
      cancellationReason = input.trim() || 'Sin motivo especificado';
    }

    startTransition(async () => {
      const result = await setAppointmentStatusAction({
        id: appointment.id,
        status,
        cancellationReason,
      });
      if (!result.ok) setStatusError(result.error ?? 'No se pudo cambiar el estado');
    });
  }

  // Agrupación por día: una lista plana de 60 citas es ilegible.
  const byDay = new Map<string, AppointmentWithRelations[]>();
  for (const appointment of appointments) {
    const key = new Intl.DateTimeFormat('es-VE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'America/Caracas',
    }).format(appointment.startsAt);
    byDay.set(key, [...(byDay.get(key) ?? []), appointment]);
  }

  const timeFormatter = new Intl.DateTimeFormat('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Caracas',
  });

  return (
    <>
      <div className="row row--between" style={{ marginBottom: '0.25rem' }}>
        <p className="text-sm muted">
          {appointments.length} citas programadas
        </p>
        <button type="button" className="btn btn--primary" onClick={crud.openCreate}>
          <IconPlus size={16} /> Nueva cita
        </button>
      </div>

      {statusError && <Notice tone="danger">{statusError}</Notice>}

      {appointments.length === 0 ? (
        <Card>
          <EmptyState>No hay citas programadas en este periodo.</EmptyState>
        </Card>
      ) : (
        [...byDay.entries()].map(([day, dayAppointments]) => (
          <Card
            key={day}
            title={day.charAt(0).toUpperCase() + day.slice(1)}
            subtitle={`${dayAppointments.length} citas`}
            flush
          >
            <div className="table-wrap">
              <table className="table table--cards">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Paciente</th>
                    <th>Tratamiento</th>
                    <th>Odontólogo</th>
                    <th>Sala</th>
                    <th>Origen</th>
                    <th>Estado</th>
                    <th className="table__num">Valor</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {dayAppointments.map((appointment, index) => (
                      <MotionRow key={appointment.id} index={index}>
                        <td className="mono text-xs" data-label="Hora">
                          {timeFormatter.format(appointment.startsAt)}
                        </td>
                        <td data-label="Paciente">
                          <div className="table__strong">{appointment.patient.fullName}</div>
                          <div className="text-xs subtle mono">
                            {appointment.patient.phoneE164}
                          </div>
                        </td>
                        <td className="muted" data-label="Tratamiento">{appointment.treatment.name}</td>
                        <td className="muted" data-label="Odontólogo">{appointment.dentist.fullName}</td>
                        <td data-label="Sala">
                          <Badge tone="neutral">{appointment.room.code}</Badge>
                        </td>
                        <td data-label="Origen">
                          <SourceBadge source={appointment.source} />
                        </td>
                        <td data-label="Estado">
                          <AppointmentStatusBadge status={appointment.status} />
                        </td>
                        <td className="table__num mono" data-label="Valor">
                          {formatCents(totalCitaCents(appointment))}
                          {/*
                            Si la consulta añadió cosas, el importe de la fila
                            deja de ser el precio de la cita. Se dice de dónde
                            sale: un número que no cuadra con lo agendado y no
                            se explica parece un error de tarifa.
                          */}
                          {appointment.addons.length > 0 && (
                            <div className="text-xs subtle">
                              +{appointment.addons.length}{' '}
                              {appointment.addons.length === 1 ? 'añadido' : 'añadidos'}
                            </div>
                          )}
                        </td>
                        <td data-label="Acciones">
                          <div className="table__actions">
                            {/*
                              Selector de estado en línea: confirmar o marcar
                              no-show es un gesto de mostrador, no debería
                              exigir abrir un formulario completo.
                            */}
                            <select
                              className="select"
                              style={{ padding: '2px 6px', fontSize: '0.75rem', width: 'auto' }}
                              value=""
                              disabled={isPending}
                              onChange={(event) =>
                                event.target.value &&
                                changeStatus(appointment, event.target.value)
                              }
                              aria-label={`Cambiar estado de la cita de ${appointment.patient.fullName}`}
                            >
                              <option value="">Estado…</option>
                              {QUICK_STATUSES.filter(
                                (option) => option.value !== appointment.status,
                              ).map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>

                            {/*
                              Cobrar sólo tiene sentido en citas ya
                              atendidas o en curso, y que no se hayan
                              cobrado antes. Mostrarlo en una cita
                              cancelada sería invitar a un error contable.
                            */}
                            {!paidIds.has(appointment.id) &&
                              ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(
                                appointment.status,
                              ) && (
                                <button
                                  type="button"
                                  className="btn btn--primary btn--sm"
                                  onClick={() => abrirFactura(appointment)}
                                  disabled={isPending}
                                  aria-label={`Facturar cita de ${appointment.patient.fullName}`}
                                >
                                  <IconCurrency size={14} /> Facturar
                                </button>
                              )}

                            {paidIds.has(appointment.id) && (
                              <Badge tone="success">Cobrada</Badge>
                            )}

                            {/*
                              Añadir procedimientos: se ofrece en las citas que
                              se están atendiendo o ya se atendieron, que es
                              cuando aparece el trabajo extra. En una cita
                              cancelada no hay nada que añadir.

                              Sigue visible en las cobradas, en modo lectura:
                              es la única forma de ver por qué el importe no
                              coincide con lo que se agendó.
                            */}
                            {['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(
                              appointment.status,
                            ) && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => setAddonsForId(appointment.id)}
                                aria-label={`Procedimientos de la cita de ${appointment.patient.fullName}`}
                              >
                                <IconTooth size={14} />
                              </button>
                            )}

                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => crud.openEdit(appointment)}
                              aria-label="Editar cita"
                            >
                              <IconEdit size={14} />
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

      <AddonsModal
        appointment={editingAddonsFor}
        treatments={treatments}
        isPaid={editingAddonsFor ? paidIds.has(editingAddonsFor.id) : false}
        onClose={() => setAddonsForId(null)}
      />

      <PaymentModal
        appointment={payingFor}
        exchangeRate={exchangeRate}
        rateSource={rateSource}
        commissionPercent={
          payingFor ? (commissionByDentist[payingFor.dentistId] ?? 40) : 40
        }
        paymentMethods={paymentMethods}
        onClose={() => setPayingFor(null)}
      />

      <Modal
        open={crud.mode.kind !== 'closed'}
        onClose={crud.close}
        title={editing ? 'Reprogramar cita' : 'Nueva cita'}
        subtitle={
          editing
            ? `${editing.patient.fullName} · ${editing.treatment.name}`
            : 'La duración y el precio los calcula el sistema según el tratamiento'
        }
        footer={
          <FormFooter
            onCancel={crud.close}
            isPending={crud.isPending}
            submitLabel={editing ? 'Reprogramar' : 'Agendar'}
          />
        }
      >
        {crud.formError && <Notice tone="danger">{crud.formError}</Notice>}

        {crud.fieldName === 'startsAt' && (
          <Notice tone="warning">
            Ese horario choca con otra cita del mismo odontólogo o de la misma sala.
            Elige otra hora.
          </Notice>
        )}

        <form id="crud-form" action={crud.submit} className="form-grid" key={editing?.id ?? 'new'}>
          <SelectField
            label="Paciente"
            name="patientId"
            required
            full
            defaultValue={editing?.patientId}
            options={patients.map((patient) => ({
              value: patient.id,
              label: `${patient.fullName} — ${patient.phoneE164}`,
            }))}
            error={errorFor('patientId')}
          />
          <SelectField
            label="Tratamiento"
            name="treatmentId"
            required
            defaultValue={editing?.treatmentId}
            hint="Define duración y precio"
            options={treatments.map((treatment) => ({
              value: treatment.id,
              label: `${treatment.name} (${treatment.durationMinutes} min · ${formatCents(treatment.basePriceCents)})`,
            }))}
            error={errorFor('treatmentId')}
          />
          <SelectField
            label="Odontólogo"
            name="dentistId"
            required
            defaultValue={editing?.dentistId}
            options={dentists.map((dentist) => ({
              value: dentist.id,
              label: dentist.fullName,
            }))}
            error={errorFor('dentistId')}
          />
          <SelectField
            label="Consultorio"
            name="roomId"
            required
            defaultValue={editing?.roomId}
            options={rooms.map((room) => ({
              value: room.id,
              label: `${room.name} (${room.code})`,
            }))}
            error={errorFor('roomId')}
          />
          <TextField
            label="Fecha y hora"
            name="startsAt"
            type="datetime-local"
            required
            hint="Hora local de la clínica (America/Caracas)"
            defaultValue={editing ? toLocalInputValue(editing.startsAt) : ''}
            error={errorFor('startsAt')}
          />
          <TextAreaField
            label="Notas"
            name="notes"
            placeholder="Observaciones para el odontólogo…"
            defaultValue={editing?.notes ?? ''}
          />
        </form>
      </Modal>
    </>
  );
}
