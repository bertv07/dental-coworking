'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'framer-motion';
import type { AppointmentSource, AppointmentStatus, Treatment } from '@/backend/domain/types';
import { Modal, motion } from '@/frontend/components/motion';
import { Badge, Card, Notice, SourceBadge } from '@/frontend/components/ui/primitives';
import { BookOwnAppointment } from '@/frontend/features/dentist/BookOwnAppointment';
import {
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconRoom,
} from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Calendario semanal del odontólogo
 * ===========================================================================
 *  La agenda del odontólogo NO es la de recepción. Responde a otra pregunta:
 *  "¿qué tengo hoy y cuánto hueco me queda?". Por eso es una rejilla de
 *  horas y no una tabla — en una rejilla, un hueco libre se VE; en una tabla
 *  hay que deducirlo restando horas mentalmente.
 *
 *  ---------------------------------------------------------------------
 *  QUÉ SE MUESTRA Y QUÉ NO
 *  ---------------------------------------------------------------------
 *  Muestra: hora, paciente, tratamiento, consultorio, origen y si la cita
 *  está confirmada.
 *
 *  NO muestra el precio. Y no es que esté oculto por CSS: el importe nunca
 *  sale del servidor hacia este componente (ver `/agenda/page.tsx`). Un
 *  campo que no se envía no se puede leer abriendo las herramientas del
 *  navegador.
 *
 *  NO permite cambiar el estado. Confirmar, cancelar o marcar una
 *  inasistencia es trabajo de recepción, que es quien habla con el paciente.
 *  Aquí el estado es sólo información.
 *
 *  ---------------------------------------------------------------------
 *  DE DÓNDE SALE LA GEOMETRÍA
 *  ---------------------------------------------------------------------
 *  El día y el minuto de cada cita llegan YA CALCULADOS desde el servidor en
 *  la zona horaria de la clínica. Este componente no toca `Date` ni zonas
 *  horarias: si lo hiciera, un odontólogo con el portátil en otra zona vería
 *  sus citas desplazadas de columna.
 * ===========================================================================
 */

/** Una cita, recortada a lo que el odontólogo necesita ver. Sin importes. */
export interface CalendarEntry {
  id: string;
  /** Día en el que cae, 'YYYY-MM-DD', hora de la clínica. */
  dayKey: string;
  /** Minutos desde medianoche. Determina la posición vertical. */
  startMinute: number;
  endMinute: number;
  /** Ya formateado en el servidor: "09:30 a. m. – 10:15 a. m.". */
  timeLabel: string;
  patientName: string;
  patientPhone: string;
  treatmentName: string;
  durationMinutes: number;
  roomName: string;
  roomCode: string;
  source: AppointmentSource;
  status: AppointmentStatus;
  notes: string | null;
}

/** Cabecera de una columna. También llega formateada del servidor. */
export interface CalendarDay {
  key: string;
  /** "lun" */
  weekdayLabel: string;
  /** "11" */
  dayNumber: string;
  /** "lunes 11 de agosto" — para lectores de pantalla y para el modal. */
  fullLabel: string;
  isToday: boolean;
  isPast: boolean;
}

interface DentistCalendarProps {
  days: CalendarDay[];
  entries: CalendarEntry[];
  /** Límites verticales de la rejilla, en minutos desde medianoche. */
  gridStartMinute: number;
  gridEndMinute: number;
  /** Minuto actual en la clínica, o `null` si la semana mostrada no es la de hoy. */
  nowMinute: number | null;
  weekLabel: string;
  previousWeekHref: string;
  nextWeekHref: string;
  currentWeekHref: string;
  isCurrentWeek: boolean;
  /**
   * Catálogo para el formulario de agendar.
   *
   * Llega ya recortado a lo que la odontóloga puede ver: nombre, código y
   * duración. Los precios no se usan aquí — en toda su parte del panel no
   * viaja ningún importe.
   */
  treatments: Treatment[];
}

/** Alto de una hora en píxeles. Fija la escala de toda la rejilla. */
const HOUR_HEIGHT = 64;

/**
 * Cómo se le presenta el estado al odontólogo.
 *
 * El sistema maneja seis estados, pero aquí sólo importa una cosa: si la
 * cita está en pie o no. `IN_PROGRESS` se pinta igual que `CONFIRMED` porque
 * para quien va a atender es lo mismo; la diferencia sólo le sirve a
 * recepción.
 */
const STATUS_VIEW: Record<
  AppointmentStatus,
  { label: string; modifier: string; tone: 'info' | 'warning' | 'success' | 'neutral' | 'danger' }
> = {
  PENDING: { label: 'Por confirmar', modifier: 'pending', tone: 'warning' },
  CONFIRMED: { label: 'Confirmada', modifier: 'confirmed', tone: 'info' },
  IN_PROGRESS: { label: 'Confirmada', modifier: 'confirmed', tone: 'info' },
  COMPLETED: { label: 'Atendida', modifier: 'done', tone: 'success' },
  CANCELLED: { label: 'Cancelada', modifier: 'cancelled', tone: 'neutral' },
  NO_SHOW: { label: 'No asistió', modifier: 'cancelled', tone: 'danger' },
};

/** Una cita ya colocada: en qué carril va y cuántos carriles comparte. */
interface PlacedEntry {
  entry: CalendarEntry;
  lane: number;
  lanes: number;
}

/**
 * Reparte las citas de un día en carriles para que dos que se solapen se
 * dibujen una al lado de la otra en vez de una encima de otra.
 *
 * ¿No lo impide ya la base de datos? Sólo en parte: el constraint EXCLUDE
 * ignora las citas canceladas y las inasistencias. Y esas SÍ se muestran
 * aquí —un odontólogo quiere ver que la cita de las 10 se cayó, no
 * encontrarse un hueco sin explicación—, así que el solapamiento es posible
 * y hay que dibujarlo bien.
 *
 * El algoritmo agrupa las citas que se tocan en cadena y reparte cada grupo
 * entre el mínimo de carriles necesario, de modo que un día sin solapes
 * conserva los bloques a ancho completo.
 */
function placeEntries(dayEntries: CalendarEntry[]): PlacedEntry[] {
  const sorted = [...dayEntries].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );

  const placed: PlacedEntry[] = [];
  let cluster: PlacedEntry[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  /** Cierra el grupo actual: todos sus bloques comparten el mismo ancho. */
  function closeCluster() {
    for (const item of cluster) item.lanes = Math.max(laneEnds.length, 1);
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
  }

  for (const entry of sorted) {
    // Si empieza cuando ya terminó todo el grupo anterior, abre grupo nuevo.
    if (entry.startMinute >= clusterEnd) closeCluster();

    // Primer carril que ya quedó libre; si no hay, se añade uno.
    let lane = laneEnds.findIndex((end) => end <= entry.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = entry.endMinute;

    cluster.push({ entry, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, entry.endMinute);
  }

  closeCluster();
  return placed;
}

export function DentistCalendar({
  days,
  entries,
  gridStartMinute,
  gridEndMinute,
  nowMinute,
  weekLabel,
  previousWeekHref,
  nextWeekHref,
  currentWeekHref,
  isCurrentWeek,
  treatments,
}: DentistCalendarProps) {
  const reduce = useReducedMotion();
  const [selected, setSelected] = useState<CalendarEntry | null>(null);

  /**
   * El minuto actual llega del servidor —el reloj de la clínica manda— y a
   * partir de ahí avanza solo. Sin esto, la línea de "ahora" se quedaría
   * congelada en el momento de cargar la página.
   */
  const [liveMinute, setLiveMinute] = useState(nowMinute);
  useEffect(() => {
    setLiveMinute(nowMinute);
    if (nowMinute === null) return;

    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 60_000);
      setLiveMinute(nowMinute + elapsed);
    }, 30_000);

    return () => clearInterval(timer);
  }, [nowMinute]);

  const totalMinutes = gridEndMinute - gridStartMinute;

  /** Etiquetas del canalón izquierdo: una por hora en punto. */
  const hourMarks = useMemo(() => {
    const marks: Array<{ minute: number; label: string }> = [];
    for (let minute = gridStartMinute; minute <= gridEndMinute; minute += 60) {
      marks.push({
        minute,
        label: `${String(Math.floor(minute / 60)).padStart(2, '0')}:00`,
      });
    }
    return marks;
  }, [gridStartMinute, gridEndMinute]);

  /** Citas agrupadas por columna y ya repartidas en carriles. */
  const placedByDay = useMemo(() => {
    const map = new Map<string, PlacedEntry[]>();
    for (const day of days) {
      map.set(
        day.key,
        placeEntries(entries.filter((entry) => entry.dayKey === day.key)),
      );
    }
    return map;
  }, [days, entries]);

  const selectedDay = selected
    ? days.find((day) => day.key === selected.dayKey)
    : undefined;

  /*
   * Las canceladas y las inasistencias se cuentan aparte.
   *
   * Sumarlas al total daría dos cifras distintas para la misma semana —una en
   * el título de la página y otra aquí— y quien las lea pensará que una de
   * las dos está mal. Cuentan como trabajo las que siguen en pie.
   */
  const dropped = entries.filter(
    (entry) => entry.status === 'CANCELLED' || entry.status === 'NO_SHOW',
  ).length;
  const active = entries.length - dropped;
  const subtitle =
    `${active} ${active === 1 ? 'cita' : 'citas'} esta semana` +
    (dropped > 0 ? ` · ${dropped} cancelada${dropped === 1 ? '' : 's'} o sin asistir` : '');

  return (
    <>
      <Card
        flush
        title={weekLabel}
        subtitle={subtitle}
        actions={
          <div className="cal__nav">
            {/*
              Agendar va junto a la navegación de semanas: es el mismo sitio
              donde ya se está mirando el hueco que se quiere ocupar.
            */}
            <BookOwnAppointment treatments={treatments} />
            <Link
              href={previousWeekHref}
              className="btn btn--ghost btn--sm"
              aria-label="Semana anterior"
            >
              <IconChevronLeft size={15} />
            </Link>
            <Link
              href={currentWeekHref}
              className={`btn btn--sm ${isCurrentWeek ? 'btn--ghost' : 'btn--primary'}`}
              aria-current={isCurrentWeek ? 'page' : undefined}
            >
              Hoy
            </Link>
            <Link
              href={nextWeekHref}
              className="btn btn--ghost btn--sm"
              aria-label="Semana siguiente"
            >
              <IconChevronRight size={15} />
            </Link>
          </div>
        }
      >
        {entries.length === 0 && (
          <div className="cal__empty-banner">
            <Notice tone="info">
              No tienes citas esta semana. Puedes agendar tú misma con el botón de
              arriba, o las agenda recepción y aparecen aquí.
            </Notice>
          </div>
        )}

        {/*
          Desplazamiento horizontal en pantallas estrechas. Una rejilla de
          seis columnas comprimida a 360 px no se lee; es preferible
          conservar el ancho de columna y deslizar.
        */}
        <div className="cal__scroller">
          <div
            className="cal"
            style={
              {
                '--cal-days': days.length,
                '--cal-hour': `${HOUR_HEIGHT}px`,
                '--cal-height': `${(totalMinutes / 60) * HOUR_HEIGHT}px`,
              } as React.CSSProperties
            }
          >
            {/* --- Cabecera de días --- */}
            <div className="cal__row cal__row--head">
              <div className="cal__gutter-head" aria-hidden="true" />
              {days.map((day) => (
                <div
                  key={day.key}
                  className={`cal__day-head${day.isToday ? ' cal__day-head--today' : ''}${
                    day.isPast ? ' cal__day-head--past' : ''
                  }`}
                >
                  <span className="cal__day-weekday">{day.weekdayLabel}</span>
                  <span className="cal__day-number">{day.dayNumber}</span>
                </div>
              ))}
            </div>

            {/* --- Rejilla horaria --- */}
            <div className="cal__row cal__row--body">
              <div className="cal__gutter">
                {hourMarks.map((mark) => (
                  <span
                    key={mark.minute}
                    className="cal__hour-label"
                    style={{
                      top: `${((mark.minute - gridStartMinute) / 60) * HOUR_HEIGHT}px`,
                    }}
                  >
                    {mark.label}
                  </span>
                ))}
              </div>

              {days.map((day) => {
                const placed = placedByDay.get(day.key) ?? [];

                return (
                  <div
                    key={day.key}
                    className={`cal__col${day.isToday ? ' cal__col--today' : ''}`}
                  >
                    {/* Línea de la hora actual. Sólo en la columna de hoy y
                        sólo si cae dentro del tramo visible. */}
                    {day.isToday &&
                      liveMinute !== null &&
                      liveMinute >= gridStartMinute &&
                      liveMinute <= gridEndMinute && (
                        <div
                          className="cal__now"
                          style={{
                            top: `${((liveMinute - gridStartMinute) / 60) * HOUR_HEIGHT}px`,
                          }}
                          aria-hidden="true"
                        />
                      )}

                    {placed.map(({ entry, lane, lanes }, index) => {
                      const view = STATUS_VIEW[entry.status];
                      const top =
                        ((entry.startMinute - gridStartMinute) / 60) * HOUR_HEIGHT;
                      const minutes = entry.endMinute - entry.startMinute;
                      const height = (minutes / 60) * HOUR_HEIGHT;

                      /*
                       * Una cita de media hora mide 32 px: no caben tres
                       * líneas de texto y lo que sobra se corta a media
                       * letra, que es peor que no ponerlo. El bloque cambia
                       * de composición según lo que realmente quepa, y lo
                       * primero que se sacrifica es el dato menos urgente:
                       * el tratamiento antes que el nombre del paciente.
                       */
                      const density =
                        minutes <= 30 ? ' cal__event--sm' : minutes < 60 ? ' cal__event--md' : '';

                      return (
                        <motion.button
                          key={entry.id}
                          type="button"
                          className={`cal__event cal__event--${view.modifier}${density}`}
                          style={{
                            top: `${top}px`,
                            height: `${height}px`,
                            left: `${(lane / lanes) * 100}%`,
                            width: `${100 / lanes}%`,
                          }}
                          onClick={() => setSelected(entry)}
                          initial={reduce ? false : { opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.22,
                            delay: Math.min(index * 0.02, 0.2),
                          }}
                          aria-label={`${entry.timeLabel} · ${entry.patientName} · ${entry.treatmentName} · ${view.label}`}
                        >
                          <span className="cal__event-time">
                            {String(Math.floor(entry.startMinute / 60)).padStart(2, '0')}
                            :{String(entry.startMinute % 60).padStart(2, '0')}
                          </span>
                          <span className="cal__event-patient">{entry.patientName}</span>
                          <span className="cal__event-meta">
                            {entry.treatmentName} · {entry.roomCode}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Leyenda: sin ella, el color de un bloque es adivinanza. */}
        <div className="cal__legend">
          <span className="cal__legend-item">
            <i className="cal__chip cal__chip--confirmed" /> Confirmada
          </span>
          <span className="cal__legend-item">
            <i className="cal__chip cal__chip--pending" /> Por confirmar
          </span>
          <span className="cal__legend-item">
            <i className="cal__chip cal__chip--done" /> Atendida
          </span>
          <span className="cal__legend-item">
            <i className="cal__chip cal__chip--cancelled" /> Cancelada
          </span>
          <span className="cal__legend-note">
            Confirmar o cancelar lo hace recepción.
          </span>
        </div>
      </Card>

      {/* --- Detalle de una cita --------------------------------------- */}
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.patientName ?? 'Cita'}
        subtitle={
          selected && selectedDay
            ? `${selectedDay.fullLabel} · ${selected.timeLabel}`
            : undefined
        }
      >
        {selected && (
          <>
            <div className="cal__detail-badges">
              <Badge tone={STATUS_VIEW[selected.status].tone}>
                {STATUS_VIEW[selected.status].label}
              </Badge>
              <SourceBadge source={selected.source} />
            </div>

            <dl className="detail-list">
              <div className="detail-list__row">
                <dt>Tratamiento</dt>
                <dd>{selected.treatmentName}</dd>
              </div>
              <div className="detail-list__row">
                <dt>
                  <IconClock size={14} /> Duración
                </dt>
                <dd>{selected.durationMinutes} min</dd>
              </div>
              <div className="detail-list__row">
                <dt>
                  <IconRoom size={14} /> Consultorio
                </dt>
                <dd>
                  {selected.roomName} <span className="subtle">({selected.roomCode})</span>
                </dd>
              </div>
              <div className="detail-list__row">
                <dt>Teléfono</dt>
                <dd>
                  {/* Enlace `tel:` — desde el móvil se llama al paciente de un toque. */}
                  <a className="mono" href={`tel:${selected.patientPhone}`}>
                    {selected.patientPhone}
                  </a>
                </dd>
              </div>
            </dl>

            {selected.notes && (
              <div className="cal__detail-notes">
                <div className="cal__detail-notes-title">Notas de recepción</div>
                <p>{selected.notes}</p>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
