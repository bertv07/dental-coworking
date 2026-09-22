import Link from 'next/link';

/**
 * ===========================================================================
 *  Filtros de Caja: periodo, día exacto, rango, odontólogo y medio de pago
 * ===========================================================================
 *  Todo va por la URL (enlaces y un formulario GET): la vista se puede
 *  recargar, compartir y volver atrás con el navegador, y no hace falta
 *  JavaScript para que funcione. Cambiar de periodo conserva el resto de
 *  filtros, que es lo que uno espera al pulsar «Mes» después de haber
 *  elegido a una odontóloga.
 *
 *  No hay filtro de «cajero»: el cobro no guarda quién lo registró. El día
 *  que lo guarde, se añade aquí.
 * ===========================================================================
 */

export type Periodo = 'dia' | 'semana' | 'mes' | 'anio' | 'todo' | 'rango';

export interface CashFilterState {
  periodo: Periodo;
  /** 'YYYY-MM-DD'. Día exacto (o el día de referencia de semana/mes/año). */
  fecha: string;
  desde: string;
  hasta: string;
  odontologo: string;
  metodo: string;
}

const PERIODOS: Array<{ id: Periodo; label: string }> = [
  { id: 'dia', label: 'Día' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
  { id: 'anio', label: 'Año' },
  { id: 'todo', label: 'Todo' },
];

const METODOS = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'CARD', label: 'Tarjeta' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'INSURANCE', label: 'Seguro' },
  { value: 'CREDIT', label: 'Bonificación' },
];

/** Construye `/caja?...` conservando lo que no cambia. */
export function urlCaja(state: CashFilterState, cambios: Partial<CashFilterState> = {}): string {
  const s = { ...state, ...cambios };
  const q = new URLSearchParams();
  if (s.periodo !== 'dia') q.set('periodo', s.periodo);
  if (s.periodo === 'rango') {
    if (s.desde) q.set('desde', s.desde);
    if (s.hasta) q.set('hasta', s.hasta);
  } else if (s.fecha) {
    q.set('fecha', s.fecha);
  }
  if (s.odontologo) q.set('odontologo', s.odontologo);
  if (s.metodo) q.set('metodo', s.metodo);
  const qs = q.toString();
  return qs ? `/caja?${qs}` : '/caja';
}

export function CashFilters({
  state,
  todayKey,
  dentists,
}: {
  state: CashFilterState;
  todayKey: string;
  dentists: Array<{ id: string; fullName: string }>;
}) {
  return (
    <aside className="caja-filtros" aria-label="Filtros de caja">
      <div className="caja-filtros__grupo">
        <div className="caja-filtros__titulo">Periodo</div>
        <div className="caja-filtros__pills">
          {PERIODOS.map((p) => (
            <Link
              key={p.id}
              href={urlCaja(state, { periodo: p.id })}
              className={`pill-btn ${state.periodo === p.id ? 'pill-btn--activo' : ''}`}
              aria-current={state.periodo === p.id ? 'page' : undefined}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      {/*
        Un solo formulario para todo lo que se teclea. `periodo` viaja oculto
        para que enviar el formulario no lo pierda; si se rellena el rango,
        el servidor lo prioriza sobre el día exacto.
      */}
      <form method="get" action="/caja" className="caja-filtros__form">
        <input type="hidden" name="periodo" value={state.periodo === 'rango' ? 'dia' : state.periodo} />

        <label className="caja-filtros__grupo">
          <span className="caja-filtros__titulo">Día exacto</span>
          <input type="date" name="fecha" className="input" max={todayKey} defaultValue={state.periodo === 'rango' ? '' : state.fecha} />
        </label>

        <div className="caja-filtros__grupo">
          <span className="caja-filtros__titulo">Rango de fechas</span>
          <input type="date" name="desde" className="input" max={todayKey} defaultValue={state.desde} aria-label="Desde" />
          <input type="date" name="hasta" className="input" max={todayKey} defaultValue={state.hasta} aria-label="Hasta" style={{ marginTop: '0.4rem' }} />
        </div>

        <label className="caja-filtros__grupo">
          <span className="caja-filtros__titulo">Odontólogo</span>
          <select name="odontologo" className="select" defaultValue={state.odontologo}>
            <option value="">Todos</option>
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </select>
        </label>

        <label className="caja-filtros__grupo">
          <span className="caja-filtros__titulo">Medio de pago</span>
          <select name="metodo" className="select" defaultValue={state.metodo}>
            <option value="">Todos</option>
            {METODOS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <div className="row" style={{ gap: '0.5rem' }}>
          <button type="submit" className="btn btn--primary btn--sm">
            Aplicar
          </button>
          <Link href="/caja" className="btn btn--ghost btn--sm">
            Limpiar
          </Link>
        </div>
      </form>
    </aside>
  );
}
