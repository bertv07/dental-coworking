import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { Sidebar } from '@/frontend/components/layout/Sidebar';
import { Topbar } from '@/frontend/components/layout/Topbar';
import { AppShell, NavToggle } from '@/frontend/components/layout/AppShell';
import { getNotifications, getMessageAlerts } from '@/backend/services/notifications.service';
import { RATE_SOURCE_LABEL, resolveRateSource } from '@/backend/services/exchange-rate.service';

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
   * Clave temporal sin cambiar: no se entra a ninguna sección del panel.
   *
   * Cubre la entrada por URL directa; el aterrizaje normal ya lo desvía
   * `app/page.tsx`. `/cambiar-clave` vive FUERA de este grupo, así que el
   * destino no vuelve a pasar por aquí y no hay bucle que esquivar.
   *
   * La contraseña llegó por correo, así que la ha visto quien tenga acceso a
   * ese buzón. Mientras siga siendo válida, la cuenta no es de su dueño.
   */
  if (user.mustChangePassword) redirect('/cambiar-clave');

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

  /*
   * Badge de tarifas esperando aprobación.
   *
   * Una tarifa propuesta y no revisada es dinero que no se está cobrando: la
   * odontóloga cree que su precio nuevo ya está y el mostrador sigue
   * facturando el de lista. Antes sólo se veía entrando a /tarifas a mirar,
   * así que se quedaban ahí semanas.
   *
   * Es de quien aprueba (recepción y administración), no del odontólogo: a
   * él ya se le dice en su propia pantalla que está pendiente.
   */
  const pendingTariffs = isDentist
    ? 0
    : (await repository.listDentistTreatments({ status: 'PENDING' })).length;

  // Para el pie del sidebar: "se cobra a tasa X", NO siempre BCV — aquí es
  // normal poner los precios en dólares y cobrar a tasa EURO.
  const settings = await repository.getClinicSettings();
  const rateLabel = RATE_SOURCE_LABEL[resolveRateSource(settings.preferredRateSource)];

  return (
    <AppShell
      sidebar={<Sidebar
          userRole={user.role}
          pendingChats={pendingChats}
          pendingTariffs={pendingTariffs}
          rateLabel={rateLabel}
        />}
    >
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
