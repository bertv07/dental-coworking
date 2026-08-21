import { requireAuth } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Card, Notice } from '@/frontend/components/ui/primitives';
import { TariffsManager } from '@/frontend/features/admin/TariffsManager';
import { TariffList } from '@/frontend/features/admin/TariffList';

/**
 * ===========================================================================
 *  /tarifas — Precios pactados por odontólogo
 * ===========================================================================
 *  «Los precios varían de acuerdo al tratamiento, y también según el
 *  odontólogo.»
 *
 *  Una ruta, TRES vistas, porque son tres trabajos distintos:
 *
 *   · Odontólogo → sólo SUS tarifas, y lo que envía queda PENDIENTE.
 *   · Asistente → sólo los precios ya APROBADOS, en lectura. Recepción cotiza
 *     y factura, así que necesita saber que con la Dra. X la exodoncia son
 *     $50 y no $30. Lo que NO ve es el REPARTO: cuánto de eso se queda la
 *     clínica y cuánto el odontólogo es una negociación entre ellos.
 *   · Super Admin → las de todos, con aprobación y rechazo.
 *
 *  El recorte del odontólogo no se hace con un parámetro de la URL sino con
 *  el id de la sesión: `listDentistTreatments({ dentistId })` no llega a leer
 *  de Postgres las tarifas de los demás, así que no hay nada que filtrar.
 *
 *  ⚠️  A recepción no se le esconde la columna del reparto: su rama construye
 *   las filas campo a campo y el porcentaje no viaja. Ocultarlo con CSS lo
 *   dejaría en el payload de React, legible con las herramientas del
 *   navegador.
 * ===========================================================================
 */

export const metadata = { title: 'Tarifas' };
export const dynamic = 'force-dynamic';

export default async function TariffsPage() {
  const user = await requireAuth();

  // --- Recepción: los precios aprobados, para poder cotizar ---------------
  if (user.role === 'ASSISTANT') {
    const agreements = await repository.listDentistTreatments({ status: 'APPROVED' });

    return (
      <div className="page-body">
        <FadeIn>
          <PageHead
            title="Tarifas"
            subtitle="Precios pactados por odontólogo, para cotizar y facturar"
          />
        </FadeIn>

        <FadeIn delay={0.06}>
          <Notice tone="info">
            Sólo aparecen las tarifas <strong>ya aprobadas</strong>: son las que se
            cobran de verdad. Lo que no esté aquí se cobra al precio de lista.
          </Notice>
        </FadeIn>

        <FadeIn delay={0.1}>
          <TariffList
            /*
             * Campo a campo, sin `customCommissionPercent`: el reparto no es
             * asunto del mostrador y no debe viajar al navegador.
             */
            tariffs={agreements
              .filter((a) => a.customPriceCents !== null)
              .map((a) => ({
                id: a.id,
                dentistName: a.dentistName,
                treatmentName: a.treatmentName,
                listPriceCents: a.treatmentBasePriceCents,
                priceCents: a.customPriceCents as number,
              }))}
          />
        </FadeIn>
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
