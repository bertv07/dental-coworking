'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import type { ComponentType } from 'react';
import type { UserRole } from '@/backend/domain/types';
import {
  IconDashboard,
  IconCalendar,
  IconChat,
  IconUsers,
  IconStethoscope,
  IconTag,
  IconRoom,
  IconSettings,
  IconTooth,
  IconCurrency,
  IconHome,
} from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Barra lateral
 * ===========================================================================
 *  Componente de CLIENTE por dos motivos: `usePathname()` para saber la
 *  sección activa, y el indicador animado que se desliza entre items.
 *
 *  ⚠️  SEGURIDAD: filtrar enlaces por rol es COSMÉTICA. Ocultar "Odontólogos"
 *   no impide escribir /odontologos en la barra de direcciones. La protección
 *   real es `requireRole()`, que corre en el servidor dentro de cada página.
 *   Aquí sólo se evita mostrar puertas que no se pueden abrir.
 * ===========================================================================
 */

interface NavLink {
  href: string;
  label: string;
  /** Componente de icono SVG. Antes eran glifos Unicode y se veían mal. */
  Icon: ComponentType<{ size?: number }>;
  /** Rol mínimo para ver el enlace. Debe coincidir con el guard de la página. */
  minimumRole: UserRole;
  badge?: number;
}

const NAV_SECTIONS: Array<{ label: string; links: NavLink[] }> = [
  {
    label: 'Menú',
    links: [
      // Panel operativo del turno. Es el aterrizaje del asistente.
      { href: '/inicio', label: 'Inicio', Icon: IconHome, minimumRole: 'ASSISTANT' },
      // /dashboard es el panel FINANCIERO y su guard exige SUPER_ADMIN.
      { href: '/dashboard', label: 'Dashboard', Icon: IconDashboard, minimumRole: 'SUPER_ADMIN' },
      { href: '/agenda', label: 'Agenda', Icon: IconCalendar, minimumRole: 'DENTIST' },
      { href: '/caja', label: 'Caja', Icon: IconCurrency, minimumRole: 'ASSISTANT' },
      { href: '/whatsapp', label: 'WhatsApp', Icon: IconChat, minimumRole: 'ASSISTANT' },
      { href: '/pacientes', label: 'Pacientes', Icon: IconUsers, minimumRole: 'ASSISTANT' },
    ],
  },
  {
    label: 'Administración',
    links: [
      { href: '/odontologos', label: 'Odontólogos', Icon: IconStethoscope, minimumRole: 'SUPER_ADMIN' },
      { href: '/tratamientos', label: 'Precios', Icon: IconTag, minimumRole: 'SUPER_ADMIN' },
      { href: '/tasa-cambio', label: 'Tasa de cambio', Icon: IconCurrency, minimumRole: 'ASSISTANT' },
      { href: '/consultorios', label: 'Consultorios', Icon: IconRoom, minimumRole: 'SUPER_ADMIN' },
      { href: '/configuracion', label: 'Configuración', Icon: IconSettings, minimumRole: 'SUPER_ADMIN' },
    ],
  },
];

/** Misma jerarquía que en `backend/auth/guards.ts`. */
const ROLE_LEVEL: Record<UserRole, number> = {
  DENTIST: 1,
  ASSISTANT: 2,
  SUPER_ADMIN: 3,
};

export function Sidebar({
  userRole,
  pendingChats = 0,
}: {
  userRole: UserRole;
  pendingChats?: number;
}) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <motion.div
          className="sidebar__logo"
          aria-hidden="true"
          // Un rebote muy corto al cargar: da vida sin distraer.
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18 }}
        >
          <IconTooth size={19} />
        </motion.div>
        <div>
          <div className="sidebar__brand-name">Dental</div>
          <div className="sidebar__brand-sub">Coworking</div>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Navegación principal">
        {NAV_SECTIONS.map((section) => {
          const visibleLinks = section.links.filter(
            (link) => ROLE_LEVEL[userRole] >= ROLE_LEVEL[link.minimumRole],
          );

          // Sección sin enlaces visibles: no se deja el título huérfano.
          if (visibleLinks.length === 0) return null;

          return (
            <div key={section.label}>
              <div className="sidebar__section-label">{section.label}</div>

              {visibleLinks.map(({ href, label, Icon, badge }) => {
                const isActive = pathname === href || pathname.startsWith(`${href}/`);
                const badgeCount = href === '/whatsapp' ? pendingChats : badge;

                return (
                  <Link
                    key={href}
                    href={href}
                    className={`nav-item ${isActive ? 'nav-item--active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {/*
                      `layoutId` compartido: Framer Motion detecta que el mismo
                      elemento cambió de posición y lo DESLIZA entre items en
                      lugar de hacerlo desaparecer y reaparecer.
                    */}
                    {isActive && (
                      <>
                        <motion.span
                          layoutId="nav-active-bg"
                          className="nav-item__bg"
                          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                        />
                        <motion.span
                          layoutId="nav-active-bar"
                          className="nav-item__bar"
                          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                        />
                      </>
                    )}

                    <span className="nav-item__icon">
                      <Icon size={18} />
                    </span>
                    <span>{label}</span>

                    {badgeCount !== undefined && badgeCount > 0 && (
                      <span className="nav-item__badge">
                        {badgeCount}
                        <span className="sr-only"> pendientes</span>
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/*
        Pie del sidebar: recordatorio de que la lista está en dólares y se
        cobra en bolívares.

        Sólo para quien cobra. El odontólogo no maneja tarifas —cobra por
        liquidación mensual— y el botón lleva a `/tasa-cambio`, que su rol no
        puede abrir. Se usa el mismo umbral que el enlace del menú, así los
        dos no pueden desincronizarse.
      */}
      {ROLE_LEVEL[userRole] >= ROLE_LEVEL.ASSISTANT && (
        <div className="sidebar__promo">
          <div className="sidebar__promo-title">Precios en USD</div>
          <p className="sidebar__promo-text">
            Se cobra en bolívares a la tasa BCV del día.
          </p>
          <Link href="/tasa-cambio" className="sidebar__promo-btn">
            Ver tasa
          </Link>
        </div>
      )}
    </aside>
  );
}
