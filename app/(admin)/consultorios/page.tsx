import { requireSuperAdmin } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { RoomsManager } from '@/frontend/features/admin/RoomsManager';
import { FadeIn } from '@/frontend/components/motion';

/**
 * ===========================================================================
 *  /consultorios — Espacios físicos
 * ===========================================================================
 *  ACCESO: sólo Super Admin.
 *
 *  El consultorio es un RECURSO ESCASO: dos citas no pueden solaparse en la
 *  misma sala. Esa regla la impone el constraint `EXCLUDE USING gist` de la
 *  migración 0001, no esta pantalla — aquí sólo se define el inventario.
 *
 *  Por eso se muestra la ocupación de los próximos 7 días junto a cada sala:
 *  desactivar un consultorio con 30 citas encima es una decisión que hay que
 *  tomar con el dato delante.
 * ===========================================================================
 */

export const metadata = { title: 'Consultorios' };
export const dynamic = 'force-dynamic';

export default async function RoomsPage() {
  await requireSuperAdmin();

  const from = new Date();
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [rooms, dentists, appointments] = await Promise.all([
    repository.listRooms({ includeInactive: true }),
    // Para elegir el odontólogo fijo de cada consultorio.
    repository.listDentists(),
    repository.listAppointments({ range: { from, to }, limit: 500 }),
  ]);

  // Ocupación por sala. Se cuenta en una sola pasada en lugar de filtrar el
  // array completo una vez por consultorio.
  const upcomingByRoom: Record<string, number> = {};
  for (const appointment of appointments) {
    if (appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW') continue;
    upcomingByRoom[appointment.roomId] = (upcomingByRoom[appointment.roomId] ?? 0) + 1;
  }

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Consultorios"
          subtitle="Espacios físicos, equipamiento y ocupación de la semana"
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <RoomsManager rooms={rooms} dentists={dentists} upcomingByRoom={upcomingByRoom} />
      </FadeIn>
    </div>
  );
}
