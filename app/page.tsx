import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { repository } from '@/backend/repositories';
import { Landing } from '@/frontend/features/public/Landing';
import { getCurrentUser } from '@/backend/auth/guards';
import type { UserRole } from '@/backend/domain/types';

/**
 * ===========================================================================
 *  Raíz del sitio — enrutador de aterrizaje por rol
 * ===========================================================================
 *  Quien llega sin sesión ve la PORTADA de la clínica; quien ya entró va
 *  directo a su pantalla.
 *
 *  POR QUÉ EXISTE ESTA PÁGINA:
 *  Mandar a todo el mundo a /dashboard tras el login era un error. El
 *  dashboard financiero es exclusivo de Super Admin, así que un asistente
 *  entraba con credenciales correctas y aterrizaba de inmediato en
 *  "sin permiso" — parecía que el sistema estaba roto.
 *
 *  Ahora el login redirige aquí y cada rol va a la primera pantalla que
 *  realmente puede usar.
 * ===========================================================================
 */

/** Primera pantalla útil de cada rol. */
const LANDING_BY_ROLE: Record<UserRole, string> = {
  // Finanzas: es lo primero que quiere ver quien administra.
  SUPER_ADMIN: '/dashboard',
  // Recepción arranca en su panel operativo del turno, no en WhatsApp:
  // los chats son UNA de sus tareas, no su panorama completo.
  ASSISTANT: '/inicio',
  // El odontólogo sólo necesita su agenda.
  DENTIST: '/agenda',
};

/**
 * Metadatos de la PORTADA.
 *
 * Se leen de la configuración de la clínica y no se escriben aquí por lo
 * mismo que el resto de la página: el día que cambie el nombre o el teléfono,
 * lo que Facebook enseñe al compartir el enlace tiene que cambiar también.
 *
 * `robots` se levanta a mano: el layout raíz bloquea la indexación de todo el
 * panel, y ésta es una de las dos únicas páginas que sí deben poder
 * encontrarse.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await repository.getClinicSettings();

  const titulo = `${settings.clinicName} — Odontología en Caracas`;
  const descripcion =
    'Consulta, ortodoncia, implantes y estética dental. Pide tu cita por ' +
    'WhatsApp y te confirmamos la hora en minutos.';

  return {
    title: titulo,
    description: descripcion,
    robots: { index: true, follow: true },
    // Lo que se ve cuando alguien comparte el enlace en Facebook o WhatsApp.
    openGraph: {
      title: titulo,
      description: descripcion,
      type: 'website',
      locale: 'es_VE',
      siteName: settings.clinicName,
    },
  };
}

export default async function HomePage() {
  const user = await getCurrentUser();

  /*
   * Sin sesión → la PORTADA pública.
   *
   * Antes iba al login, pero `/` es la dirección que se pone en Facebook, en
   * Instagram y en el pie de los mensajes: quien la abre casi siempre es un
   * paciente, no alguien del equipo. Recibirle con un formulario de acceso es
   * cerrarle la puerta en la cara.
   *
   * El personal no pierde nada: sigue entrando por `/login`, y si ya tiene
   * sesión esta misma página lo lleva a su panel sin ver la portada.
   */
  if (!user) return <Landing />;

  /*
   * Clave temporal sin cambiar: se aterriza en el cambio de contraseña, no en
   * la pantalla del rol.
   *
   * Va AQUÍ y no en el layout del panel porque aquí es donde cae el login, y
   * porque una redirección lanzada desde un layout durante esa misma
   * navegación deja el árbol vacío — la pantalla se veía en blanco.
   */
  if (user.mustChangePassword) redirect('/cambiar-clave');

  redirect(LANDING_BY_ROLE[user.role]);
}
