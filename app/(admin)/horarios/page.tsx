import { requireAuth } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Card, Notice } from '@/frontend/components/ui/primitives';
import { ScheduleManager } from '@/frontend/features/admin/ScheduleManager';

/**
 * ===========================================================================
 *  /horarios — cambios de horario del odontólogo
 * ===========================================================================
 *  El horario semanal es lo que el bot usa para ofrecer huecos, así que no lo
 *  cambia cada quien por su cuenta: mover la disponibilidad afecta a las citas
 *  que se van a agendar y a la ocupación de los consultorios.
 *
 *   · Odontólogo → ve su horario y SUS solicitudes; propone.
 *   · Asistente / Super Admin → ve las de todos; aprueba y rechaza.
 *
 *  Recepción SÍ entra aquí, a diferencia de `/tarifas`: quién trabaja cuándo
 *  es exactamente su trabajo. Lo que no ve es cuánto cobra cada quien.
 * ===========================================================================
 */

export const metadata = { title: 'Horarios' };
export const dynamic = 'force-dynamic';

export default async function SchedulesPage() {
  const user = await requireAuth();

  // --- Vista del odontólogo: lo suyo --------------------------------------
  if (user.role === 'DENTIST') {
    const profile = await repository.findDentistByUserId(user.id);

    if (!profile) {
      return (
        <div className="page-body">
          <PageHead title="Mi horario" />
          <Card>
            <Notice tone="warning">
              Tu usuario todavía no está vinculado a una ficha de odontólogo. Pídele al
              administrador que enlace tu cuenta.
            </Notice>
          </Card>
        </div>
      );
    }

    const [requests, currentBlocks] = await Promise.all([
      repository.listScheduleRequests({ dentistId: profile.id }),
      repository.listSchedule(profile.id),
    ]);

    return (
      <div className="page-body">
        <FadeIn>
          <PageHead
            title="Mi horario"
            subtitle="Propón cambios; se aplican cuando los aprueben"
          />
        </FadeIn>
        <FadeIn delay={0.08}>
          <ScheduleManager
            requests={requests}
            currentBlocks={currentBlocks}
            canApprove={false}
            canPropose
          />
        </FadeIn>
      </div>
    );
  }

  // --- Recepción y administración: todas ----------------------------------
  const requests = await repository.listScheduleRequests();
  const pendientes = requests.filter((request) => request.status === 'PENDING').length;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Horarios"
          subtitle={
            pendientes > 0
              ? `${pendientes} ${pendientes === 1 ? 'solicitud' : 'solicitudes'} esperando`
              : 'Sin solicitudes pendientes'
          }
        />
      </FadeIn>
      <FadeIn delay={0.08}>
        <ScheduleManager
          requests={requests}
          currentBlocks={[]}
          canApprove
          canPropose={false}
        />
      </FadeIn>
    </div>
  );
}
