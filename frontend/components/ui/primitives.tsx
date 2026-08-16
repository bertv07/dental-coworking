import type { ReactNode } from 'react';

/**
 * ===========================================================================
 *  Primitivas de UI
 * ===========================================================================
 *  Server Components sin estado: se renderizan en el servidor y no añaden
 *  ni un byte de JavaScript al bundle del cliente.
 *
 *  Sobre XSS: todo lo que se pinta aquí pasa por interpolación de React
 *  (`{value}`), que escapa automáticamente. Un paciente llamado
 *  `<script>alert(1)</script>` se muestra como texto literal. En todo el
 *  proyecto no se usa `dangerouslySetInnerHTML` — ni una vez.
 * ===========================================================================
 */

// --- Tarjeta ---------------------------------------------------------------

interface CardProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** `flush` quita el padding interior: para tablas que llegan al borde. */
  flush?: boolean;
}

export function Card({ title, subtitle, actions, children, flush }: CardProps) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card__header">
          <div>
            {title && <h2 className="card__title">{title}</h2>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={`card__body ${flush ? 'card__body--flush' : ''}`}>{children}</div>
    </section>
  );
}

// --- Indicador (KPI) -------------------------------------------------------

interface StatProps {
  label: string;
  /** Valor ya formateado. Para animarlo, usar `AnimatedStat`. */
  value: ReactNode;
  meta?: string;
  /** Variación porcentual vs. periodo anterior. `null` = sin base comparable. */
  deltaPercent?: number | null;
  /**
   * Tarjeta rellena de azul con texto blanco.
   * Se usa en UNA sola por sección: es el recurso que dirige la mirada al
   * dato principal. Si todas destacan, ninguna destaca.
   */
  featured?: boolean;
  /** Valor largo (importes) → tipografía algo menor para que quepa. */
  compact?: boolean;
}

export function Stat({
  label,
  value,
  meta,
  deltaPercent,
  featured,
  compact,
}: StatProps) {
  const hasDelta = deltaPercent !== null && deltaPercent !== undefined;
  const isUp = hasDelta && deltaPercent > 0;

  return (
    <article className={`stat ${featured ? 'stat--featured' : ''}`}>
      <div className="stat__top">
        <span className="stat__label">{label}</span>
        <span className="stat__arrow" aria-hidden="true">
          ↗
        </span>
      </div>

      <span className={`stat__value ${compact ? 'stat__value--sm' : ''}`}>{value}</span>

      <span className="stat__meta">
        {hasDelta && (
          <span className={`stat__delta ${isUp ? '' : 'stat__delta--down'}`}>
            {isUp ? '↑' : '↓'} {Math.abs(deltaPercent).toFixed(1)}%
          </span>
        )}
        {meta && <span>{meta}</span>}
      </span>
    </article>
  );
}

// --- Etiqueta de estado ----------------------------------------------------

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/**
 * Traduce el estado de una cita a etiqueta legible y color coherente.
 *
 * Centralizarlo evita que cada pantalla invente su propio color para
 * "CANCELLED" — y que el mismo estado se vea distinto en dos vistas.
 */
const APPOINTMENT_STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Pendiente', tone: 'warning' },
  CONFIRMED: { label: 'Confirmada', tone: 'info' },
  IN_PROGRESS: { label: 'En curso', tone: 'accent' },
  COMPLETED: { label: 'Completada', tone: 'success' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
  NO_SHOW: { label: 'No asistió', tone: 'danger' },
};

export function AppointmentStatusBadge({ status }: { status: string }) {
  const meta = APPOINTMENT_STATUS_META[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const SOURCE_META: Record<string, { label: string; tone: BadgeTone }> = {
  WHATSAPP_AI: { label: '🤖 IA', tone: 'accent' },
  ADMIN_PANEL: { label: 'Panel', tone: 'neutral' },
  PHONE_CALL: { label: 'Teléfono', tone: 'neutral' },
  WALK_IN: { label: 'Presencial', tone: 'neutral' },
};

export function SourceBadge({ source }: { source: string }) {
  const meta = SOURCE_META[source] ?? { label: source, tone: 'neutral' as const };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

// --- Avatar con iniciales ---------------------------------------------------

export function Avatar({ name, small }: { name: string; small?: boolean }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span className={`avatar ${small ? 'avatar--sm' : ''}`} aria-hidden="true">
      {initials}
    </span>
  );
}

// --- Barra de reparto de comisiones ----------------------------------------

interface SplitBarProps {
  clinicCents: number;
  dentistCents: number;
  clinicLabel: string;
  dentistLabel: string;
}

/**
 * Visualiza el reparto 40/60. Una barra comunica la proporción de un vistazo
 * mucho mejor que dos números sueltos.
 */
export function SplitBar({
  clinicCents,
  dentistCents,
  clinicLabel,
  dentistLabel,
}: SplitBarProps) {
  const total = clinicCents + dentistCents;
  // Evita la división por cero cuando aún no hay ingresos en el periodo.
  const clinicPercent = total > 0 ? (clinicCents / total) * 100 : 0;

  return (
    <div>
      <div
        className="split-bar"
        role="img"
        aria-label={`Reparto: clínica ${clinicPercent.toFixed(0)}%, odontólogos ${(100 - clinicPercent).toFixed(0)}%`}
      >
        <div
          className="split-bar__segment split-bar__segment--clinic"
          style={{ width: `${clinicPercent}%` }}
        />
        <div
          className="split-bar__segment split-bar__segment--dentist"
          style={{ width: `${100 - clinicPercent}%` }}
        />
      </div>

      <div className="split-legend">
        <span className="split-legend__item">
          <span
            className="split-legend__dot"
            style={{ background: 'var(--color-primary)' }}
            aria-hidden="true"
          />
          Clínica · {clinicLabel}
        </span>
        <span className="split-legend__item">
          <span
            className="split-legend__dot"
            style={{ background: '#93b4fb' }}
            aria-hidden="true"
          />
          Odontólogos · {dentistLabel}
        </span>
      </div>
    </div>
  );
}

// --- Aviso -----------------------------------------------------------------

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  const icon = tone === 'warning' ? '⚠' : tone === 'danger' ? '✕' : 'ℹ';
  return (
    <div className={`notice notice--${tone}`} role="status">
      <span aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

// --- Estado vacío ----------------------------------------------------------

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
