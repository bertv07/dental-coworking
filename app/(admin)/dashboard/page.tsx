import Link from 'next/link';
import { requireSuperAdmin } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { getCurrentRate, resolveRateSource } from '@/backend/services/exchange-rate.service';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { clinicDayKey } from '@/backend/domain/clinic-calendar';
import { libroConGastos } from '@/backend/domain/gastos-y-libro';
import { resumirLibro } from '@/backend/domain/ledger-summary';
import { FinanceDashboard } from '@/frontend/features/finance/FinanceDashboard';
import { AdminLedgerSummary } from '@/frontend/features/finance/AdminLedgerSummary';
import { FadeIn } from '@/frontend/components/motion';
import { IconPlus, IconDownload } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  /dashboard — Dashboard financiero del Super Admin
 * ===========================================================================
 *  Server Component: los datos se obtienen EN EL SERVIDOR y llegan al
 *  navegador ya renderizados como HTML.
 *
 *  Tres consecuencias directas:
 *   1. Cero JavaScript de obtención de datos en el bundle.
 *   2. Sin estados de carga ni parpadeo: el HTML llega completo.
 *   3. Las cifras financieras nunca viajan por una API que alguien pueda
 *      llamar por su cuenta — no existe tal endpoint.
 * ===========================================================================
 */

export const metadata = { title: 'Dashboard' };

/** Datos siempre frescos: un dashboard financiero cacheado engaña. */
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  // AUTORIZACIÓN: sólo Super Admin. Un asistente que escriba /dashboard a
  // mano acaba en /sin-permiso. El guard corre antes de tocar ningún dato.
  await requireSuperAdmin();

  // Periodo por defecto: los últimos 30 días.
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const range = { from, to };

  // La tasa preferida de la clínica, NO siempre BCV: aquí es normal poner los
  // precios en dólares y cobrar a tasa EURO. Fijar 'BCV' a mano haría que el
  // dashboard enseñara una cifra distinta de la que de verdad cobra el
  // mostrador.
  const settings = await repository.getClinicSettings();
  const rateSource = resolveRateSource(settings.preferredRateSource);

  // Las consultas en paralelo. Secuencialmente sumarían sus latencias;
  // con `Promise.all` el coste es el de la más lenta.
  const [summary, dentistEarnings, upcomingAppointments, rate, delLibro, cajaChica, dentists, gastosClinica] = await Promise.all([
    repository.getFinancialSummary(range),
    repository.getDentistEarnings(range),
    repository.listAppointments({
      range: { from: to, to: new Date(to.getTime() + 7 * 24 * 60 * 60 * 1000) },
      limit: 8,
    }),
    getCurrentRate(rateSource),
    repository.listAdminLedgerEntries({ book: 'GASTOS_ADMIN' }),
    repository.listAdminLedgerEntries({ book: 'CAJA_CHICA' }),
    repository.listDentists(),
    repository.listExpenses({ scope: 'CLINIC' }),
  ]);

  // El libro general CON los gastos de la clínica, igual que en la pestaña
  // de /administracion: las dos pantallas suman las mismas filas.
  const gastos = libroConGastos(delLibro, gastosClinica, clinicDayKey(to).slice(0, 7));

  // El libro de Administración: las MISMAS filas de /administracion, sumadas
  // por mes; `?mes=2026-09` enseña uno concreto.
  //
  // Sin elegir, el mes en curso (en Caracas, no en la zona del servidor) —
  // SALVO que todavía no tenga ninguna fila: entonces el último que sí. Los
  // primeros días del mes el libro está vacío, y una sección entera en $0
  // se lee como «esto no está conectado», no como «octubre acaba de empezar».
  const { mes } = await searchParams;
  const mesActual = clinicDayKey(to).slice(0, 7);
  const mesesConFilas = gastos.map((f) => f.date.slice(0, 7)).sort();
  const mesDelLibro =
    mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)
      ? mes
      : mesesConFilas.includes(mesActual)
        ? mesActual
        : (mesesConFilas.at(-1) ?? mesActual);
  const resumenDelLibro = resumirLibro({
    month: mesDelLibro,
    gastos,
    cajaChica,
    libros: await Promise.all(
      dentists.map(async (d) => ({
        dentistId: d.id,
        dentistName: d.fullName,
        filas: await repository.listDentistLedgerEntries({ dentistId: d.id }),
      })),
    ),
  });

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Dashboard"
          subtitle={
            <>
              Finanzas, comisiones y desempeño de la automatización.
              {rate && (
                <>
                  {' '}
                  <span className={`rate-chip ${rate.isStale ? 'rate-chip--stale' : ''}`}>
                    {rateSource} {rate.rate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs/USD
                    {rate.isStale && ' (desactualizada)'}
                  </span>
                </>
              )}
            </>
          }
          actions={
            <>
              {/* Lleva a la agenda, donde vive el formulario de alta. Un
                  modal duplicado aquí obligaría a mantener dos copias del
                  mismo formulario. */}
              <Link href="/agenda" className="btn btn--primary">
                <IconPlus size={16} /> Nueva cita
              </Link>

              {/* Descarga directa: es un GET a una API Route que devuelve el
                  CSV con `Content-Disposition: attachment`. No hace falta
                  JavaScript — funciona como cualquier enlace. */}
              <a href="/api/export/finanzas?dias=30" className="btn btn--ghost" download>
                <IconDownload size={16} /> Exportar
              </a>
            </>
          }
        />
      </FadeIn>

      {/*
        Los datos se pasan como props ya serializadas. El componente de
        presentación no sabe de dónde vienen — se puede testear con datos
        fijos y reutilizar en un futuro informe en PDF.
      */}
      <FinanceDashboard
        summary={summary}
        dentistEarnings={dentistEarnings}
        upcomingAppointments={upcomingAppointments}
        exchangeRate={rate?.rate ?? null}
        afterIndicators={<AdminLedgerSummary resumen={resumenDelLibro} />}
      />
    </div>
  );
}
