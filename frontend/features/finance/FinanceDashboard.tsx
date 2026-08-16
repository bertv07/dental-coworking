import type {
  AppointmentWithRelations,
  DentistEarnings,
  FinancialSummary,
} from '@/backend/domain/types';
import { formatCents, formatBs, centsToBs } from '@/backend/domain/money';
import {
  Card,
  Stat,
  Badge,
  SplitBar,
  EmptyState,
  Avatar,
  AppointmentStatusBadge,
  SourceBadge,
} from '@/frontend/components/ui/primitives';
import {
  Stagger,
  StaggerItem,
  HoverCard,
  FadeIn,
  CountUp,
} from '@/frontend/components/motion';

/**
 * ===========================================================================
 *  Dashboard financiero — presentación
 * ===========================================================================
 *  Componente PURO de presentación. Recibe datos por props y no consulta
 *  nada. Server Component: sólo los envoltorios de animación son de cliente.
 *
 *  Responde a las tres preguntas del Super Admin:
 *    1. ¿Cuánto se facturó?            → ingresos totales
 *    2. ¿Cuánto le queda a la clínica? → el 40%
 *    3. ¿Cuánto le debo a cada uno?    → el 60%, por odontólogo
 * ===========================================================================
 */

interface FinanceDashboardProps {
  summary: FinancialSummary;
  dentistEarnings: DentistEarnings[];
  upcomingAppointments: AppointmentWithRelations[];
  /** Tasa BCV vigente. `null` si DolarAPI nunca respondió. */
  exchangeRate: number | null;
}

/**
 * Importe en dólares con su equivalente en bolívares debajo.
 *
 * Las dos monedas juntas porque son las dos preguntas que se hacen a la vez
 * en una clínica venezolana: cuánto vale (USD, estable) y cuánto se cobra
 * hoy (Bs, a la tasa del día).
 */
function Amount({ cents, rate }: { cents: number; rate: number | null }) {
  return (
    <>
      {formatCents(cents)}
      {rate !== null && (
        <span className="amount-bs">{formatBs(centsToBs(cents, rate))}</span>
      )}
    </>
  );
}

/** Formatea fecha y hora en la zona de la clínica, de forma estable. */
function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Caracas',
  }).format(date);
}

export function FinanceDashboard({
  summary,
  dentistEarnings,
  upcomingAppointments,
  exchangeRate,
}: FinanceDashboardProps) {
  const totalAppointments =
    summary.completedAppointments + summary.cancelledAppointments + summary.noShowAppointments;

  // Tasa de citas originadas por la IA: la métrica que justifica el bot.
  const aiRate =
    totalAppointments > 0
      ? Math.round((summary.aiBookedAppointments / totalAppointments) * 100)
      : 0;

  // Sólo odontólogos con actividad: doce filas en cero no aportan nada.
  const activeEarnings = dentistEarnings.filter((row) => row.grossCents > 0);

  return (
    <>
      {/* --- Indicadores principales ------------------------------------ */}
      <Stagger className="stat-grid">
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Ingresos totales"
              // `CountUp` anima el número al cargar. Se le pasa el formateador
              // para que cada fotograma salga ya como moneda, y el valor final
              // sea EXACTAMENTE el recibido, sin errores de redondeo.
              value={<CountUp value={summary.totalRevenueCents} format="currency" />}
              meta="últimos 30 días"
              deltaPercent={summary.revenueChangePercent}
              featured
              compact
            />
          </HoverCard>
        </StaggerItem>

        <StaggerItem>
          <HoverCard>
            <Stat
              label="Ganancia clínica"
              value={<CountUp value={summary.clinicEarningsCents} format="currency" />}
              meta="comisión retenida"
              compact
            />
          </HoverCard>
        </StaggerItem>

        <StaggerItem>
          <HoverCard>
            <Stat
              label="Devengado odontólogos"
              value={<CountUp value={summary.dentistEarningsCents} format="currency" />}
              meta="generado en el periodo"
              compact
            />
          </HoverCard>
        </StaggerItem>

        <StaggerItem>
          <HoverCard>
            <Stat
              label="Deuda pendiente"
              value={<CountUp value={summary.outstandingPayoutsCents} format="currency" />}
              meta="sin liquidar"
              compact
            />
          </HoverCard>
        </StaggerItem>
      </Stagger>

      {/* --- Reparto y automatización ----------------------------------- */}
      <div className="grid-2">
        <FadeIn delay={0.14}>
          <Card
            title="Distribución de ingresos"
            subtitle="Reparto entre la clínica y el cuerpo odontológico"
          >
            <SplitBar
              clinicCents={summary.clinicEarningsCents}
              dentistCents={summary.dentistEarningsCents}
              clinicLabel={formatCents(summary.clinicEarningsCents)}
              dentistLabel={formatCents(summary.dentistEarningsCents)}
            />

            <div className="row row--wrap" style={{ marginTop: '1.5rem', gap: '2.5rem' }}>
              <div>
                <div className="text-xs subtle">Completadas</div>
                <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                  <CountUp value={summary.completedAppointments} />
                </div>
              </div>
              <div>
                <div className="text-xs subtle">Canceladas</div>
                <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                  <CountUp value={summary.cancelledAppointments} />
                </div>
              </div>
              <div>
                <div className="text-xs subtle">No asistieron</div>
                <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                  <CountUp value={summary.noShowAppointments} />
                </div>
              </div>
            </div>
          </Card>
        </FadeIn>

        <FadeIn delay={0.2}>
          <Card title="Automatización" subtitle="Desempeño del bot de WhatsApp">
            <div className="stack">
              <div>
                <div
                  className="stat__value"
                  style={{ color: 'var(--color-primary)', fontSize: '2.75rem' }}
                >
                  <CountUp value={aiRate} />%
                </div>
                <div className="text-xs subtle">de las citas las agendó la IA</div>
              </div>

              {/* Barra de progreso simple: la proporción se lee mejor que el número solo. */}
              <div className="split-bar">
                <div
                  className="split-bar__segment split-bar__segment--clinic"
                  style={{ width: `${aiRate}%` }}
                />
                <div
                  className="split-bar__segment split-bar__segment--dentist"
                  style={{ width: `${100 - aiRate}%` }}
                />
              </div>

              <div className="row row--between text-sm">
                <span className="muted">Citas por IA</span>
                <span className="mono table__strong">{summary.aiBookedAppointments}</span>
              </div>
              <div className="row row--between text-sm">
                <span className="muted">Total del periodo</span>
                <span className="mono table__strong">{totalAppointments}</span>
              </div>
            </div>
          </Card>
        </FadeIn>
      </div>

      {/* --- Liquidación por odontólogo --------------------------------- */}
      <FadeIn delay={0.26}>
        <Card
          title="Liquidación por odontólogo"
          subtitle="Producción, comisión de la clínica y saldo pendiente"
          flush
        >
          {activeEarnings.length === 0 ? (
            <EmptyState>Sin movimientos registrados en este periodo.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Odontólogo</th>
                    <th className="table__num">Citas</th>
                    <th className="table__num">Producción</th>
                    <th className="table__num">Comisión</th>
                    <th className="table__num">Clínica</th>
                    <th className="table__num">Odontólogo</th>
                    <th className="table__num">Por pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {activeEarnings.map((row) => (
                    <tr key={row.dentistId}>
                      <td>
                        <div className="row">
                          <Avatar name={row.dentistName} small />
                          <span className="table__strong">{row.dentistName}</span>
                        </div>
                      </td>
                      <td className="table__num muted">{row.appointmentCount}</td>
                      <td className="table__num mono">{formatCents(row.grossCents)}</td>
                      <td className="table__num">
                        {/* Comisión no estándar → se resalta, para detectar
                            de un vistazo los acuerdos especiales. */}
                        <Badge tone={row.commissionPercent === 40 ? 'neutral' : 'warning'}>
                          {row.commissionPercent}%
                        </Badge>
                      </td>
                      <td
                        className="table__num mono"
                        style={{ color: 'var(--color-primary)', fontWeight: 600 }}
                      >
                        {formatCents(row.clinicShareCents)}
                      </td>
                      <td className="table__num mono muted">
                        {formatCents(row.dentistShareCents)}
                      </td>
                      <td className="table__num mono table__strong">
                        {row.outstandingCents > 0 ? (
                          <span style={{ color: 'var(--color-warning)' }}>
                            <Amount cents={row.outstandingCents} rate={exchangeRate} />
                          </span>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* Fila de totales: el número que el admin busca primero. */}
                <tfoot>
                  <tr style={{ background: 'var(--color-surface-soft)' }}>
                    <td className="table__strong">Total</td>
                    <td className="table__num muted">
                      {activeEarnings.reduce((sum, row) => sum + row.appointmentCount, 0)}
                    </td>
                    <td className="table__num mono table__strong">
                      {formatCents(activeEarnings.reduce((s, r) => s + r.grossCents, 0))}
                    </td>
                    <td />
                    <td className="table__num mono table__strong">
                      {formatCents(activeEarnings.reduce((s, r) => s + r.clinicShareCents, 0))}
                    </td>
                    <td className="table__num mono table__strong">
                      {formatCents(activeEarnings.reduce((s, r) => s + r.dentistShareCents, 0))}
                    </td>
                    <td className="table__num mono table__strong">
                      {formatCents(activeEarnings.reduce((s, r) => s + r.outstandingCents, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </FadeIn>

      {/* --- Próximas citas --------------------------------------------- */}
      <FadeIn delay={0.32}>
        <Card title="Próximas citas" subtitle="Siguientes 7 días" flush>
          {upcomingAppointments.length === 0 ? (
            <EmptyState>No hay citas programadas.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Paciente</th>
                    <th>Tratamiento</th>
                    <th>Odontólogo</th>
                    <th>Sala</th>
                    <th>Origen</th>
                    <th>Estado</th>
                    <th className="table__num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingAppointments.map((appointment) => (
                    <tr key={appointment.id}>
                      <td className="mono text-xs">{formatDateTime(appointment.startsAt)}</td>
                      {/*
                        React escapa este contenido automáticamente. Un paciente
                        llamado `<img onerror=...>` se muestra como texto plano.
                      */}
                      <td className="table__strong">{appointment.patient.fullName}</td>
                      <td className="muted">{appointment.treatment.name}</td>
                      <td className="muted">{appointment.dentist.fullName}</td>
                      <td>
                        <Badge tone="neutral">{appointment.room.code}</Badge>
                      </td>
                      <td>
                        <SourceBadge source={appointment.source} />
                      </td>
                      <td>
                        <AppointmentStatusBadge status={appointment.status} />
                      </td>
                      <td className="table__num mono">
                        <Amount cents={appointment.agreedPriceCents} rate={exchangeRate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </FadeIn>
    </>
  );
}
