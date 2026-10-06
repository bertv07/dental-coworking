import Link from 'next/link';
import { requireAuth } from '@/backend/auth/guards';
import { redirect } from 'next/navigation';
import { repository } from '@/backend/repositories';
import { formatCents } from '@/backend/domain/money';
import { clinicDayKey, clinicWallClockToInstant, addDays } from '@/backend/domain/clinic-calendar';
import { gastosDelPeriodo } from '@/backend/domain/gastos';
import { egresosDelLibroComoGastos } from '@/backend/domain/gastos-y-libro';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn, Stagger, StaggerItem, HoverCard } from '@/frontend/components/motion';
import { Card, Stat, Notice } from '@/frontend/components/ui/primitives';
import { IconChevronLeft, IconChevronRight } from '@/frontend/components/ui/icons';
import {
  ExpensesManager,
  CATEGORIAS_SUGERIDAS_CLINICA,
  CATEGORIAS_SUGERIDAS_ODONTOLOGA,
} from '@/frontend/features/finance/ExpensesManager';

/**
 * ===========================================================================
 *  /gastos — lo que sale, y lo que queda de verdad
 * ===========================================================================
 *  La caja dice cuánto entra. Esta pantalla resta lo que se paga para
 *  trabajar y dice lo que queda: para la clínica, su parte de los cobros
 *  menos luz, condominio, publicidad…; para cada odontóloga, su parte menos
 *  lo que compra.
 *
 *  Dos vistas con la misma pantalla, decididas por la SESIÓN:
 *   · SUPER_ADMIN → los gastos de la clínica.
 *   · DENTIST     → sus propios gastos. No ve los de nadie más.
 *  Recepción no entra: no son gastos suyos.
 *
 *  Se ve por MES (?mes=YYYY-MM), que es como se pagan la luz y el
 *  condominio, y como se liquida a las odontólogas.
 * ===========================================================================
 */

export const metadata = { title: 'Gastos' };
export const dynamic = 'force-dynamic';

function mesAnterior(m: string) {
  const [y, mm] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))];
  return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`;
}
function mesSiguiente(m: string) {
  const [y, mm] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))];
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
}
/** Último día del mes 'YYYY-MM' como 'YYYY-MM-DD'. */
function finDeMes(m: string) {
  return addDays(`${mesSiguiente(m)}-01`, -1);
}

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const user = await requireAuth();
  if (user.role === 'ASSISTANT') redirect('/sin-permiso');

  const { mes: mesPedido } = await searchParams;
  const mesActual = clinicDayKey(new Date()).slice(0, 7);
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(mesPedido ?? '') ? mesPedido! : mesActual;
  const desde = `${mes}-01`;
  const hasta = finDeMes(mes);

  const nombreMes = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${desde}T12:00:00Z`));
  const tituloMes = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

  // --- De quién son los gastos y los ingresos ------------------------------
  let scope: 'CLINIC' | 'DENTIST' = 'CLINIC';
  let dentistId: string | undefined;
  if (user.role === 'DENTIST') {
    const perfil = await repository.findDentistByUserId(user.id);
    if (!perfil) {
      return (
        <div className="page-body">
          <PageHead title="Mis gastos" />
          <Notice tone="warning">
            Tu usuario todavía no está vinculado a una ficha de odontólogo. Pídele al
            administrador que enlace tu cuenta desde <strong>Odontólogos</strong>.
          </Notice>
        </div>
      );
    }
    scope = 'DENTIST';
    dentistId = perfil.id;
  }

  const [gastos, libro, caja] = await Promise.all([
    repository.listExpenses({ scope, dentistId }),
    // Sólo la clínica: el libro de Administración es suyo, no de una odontóloga.
    scope === 'CLINIC' ? repository.listAdminLedgerEntries({ book: 'GASTOS_ADMIN' }) : Promise.resolve([]),
    repository.getCashReport({
      from: clinicWallClockToInstant(desde, 0),
      to: clinicWallClockToInstant(addDays(hasta, 1), 0),
      dentistId,
    }),
  ]);

  const { filas, totalCents: gastosPropiosCents } = gastosDelPeriodo(gastos, desde, hasta);
  /*
   * Los egresos del libro de Administración también son gastos de la clínica
   * —la publicidad, un sueldo, una reparación—, se hayan escrito a mano o
   * subido por Excel. Se suman aquí para que «le queda de verdad» sea uno
   * solo. Los «Pago Dra» no: lo que le entra a la clínica ya es sin su parte.
   */
  const delLibro = egresosDelLibroComoGastos(libro, desde, hasta);
  const gastosCents = gastosPropiosCents + delLibro.totalCents;
  const conceptos = filas.length + delLibro.filas.length;
  // La clínica cuenta su parte de los cobros; la odontóloga, la suya.
  const ingresosCents = scope === 'CLINIC' ? caja.clinicShareCents : caja.dentistShareCents;
  const quedaCents = ingresosCents - gastosCents;
  const esClinica = scope === 'CLINIC';

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title={esClinica ? 'Gastos de la clínica' : 'Mis gastos'}
          subtitle={tituloMes}
          actions={
            <>
              <Link href={`/gastos?mes=${mesAnterior(mes)}`} className="btn btn--ghost">
                <IconChevronLeft size={15} /> Mes anterior
              </Link>
              {mes < mesActual && (
                <Link href={`/gastos?mes=${mesSiguiente(mes)}`} className="btn btn--ghost">
                  Mes siguiente <IconChevronRight size={15} />
                </Link>
              )}
            </>
          }
        />
      </FadeIn>

      <Stagger className="stat-grid">
        <StaggerItem>
          <HoverCard>
            <Stat
              label={esClinica ? 'Le entra a la clínica' : 'Tu parte de los cobros'}
              value={formatCents(ingresosCents)}
              meta={`${caja.paymentCount} ${caja.paymentCount === 1 ? 'cobro' : 'cobros'} en el mes`}
              compact
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Gastos del mes"
              value={formatCents(gastosCents)}
              meta={`${conceptos} ${conceptos === 1 ? 'concepto' : 'conceptos'}`}
              compact
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label={esClinica ? 'Le queda de verdad' : 'Ganaste de verdad'}
              value={formatCents(quedaCents)}
              meta={quedaCents < 0 ? 'los gastos superan lo cobrado' : 'después de restar los gastos'}
              featured
              compact
            />
          </HoverCard>
        </StaggerItem>
      </Stagger>

      <FadeIn delay={0.1}>
        <ExpensesManager
          filas={filas}
          categorias={esClinica ? CATEGORIAS_SUGERIDAS_CLINICA : CATEGORIAS_SUGERIDAS_ODONTOLOGA}
          tituloPeriodo={`Lo que cuenta en ${tituloMes.toLowerCase()}`}
        />
      </FadeIn>

      {delLibro.filas.length > 0 && (
        <FadeIn delay={0.14}>
          <Card
            title="Del libro de Administración"
            subtitle={`Egresos anotados en el libro en ${tituloMes.toLowerCase()} — ya están sumados arriba`}
            flush
            actions={
              <Link href="/administracion?tab=gastos" className="btn btn--ghost btn--sm">
                Abrir el libro
              </Link>
            }
          >
            <div className="table-wrap">
              <table className="table table--cards">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th className="table__num">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {delLibro.filas.map((f) => (
                    <tr key={f.id}>
                      <td data-label="Fecha" className="text-xs mono">
                        {new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', timeZone: 'UTC' })
                          .format(new Date(`${f.date}T12:00:00Z`))}
                      </td>
                      <td data-label="Concepto">
                        <div className="table__strong">{f.description}</div>
                        {f.notes && <div className="text-xs subtle">{f.notes}</div>}
                      </td>
                      <td data-label="Monto" className="table__num mono">{formatCents(f.expenseCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 700, textAlign: 'right' }}>Total del libro</td>
                    <td className="table__num mono" style={{ fontWeight: 700 }}>{formatCents(delLibro.totalCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </FadeIn>
      )}
    </div>
  );
}
