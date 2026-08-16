'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { IconMenu, IconClose } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Armazón de la aplicación
 * ===========================================================================
 *  Reparte la ventana en dos: menú fijo a la izquierda y contenido a la
 *  derecha. Ni la página ni el `body` se desplazan nunca; el scroll vive
 *  DENTRO del área de contenido.
 *
 *  Por qué importa: con el scroll en la página, el menú lateral se va hacia
 *  arriba al bajar por una tabla larga y hay que volver arriba para cambiar
 *  de sección. Encerrando el scroll en su panel, el menú y la barra superior
 *  quedan siempre en su sitio.
 *
 *  ---------------------------------------------------------------------
 *  EN MÓVIL
 *  ---------------------------------------------------------------------
 *  Por debajo de 960 px no hay sitio para una columna fija de 244 px, así
 *  que el menú pasa a ser un cajón que entra desde la izquierda con el
 *  botón hamburguesa.
 *
 *  El estado vive aquí y se reparte por contexto en lugar de por props: el
 *  botón que abre el cajón está dentro de la barra superior, que es un
 *  Server Component y no puede tener estado. Así el botón sigue siendo una
 *  isla mínima de cliente y la barra entera no se arrastra al navegador.
 * ===========================================================================
 */

interface NavContextValue {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const NavContext = createContext<NavContextValue | null>(null);

export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  /*
   * Al cambiar de sección se cierra solo. Sin esto, tocar «Pacientes» deja el
   * cajón abierto tapando la pantalla a la que se acaba de llegar.
   */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape cierra, como cualquier capa superpuesta.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <NavContext.Provider
      value={{ open, toggle: () => setOpen((value) => !value), close: () => setOpen(false) }}
    >
      <div className={`admin-shell${open ? ' admin-shell--nav-open' : ''}`}>
        {/*
          `inert` cuando el cajón está cerrado en móvil sería lo ideal, pero
          en escritorio el menú SIEMPRE es visible y el mismo nodo se usa para
          las dos cosas. Se resuelve en CSS: fuera de la pantalla no recibe
          clics porque `visibility: hidden` lo saca del árbol de foco.
        */}
        <div className="admin-shell__nav" id="menu-principal">
          {sidebar}
        </div>

        {/* Capa oscura del móvil: tocar fuera cierra. */}
        <button
          type="button"
          className="admin-shell__scrim"
          onClick={() => setOpen(false)}
          aria-label="Cerrar el menú"
          tabIndex={open ? 0 : -1}
        />

        <div className="main-content">{children}</div>
      </div>
    </NavContext.Provider>
  );
}

/**
 * Botón hamburguesa. Se coloca dentro de la barra superior y sólo se ve en
 * pantallas pequeñas — en escritorio el menú no se puede cerrar, así que un
 * botón para abrirlo no tendría sentido.
 */
export function NavToggle() {
  const nav = useContext(NavContext);
  if (!nav) return null;

  return (
    <button
      type="button"
      className="nav-toggle"
      onClick={nav.toggle}
      aria-expanded={nav.open}
      aria-controls="menu-principal"
      aria-label={nav.open ? 'Cerrar el menú' : 'Abrir el menú'}
    >
      {nav.open ? <IconClose size={20} /> : <IconMenu size={20} />}
    </button>
  );
}
