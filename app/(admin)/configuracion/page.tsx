import { requireSuperAdmin } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { Stat } from '@/frontend/components/ui/primitives';
import { SettingsForm } from '@/frontend/features/admin/SettingsForm';
import { PaymentMethodsPanel } from '@/frontend/features/admin/PaymentMethodsPanel';
import { FadeIn, Stagger, StaggerItem, HoverCard } from '@/frontend/components/motion';

/**
 * ===========================================================================
 *  /configuracion — Ajustes de la clínica
 * ===========================================================================
 *  ACCESO: sólo Super Admin.
 *
 *  QUÉ VIVE AQUÍ Y QUÉ NO:
 *
 *  SÍ → decisiones de NEGOCIO que el administrador debe poder cambiar sin
 *       llamar a nadie: identidad fiscal, comisión por defecto, jornada
 *       laboral, moneda de visualización.
 *
 *  NO → infraestructura: llaves de n8n, estado del hasheo de contraseñas,
 *       origen de datos, rate limit. Eso es información de desarrollo; el
 *       administrador de la clínica no puede actuar sobre ella y mostrarla
 *       sólo servía para llenar la pantalla de ruido. Vive en el `.env` y
 *       está documentada en el README.
 * ===========================================================================
 */

export const metadata = { title: 'Configuración' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requireSuperAdmin();

  const [settings, counts, paymentMethods] = await Promise.all([
    repository.getClinicSettings(),
    repository.getEntityCounts(),
    // Se piden los inactivos también: el administrador tiene que poder
    // reactivar un banco que dejó de usar sin volver a teclear sus datos.
    repository.listPaymentMethods({ includeInactive: true }),
  ]);

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Configuración"
          subtitle="Identidad, reglas de negocio y moneda de la clínica"
        />
      </FadeIn>

      {/* Inventario: contexto útil antes de tocar nada. Cambiar la comisión
          por defecto importa distinto con 3 odontólogos que con 30. */}
      <Stagger className="stat-grid">
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Pacientes"
              value={String(counts.patients)}
              meta="registrados en la clínica"
              featured
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Odontólogos"
              value={`${counts.activeDentists}/${counts.dentists}`}
              meta="activos sobre el total"
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Tratamientos"
              value={String(counts.treatments)}
              meta="activos en el catálogo"
            />
          </HoverCard>
        </StaggerItem>
        <StaggerItem>
          <HoverCard>
            <Stat
              label="Consultorios"
              value={String(counts.rooms)}
              meta="operativos"
            />
          </HoverCard>
        </StaggerItem>
      </Stagger>

      <FadeIn delay={0.12}>
        <SettingsForm settings={settings} />
      </FadeIn>

      {/* Va después de los ajustes generales: se toca menos, pero cuando se
          toca importa más — son los datos con los que cobra la clínica. */}
      <FadeIn delay={0.18}>
        <PaymentMethodsPanel methods={paymentMethods} />
      </FadeIn>
    </div>
  );
}
