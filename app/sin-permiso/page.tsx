import Link from 'next/link';

/**
 * /sin-permiso — El usuario está autenticado pero su rol no alcanza.
 *
 * Página propia y no una redirección al login: mandar a alguien con sesión
 * válida al formulario de acceso le hace pensar que su sesión caducó y que
 * el sistema falla. Aquí queda claro que es una cuestión de permisos.
 */

export const metadata = { title: 'Sin permiso' };

export default function ForbiddenPage() {
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
        <Link href="/dashboard" className="btn btn--primary">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
