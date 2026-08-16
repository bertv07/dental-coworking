'use client';

import { logoutAction } from '@/app/actions/auth.actions';
import { IconLogout } from '@/frontend/components/ui/icons';

/**
 * Identidad del usuario + cierre de sesión.
 *
 * SOBRE EL LOGOUT: invoca una Server Action en lugar de hacer `fetch` a un
 * endpoint. Dos ventajas concretas:
 *
 *  · CSRF: Next.js valida el header Origin de toda Server Action contra
 *    `allowedOrigins` (next.config.mjs). Un formulario en otro dominio no
 *    puede dispararla.
 *  · La cookie se borra en el SERVIDOR, que es el único sitio donde borrarla
 *    significa algo — es `httpOnly` y JavaScript no la ve.
 *
 * Se usa `<form action={...}>` y no `onClick`: así funciona incluso si el
 * JavaScript no cargó. Antes era un `onClick` dentro de `useTransition`, que
 * quedaba muerto en cuanto algo rompía el bundle del cliente.
 */

function getInitials(fullName: string): string {
  return fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function UserMenu({ userName, subtitle }: { userName: string; subtitle: string }) {
  return (
    <div className="row" style={{ gap: '0.5rem' }}>
      <div className="user-chip">
        <div className="user-chip__avatar" aria-hidden="true">
          {getInitials(userName)}
        </div>
        {/* Envuelto para poder ocultar el texto en móvil y dejar el avatar. */}
        <div className="user-chip__text">
          <div className="user-chip__name">{userName}</div>
          <div className="user-chip__role">{subtitle}</div>
        </div>
      </div>

      {/* La Server Action se pasa DIRECTAMENTE al form: Next.js se encarga
          del envío, y el formulario sigue funcionando sin JavaScript. */}
      <form action={logoutAction}>
        <button
          type="submit"
          className="icon-btn"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
        >
          <IconLogout size={17} />
        </button>
      </form>
    </div>
  );
}
