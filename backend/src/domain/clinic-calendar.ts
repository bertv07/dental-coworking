/**
 * ===========================================================================
 *  Calendario de la clínica
 * ===========================================================================
 *  Aritmética de fechas para la vista semanal. Sin `server-only`: son
 *  funciones puras y el cliente puede necesitarlas.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ TODO GIRA EN TORNO A 'YYYY-MM-DD'
 *  ---------------------------------------------------------------------
 *  Un `Date` es un INSTANTE, no un día. El mismo instante es "lunes 23:30"
 *  en Caracas y "martes 03:30" en UTC. Colocar una cita en la columna
 *  equivocada del calendario es exactamente el error que produce esa
 *  confusión.
 *
 *  Aquí se separan las dos cosas:
 *   · Un INSTANTE (`Date`) es lo que se guarda y lo que compara la base.
 *   · Un DÍA es una cadena 'YYYY-MM-DD' ya resuelta en la zona de la clínica.
 *
 *  Toda la geometría del calendario (qué columna, a qué altura) se calcula
 *  desde esas cadenas y desde minutos-del-día, ambos derivados con `Intl` en
 *  la zona de la clínica. Así el resultado no depende del reloj ni de la
 *  configuración regional del navegador de quien mira la pantalla.
 * ===========================================================================
 */

/**
 * Zona horaria de la clínica. Venezuela no aplica horario de verano, pero se
 * usa el identificador IANA en vez de un desfase fijo "-04:00": si el país
 * vuelve a cambiar la hora —ya lo hizo en 2007 y en 2016— basta con que el
 * sistema tenga la base tzdata al día.
 */
export const CLINIC_TIME_ZONE = 'America/Caracas';

/** Minutos que tiene un día. Evita el `24 * 60` suelto por el archivo. */
export const MINUTES_PER_DAY = 1440;

// 'en-CA' formatea como 'YYYY-MM-DD', que es justo la clave que se necesita.
const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// `hourCycle: 'h23'` y no `hour12: false`: este último devuelve "24:00" para
// medianoche en algunas versiones de ICU, y eso rompería el cálculo.
const dayMinuteFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLINIC_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Día ('YYYY-MM-DD') en el que cae este instante para la clínica. */
export function clinicDayKey(instant: Date): string {
  return dayKeyFormatter.format(instant);
}

/** Minutos desde medianoche (0-1439) de este instante, hora de la clínica. */
export function clinicMinuteOfDay(instant: Date): number {
  const [hour, minute] = dayMinuteFormatter.format(instant).split(':');
  return Number(hour) * 60 + Number(minute);
}

// Sonda para averiguar el desfase de la zona en un instante dado. Se declara
// una sola vez: construir un `Intl.DateTimeFormat` es caro.
const offsetProbe = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Desfase de la zona de la clínica respecto a UTC, en ms, en ese instante. */
function clinicOffsetMs(instant: Date): number {
  const parts = offsetProbe.formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  // La hora local leída "como si fuera UTC" menos el instante real da el desfase.
  const asIfUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );

  return asIfUtc - instant.getTime();
}

/**
 * Operación inversa: de "las 8 de la mañana del 11 de agosto EN LA CLÍNICA"
 * al instante UTC que hay que guardar.
 *
 * Es la conversión que hace falta al GENERAR citas (semillas, importaciones).
 * Al leer no se usa: para leer basta con `clinicDayKey` y `clinicMinuteOfDay`.
 *
 * Método: se supone que la hora de pared es UTC y se corrige con el desfase
 * de la zona en ese entorno. Con una zona sin horario de verano —el caso de
 * Venezuela— el resultado es exacto. En una zona con cambio de hora, un
 * instante que caiga justo en el salto podría quedar desplazado una hora;
 * si algún día se abre sede en otro país, ahí es donde hay que mirar.
 */
export function clinicWallClockToInstant(dayKey: string, minuteOfDay: number): Date {
  const asIfUtc = Date.parse(`${dayKey}T00:00:00Z`) + minuteOfDay * 60_000;
  return new Date(asIfUtc - clinicOffsetMs(new Date(asIfUtc)));
}

/**
 * Suma días a una clave de día.
 *
 * Se opera a MEDIODÍA UTC a propósito: cualquier desfase horario razonable
 * (±14 h) deja la fecha intacta. Hacerlo a medianoche significaría que un
 * desfase negativo empuja el resultado al día anterior.
 */
export function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Lunes de la semana que contiene `dayKey`. La semana clínica empieza en lunes. */
export function startOfWeek(dayKey: string): string {
  const weekday = new Date(`${dayKey}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(dayKey, weekday === 0 ? -6 : 1 - weekday);
}

/** Los siete días de la semana que arranca en `weekStart`, de lunes a domingo. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

/**
 * Rango de instantes con el que pedir la semana a la base de datos.
 *
 * Se pide UN DÍA DE MÁS por cada lado y luego se filtra por `clinicDayKey`.
 *
 * El motivo es evitar la conversión "hora de pared local → instante UTC", que
 * necesita conocer el desfase exacto de la zona en esa fecha concreta y es
 * donde este tipo de código suele fallar. Sobre-pedir 48 horas y descartar lo
 * que sobra da el mismo resultado sin esa conversión, y el coste es
 * despreciable: son unas pocas filas indexadas por fecha.
 */
export function weekQueryRange(weekStart: string): { from: Date; to: Date } {
  return {
    from: new Date(`${addDays(weekStart, -1)}T00:00:00Z`),
    to: new Date(`${addDays(weekStart, 8)}T00:00:00Z`),
  };
}

/**
 * Valida una clave de día que viene de la URL.
 *
 * Es entrada del usuario: `?semana=` puede traer cualquier cosa. Devuelve
 * `null` en vez de lanzar, para que quien llame caiga en la semana actual en
 * lugar de romper la página con un 500.
 */
export function parseDayKey(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  // Descarta fechas imposibles ('2026-02-31'): si el redondeo del constructor
  // cambió el valor, la fecha original no existía.
  return date.toISOString().slice(0, 10) === value ? value : null;
}
