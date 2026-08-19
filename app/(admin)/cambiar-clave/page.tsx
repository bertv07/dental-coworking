import { requireAuth } from '@/backend/auth/guards';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Card } from '@/frontend/components/ui/primitives';
import { PasswordChangeForm } from '@/frontend/features/auth/PasswordChangeForm';

/**
 * ===========================================================================
 *  /cambiar-clave
 * ===========================================================================
 *  Cualquier usuario con sesión, incluido el odontólogo. Cambia SU propia
 *  contraseña y ninguna otra.
 *
 *  Es también la pantalla a la que el layout obliga a ir cuando la cuenta
 *  nació de una invitación y todavía arrastra la clave temporal.
 * ===========================================================================
 */

export const metadata = { title: 'Cambiar contraseña' };
export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const user = await requireAuth();

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Cambiar contraseña"
          subtitle={user.email}
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <Card>
          <div style={{ maxWidth: '32rem' }}>
            <PasswordChangeForm isForced={user.mustChangePassword} />
          </div>
        </Card>
      </FadeIn>
    </div>
  );
}
