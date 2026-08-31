import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { AuthShell } from '@/frontend/features/auth/AuthShell';
import { LoginForm } from '@/frontend/features/auth/LoginForm';
import { isUsingMockData } from '@/backend/config/env';
import { MOCK_CREDENTIALS } from '@/backend/mock/data';

/** Cuentas que se muestran en el recuadro de demo, en orden de privilegio. */
const DEMO_ACCOUNTS = [
  { role: 'Super Admin', email: 'admin@dentalcoworking.co' },
  { role: 'Asistente', email: 'recepcion@dentalcoworking.co' },
  { role: 'Odontóloga', email: 'camila.restrepo@dentalcoworking.co' },
] as const;

/**
 * /login — Página pública de acceso.
 *
 * Fuera del grupo `(admin)` a propósito: no debe heredar su layout ni,
 * sobre todo, su guard de autenticación (sería un bucle de redirecciones).
 */

export const metadata = { title: 'Iniciar sesión' };

export default async function LoginPage() {
  // Si ya hay sesión, no tiene sentido mostrar el formulario.
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  const settings = await repository.getClinicSettings();

  return (
    <AuthShell
      clinicName={settings.clinicName}
      title="Entrar al panel"
      subtitle="Con el correo y la contraseña que te dieron"
      footer={<Link href="/recuperar">¿Olvidaste tu contraseña?</Link>}
    >
      <LoginForm />

      {/*
        Las credenciales de demo SÓLO se muestran en modo mock. En cuanto
        `DATA_SOURCE=db` esté activo, este bloque desaparece del render —
        no queda ni en el HTML.
      */}
      {isUsingMockData && (
        <div className="notice notice--info" style={{ marginTop: '1.25rem' }}>
          <span aria-hidden="true">ℹ</span>
          <div className="text-xs" style={{ display: 'grid', gap: '0.5rem' }}>
            <strong>Modo demo — cuentas disponibles</strong>
            {DEMO_ACCOUNTS.map((account) => (
              <div key={account.email}>
                <strong>{account.role}</strong>
                <br />
                <code className="mono">{account.email}</code>
                <br />
                <code className="mono">{MOCK_CREDENTIALS[account.email]}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </AuthShell>
  );
}
