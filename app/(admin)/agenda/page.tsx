import { requireAuth } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Card, Notice } from '@/frontend/components/ui/primitives';
import { AgendaManager } from '@/frontend/features/admin/AgendaManager';
import {
  DentistCalendar,
  type CalendarDay,
  type CalendarEntry,
} from '@/frontend/features/dentist/DentistCalendar';
import { getCurrentRate, resolveRateSource } from '@/backend/services/exchange-rate.service';
import {
  CLINIC_TIME_ZONE,
  MINUTES_PER_DAY,
  addDays,
  clinicDayKey,
  clinicMinuteOfDay,
  parseDayKey,
  startOfWeek,
  weekDays,
  weekQueryRange,
} from '@/backend/domain/clinic-calendar';

/**
 * ===========================================================================
 *  /agenda
 * ===========================================================================
 *  Una ruta, DOS pantallas distintas, porque son dos trabajos distintos:
 *
 *   · Odontólogo → CALENDARIO semanal de sus propias citas, en modo lectura.
 *     Ve la hora, el paciente, el tratamiento, la sala, el origen y si la
 *     cita está confirmada. No ve importes ni puede cambiar estados.
 *
 *   · Asistente / Super Admin → agenda completa de la clínica, con alta,
 *     reprogramación, cambio de estado y cobro.
 *
 *  El filtro por odontólogo se resuelve SIEMPRE desde el id de sesión, nunca
 *  desde un parámetro de la URL: eso último permitiría ver la agenda ajena
 *  cambiando un id a mano.
 * ===========================================================================
 */

export const metadata = { title: 'Agenda' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AgendaPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireAuth();

  return user.role === 'DENTIST' ? (
    <DentistWeekView userId={user.id} searchParams={await searchParams} />
  ) : (
    <ClinicAgendaView searchParams={await searchParams} />
  );
}

/* ==========================================================================
   Vista del odontólogo — calendario semanal
   ========================================================================== */

async function DentistWeekView({
  userId,
  searchParams,
}: {
  userId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // El perfil clínico se busca por el userId de la sesión, que va firmado por
  // el servidor. Si la cuenta no tiene perfil vinculado no se consulta NADA:
  // ante la duda, cero datos, nunca la agenda entera.
  const profile = await repository.findDentistByUserId(userId);

  if (!profile) {
    return (
      <div className="page-body">
        <PageHead title="Agenda" />
        <Card>
          <Notice tone="warning">
            Tu usuario todavía no está vinculado a una ficha de odontólogo, así que
            no hay agenda que mostrar. Pídele al administrador que enlace tu cuenta
            desde <strong>Odontólogos</strong>.
          </Notice>
        </Card>
      </div>
    );
  }

  // --- Semana a mostrar ---------------------------------------------------
  // `?semana=YYYY-MM-DD` es entrada del usuario: si no es una fecha válida se
  // cae a la semana actual en lugar de reventar la página.
  const now = new Date();
  const todayKey = clinicDayKey(now);
  const requestedKey = parseDayKey(searchParams.semana);
  const weekStart = startOfWeek(requestedKey ?? todayKey);
  const currentWeekStart = startOfWeek(todayKey);

  // --- Citas de la semana -------------------------------------------------
  // `listDentistAgenda` y no `listAppointments`: la primera ni siquiera
  // selecciona `agreedPriceCents` en la consulta a Postgres. Ver el comentario
  // del método en `repositories/types.ts`.
  const appointments = await repository.listDentistAgenda({
    dentistId: profile.id,
    range: weekQueryRange(weekStart),
  });

  /*
   * Catálogo para que pueda agendar ella misma, RECORTADO aquí.
   *
   * `listTreatments()` trae `basePriceCents`, y pasar el objeto entero metía
   * la lista de precios en el payload que viaja al navegador aunque el
   * formulario no la pintase. Se mandan sólo los tres campos que usa.
   */
  const treatments = (await repository.listTreatments())
    .filter((treatment) => treatment.isActive)
    .map((treatment) => ({
      code: treatment.code,
      name: treatment.name,
      durationMinutes: treatment.durationMinutes,
    }));

  const timeFormatter = new Intl.DateTimeFormat('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: CLINIC_TIME_ZONE,
  });

  const allDayKeys = weekDays(weekStart);

  // Sólo queda añadir la geometría: qué columna y a qué altura va cada cita.
  // El recorte de campos ya lo hizo la consulta.
  const entries: CalendarEntry[] = appointments
    // El rango pedido a la base lleva un día de margen a cada lado; se
    // descarta lo que caiga fuera de la semana en hora de la clínica.
    .filter((appointment) => allDayKeys.includes(clinicDayKey(appointment.startsAt)))
    .map((appointment) => {
      const startMinute = clinicMinuteOfDay(appointment.startsAt);
      const rawEndMinute = clinicMinuteOfDay(appointment.endsAt);

      return {
        id: appointment.id,
        dayKey: clinicDayKey(appointment.startsAt),
        startMinute,
        // Una cita que cruza la medianoche daría un minuto final MENOR que el
        // inicial y se dibujaría con altura negativa. Se corta al final del
        // día: no existen en esta clínica, pero un dato corrupto no debe
        // romper la pantalla.
        endMinute: rawEndMinute > startMinute ? rawEndMinute : MINUTES_PER_DAY,
        timeLabel: `${timeFormatter.format(appointment.startsAt)} – ${timeFormatter.format(appointment.endsAt)}`,
        patientName: appointment.patientName,
        treatmentName: appointment.treatmentName,
        durationMinutes: appointment.treatmentDurationMinutes,
        roomName: appointment.roomName,
        roomCode: appointment.roomCode,
        source: appointment.source,
        status: appointment.status,
        notes: appointment.notes,
      };
    });

  // --- Columnas -----------------------------------------------------------
  // Lunes a sábado siempre. El domingo sólo aparece si hay algo ese día:
  // reservar una séptima columna para un día que la clínica no abre estrecha
  // las otras seis sin dar nada a cambio.
  const visibleDayKeys = allDayKeys.filter(
    (key, index) => index < 6 || entries.some((entry) => entry.dayKey === key),
  );

  const weekdayFormatter = new Intl.DateTimeFormat('es-VE', {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const fullDayFormatter = new Intl.DateTimeFormat('es-VE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  const days: CalendarDay[] = visibleDayKeys.map((key) => {
    // Las claves ya están resueltas en hora de la clínica; se formatean en UTC
    // a mediodía para que `Intl` no vuelva a desplazarlas.
    const noon = new Date(`${key}T12:00:00Z`);

    return {
      key,
      weekdayLabel: weekdayFormatter.format(noon).replace('.', ''),
      dayNumber: key.slice(8),
      fullLabel: fullDayFormatter.format(noon),
      isToday: key === todayKey,
      isPast: key < todayKey,
    };
  });

  // --- Límites verticales de la rejilla -----------------------------------
  // Se parte de la jornada configurada y se ENSANCHA si alguna cita se sale
  // (una urgencia a las 7:00). Nunca al revés: recortar dejaría una cita
  // invisible, que es el peor fallo posible en una agenda.
  const settings = await repository.getClinicSettings();
  let gridStartMinute = Math.floor(settings.openingMinute / 60) * 60;
  let gridEndMinute = Math.ceil(settings.closingMinute / 60) * 60;

  for (const entry of entries) {
    gridStartMinute = Math.min(gridStartMinute, Math.floor(entry.startMinute / 60) * 60);
    gridEndMinute = Math.max(gridEndMinute, Math.ceil(entry.endMinute / 60) * 60);
  }

  gridStartMinute = Math.max(0, gridStartMinute);
  gridEndMinute = Math.min(MINUTES_PER_DAY, gridEndMinute);
  // Salvaguarda ante una configuración incoherente (cierre antes de apertura).
  if (gridEndMinute - gridStartMinute < 60) {
    gridStartMinute = 8 * 60;
    gridEndMinute = 18 * 60;
  }

  const isCurrentWeek = weekStart === currentWeekStart;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Mi agenda"
          subtitle={`${profile.fullName} · ${describeWeekload(entries)}`}
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <DentistCalendar
          days={days}
          entries={entries}
          gridStartMinute={gridStartMinute}
          gridEndMinute={gridEndMinute}
          // El minuto actual sale del reloj del SERVIDOR en hora de la clínica.
          // Sólo tiene sentido si se está mirando la semana en curso.
          nowMinute={isCurrentWeek ? clinicMinuteOfDay(now) : null}
          // `weekStart` es siempre el primer día visible (lunes); el último se
          // deriva de cuántas columnas quedaron a la vista.
          weekLabel={formatWeekLabel(weekStart, addDays(weekStart, visibleDayKeys.length - 1))}
          treatments={treatments}
          previousWeekHref={`/agenda?semana=${addDays(weekStart, -7)}`}
          nextWeekHref={`/agenda?semana=${addDays(weekStart, 7)}`}
          currentWeekHref="/agenda"
          isCurrentWeek={isCurrentWeek}
        />
      </FadeIn>
    </div>
  );
}

/** "6 citas · 2 por confirmar" — el resumen que interesa de un vistazo. */
function describeWeekload(entries: CalendarEntry[]): string {
  const active = entries.filter(
    (entry) => entry.status !== 'CANCELLED' && entry.status !== 'NO_SHOW',
  );
  const pending = active.filter((entry) => entry.status === 'PENDING').length;

  if (active.length === 0) return 'sin citas esta semana';

  const base = `${active.length} ${active.length === 1 ? 'cita' : 'citas'} esta semana`;
  return pending > 0 ? `${base} · ${pending} por confirmar` : base;
}

/** "11 – 17 de agosto de 2026", omitiendo el mes repetido cuando coincide. */
function formatWeekLabel(firstKey: string, lastKey: string): string {
  const first = new Date(`${firstKey}T12:00:00Z`);
  const last = new Date(`${lastKey}T12:00:00Z`);

  const options = { timeZone: 'UTC' } as const;
  const dayOnly = new Intl.DateTimeFormat('es-VE', { day: 'numeric', ...options });
  const dayMonth = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'long', ...options });
  const full = new Intl.DateTimeFormat('es-VE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...options,
  });

  // 'YYYY-MM' — si el mes coincide no se repite: "11 – 17 de agosto".
  const sameMonth = firstKey.slice(0, 7) === lastKey.slice(0, 7);
  return `${sameMonth ? dayOnly.format(first) : dayMonth.format(first)} – ${full.format(last)}`;
}

/* ==========================================================================
   Vista de recepción / administración — agenda completa y editable
   ========================================================================== */

async function ClinicAgendaView({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  /*
   * `?paciente=…` abre el alta con ese paciente ya elegido.
   *
   * Es el segundo paso de una venta en persona: se viene de su ficha, así que
   * volver a buscarlo en un desplegable de 200 nombres sería repetir trabajo
   * que ya se hizo.
   *
   * Se valida como cuid antes de pasarlo: viene de la URL, y un valor basura
   * dejaría el desplegable en un estado que no corresponde a nadie.
   */
  const preselected =
    typeof searchParams.paciente === 'string' && /^c[a-z0-9]{20,30}$/i.test(searchParams.paciente)
      ? searchParams.paciente
      : null;

  const from = new Date();
  const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);

  // Los catálogos alimentan los desplegables del formulario. Se piden en
  // paralelo con las citas: son consultas independientes.
  const [appointments, patients, dentists, rooms, treatments, settings] = await Promise.all([
    repository.listAppointments({ range: { from, to }, limit: 80 }),
    repository.listPatients({ page: 1, limit: 200 }),
    repository.listDentists(),
    repository.listRooms(),
    repository.listTreatments(),
    repository.getClinicSettings(),
  ]);

  // Los medios que ofrece el bot son los mismos que ve recepción al cobrar.
  const paymentMethods = await repository.listPaymentMethods();

  // Tasa según la fuente configurada por la clínica.
  const rateSource = resolveRateSource(settings.preferredRateSource);
  const rate = await getCurrentRate(rateSource);

  // Comisión por odontólogo: el modal de cobro previsualiza el reparto real,
  // no un 40% genérico.
  const commissionByDentist: Record<string, number> = {};
  for (const dentist of await repository.listDentists({ includeInactive: true })) {
    commissionByDentist[dentist.id] = dentist.clinicCommissionPercent;
  }

  // Citas del periodo que ya tienen cobro: no deben ofrecer el botón otra vez.
  // Una sola consulta para las 80, no una por fila.
  const paidAppointmentIds = await repository.getPaidAppointmentIds(
    appointments.map((appointment) => appointment.id),
  );

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Agenda"
          subtitle={`Clínica completa · próximos 14 días · ${appointments.length} programadas`}
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <AgendaManager
          appointments={appointments}
          patients={patients.items}
          dentists={dentists}
          rooms={rooms}
          treatments={treatments}
          exchangeRate={rate?.rate ?? null}
          rateSource={rateSource}
          commissionByDentist={commissionByDentist}
          paidAppointmentIds={paidAppointmentIds}
          paymentMethods={paymentMethods}
          preselectedPatientId={preselected}
        />
      </FadeIn>
    </div>
  );
}
