import Link from 'next/link';
import { requireAuth } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { AuthShell } from '@/frontend/features/auth/AuthShell';
import { PasswordChangeForm } from '@/frontend/features/auth/PasswordChangeForm';

/**
 * ===========================================================================
 *  /cambiar-clave
 * ===========================================================================
 *  Cualquier usuario con sesión, incluido el odontólogo. Cambia SU propia
 *  contraseña y ninguna otra.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ VIVE FUERA DEL GRUPO `(admin)`
 *  ---------------------------------------------------------------------
 *  Es la pantalla a la que se manda a quien entró con una clave temporal, y
 *  el layout de `(admin)` es justo quien lo manda. Si estuviera dentro, ese
 *  layout se aplicaría también aquí y habría que esquivarlo con un caso
 *  especial — que fue la primera versión, y se quedaba en blanco al iniciar
 *  sesión.
 *
 *  Fuera del grupo, el destino de la redirección no vuelve a pasar por el
 *  guard que la disparó. No hay bucle que romper porque no hay bucle.
 *
 *  Sin barra lateral también a propósito: quien llega aquí obligado no puede
 *  ir a ninguna otra parte, y un menú cuyos enlaces no llevan a nada es peor
 *  que no tener menú.
 * ===========================================================================
 */

export const metadata = { title: 'Cambiar contraseña' };
export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const user = await requireAuth();

  const settings = await repository.getClinicSettings();

  return (
    <AuthShell
      clinicName={settings.clinicName}
      title={user.mustChangePassword ? 'Elige tu contraseña' : 'Cambiar contraseña'}
      subtitle={
        user.mustChangePassword
          ? `Entraste con una clave temporal. Elige la tuya para seguir — la anterior la vio quien te la envió.`
          : user.email
      }
      /*
       * Sin panel lateral cuando es obligatorio: quien llega aquí forzado no
       * puede ir a ninguna otra parte, y adornar esa pantalla con lo que le
       * espera dentro es enseñarle una puerta cerrada.
       */
      aside={!user.mustChangePassword}
      footer={
        // El enlace de vuelta sólo si NO está obligado: ofrecerle una salida a
        // quien tiene que cambiarla sería ofrecerle una puerta que no abre.
        !user.mustChangePassword ? <Link href="/">Volver al panel</Link> : undefined
      }
    >
      <PasswordChangeForm isForced={user.mustChangePassword} />
    </AuthShell>
  );
}
