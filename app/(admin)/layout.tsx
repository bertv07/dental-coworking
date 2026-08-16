import type { ReactNode } from 'react';
import { requireAuth } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { Sidebar } from '@/frontend/components/layout/Sidebar';
import { Topbar } from '@/frontend/components/layout/Topbar';
import { AppShell, NavToggle } from '@/frontend/components/layout/AppShell';
import { getNotifications, getMessageAlerts } from '@/backend/services/notifications.service';

/**
 * ===========================================================================
 *  LAYOUT PRINCIPAL DEL PANEL ADMINISTRATIVO
 * ===========================================================================
 *  Envuelve todas las rutas del grupo `(admin)`. Los paréntesis crean un
 *  *route group*: agrupa rutas bajo un layout común SIN añadir `/admin` a la
 *  URL. Así `/dashboard`, `/pacientes` y `/whatsapp` comparten este marco
 *  pero conservan URLs limpias.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ EL GUARD ESTÁ AQUÍ
 *  ---------------------------------------------------------------------
 *  `requireAuth()` corre en el SERVIDOR antes de renderizar nada. Sin sesión,
 *  redirige y el navegador jamás recibe el HTML del panel.
 *
 *  Diferencia real frente a comprobar la sesión en un `useEffect`: allí el
 *  HTML ya viajó al cliente y los datos ya se filtraron, aunque después se
 *  oculte la pantalla.
 *
 *  Este layout garantiza AUTENTICACIÓN. La AUTORIZACIÓN por sección
 *  (¿puede este usuario ver precios?) la hace cada página con su propio
 *  `requireSuperAdmin()`. Dos capas, dos responsabilidades.
 *
 *  ---------------------------------------------------------------------
 *  RENDIMIENTO
 *  ---------------------------------------------------------------------
 *  Los layouts de Next.js NO se re-renderizan al navegar entre páginas
 *  hijas. Sesión, topbar y contador de chats se resuelven una vez por carga,
 *  no en cada clic del menú. Eso también hace que el indicador animado del
 *  sidebar pueda deslizarse: el componente sobrevive a la navegación.
 * ===========================================================================
 */

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Redirige a /login si no hay sesión. Nada por debajo llega a ejecutarse.
  const user = await requireAuth();

  /*
   * Las herramientas de la barra superior son de RECEPCIÓN, no del panel:
   * avisos de citas por confirmar, chats de WhatsApp esperando respuesta y
   * búsqueda de pacientes. El odontólogo no tiene acceso a ninguna de esas
   * secciones, así que los tres controles le abrirían pantallas prohibidas.
   *
   * No se ocultan con CSS: NO SE CONSULTAN. Esos avisos hablan de los
   * pacientes de toda la clínica —nombres, teléfonos, citas de otros
   * odontólogos— y viajarían en la respuesta aunque el icono estuviera
   * escondido. Además le ahorra tres consultas a cada carga de su agenda.
   */
  const isDentist = user.role === 'DENTIST';

  // Todo en paralelo: son consultas independientes y su latencia se solapa.
  const [conversations, notifications, messages] = isDentist
    ? [[], undefined, undefined]
    : await Promise.all([
        repository.listConversations({ limit: 50 }),
        getNotifications(),
        getMessageAlerts(),
      ]);

  // Badge de WhatsApp en el sidebar. Sólo cuenta para quien ve esa sección.
  const pendingChats = conversations.filter(
    (conversation) => conversation.needsHumanAttention,
  ).length;

  return (
    <AppShell sidebar={<Sidebar userRole={user.role} pendingChats={pendingChats} />}>
      <Topbar
        userName={user.name}
        userRole={user.role}
        userEmail={user.email}
        notifications={notifications}
        messages={messages}
        canSearchPatients={!isDentist}
        navToggle={<NavToggle />}
      />
      {children}
    </AppShell>
  );
}
