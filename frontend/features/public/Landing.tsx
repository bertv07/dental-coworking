import Link from 'next/link';
import { repository } from '@/backend/repositories';

/**
 * ===========================================================================
 *  Portada pública
 * ===========================================================================
 *  Lo que ve quien abre la dirección de la clínica sin tener sesión: un
 *  paciente que llegó desde Facebook, desde Instagram o desde el pie de un
 *  mensaje de WhatsApp.
 *
 *  ---------------------------------------------------------------------
 *  LOS DATOS SALEN DE LA BASE, NO DEL CÓDIGO
 *  ---------------------------------------------------------------------
 *  El nombre, el teléfono, la dirección y el horario se leen de la
 *  configuración de la clínica, y las especialidades del cuerpo odontológico
 *  real. Es el mismo criterio que con el bot: escribirlos aquí significaría
 *  que el día que cambie el horario, la portada seguiría anunciando el viejo
 *  hasta que alguien se acordara de tocar el código.
 *
 *  ⚠️  NO se publica nada del interior: ni precios, ni nombres del equipo, ni
 *   agenda. Esta página la ve cualquiera, y lo que no viaja no se filtra.
 * ===========================================================================
 */

/** Cómo se le cuenta al paciente cada especialidad que hay en plantilla. */
const ESPECIALIDAD_LEGIBLE: Record<string, string> = {
  'ODONTOLOGÍA GENERAL': 'Consulta general',
  PREVENTIVO: 'Limpieza y prevención',
  ORTODONCIA: 'Ortodoncia y brackets',
  ENDODONCIA: 'Tratamiento de conducto',
  PERIODONCIA: 'Encías',
  'CIRUGÍA ORAL': 'Cirugía y extracciones',
  IMPLANTOLOGÍA: 'Implantes',
  'ESTÉTICA DENTAL': 'Estética y blanqueamiento',
  'REHABILITACIÓN ORAL': 'Coronas y rehabilitación',
  ODONTOPEDIATRÍA: 'Odontopediatría',
};

/** "540" → "9:00 am". La portada habla como habla la gente, no en minutos. */
function hora(minuto: number): string {
  const h = Math.floor(minuto / 60);
  const m = String(minuto % 60).padStart(2, '0');
  if (h === 12) return `12:${m} m`;
  return h < 12 ? `${h}:${m} am` : `${h - 12}:${m} pm`;
}

export async function Landing() {
  const [settings, dentists] = await Promise.all([
    repository.getClinicSettings(),
    repository.listDentists(),
  ]);

  /*
   * Especialidades REALES, sin repetir y traducidas.
   *
   * Si mañana entra una periodoncista, aparece sola. Y si se va la última
   * ortodoncista, deja de anunciarse un servicio que ya no se presta — que es
   * lo que pasa con una lista escrita a mano.
   */
  const servicios = [
    ...new Set(dentists.flatMap((d) => d.specialties)),
  ]
    .map((e) => ESPECIALIDAD_LEGIBLE[e] ?? null)
    .filter((e): e is string => e !== null)
    .sort();

  const whatsapp = settings.phone?.replace(/[^\d]/g, '') ?? '';

  return (
    <main className="landing">
      <header className="landing__hero">
        <p className="landing__eyebrow">Odontología en Caracas</p>
        <h1 className="landing__title">{settings.clinicName}</h1>
        <p className="landing__lead">
          Un equipo de {dentists.length} especialistas en un mismo sitio. Pide tu
          cita por WhatsApp y te confirmamos la hora en minutos.
        </p>

        <div className="landing__actions">
          {whatsapp && (
            <a
              className="landing__cta"
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noreferrer"
            >
              Pedir cita por WhatsApp
            </a>
          )}
          {settings.phone && (
            <a className="landing__cta landing__cta--ghost" href={`tel:${settings.phone}`}>
              Llamar {settings.phone}
            </a>
          )}
        </div>
      </header>

      {servicios.length > 0 && (
        <section className="landing__section">
          <h2 className="landing__h2">Qué hacemos</h2>
          <ul className="landing__services">
            {servicios.map((servicio) => (
              <li key={servicio} className="landing__service">
                {servicio}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="landing__section">
        <h2 className="landing__h2">Dónde y cuándo</h2>
        <dl className="landing__facts">
          {settings.address && (
            <div className="landing__fact">
              <dt>Dirección</dt>
              <dd>{settings.address}</dd>
            </div>
          )}
          <div className="landing__fact">
            <dt>Horario</dt>
            <dd>
              Lunes a viernes, {hora(settings.openingMinute)} a{' '}
              {hora(settings.closingMinute)}
            </dd>
          </div>
          {settings.phone && (
            <div className="landing__fact">
              <dt>Teléfono</dt>
              <dd>
                <a href={`tel:${settings.phone}`}>{settings.phone}</a>
              </dd>
            </div>
          )}
          {settings.email && (
            <div className="landing__fact">
              <dt>Correo</dt>
              <dd>
                <a href={`mailto:${settings.email}`}>{settings.email}</a>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <footer className="landing__foot">
        <p>
          © {new Date().getFullYear()} {settings.clinicName}
          {settings.taxId && ` · RIF ${settings.taxId}`}
        </p>
        <p>
          <Link href="/privacidad">Política de privacidad</Link>
          {' · '}
          {/*
            El acceso del personal va en el pie y en letra pequeña: esta página
            es para pacientes. Quien trabaja aquí conoce la dirección y llega
            igual, pero un enlace grande a «entrar» confunde a quien sólo
            quiere pedir una cita.
          */}
          <Link href="/login">Acceso del personal</Link>
        </p>
      </footer>
    </main>
  );
}
