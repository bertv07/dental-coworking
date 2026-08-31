import type { ReactNode } from 'react';

/**
 * ===========================================================================
 *  Marco compartido de las pantallas de acceso
 * ===========================================================================
 *  Lo usan `/login` y `/cambiar-clave`, que hasta ahora eran dos pantallas
 *  distintas de la misma cosa: una montada con estilos en línea y la otra con
 *  clases que no existían en la hoja de estilos —y por eso se veía sin
 *  formato ninguno—.
 *
 *  En escritorio, dos columnas: la identidad de la clínica a un lado y el
 *  formulario al otro. En móvil sólo el formulario: un panel decorativo que
 *  empuja el campo de la contraseña fuera de la pantalla estorba más de lo
 *  que aporta.
 * ===========================================================================
 */

export function AuthShell({
  clinicName = 'Dental Coworking',
  title,
  subtitle,
  aside = true,
  children,
  footer,
}: {
  clinicName?: string;
  title: string;
  subtitle?: ReactNode;
  /** El panel de la izquierda. Se puede quitar en pantallas muy escuetas. */
  aside?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className={`login-shell ${aside ? 'login-shell--split' : ''}`}>
      {aside && (
        <aside className="login-aside">
          <div className="login-aside__marca">
            <span className="login-aside__logo" aria-hidden="true">
              🦷
            </span>
            {clinicName}
          </div>

          <div>
            <h2 className="login-aside__titular">
              La clínica entera, en una sola pantalla
            </h2>
            <ul className="login-aside__lista">
              <li>
                <span aria-hidden="true">·</span> Agenda, pacientes y caja del día
              </li>
              <li>
                <span aria-hidden="true">·</span> El bot de WhatsApp y lo que responde
              </li>
              <li>
                <span aria-hidden="true">·</span> Facturas, tarifas y liquidaciones
              </li>
            </ul>
          </div>

          <p className="login-aside__pie">
            Acceso restringido al personal de la clínica.
          </p>
        </aside>
      )}

      <div className="login-main">
        <div className="login-card">
          {/* La marca también aquí, para cuando no hay panel al lado (móvil). */}
          <div className="login-card__marca">
            <span className="login-card__logo" aria-hidden="true">
              🦷
            </span>
            {clinicName}
          </div>

          <h1 className="login-card__title">{title}</h1>
          {subtitle && <p className="login-card__subtitle">{subtitle}</p>}

          {children}

          {footer && <div className="login-card__pie">{footer}</div>}
        </div>
      </div>
    </main>
  );
}
