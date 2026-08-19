import { requireAuth } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Card, Notice } from '@/frontend/components/ui/primitives';
import { TariffsManager } from '@/frontend/features/admin/TariffsManager';

/**
 * ===========================================================================
 *  /tarifas — Precios pactados por odontólogo
 * ===========================================================================
 *  «Los precios varían de acuerdo al tratamiento, y también según el
 *  odontólogo.»
 *
 *  Una ruta, DOS vistas, igual que `/agenda`:
 *
 *   · Odontólogo → sólo SUS tarifas, y lo que envía queda PENDIENTE.
 *   · Super Admin → las de todos, con aprobación y rechazo.
 *
 *  El recorte no se hace con un parámetro de la URL sino con el id de la
 *  sesión: `listDentistTreatments({ dentistId })` no llega a leer de Postgres
 *  las tarifas de los demás, así que no hay nada que filtrar después.
 *
 *  ⚠️  Recepción NO entra aquí. La página trata de cuánto cobra cada
 *  odontólogo, que es la misma razón por la que `/odontologos` es sólo del
 *  administrador.
 * ===========================================================================
 */

export const metadata = { title: 'Tarifas' };
export const dynamic = 'force-dynamic';

export default async function TariffsPage() {
  const user = await requireAuth();

  // Asistente: ni ve ni propone. No es su decisión ni su información.
  if (user.role === 'ASSISTANT') {
    return (
      <div className="page-body">
        <PageHead title="Tarifas" />
        <Card>
          <Notice tone="warning">
            Esta sección define cuánto cobra cada odontólogo, así que sólo la abre la
            administración.
          </Notice>
        </Card>
      </div>
    );
  }

  const esAdministrador = user.role === 'SUPER_ADMIN';

  // --- Vista del odontólogo: sólo lo suyo ---------------------------------
  if (!esAdministrador) {
    const profile = await repository.findDentistByUserId(user.id);

    if (!profile) {
      return (
        <div className="page-body">
          <PageHead title="Mis tarifas" />
          <Card>
            <Notice tone="warning">
              Tu usuario todavía no está vinculado a una ficha de odontólogo. Pídele al
              administrador que enlace tu cuenta desde <strong>Odontólogos</strong>.
            </Notice>
          </Card>
        </div>
      );
    }

    const [agreements, treatments] = await Promise.all([
      repository.listDentistTreatments({ dentistId: profile.id }),
      repository.listTreatments(),
    ]);

    return (
      <div className="page-body">
        <FadeIn>
          <PageHead
            title="Mis tarifas"
            subtitle="Lo que propongas se aplica cuando lo apruebe la administración"
          />
        </FadeIn>

        <FadeIn delay={0.08}>
          <TariffsManager
            agreements={agreements}
            treatments={treatments}
            // No elige persona: es él.
            dentists={[]}
            canApprove={false}
            ownDentistId={profile.id}
            commissionByDentist={{ [profile.id]: profile.clinicCommissionPercent }}
          />
        </FadeIn>
      </div>
    );
  }

  // --- Vista de administración: todas ------------------------------------
  const [agreements, treatments, dentists] = await Promise.all([
    repository.listDentistTreatments(),
    repository.listTreatments(),
    repository.listDentists({ includeInactive: true }),
  ]);

  const commissionByDentist: Record<string, number> = {};
  for (const dentist of dentists) {
    commissionByDentist[dentist.id] = dentist.clinicCommissionPercent;
  }

  const pendientes = agreements.filter((agreement) => agreement.status === 'PENDING').length;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Tarifas por odontólogo"
          subtitle={
            pendientes > 0
              ? `${agreements.length} pactadas · ${pendientes} esperando aprobación`
              : `${agreements.length} pactadas · nada pendiente`
          }
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <TariffsManager
          agreements={agreements}
          treatments={treatments}
          dentists={dentists}
          canApprove
          ownDentistId={null}
          commissionByDentist={commissionByDentist}
        />
      </FadeIn>
    </div>
  );
}
