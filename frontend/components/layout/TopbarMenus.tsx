'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { IconBell, IconMail } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Notificaciones y mensajes de la barra superior
 * ===========================================================================
 *  Antes eran dos botones decorativos. Ahora abren un panel con datos REALES
 *  calculados en el servidor:
 *
 *   · Notificaciones → citas por confirmar, inasistencias de hoy y avisos
 *     del sistema (tasa de cambio desactualizada).
 *   · Mensajes → conversaciones de WhatsApp que requieren atención humana.
 *
 *  Los datos llegan como props desde un Server Component. Este componente
 *  sólo abre y cierra el panel; no consulta nada.
 * ===========================================================================
 */

export interface NotificationItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: 'info' | 'warning' | 'danger';
  time?: string;
}

/** Cierra el panel al hacer clic fuera o pulsar Escape. */
function useDismissable(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss();
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onDismiss]);

  return ref;
}

function Panel({
  title,
  items,
  emptyText,
  footerHref,
  footerLabel,
  onClose,
}: {
  title: string;
  items: NotificationItem[];
  emptyText: string;
  footerHref: string;
  footerLabel: string;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="dropdown"
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.16 }}
      role="menu"
      aria-label={title}
    >
      <div className="dropdown__header">
        <span>{title}</span>
        <span className="badge badge--accent">{items.length}</span>
      </div>

      <div className="dropdown__list">
        {items.length === 0 ? (
          <p className="dropdown__empty">{emptyText}</p>
        ) : (
          items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="dropdown__item"
              onClick={onClose}
              role="menuitem"
            >
              <span className={`dropdown__dot dropdown__dot--${item.tone}`} aria-hidden="true" />
              <span style={{ minWidth: 0 }}>
                <span className="dropdown__item-title">{item.title}</span>
                <span className="dropdown__item-detail">{item.detail}</span>
              </span>
              {item.time && <span className="dropdown__item-time">{item.time}</span>}
            </Link>
          ))
        )}
      </div>

      <Link href={footerHref} className="dropdown__footer" onClick={onClose}>
        {footerLabel}
      </Link>
    </motion.div>
  );
}

export function NotificationsMenu({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(() => setOpen(false));

  return (
    <div className="dropdown-anchor" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Notificaciones (${items.length})`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconBell size={17} />
        {items.length > 0 && <span className="icon-btn__dot" aria-hidden="true" />}
      </button>

      <AnimatePresence>
        {open && (
          <Panel
            title="Notificaciones"
            items={items}
            emptyText="Todo al día. No hay avisos pendientes."
            footerHref="/agenda"
            footerLabel="Ver la agenda completa"
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export function MessagesMenu({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(() => setOpen(false));

  return (
    <div className="dropdown-anchor" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Mensajes (${items.length})`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconMail size={17} />
        {items.length > 0 && <span className="icon-btn__dot" aria-hidden="true" />}
      </button>

      <AnimatePresence>
        {open && (
          <Panel
            title="Conversaciones que requieren atención"
            items={items}
            emptyText="Ningún chat necesita intervención humana."
            footerHref="/whatsapp"
            footerLabel="Abrir el monitor de WhatsApp"
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
