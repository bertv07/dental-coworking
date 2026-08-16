'use client';

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatCents } from '@/backend/domain/money';

/**
 * ===========================================================================
 *  Primitivas de animación (Framer Motion)
 * ===========================================================================
 *  Todas son componentes de CLIENTE, pero aceptan `children` renderizados en
 *  el SERVIDOR. Ese detalle importa: envolver contenido en `<Stagger>` NO
 *  convierte ese contenido en cliente — React lo pasa como ReactNode ya
 *  serializado. Así se animan las tarjetas sin enviar su lógica al navegador.
 *
 *  CRITERIO: animaciones cortas (0.2–0.45 s) y sutiles. En un panel que se
 *  usa ocho horas al día, una animación vistosa se vuelve insoportable en la
 *  tercera visita. Se anima la ENTRADA y la respuesta al puntero, nada más.
 *
 *  ACCESIBILIDAD: `useReducedMotion` respeta la preferencia del sistema. Si
 *  el usuario pidió menos movimiento, todo se resuelve en un fundido simple.
 * ===========================================================================
 */

/** Curva de salida estándar: arranca rápido y frena suave. */
const EASE = [0.22, 1, 0.36, 1] as const;

// --- Contenedor con entrada escalonada -------------------------------------

interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** Retardo entre hijos, en segundos. */
  gap?: number;
  /** Retardo antes de empezar. Útil para encadenar secciones. */
  delay?: number;
}

/**
 * Anima a sus hijos directos apareciendo uno tras otro.
 *
 * Se usa `variants` con `staggerChildren` en vez de calcular un `delay` por
 * hijo: así el escalonado no depende de cuántos hijos haya ni de su orden en
 * el código.
 */
export function Stagger({ children, className, gap = 0.06, delay = 0 }: StaggerProps) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: reduce ? 0 : gap, delayChildren: delay },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Hijo de `<Stagger>`. Sube 12px mientras aparece. */
export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: reduce ? 0 : 12 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

// --- Aparición simple -------------------------------------------------------

export function FadeIn({
  children,
  className,
  delay = 0,
  y = 10,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

// --- Tarjeta con elevación al pasar el puntero ------------------------------

/**
 * Tarjeta que reacciona al puntero con un desplazamiento mínimo.
 *
 * Se anima `y` y no `box-shadow` ni `height`: las transformaciones las
 * resuelve la GPU sin recalcular el layout, así que el efecto no provoca
 * reflow aunque haya veinte tarjetas en pantalla.
 */
export function HoverCard({
  children,
  className,
  lift = 3,
}: {
  children: ReactNode;
  className?: string;
  lift?: number;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      whileHover={reduce ? undefined : { y: -lift }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      style={{ height: '100%' }}
    >
      {children}
    </motion.div>
  );
}

// --- Contador numérico ------------------------------------------------------

interface CountUpProps {
  value: number;
  /**
   * Tipo de formato, como CADENA — no como función.
   *
   * ⚠️  Es una restricción de React Server Components, no un capricho: las
   *  props que cruzan del servidor al cliente se serializan, y una función
   *  no es serializable. Pasar `format={formatCents}` desde un Server
   *  Component lanza "Functions cannot be passed directly to Client
   *  Components". Se envía qué formato aplicar y el formateo ocurre aquí.
   */
  format?: 'number' | 'currency';
  duration?: number;
}

/**
 * Cuenta desde 0 hasta `value` al montarse.
 *
 * Implementado con `requestAnimationFrame` en vez de `useSpring` de Framer
 * porque hace falta aplicar un formateador (moneda, porcentaje) en cada
 * fotograma, y así el valor final es EXACTAMENTE el recibido — un spring
 * puede quedarse en 189.049.997 por redondeo, y en cifras de dinero eso
 * se nota.
 */
export function CountUp({ value, format, duration = 0.9 }: CountUpProps) {
  const reduce = useReducedMotion();

  /**
   * El estado arranca en el VALOR FINAL, no en cero.
   *
   * Es deliberado y importa: el servidor renderiza este número en el HTML.
   * Si arrancara en 0, el dashboard se serviría con "$0,00" y sólo se
   * corregiría al hidratar — de modo que sin JavaScript, o durante el
   * instante previo a la hidratación, el administrador vería ingresos de
   * cero. Eso no es una animación ausente: es un dato FALSO.
   *
   * La animación se dispara en `useEffect`, que sólo corre en el cliente:
   * ahí sí se baja a 0 y se cuenta hacia arriba.
   */
  const [display, setDisplay] = useState(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const totalMs = duration * 1000;

    function tick(now: number) {
      const progress = Math.min((now - start) / totalMs, 1);
      // easeOutExpo: casi todo el recorrido ocurre al principio.
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

      setDisplay(Math.round(value * eased));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        // Se fija el valor exacto: nada de aproximaciones al terminar.
        setDisplay(value);
      }
    }

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration, reduce]);

  // `formatCents` se puede importar aquí porque `domain/money.ts` NO lleva
  // `server-only`: son funciones puras y la UI necesita formatear importes.
  const text =
    format === 'currency' ? formatCents(display) : display.toLocaleString('es-CO');

  return <>{text}</>;
}

// --- Modal ------------------------------------------------------------------

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Modal animado.
 *
 * `AnimatePresence` permite animar también la SALIDA — sin él, React
 * desmontaría el nodo de golpe y el cierre sería un corte seco.
 *
 * Accesibilidad incluida: cierre con Escape, bloqueo del scroll de fondo,
 * `role="dialog"` y `aria-modal`.
 */
export function Modal({ open, onClose, title, subtitle, children, footer }: ModalProps) {
  const reduce = useReducedMotion();

  // Escape cierra, y el fondo no debe poder desplazarse mientras esté abierto.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            className="modal"
            initial={{ opacity: 0, scale: reduce ? 1 : 0.96, y: reduce ? 0 : 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduce ? 1 : 0.97, y: reduce ? 0 : 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            // Sin esto, un clic dentro del modal borbotea hasta el fondo y lo cierra.
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal__header">
              <div>
                <h2 className="modal__title">{title}</h2>
                {subtitle && <p className="modal__subtitle">{subtitle}</p>}
              </div>
              <button type="button" className="modal__close" onClick={onClose} aria-label="Cerrar">
                ✕
              </button>
            </div>

            <div className="modal__body">{children}</div>
            {footer && <div className="modal__footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// --- Filas de tabla animadas ------------------------------------------------

/**
 * `<tr>` que aparece y desaparece con animación.
 *
 * Va aparte de `StaggerItem` porque HTML no permite un `<div>` entre
 * `<tbody>` y `<tr>`: el navegador lo expulsaría de la tabla y rompería el
 * layout. `motion.tr` conserva la semántica correcta.
 */
export function MotionRow({
  children,
  index = 0,
}: {
  children: ReactNode;
  index?: number;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.tr
      layout
      initial={{ opacity: 0, y: reduce ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{
        duration: 0.28,
        // Se limita el escalonado a las 12 primeras: con 60 filas, la última
        // tardaría cuatro segundos en aparecer.
        delay: reduce ? 0 : Math.min(index, 12) * 0.025,
        ease: EASE,
      }}
    >
      {children}
    </motion.tr>
  );
}

/** Reexportaciones para no importar framer-motion en todas partes. */
export { motion, AnimatePresence };
