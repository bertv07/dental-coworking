import Link from 'next/link';
import { ForgotPasswordForm } from '@/frontend/features/auth/ForgotPasswordForm';

/**
 * ===========================================================================
 *  /recuperar — pedir un enlace de recuperación
 * ===========================================================================
 *  PÚBLICA: la abre alguien que no puede entrar, así que no hay guard.
 *
 *  Fuera del grupo `(admin)` a propósito: ese layout exige sesión y además
 *  fuerza el cambio de clave temporal. Meter aquí una pantalla para quien no
 *  tiene sesión daría un bucle de redirecciones.
 * ===========================================================================
 */

export const metadata = { title: 'Recuperar contraseña' };

export default function ForgotPasswordPage() {
  return (
    <main className="login-shell">
      <div className="login-card">
        <h1 className="login-card__title">Recuperar contraseña</h1>
        <p className="login-card__subtitle">
          Escribe tu correo y te enviamos un enlace para poner una nueva.
        </p>

        <ForgotPasswordForm />

        <p className="text-sm" style={{ marginTop: '1.25rem', textAlign: 'center' }}>
          <Link href="/login">Volver a iniciar sesión</Link>
        </p>
      </div>
    </main>
  );
}
