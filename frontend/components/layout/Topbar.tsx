import type { ReactNode } from 'react';
import type { UserRole } from '@/backend/domain/types';
import { UserMenu } from '@/frontend/components/layout/UserMenu';
import { GlobalSearch } from '@/frontend/components/layout/GlobalSearch';
import {
  NotificationsMenu,
  MessagesMenu,
  type NotificationItem,
} from '@/frontend/components/layout/TopbarMenus';

/**
 * Barra superior: buscador, avisos e identidad del usuario.
 *
 * Server Component. Las piezas que necesitan JavaScript —buscador, menús y
 * cierre de sesión— viven aisladas en sus propios componentes de cliente,
 * para no arrastrar toda la barra al bundle del navegador.
 *
 * Los avisos y los mensajes son OPCIONALES, y su ausencia es la que decide
 * si se pinta el icono. Ligar lo que se ve a lo que el servidor mandó —en vez
 * de a una segunda comprobación de rol aquí— evita el caso incoherente de una
 * campana que se abre y no tiene nada dentro porque nadie consultó los datos.
 */

const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ASSISTANT: 'Asistente',
  DENTIST: 'Odontólogo',
};

export function Topbar({
  userName,
  userRole,
  userEmail,
  notifications,
  messages,
  canSearchPatients = true,
  navToggle,
}: {
  userName: string;
  userRole: UserRole;
  userEmail?: string;
  /** Botón hamburguesa. Sólo se ve en móvil; lo inyecta el armazón. */
  navToggle?: ReactNode;
  /** Sin datos → sin campana. Lo decide el layout, que es quien consulta. */
  notifications?: NotificationItem[];
  messages?: NotificationItem[];
  /**
   * El buscador lleva a `/pacientes`. A quien no tenga esa sección le
   * devolvería un «sin permiso»: una caja de búsqueda que castiga por usarla
   * es peor que no tenerla.
   */
  canSearchPatients?: boolean;
}) {
  return (
    <header className="topbar">
      {navToggle}

      {/* El hueco se conserva aunque no haya buscador: sin él, el menú de
          usuario saltaría al borde izquierdo y la barra cambiaría de forma
          según quién entre. */}
      {canSearchPatients ? <GlobalSearch /> : <div />}

      <div className="topbar__actions">
        {messages && <MessagesMenu items={messages} />}
        {notifications && <NotificationsMenu items={notifications} />}
        <UserMenu userName={userName} subtitle={userEmail ?? ROLE_LABEL[userRole]} />
      </div>
    </header>
  );
}

/**
 * Cabecera de página: título grande, subtítulo y acciones.
 *
 * Va separada de `Topbar` porque son cosas distintas: la topbar es global y
 * constante; esto cambia en cada pantalla.
 */
export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-head__title">{title}</h1>
        {subtitle && <p className="page-head__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}
