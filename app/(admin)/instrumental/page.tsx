import { requireAuth } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Card, Notice } from '@/frontend/components/ui/primitives';
import { InstrumentsManager } from '@/frontend/features/admin/InstrumentsManager';

/**
 * ===========================================================================
 *  /instrumental — «cada odontólogo tenga su inventario»
 * ===========================================================================
 *  Son SUS instrumentos: el fórceps, la turbina, la cureta que trajo él.
 *
 *  Una ruta, dos vistas, como `/tarifas`:
 *   · Odontólogo → sólo el suyo. `listInstruments({ dentistId })` no llega a
 *     leer el de los demás, así que no hay nada que filtrar después.
 *   · Super Admin → el de todos, y elige dueño al dar de alta.
 *
 *  Recepción no entra: no es su material ni su responsabilidad.
 * ===========================================================================
 */

export const metadata = { title: 'Instrumental' };
export const dynamic = 'force-dynamic';

export default async function InstrumentsPage() {
  const user = await requireAuth();

  if (user.role === 'ASSISTANT') {
    return (
      <div className="page-body">
        <PageHead title="Instrumental" />
        <Card>
          <Notice tone="warning">
            El instrumental es de cada odontólogo. Esta sección la abren ellos y la
            administración.
          </Notice>
        </Card>
      </div>
    );
  }

  const esAdministrador = user.role === 'SUPER_ADMIN';

  if (!esAdministrador) {
    const profile = await repository.findDentistByUserId(user.id);

    if (!profile) {
      return (
        <div className="page-body">
          <PageHead title="Mi instrumental" />
          <Card>
            <Notice tone="warning">
              Tu usuario todavía no está vinculado a una ficha de odontólogo. Pídele al
              administrador que enlace tu cuenta.
            </Notice>
          </Card>
        </div>
      );
    }

    const instruments = await repository.listInstruments({ dentistId: profile.id });

    return (
      <div className="page-body">
        <FadeIn>
          <PageHead
            title="Mi instrumental"
            subtitle="Tu material: lo que es tuyo y en qué estado está"
          />
        </FadeIn>
        <FadeIn delay={0.08}>
          <InstrumentsManager
            instruments={instruments}
            dentists={[]}
            isAdmin={false}
            dentistNames={{ [profile.id]: profile.fullName }}
          />
        </FadeIn>
      </div>
    );
  }

  const [instruments, dentists] = await Promise.all([
    repository.listInstruments(),
    repository.listDentists({ includeInactive: true }),
  ]);

  const dentistNames: Record<string, string> = {};
  for (const dentist of dentists) dentistNames[dentist.id] = dentist.fullName;

  const requierenAtencion = instruments.filter((item) => item.condition !== 'GOOD').length;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Instrumental"
          subtitle={
            requierenAtencion > 0
              ? `${instruments.length} piezas · ${requierenAtencion} necesitan atención`
              : `${instruments.length} piezas · todo en orden`
          }
        />
      </FadeIn>
      <FadeIn delay={0.08}>
        <InstrumentsManager
          instruments={instruments}
          dentists={dentists}
          isAdmin
          dentistNames={dentistNames}
        />
      </FadeIn>
    </div>
  );
}
