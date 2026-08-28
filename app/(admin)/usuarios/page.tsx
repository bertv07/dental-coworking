import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { isStaffEmailConfigured } from '@/backend/services/staff-invite.service';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Notice } from '@/frontend/components/ui/primitives';
import { StaffUsersManager } from '@/frontend/features/admin/StaffUsersManager';

/**
 * ===========================================================================
 *  /usuarios — quién entra al panel
 * ===========================================================================
 *  ACCESO: SÓLO administrador. Es la pantalla que reparte el acceso a todo lo
 *  demás; una asistente que pudiera abrirla podría ascenderse a sí misma.
 *
 *  Se avisa en la propia pantalla si el envío de correo no está configurado:
 *  sin `STAFF_EMAIL_WEBHOOK_URL`, las cuentas se crean igual pero la clave no
 *  sale de aquí, y quien la dé de alta se quedaría esperando un correo que
 *  nunca llega.
 * ===========================================================================
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Cuentas del panel' };

export default async function UsuariosPage() {
  const user = await requireRole('SUPER_ADMIN');

  const [users, dentists] = await Promise.all([
    repository.listStaffUsers(),
    repository.listDentists({ includeInactive: true }),
  ]);

  /*
   * Sólo las fichas que aún no tienen cuenta: enlazar dos cuentas a la misma
   * odontóloga dejaría dos personas donde hay una, y su agenda partida entre
   * las dos.
   */
  const conCuenta = new Set(users.map((u) => u.dentistId).filter(Boolean));
  const dentistsSinCuenta = dentists
    .filter((d) => !conCuenta.has(d.id))
    .map((d) => ({ id: d.id, name: d.fullName }));

  const correoConfigurado = isStaffEmailConfigured();

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Cuentas del panel"
          subtitle="Quién puede entrar y con qué permisos"
        />
      </FadeIn>

      {!correoConfigurado && (
        <FadeIn delay={0.04}>
          <Notice tone="warning">
            El envío de correo no está configurado (<code>STAFF_EMAIL_WEBHOOK_URL</code>).
            Puedes crear cuentas, pero <strong>la clave no le llegará a nadie</strong>:
            tendrás que configurarlo y usar «Clave nueva» para que salga el correo.
          </Notice>
        </FadeIn>
      )}

      <FadeIn delay={0.08}>
        <StaffUsersManager
          users={users}
          dentistsSinCuenta={dentistsSinCuenta}
          currentUserId={user.id}
        />
      </FadeIn>
    </div>
  );
}
