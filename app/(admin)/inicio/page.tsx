import Link from 'next/link';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { getCurrentRate } from '@/backend/services/exchange-rate.service';
import { formatCents, formatBs } from '@/backend/domain/money';
import { PageHead } from '@/frontend/components/layout/Topbar';
import {
  Card,
  Stat,
  Badge,
  EmptyState,
  Avatar,
  Notice,
  AppointmentStatusBadge,
  SourceBadge,
} from '@/frontend/components/ui/primitives';
import { FadeIn, Stagger, StaggerItem, HoverCard } from '@/frontend/components/motion';
import { IconPlus, IconCurrency, IconChat } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  /inicio — Panel operativo del asistente
 * ===========================================================================
 *  ACCESO: asistente o superior.
 *
 *  POR QUÉ EXISTE:
 *  Recepción aterrizaba en el monitor de WhatsApp, que es UNA de sus tareas
 *  pero no su panorama. Esta pantalla responde a lo que se pregunta al
 *  empezar el turno: qué hay hoy, quién falta por confirmar, cuánto llevamos
 *  cobrado y a qué tasa.
 *
 *  El dashboard financiero (`/dashboard`) sigue siendo exclusivo del Super
 *  Admin: aquí no se muestran márgenes históricos ni deuda con odontólogos,
 *  sólo la operación del día.
 * ===========================================================================
 */

export const metadata = { title: 'Inicio' };
export const dynamic = 'force-dynamic';

export default async function AssistantHomePage() {
  const user = await requireRole('ASSISTANT');

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [todayAppointments, cash, conversations, settings] = await Promise.all([
    repository.listAppointments({ range: { from: dayStart, to: dayEnd }, limit: 100 }),
    repository.getDailyCash(now),
    repository.listConversations({ limit: 50 }),
    repository.getClinicSettings(),
  ]);

  const rateSource = settings.preferredRateSource === 'PARALELO' ? 'PARALELO' : 'BCV';
  const rate = await getCurrentRate(rateSource);

  // Estado del día. Se calcula en una sola pasada sobre las citas.
  const pending = todayAppointments.filter((a) => a.status === 'PENDING');
  const upcoming = todayAppointments
    .filter((a) => a.startsAt > now && !['CANCELLED', 'NO_SHOW'].includes(a.status))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const inProgress = todayAppointments.filter((a) => a.status === 'IN_PROGRESS');
  const completed = todayAppointments.filter((a) => a.status === 'COMPLETED');

  // Citas atendidas que aún NO se han cobrado: el pendiente más importante
  // del turno, porque es dinero que se puede quedar sin registrar.
  const paidIds = new Set(
    await repository.getPaidAppointmentIds(todayAppointments.map((a) => a.id)),
  );
  const uncollected = completed.filter((a) => !paidIds.has(a.id));

  const needsHuman = conversations.filter((c) => c.needsHumanAttention);

  const timeFormatter = new Intl.DateTimeFormat('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Caracas',
  });

  const dateLabel = new Intl.DateTimeFormat('es-VE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Caracas',
  }).format(now);

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title={`Hola, ${user.name.split(' ')[0]}`}
          subtitle={
            <>
              {dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)} ·{' '}
              {todayAppointments.length} citas hoy
              {rate && (
                <>
                  {' '}
                  <span className={`rate-chip ${rate.isStale ? 'rate-chip--stale' : ''}`}>
                    {rateSource} {rate.rate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs/USD
                  </span>
                </>
              )}
            </>
          }
          actions={
            <>
              <Link href="/agenda" className="btn btn--primary">
                <IconPlus size={16} /> Nueva cita
              </Link>
              <Link href="/caja" className="btn btn--ghost">
                <IconCurrency size={16} /> Caja
              </Link>
            </>
          }
        />
      </FadeIn>

      {/* --- Avisos que exigen acción HOY --- */}
      {!rate && (
        <FadeIn>
          <Notice tone="danger">
            No hay tasa de cambio disponible. <Link href="/tasa-cambio">Actualízala</Link> antes
            de cobrar: sin ella no se puede registrar el importe en bolívares.
          </Notice>
        </FadeIn>
      )}

      {uncollected.length > 0 && (
        <FadeIn>
          <Notice tone="warning">
            Hay <strong>{uncollected.length} citas atendidas sin cobrar</strong>. Regístralas
            desde la <Link href="/agenda">agenda</Link> antes de cerrar el turno.
          </Notice>
        </FadeIn>
      )}

      <Stagger className="stat-grid">
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Cobrado hoy"
              value={formatCents(cash.totalCents)}
              meta={rate ? formatBs(cash.totalBs) : `${cash.paymentCount} ${cash.paymentCount === 1 ? 'cobro' : 'cobros'}`}
              featured
              compact
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Por confirmar"
              value={String(pending.length)}
              meta="citas de hoy sin confirmar"
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="En curso"
              value={String(inProgress.length)}
              meta={`${completed.length} ya atendidas`}
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Chats por atender"
              value={String(needsHuman.length)}
              meta="la IA pidió ayuda humana"
            />
          </HoverCard>
        </StaggerItem>
      </Stagger>

      <div className="grid-2">
        {/* --- Lo que viene en el turno --- */}
        <FadeIn delay={0.14}>
          <Card
            title="Próximas citas de hoy"
            subtitle={`${upcoming.length} pendientes`}
            actions={
              <Link href="/agenda" className="pill-btn">
                Ver agenda
              </Link>
            }
            flush
          >
            {upcoming.length === 0 ? (
              <EmptyState>No quedan citas por atender hoy.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Paciente</th>
                      <th>Odontólogo</th>
                      <th>Sala</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.slice(0, 8).map((appointment) => (
                      <tr key={appointment.id}>
                        <td className="mono text-xs">
                          {timeFormatter.format(appointment.startsAt)}
                        </td>
                        <td>
                          <div className="row">
                            <Avatar name={appointment.patient.fullName} small />
                            <div>
                              <div className="table__strong">
                                {appointment.patient.fullName}
                              </div>
                              <div className="text-xs subtle">
                                {appointment.treatment.name}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="muted text-xs">{appointment.dentist.fullName}</td>
                        <td>
                          <Badge tone="neutral">{appointment.room.code}</Badge>
                        </td>
                        <td>
                          <AppointmentStatusBadge status={appointment.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </FadeIn>

        {/* --- Conversaciones que necesitan a una persona --- */}
        <FadeIn delay={0.2}>
          <Card
            title="Requieren tu atención"
            subtitle="La IA escaló estas conversaciones"
            actions={
              <Link href="/whatsapp" className="pill-btn">
                <IconChat size={12} /> Abrir
              </Link>
            }
          >
            {needsHuman.length === 0 ? (
              <EmptyState>Ningún chat necesita intervención humana.</EmptyState>
            ) : (
              <div className="stack">
                {needsHuman.slice(0, 5).map((conversation) => (
                  <Link
                    key={conversation.id}
                    href="/whatsapp"
                    className="row"
                    style={{ alignItems: 'flex-start' }}
                  >
                    <Avatar name={conversation.patientName ?? conversation.phoneE164} small />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="text-sm" style={{ fontWeight: 600 }}>
                        {conversation.patientName ?? conversation.phoneE164}
                      </div>
                      <div className="text-xs subtle conversation-item__preview">
                        {conversation.lastMessagePreview ?? 'Sin mensajes'}
                      </div>
                    </div>
                    {!conversation.aiEnabled && <Badge tone="danger">IA apagada</Badge>}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </FadeIn>
      </div>

      {/* --- Citas atendidas sin cobrar: el pendiente de dinero --- */}
      {uncollected.length > 0 && (
        <FadeIn delay={0.26}>
          <Card
            title="Atendidas sin cobrar"
            subtitle="Dinero pendiente de registrar"
            actions={
              <Link href="/agenda" className="pill-btn">
                Ir a cobrar
              </Link>
            }
            flush
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Paciente</th>
                    <th>Tratamiento</th>
                    <th>Odontólogo</th>
                    <th>Origen</th>
                    <th className="table__num">A cobrar</th>
                  </tr>
                </thead>
                <tbody>
                  {uncollected.map((appointment) => (
                    <tr key={appointment.id}>
                      <td className="mono text-xs">
                        {timeFormatter.format(appointment.startsAt)}
                      </td>
                      <td className="table__strong">{appointment.patient.fullName}</td>
                      <td className="muted">{appointment.treatment.name}</td>
                      <td className="muted text-xs">{appointment.dentist.fullName}</td>
                      <td>
                        <SourceBadge source={appointment.source} />
                      </td>
                      <td className="table__num mono table__strong">
                        {formatCents(appointment.agreedPriceCents)}
                        {rate && (
                          <span className="amount-bs">
                            {formatBs(
                              Math.round(
                                (appointment.agreedPriceCents / 100) * rate.rate * 100,
                              ) / 100,
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </FadeIn>
      )}
    </div>
  );
}
