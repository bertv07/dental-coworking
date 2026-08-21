import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { formatCents } from '@/backend/domain/money';
import type { DentistEarnings } from '@/backend/domain/types';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { Stat } from '@/frontend/components/ui/primitives';
import { DentistsManager } from '@/frontend/features/admin/DentistsManager';
import { DentistRoster } from '@/frontend/features/admin/DentistRoster';
import { FadeIn, Stagger, StaggerItem, HoverCard } from '@/frontend/components/motion';

/**
 * ===========================================================================
 *  /odontologos — el cuerpo odontológico
 * ===========================================================================
 *  Una ruta, DOS pantallas, porque son dos necesidades distintas:
 *
 *   · Super Admin → el CRUD completo. Define la comisión de cada persona, es
 *     decir cuánto cobra, y ve lo que produjo y lo que se le debe.
 *   · Asistente → el LISTADO: quién hay, qué hace cada quien y cómo
 *     localizarlo. Es lo que necesita para agendar y para derivar a alguien
 *     que pide un cirujano.
 *
 *  Recepción NO ve dinero aquí — ni comisión, ni producción, ni deuda. Y no
 *  se le oculta con CSS: su rama NO CONSULTA esas cifras, así que no llegan
 *  a su navegador ni siquiera dentro del payload de React.
 * ===========================================================================
 */

export const metadata = { title: 'Odontólogos' };
export const dynamic = 'force-dynamic';

export default async function DentistsPage() {
  const user = await requireRole('ASSISTANT');

  // --- Recepción: el listado, sin un solo importe -------------------------
  if (user.role !== 'SUPER_ADMIN') {
    // Sólo los activos: a recepción no le sirve alguien que ya no atiende, y
    // reactivarlo es cosa de administración.
    const dentists = await repository.listDentists();

    return (
      <div className="page-body">
        <FadeIn>
          <PageHead
            title="Odontólogos"
            subtitle="Quién atiende y qué hace cada quien"
          />
        </FadeIn>
        <FadeIn delay={0.08}>
          <DentistRoster
            /*
             * Se construye campo a campo en vez de pasar el objeto entero:
             * `Dentist` lleva `clinicCommissionPercent`, y con un spread se
             * colaría en el payload aunque la tabla no lo pintara.
             */
            dentists={dentists.map((d) => ({
              id: d.id,
              fullName: d.fullName,
              licenseNumber: d.licenseNumber,
              email: d.email,
              phone: d.phone,
              specialties: d.specialties,
              isActive: d.isActive,
            }))}
          />
        </FadeIn>
      </div>
    );
  }

  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Se incluyen los inactivos: el admin necesita poder reactivar a alguien.
  const [dentists, earnings] = await Promise.all([
    repository.listDentists({ includeInactive: true }),
    repository.getDentistEarnings({ from, to }),
  ]);

  // Índice por id para que la tabla no haga un `find` por fila (O(n²)).
  const earningsByDentist: Record<string, DentistEarnings | undefined> = {};
  for (const row of earnings) earningsByDentist[row.dentistId] = row;

  /*
   * Especialidades ya en uso, para sugerirlas al escribir.
   *
   * Salen de los datos y no de una lista fija: mañana entra un
   * maxilofacial y nadie debería tener que tocar código. Lo que se evita es
   * que convivan «CIRUGÍA ORAL» y «cirujano» como valores distintos, porque
   * el bot enruta al especialista por este campo.
   */
  const knownSpecialties = [
    ...new Set(dentists.flatMap((dentist) => dentist.specialties)),
  ].sort();

  const activeCount = dentists.filter((dentist) => dentist.isActive).length;
  const totalOutstanding = earnings.reduce((sum, row) => sum + row.outstandingCents, 0);
  const totalProduction = earnings.reduce((sum, row) => sum + row.grossCents, 0);

  // Comisión promedio PONDERADA por producción, no media simple: un
  // odontólogo que facturó $50M pesa más que uno que facturó $500K.
  const weightedCommission =
    totalProduction > 0
      ? earnings.reduce((sum, row) => sum + row.commissionPercent * row.grossCents, 0) /
        totalProduction
      : 40;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Odontólogos"
          subtitle="Personal, comisiones y liquidaciones pendientes"
        />
      </FadeIn>

      <Stagger className="stat-grid">
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Odontólogos activos"
              value={String(activeCount)}
              meta={`de ${dentists.length} registrados`}
              featured
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Producción 30 días"
              value={formatCents(totalProduction)}
              meta="facturado por el equipo"
              compact
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Por liquidar"
              value={formatCents(totalOutstanding)}
              meta="deuda viva con el equipo"
              compact
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Comisión promedio"
              value={`${weightedCommission.toFixed(1)}%`}
              meta="ponderada por producción"
            />
          </HoverCard>
        </StaggerItem>
      </Stagger>

      <FadeIn delay={0.12}>
        <DentistsManager
          dentists={dentists}
          earningsByDentist={earningsByDentist}
          knownSpecialties={knownSpecialties}
        />
      </FadeIn>
    </div>
  );
}
