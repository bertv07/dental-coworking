import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { AdminLedgerManager } from '@/frontend/features/finance/AdminLedgerManager';
import { DentistLedgerManager } from '@/frontend/features/finance/DentistLedgerManager';
import { LedgerImport } from '@/frontend/features/finance/LedgerImport';
import { IconClose, IconDownload } from '@/frontend/components/ui/icons';

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

export const metadata = { title: 'Administración' };
export const dynamic = 'force-dynamic';

export default async function AdministracionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; cargar?: string }>;
}) {
  await requireRole('SUPER_ADMIN');

  const { tab, cargar } = await searchParams;
  const pestañaActual = tab ?? 'gastos';
  // En la URL, como las pestañas: recargar no cierra la carga a medias.
  const cargando = cargar === '1';

  const dentists = await repository.listDentists();

  const PESTAÑAS = [
    { id: 'gastos', label: 'Gastos Administrativos' },
    { id: 'caja-chica', label: 'Caja Chica' },
    ...dentists.map((d) => ({ id: `dr-${d.id}`, label: d.fullName })),
  ];

  if (!PESTAÑAS.some((p) => p.id === pestañaActual)) redirect('/administracion');

  let contenido: React.ReactNode;

  if (pestañaActual === 'gastos') {
    const filas = await repository.listAdminLedgerEntries({ book: 'GASTOS_ADMIN' });
    contenido = <AdminLedgerManager book="GASTOS_ADMIN" filas={filas} saldoLabel="Total General" />;
  } else if (pestañaActual === 'caja-chica') {
    const filas = await repository.listAdminLedgerEntries({ book: 'CAJA_CHICA' });
    contenido = <AdminLedgerManager book="CAJA_CHICA" filas={filas} saldoLabel="Saldo" />;
  } else {
    const dentistId = pestañaActual.slice('dr-'.length);
    const dentist = dentists.find((d) => d.id === dentistId);
    if (!dentist) redirect('/administracion');
    const filas = await repository.listDentistLedgerEntries({ dentistId });
    contenido = <DentistLedgerManager dentistId={dentistId} dentistName={dentist.fullName} filas={filas} />;
  }

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Administración"
          subtitle="El libro de la clínica, por pestañas — igual que en la hoja de cálculo"
          actions={
            cargando ? (
              <Link href={`/administracion?tab=${pestañaActual}`} className="btn btn--ghost">
                <IconClose size={16} /> Cerrar carga
              </Link>
            ) : (
              <Link href={`/administracion?tab=${pestañaActual}&cargar=1`} className="btn btn--primary">
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
        {PESTAÑAS.map((p) => (
          <Link
            key={p.id}
            href={`/administracion?tab=${p.id}${cargando ? '&cargar=1' : ''}`}
            role="tab"
            aria-selected={p.id === pestañaActual}
            className={`admin-tabs__item ${p.id === pestañaActual ? 'admin-tabs__item--activa' : ''}`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <FadeIn delay={0.06}>{contenido}</FadeIn>
    </div>
  );
}
