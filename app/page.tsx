import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/backend/auth/guards';
import type { UserRole } from '@/backend/domain/types';

/**
 * ===========================================================================
 *  Raíz del sitio — enrutador de aterrizaje por rol
 * ===========================================================================
 *  No hay landing pública: es un panel interno.
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

export default async function HomePage() {
  const user = await getCurrentUser();

  // Sin sesión → al login. El middleware normalmente ya lo habrá hecho;
  // esto cubre el caso de una cookie presente pero inválida.
  if (!user) redirect('/login');

  redirect(LANDING_BY_ROLE[user.role]);
}
