'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import type { UserRole } from '@/backend/domain/types';
import { Modal } from '@/frontend/components/motion';
import { IconHelp } from '@/frontend/components/ui/icons';
import { ayudaDe } from '@/frontend/features/help/help-content';

/**
 * ===========================================================================
 *  «¿Cómo se hace?» — la ayuda de la pantalla en la que se está
 * ===========================================================================
 *  Un «?» en la barra de arriba, igual en todas las pantallas. Al tocarlo
 *  explica ESA pantalla: qué se puede hacer, cómo, cómo se corrige y qué no
 *  se puede.
 *
 *  Sale de la ruta, no de un texto que cada página tenga que acordarse de
 *  pasar: una pantalla nueva sin ayuda escrita simplemente no enseña el
 *  botón, en vez de abrir un cuadro vacío.
 *
 *  Las secciones marcadas para un rol sólo las ve ese rol: a recepción no se
 *  le explica cómo pagarle a una odontóloga, que no es algo que pueda hacer.
 * ===========================================================================
 */

export function HelpButton({ userRole }: { userRole: UserRole }) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);

  const ayuda = ayudaDe(pathname ?? '');
  const secciones = ayuda?.secciones.filter((s) => !s.roles || s.roles.includes(userRole)) ?? [];
  if (!ayuda || secciones.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setAbierto(true)}
        title="¿Cómo se usa esta pantalla?"
        aria-label={`Ayuda de ${ayuda.titulo}`}
        aria-haspopup="dialog"
      >
        <IconHelp size={18} />
      </button>

      <Modal open={abierto} onClose={() => setAbierto(false)} title={`Cómo se usa: ${ayuda.titulo}`} subtitle={ayuda.para}>
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          {secciones.map((seccion) => (
            <section key={seccion.titulo}>
              <h3 className="text-sm" style={{ fontWeight: 700, marginBottom: '0.4rem' }}>
                {seccion.titulo}
              </h3>
              <ul className="text-sm" style={{ paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem' }}>
                {seccion.puntos.map((punto) => (
                  <li key={punto}>{punto}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Modal>
    </>
  );
}
