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
      // El BASE, no el de una semana: es el que se enseña como «tu horario
      // habitual» y del que se parte al proponer un cambio.
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
  const [requests, dentists] = await Promise.all([
    repository.listScheduleRequests(),
    repository.listDentists(),
  ]);

  /*
   * Horario base de cada odontólogo, para que recepción lo vea y lo edite.
   *
   * Una consulta por odontólogo, en paralelo: son doce personas, no doce mil,
   * y montar una consulta agregada para eso sería complicar sin ganancia.
   */
  const bases = await Promise.all(
    dentists.map(async (dentist) => [
      dentist.id,
      await repository.listSchedule(dentist.id),
    ] as const),
  );
  const baseByDentist = Object.fromEntries(bases);

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
          dentists={dentists.map((d) => ({ id: d.id, fullName: d.fullName }))}
          baseByDentist={baseByDentist}
        />
      </FadeIn>
    </div>
  );
}
