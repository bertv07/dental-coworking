import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/backend/auth/guards';
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

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '1rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            className="sidebar__logo"
            style={{ margin: '0 auto 1rem', width: '48px', height: '48px', fontSize: '1.5rem' }}
            aria-hidden="true"
          >
            🦷
          </div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Dental Coworking</h1>
          <p className="subtle text-sm">Panel administrativo</p>
        </div>

        <div className="card">
          <div className="card__body">
            <LoginForm />
          </div>
        </div>

        {/*
          Las credenciales de demo SÓLO se muestran en modo mock. En cuanto
          `DATA_SOURCE=db` esté activo, este bloque desaparece del render —
          no queda ni en el HTML.
        */}
        {isUsingMockData && (
          <div className="notice notice--info" style={{ marginTop: '1rem' }}>
            <span aria-hidden="true">ℹ</span>
            <div className="text-xs" style={{ display: 'grid', gap: '0.5rem' }}>
              <strong>Modo demo — cuentas disponibles</strong>

              {/*
                Se listan las tres cuentas para poder comprobar la separación
                de roles: cada una aterriza en una pantalla distinta y ve un
                menú distinto.
              */}
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
      </div>
    </main>
  );
}
