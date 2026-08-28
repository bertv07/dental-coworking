import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { formatCents, formatBs } from '@/backend/domain/money';
import { clinicDayKey, addDays } from '@/backend/domain/clinic-calendar';
import { getCurrentRate, resolveRateSource } from '@/backend/services/exchange-rate.service';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { Card, Stat, Badge, EmptyState } from '@/frontend/components/ui/primitives';
import { FadeIn, Stagger, StaggerItem, HoverCard } from '@/frontend/components/motion';
import { IconDownload, IconChevronLeft, IconChevronRight } from '@/frontend/components/ui/icons';
import { CashClosePanel } from '@/frontend/features/admin/CashClosePanel';
import { PendingCharges } from '@/frontend/features/admin/PendingCharges';
import { DailySettlements } from '@/frontend/features/admin/DailySettlements';

/**
 * ===========================================================================
 *  /caja — Cierre de caja del día
 * ===========================================================================
 *  ACCESO: asistente o superior. Es la pantalla con la que recepción cuadra
 *  al final de la jornada.
 *
 *  DE DÓNDE SALEN ESTOS DATOS:
 *  De los cobros que la propia recepción registró desde la agenda. Cada uno
 *  guarda su tasa Bs/USD, así que el total en bolívares es la suma de lo que
 *  REALMENTE entró — no una reconversión al tipo de cambio de ahora, que
 *  daría un número distinto y descuadraría el arqueo.
 *
 *  Los mismos cobros alimentan el dashboard del administrador. Es el punto
 *  donde el trabajo del mostrador se convierte en las finanzas de la clínica.
 * ===========================================================================
 */

export const metadata = { title: 'Caja' };
export const dynamic = 'force-dynamic';

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  INSURANCE: 'Seguro',
};

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const user = await requireRole('ASSISTANT');
  const params = await searchParams;

  // Permite revisar el cierre de días anteriores. Se valida el formato: un
  // `new Date("cualquier cosa")` daría `Invalid Date` y rompería la consulta.
  const requested = params.fecha?.match(/^\d{4}-\d{2}-\d{2}$/)
    ? new Date(`${params.fecha}T12:00:00`)
    : new Date();

  const cash = await repository.getDailyCash(requested);

  // Día de calendario en hora de la clínica. Es la clave del arqueo y la que
  // usan los enlaces de navegación entre días.
  const businessDate = clinicDayKey(cash.date);
  const todayKey = clinicDayKey(new Date());

  const [closing, pending, settings, settlements] = await Promise.all([
    repository.getCashClosing(businessDate),
    // Lo que falta por cobrar: sólo tiene sentido en un día no cerrado.
    repository.listUnpaidAppointmentsForDay(businessDate),
    repository.getClinicSettings(),
    // «Se paga al final del día»: lo que le toca a cada odontólogo hoy.
    repository.getDailySettlements(businessDate),
  ]);

  const paymentMethods = await repository.listPaymentMethods();

  const rateSource = resolveRateSource(settings.preferredRateSource);
  const rate = await getCurrentRate(rateSource);

  const commissionByDentist: Record<string, number> = {};
  for (const dentist of await repository.listDentists({ includeInactive: true })) {
    commissionByDentist[dentist.id] = dentist.clinicCommissionPercent;
  }

  const expectedCashBs = cash.byMethod.find((row) => row.method === 'CASH')?.bs ?? 0;

  const dateLabel = new Intl.DateTimeFormat('es-VE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Caracas',
  }).format(cash.date);

  const timeFormatter = new Intl.DateTimeFormat('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Caracas',
  });

  const isoDate = cash.date.toISOString().slice(0, 10);

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Caja del día"
          subtitle={dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}
          actions={
            <>
              {/* Navegación por días con enlaces: sin JavaScript y compartible. */}
              <a href={`/caja?fecha=${addDays(businessDate, -1)}`} className="btn btn--ghost">
                <IconChevronLeft size={15} /> Anterior
              </a>
              {/* Sin salto al futuro: no hay caja que revisar por delante. */}
              {businessDate < todayKey && (
                <a href={`/caja?fecha=${addDays(businessDate, 1)}`} className="btn btn--ghost">
                  Siguiente <IconChevronRight size={15} />
                </a>
              )}
              <a href={`/api/export/finanzas?dias=1`} className="btn btn--ghost" download>
                <IconDownload size={16} /> Exportar
              </a>
            </>
          }
        />
      </FadeIn>

      <Stagger className="stat-grid">
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Total cobrado"
              value={formatCents(cash.totalCents)}
              meta={`${cash.paymentCount} ${cash.paymentCount === 1 ? 'cobro' : 'cobros'}`}
              featured
              compact
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="En bolívares"
              value={formatBs(cash.totalBs)}
              meta="suma de lo realmente cobrado"
              compact
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Queda en la clínica"
              value={formatCents(cash.clinicShareCents)}
              meta="comisión retenida"
              compact
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Para odontólogos"
              value={formatCents(cash.dentistShareCents)}
              meta="devengado hoy"
              compact
            />
          </HoverCard>
        </StaggerItem>
      </Stagger>

      {/* El trabajo del mostrador va ARRIBA: primero cobrar lo que falta,
          después cuadrar. El detalle histórico queda debajo. */}
      <div className="grid-2">
        <FadeIn delay={0.1}>
          <PendingCharges
            appointments={pending}
            exchangeRate={rate?.rate ?? null}
            rateSource={rateSource}
            commissionByDentist={commissionByDentist}
            isClosed={closing !== null}
            paymentMethods={paymentMethods}
          />
        </FadeIn>

        <FadeIn delay={0.14}>
          <CashClosePanel
            businessDate={businessDate}
            dateLabel={dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}
            expectedCashBs={expectedCashBs}
            totalBs={cash.totalBs}
            paymentCount={cash.paymentCount}
            closing={closing}
            canReopen={user.role === 'SUPER_ADMIN'}
            isFuture={businessDate > todayKey}
          />
        </FadeIn>
      </div>

      {/*
        La liquidación va DESPUÉS de cuadrar la caja: primero se sabe cuánto
        entró y que el efectivo cuadra, y sólo entonces se reparte.
      */}
      <FadeIn delay={0.16}>
        <DailySettlements
          settlements={settlements}
          businessDate={businessDate}
          exchangeRate={rate?.rate ?? null}
          canSettle={user.role === 'SUPER_ADMIN'}
        />
      </FadeIn>

      <div className="grid-2">
        <FadeIn delay={0.18}>
          <Card title="Cobros del día" subtitle="En orden de registro" flush>
            {cash.payments.length === 0 ? (
              <EmptyState>
                Aún no se ha registrado ningún cobro hoy.
                <br />
                Los cobros se registran desde la agenda, con el botón «Cobrar».
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table table--cards">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Paciente</th>
                      <th>Tratamiento</th>
                      <th>Medio</th>
                      <th className="table__num">USD</th>
                      <th className="table__num">Bolívares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cash.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="mono text-xs" data-label="Hora">{timeFormatter.format(payment.paidAt)}</td>
                        <td data-label="Paciente">
                          <div className="table__strong">{payment.patientName}</div>
                          <div className="text-xs subtle">{payment.dentistName}</div>
                        </td>
                        <td className="muted text-xs" data-label="Tratamiento">{payment.treatmentName}</td>
                        <td data-label="Medio">
                          <Badge tone="neutral">
                            {METHOD_LABEL[payment.method] ?? payment.method}
                          </Badge>
                        </td>
                        <td className="table__num mono table__strong" data-label="USD">
                          {formatCents(payment.amountCents)}
                        </td>
                        <td className="table__num mono" style={{ color: 'var(--color-primary)' }} data-label="Bolívares">
                          {formatBs(payment.amountBs)}
                          {/* La tasa de CADA cobro: si el BCV cambió a media
                              jornada, aquí se ve y el arqueo cuadra igual. */}
                          <span className="amount-bs">
                            @ {payment.exchangeRate.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </FadeIn>

        <FadeIn delay={0.22}>
          <Card title="Desglose por medio de pago" subtitle="Para el arqueo">
            {cash.byMethod.length === 0 ? (
              <EmptyState>Sin movimientos.</EmptyState>
            ) : (
              <div className="stack">
                {cash.byMethod.map((row) => (
                  <div key={row.method} className="row row--between">
                    <div>
                      <div className="text-sm" style={{ fontWeight: 600 }}>
                        {METHOD_LABEL[row.method] ?? row.method}
                      </div>
                      <div className="text-xs subtle">
                        {row.count} {row.count === 1 ? 'cobro' : 'cobros'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono table__strong">{formatCents(row.cents)}</div>
                      <div className="text-xs subtle mono">{formatBs(row.bs)}</div>
                    </div>
                  </div>
                ))}

                <div
                  className="row row--between"
                  style={{ borderTop: '2px solid var(--color-border-strong)', paddingTop: '0.75rem' }}
                >
                  <span style={{ fontWeight: 700 }}>Total</span>
                  <div style={{ textAlign: 'right' }}>
                    <div className="mono" style={{ fontWeight: 700 }}>
                      {formatCents(cash.totalCents)}
                    </div>
                    <div className="text-xs mono" style={{ color: 'var(--color-primary)' }}>
                      {formatBs(cash.totalBs)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
