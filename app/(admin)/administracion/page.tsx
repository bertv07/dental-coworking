import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { clinicDayKey } from '@/backend/domain/clinic-calendar';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { AdminLedgerManager } from '@/frontend/features/finance/AdminLedgerManager';
import { DentistLedgerManager } from '@/frontend/features/finance/DentistLedgerManager';
import { PeriodClosingReport } from '@/frontend/features/finance/PeriodClosingReport';
import { esPeriodoValido, obtenerCierre } from '@/backend/services/cierre.service';
import { LedgerImport } from '@/frontend/features/finance/LedgerImport';
import { IconChevronLeft, IconChevronRight, IconClose, IconDownload } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  /administracion — el libro que Deimara llevaba en Excel
 * ===========================================================================
 *  Pestañas, como en la hoja de cálculo: Gastos Administrativos, Caja Chica,
 *  y una por cada odontóloga ACTIVA — «todas las que estén registradas», así
 *  que la lista sale de la base y no de un texto fijo: una odontóloga nueva
 *  aparece sola, con su libro vacío.
 *
 *  SÓLO Super Admin: es dinero de la clínica y de cada odontóloga por
 *  separado, la misma razón por la que el reparto no se le enseña a
 *  recepción en ningún otro sitio del panel.
 *
 *  ES UN LIBRO MANUAL, a propósito. No se deriva de Facturas/Caja: la
 *  clínica ya llevaba esta contabilidad a mano en la hoja de cálculo, y este
 *  panel es esa misma hoja, no un espejo automático de otra cosa. Cargar
 *  aquí una fila no crea ninguna factura, y cobrar una factura no escribe
 *  ninguna fila aquí — son dos historias distintas por diseño.
 * ===========================================================================
 */

/**
 * Qué mes enseñar de un libro, y entre cuáles se puede pasar.
 *
 * El libro se ve POR MES, como la hoja de cálculo (una hoja por mes): la
 * lista entera crece sin fin y el Total General de «todo» no es el que nadie
 * va a comparar con su Excel.
 *
 * Sin elegir, el mes en curso — salvo que esté vacío y haya otros con filas:
 * entonces el último que tenga. «todo» sigue disponible para ver la lista
 * completa.
 */
function elegirMes(fechas: string[], pedido: string | undefined, mesActual: string) {
  // Los meses con filas, más el actual: es por donde pasan Anterior/Siguiente.
  const meses = [...new Set([...fechas.map((f) => f.slice(0, 7)), mesActual])].sort();
  const conFilas = new Set(fechas.map((f) => f.slice(0, 7)));
  let mes: string;
  if (pedido === 'todo') mes = 'todo';
  else if (pedido && /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido)) mes = pedido;
  else mes = conFilas.has(mesActual) || conFilas.size === 0 ? mesActual : [...conFilas].sort().at(-1)!;
  return {
    mes,
    anterior: mes === 'todo' ? null : (meses.filter((m) => m < mes).at(-1) ?? null),
    siguiente: mes === 'todo' ? null : (meses.find((m) => m > mes) ?? null),
  };
}

function nombreDelMes(mes: string): string {
  const nombre = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${mes}-15T12:00:00Z`));
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

export const metadata = { title: 'Administración' };
export const dynamic = 'force-dynamic';

export default async function AdministracionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; cargar?: string; periodo?: string; mes?: string }>;
}) {
  await requireRole('SUPER_ADMIN');

  const { tab, cargar, periodo, mes: mesPedido } = await searchParams;
  const mesActual = clinicDayKey(new Date()).slice(0, 7);
  const pestañaActual = tab ?? 'gastos';
  // En la URL, como las pestañas: recargar no cierra la carga a medias.
  const esCierre = pestañaActual === 'cierre';
  // El cierre no es un libro: ahí no hay nada que cargar.
  const cargando = cargar === '1' && !esCierre;

  const dentists = await repository.listDentists();

  const PESTAÑAS = [
    { id: 'gastos', label: 'Gastos General' },
    { id: 'caja-chica', label: 'Caja Chica' },
    ...dentists.map((d) => ({ id: `dr-${d.id}`, label: d.fullName })),
  ];

  if (!esCierre && !PESTAÑAS.some((p) => p.id === pestañaActual)) redirect('/administracion');

  let contenido: React.ReactNode;
  /** El mes que se está viendo en el libro; `null` en el cierre. */
  let vista: ReturnType<typeof elegirMes> | null = null;
  const delMes = <F extends { date: string }>(filas: F[], mes: string) =>
    mes === 'todo' ? filas : filas.filter((f) => f.date.startsWith(mes));

  if (esCierre) {
    // Por defecto el mes en curso; `?periodo=2026` es el cierre anual.
    const period = esPeriodoValido(periodo) ? periodo : mesActual;
    const [datos, closings] = await Promise.all([
      obtenerCierre(period),
      repository.listPeriodClosings(period.slice(0, 4)),
    ]);
    contenido = (
      <PeriodClosingReport
        datos={datos}
        closing={closings.find((c) => c.period === period) ?? null}
        closings={closings}
        periodoActual={mesActual}
      />
    );
  } else if (pestañaActual === 'gastos') {
    const filas = await repository.listAdminLedgerEntries({ book: 'GASTOS_ADMIN' });
    vista = elegirMes(filas.map((f) => f.date), mesPedido, mesActual);
    contenido = <AdminLedgerManager book="GASTOS_ADMIN" filas={delMes(filas, vista.mes)} saldoLabel="Total General" />;
  } else if (pestañaActual === 'caja-chica') {
    const filas = await repository.listAdminLedgerEntries({ book: 'CAJA_CHICA' });
    vista = elegirMes(filas.map((f) => f.date), mesPedido, mesActual);
    const mes = vista.mes;
    // La caja chica no empieza de cero cada mes: lo que quedó de los meses
    // anteriores es con lo que se abre éste.
    const saldoAnteriorCents =
      mes === 'todo'
        ? undefined
        : filas.filter((f) => f.date < `${mes}-01`).reduce((s, f) => s + f.incomeCents - f.expenseCents, 0);
    contenido = (
      <AdminLedgerManager
        book="CAJA_CHICA"
        filas={delMes(filas, mes)}
        saldoLabel="Saldo"
        saldoAnteriorCents={saldoAnteriorCents}
      />
    );
  } else {
    const dentistId = pestañaActual.slice('dr-'.length);
    const dentist = dentists.find((d) => d.id === dentistId);
    if (!dentist) redirect('/administracion');
    const [filas, pacientes] = await Promise.all([
      repository.listDentistLedgerEntries({ dentistId }),
      // Sus pacientes ya registrados en el sistema, para anotarles una
      // consulta a mano sin volver a escribir el nombre.
      repository.listPatientsOfDentist(dentistId),
    ]);
    vista = elegirMes(filas.map((f) => f.date), mesPedido, mesActual);
    contenido = (
      <DentistLedgerManager
        dentistId={dentistId}
        dentistName={dentist.fullName}
        filas={delMes(filas, vista.mes)}
        pacientes={pacientes}
      />
    );
  }

  // El mes elegido A MANO viaja de una pestaña a otra: quien mira septiembre
  // en Gastos quiere septiembre al pasar a una doctora. El elegido solo, no.
  const conMes = mesPedido ? `&mes=${vista?.mes ?? mesPedido}` : '';
  const urlDelMes = (mes: string) => `/administracion?tab=${pestañaActual}&mes=${mes}${cargando ? '&cargar=1' : ''}`;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Administración"
          subtitle="El libro de la clínica, por pestañas — igual que en la hoja de cálculo"
          actions={
            esCierre ? null : cargando ? (
              <Link href={`/administracion?tab=${pestañaActual}${conMes}`} className="btn btn--ghost">
                <IconClose size={16} /> Cerrar carga
              </Link>
            ) : (
              <Link href={`/administracion?tab=${pestañaActual}${conMes}&cargar=1`} className="btn btn--primary">
                <IconDownload size={16} /> Cargar Excel
              </Link>
            )
          }
        />
      </FadeIn>

      {/* Fuera de las pestañas: el destino se elige dentro, y sale ya puesto
          en la pestaña desde la que se abrió. */}
      {cargando && (
        <FadeIn>
          <LedgerImport destinos={PESTAÑAS} destinoInicial={pestañaActual} />
        </FadeIn>
      )}

      {/* Pestañas por enlace: se puede recargar, compartir y volver atrás. */}
      <div className="admin-tabs" role="tablist" aria-label="Pestañas de administración">
        {[...PESTAÑAS, { id: 'cierre', label: 'Cierre mensual y anual' }].map((p) => (
          <Link
            key={p.id}
            href={`/administracion?tab=${p.id}${p.id === 'cierre' ? '' : conMes}${cargando ? '&cargar=1' : ''}`}
            role="tab"
            aria-selected={p.id === pestañaActual}
            className={`admin-tabs__item ${p.id === pestañaActual ? 'admin-tabs__item--activa' : ''}`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {/* --- Qué mes se está viendo ------------------------------------- */}
      {vista && (
        <div className="row row--between row--wrap" style={{ gap: '0.75rem', marginBottom: 'var(--space-4)' }}>
          <div className="row" style={{ gap: '0.5rem' }}>
            {vista.anterior ? (
              <Link href={urlDelMes(vista.anterior)} className="btn btn--ghost btn--sm">
                <IconChevronLeft size={15} /> {nombreDelMes(vista.anterior)}
              </Link>
            ) : (
              <span />
            )}
            <strong>{vista.mes === 'todo' ? 'Todos los meses' : nombreDelMes(vista.mes)}</strong>
            {vista.siguiente && (
              <Link href={urlDelMes(vista.siguiente)} className="btn btn--ghost btn--sm">
                {nombreDelMes(vista.siguiente)} <IconChevronRight size={15} />
              </Link>
            )}
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            {vista.mes !== mesActual && (
              <Link href={urlDelMes(mesActual)} className="btn btn--ghost btn--sm">
                Este mes
              </Link>
            )}
            {vista.mes !== 'todo' && (
              <Link href={urlDelMes('todo')} className="btn btn--ghost btn--sm">
                Ver todo
              </Link>
            )}
          </div>
        </div>
      )}

      <FadeIn delay={0.06}>{contenido}</FadeIn>
    </div>
  );
}
