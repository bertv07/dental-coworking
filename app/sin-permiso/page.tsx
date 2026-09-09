import Link from 'next/link';
import { getCurrentUser } from '@/backend/auth/guards';
import type { UserRole } from '@/backend/domain/types';

/**
 * /sin-permiso — El usuario está autenticado pero su rol no alcanza.
 *
 * Página propia y no una redirección al login: mandar a alguien con sesión
 * válida al formulario de acceso le hace pensar que su sesión caducó y que
 * el sistema falla. Aquí queda claro que es una cuestión de permisos.
 *
 * ---------------------------------------------------------------------
 * "Volver al inicio" tiene que ir a UN INICIO QUE ESE ROL PUEDA VER.
 * ---------------------------------------------------------------------
 * Antes el botón apuntaba siempre a /dashboard, que exige Super Admin. Un
 * asistente u odontólogo que caía aquí le daba clic, /dashboard lo rebotaba
 * de vuelta a /sin-permiso, y quedaba en un bucle del que no podía salir
 * sin cerrar la pestaña o teclear la URL a mano. Por eso aquí se consulta
 * el rol real y se manda a la página que SÍ le corresponde.
 *
 * Se usa `getCurrentUser()` y no `requireAuth()`/`requireRole()`: esas
 * redirigen si fallan, y esta página ya es un destino de redirección —
 * encadenar otra aquí es cómo se arma un bucle, no cómo se rompe uno.
 */

export const metadata = { title: 'Sin permiso' };

const INICIO_POR_ROL: Record<UserRole, string> = {
  SUPER_ADMIN: '/dashboard',
  ASSISTANT: '/inicio',
  DENTIST: '/agenda',
};

export default async function ForbiddenPage() {
  const user = await getCurrentUser();
  const inicio = user ? INICIO_POR_ROL[user.role] : '/login';

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1rem' }}>
      <div style={{ textAlign: 'center', maxWidth: '420px' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }} aria-hidden="true">
          🔒
        </div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          No tienes acceso a esta sección
        </h1>
        <p className="muted text-sm" style={{ marginBottom: '1.5rem' }}>
          Tu rol actual no permite ver esta página. Si crees que se trata de un error,
          contacta al administrador del sistema.
        </p>
        <Link href={inicio} className="btn btn--primary">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
