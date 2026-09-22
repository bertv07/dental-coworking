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
import { CashFilters, urlCaja, type CashFilterState, type Periodo } from '@/frontend/features/admin/CashFilters';
import { CashReport } from '@/frontend/features/admin/CashReport';
import { clinicDayRange, clinicWallClockToInstant, parseDayKey, startOfWeek } from '@/backend/domain/clinic-calendar';

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

/** Rango de instantes de un periodo, en hora de la clínica. `to` es exclusivo. */
function rangoDelPeriodo(periodo: Periodo, fecha: string, desde: string, hasta: string) {
  const dia = (k: string) => clinicWallClockToInstant(k, 0);
  switch (periodo) {
    case 'semana': {
      const lunes = startOfWeek(fecha);
      return { from: dia(lunes), to: dia(addDays(lunes, 7)), titulo: `Semana del ${lunes}` };
    }
    case 'mes': {
      const y = Number(fecha.slice(0, 4));
      const m = Number(fecha.slice(5, 7));
      const inicio = `${y}-${String(m).padStart(2, '0')}-01`;
      const fin = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const nombre = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'America/Caracas' })
        .format(dia(inicio));
      return { from: dia(inicio), to: dia(fin), titulo: nombre.charAt(0).toUpperCase() + nombre.slice(1) };
    }
    case 'anio': {
      const y = Number(fecha.slice(0, 4));
      return { from: dia(`${y}-01-01`), to: dia(`${y + 1}-01-01`), titulo: `Año ${y}` };
    }
    case 'todo':
      // Desde antes de que existiera la clínica hasta mañana: todo lo que hay.
      return { from: dia('2000-01-01'), to: dia(addDays(clinicDayKey(new Date()), 1)), titulo: 'Todo el historial' };
    case 'rango':
      return { from: dia(desde), to: dia(addDays(hasta, 1)), titulo: `Del ${desde} al ${hasta}` };
    default:
      return { ...clinicDayRange(dia(fecha)), titulo: '' };
  }
}

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{
    fecha?: string;
    periodo?: string;
    desde?: string;
    hasta?: string;
    odontologo?: string;
    metodo?: string;
  }>;
}) {
  const user = await requireRole('ASSISTANT');
  const params = await searchParams;

  /*
   * Todo lo que viene de la URL se valida antes de usarse: un `new Date()`
   * con cualquier cosa da `Invalid Date` y rompe la consulta. Un rango con
   * las dos fechas gana sobre el periodo; un rango a medias se ignora.
   */
  const hoyKey = clinicDayKey(new Date());
  const desde = parseDayKey(params.desde) ?? '';
  const hasta = parseDayKey(params.hasta) ?? '';
  const periodoPedido = (['dia', 'semana', 'mes', 'anio', 'todo'] as const).find((p) => p === params.periodo) ?? 'dia';
  const periodo: Periodo = desde && hasta && desde <= hasta ? 'rango' : periodoPedido;
  const fecha = parseDayKey(params.fecha) ?? hoyKey;
  const metodos = ['CASH', 'CARD', 'TRANSFER', 'INSURANCE', 'CREDIT'] as const;
  const metodo = metodos.find((m) => m === params.metodo);
  const odontologo = /^[a-z0-9]{20,30}$/i.test(params.odontologo ?? '') ? params.odontologo! : '';

  const filtros: CashFilterState = { periodo, fecha, desde, hasta, odontologo, metodo: metodo ?? '' };

  // Con filtros de odontólogo o medio, hasta el día se ve como informe: el
  // arqueo cuadra la caja ENTERA y no tiene sentido con una parte.
  const esInforme = periodo !== 'dia' || Boolean(metodo) || Boolean(odontologo);
  const rango = rangoDelPeriodo(periodo, fecha, desde, hasta);

  const dentistsParaFiltro = (await repository.listDentists({ includeInactive: true })).map((d) => ({
    id: d.id,
    fullName: d.fullName,
  }));

  if (esInforme) {
    const report = await repository.getCashReport({
      from: rango.from,
      to: rango.to,
      method: metodo,
      dentistId: odontologo || undefined,
    });
    const diasAtras = Math.max(1, Math.ceil((Date.now() - rango.from.getTime()) / 86_400_000));
    const titulo = periodo === 'dia' ? `Día ${fecha}` : rango.titulo;

    return (
      <div className="page-body">
        <FadeIn>
          <PageHead
            title="Caja"
            subtitle={titulo}
            actions={
              <a href={`/api/export/finanzas?dias=${diasAtras}`} className="btn btn--ghost" download>
                <IconDownload size={16} /> Exportar
              </a>
            }
          />
        </FadeIn>
        <div className="caja-layout">
          <div className="stack" style={{ gap: 'var(--space-5)' }}>
            <CashReport report={report} tituloPeriodo={titulo} />
          </div>
          <CashFilters state={filtros} todayKey={hoyKey} dentists={dentistsParaFiltro} />
        </div>
      </div>
    );
  }

  const requested = clinicWallClockToInstant(fecha, 12 * 60);
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
              <a href={urlCaja(filtros, { fecha: addDays(businessDate, -1) })} className="btn btn--ghost">
                <IconChevronLeft size={15} /> Anterior
              </a>
              {/* Sin salto al futuro: no hay caja que revisar por delante. */}
              {businessDate < todayKey && (
                <a href={urlCaja(filtros, { fecha: addDays(businessDate, 1) })} className="btn btn--ghost">
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

      <div className="caja-layout">
      <div className="stack" style={{ gap: 'var(--space-5)' }}>
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
      <CashFilters state={filtros} todayKey={hoyKey} dentists={dentistsParaFiltro} />
      </div>
    </div>
  );
}
