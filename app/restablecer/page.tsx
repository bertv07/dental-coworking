import Link from 'next/link';
import { ResetPasswordForm } from '@/frontend/features/auth/ResetPasswordForm';

/**
 * ===========================================================================
 *  /restablecer?token=… — poner la contraseña nueva
 * ===========================================================================
 *  PÚBLICA: se llega desde el enlace del correo, sin sesión.
 *
 *  El token NO se valida aquí para pintar la pantalla. Se comprueba al
 *  enviar, en el servidor. Validarlo antes obligaría a distinguir «no existe»
 *  de «caducado» de «ya usado» en la interfaz, y esas tres respuestas
 *  distintas permitirían sondear tokens: al enviar, los tres dan lo mismo.
 * ===========================================================================
 */

export const metadata = { title: 'Nueva contraseña' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';

  return (
    <main className="login-shell">
      <div className="login-card">
        <h1 className="login-card__title">Nueva contraseña</h1>
        <p className="login-card__subtitle">
          Elige una contraseña para tu cuenta.
        </p>

        <ResetPasswordForm token={token} />

        <p className="text-sm" style={{ marginTop: '1.25rem', textAlign: 'center' }}>
          <Link href="/login">Volver a iniciar sesión</Link>
        </p>
      </div>
    </main>
  );
}
