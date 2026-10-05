import type { AdminLedgerEntry, DentistLedgerEntry } from '@/backend/domain/types';

/**
 * ===========================================================================
 *  El libro de Administración, resumido para el dashboard
 * ===========================================================================
 *  Función PURA: recibe las filas de los libros y devuelve los totales. No
 *  consulta nada, así que el dashboard y el libro no pueden decir cosas
 *  distintas — salen de las mismas filas, sumadas igual.
 *
 *  POR MES, no por «últimos 30 días» como el resto del dashboard: la hoja se
 *  lleva y se cierra por mes, y el «Total General» que alguien va a comparar
 *  con su Excel es el del mes entero.
 * ===========================================================================
 */

export interface LedgerMonthTotals {
  /** 'YYYY-MM'. */
  month: string;
  incomeCents: number;
  expenseCents: number;
}

export interface LedgerDentistTotals {
  dentistId: string;
  dentistName: string;
  consultas: number;
  budgetCents: number;
  dentistShareCents: number;
  clinicShareCents: number;
}

export interface LedgerSummary {
  /** El mes que se enseña en detalle. */
  month: string;
  incomeCents: number;
  expenseCents: number;
  /** Filas de Gastos Administrativos en ese mes. */
  filas: number;
  /** Lo que hay HOY en caja chica: todo lo que entró menos todo lo que salió. */
  pettyCashBalanceCents: number;
  /** Los meses con movimiento, del más reciente al más antiguo. */
  months: LedgerMonthTotals[];
  /** Los libros de las odontólogas en ese mes; sólo las que tienen filas. */
  dentists: LedgerDentistTotals[];
}

const MESES_VISIBLES = 6;

export function resumirLibro(params: {
  month: string;
  gastos: AdminLedgerEntry[];
  cajaChica: AdminLedgerEntry[];
  libros: Array<{ dentistId: string; dentistName: string; filas: DentistLedgerEntry[] }>;
}): LedgerSummary {
  const { month, gastos, cajaChica, libros } = params;

  const porMes = new Map<string, LedgerMonthTotals>();
  for (const f of gastos) {
    const clave = f.date.slice(0, 7);
    const total = porMes.get(clave) ?? { month: clave, incomeCents: 0, expenseCents: 0 };
    total.incomeCents += f.incomeCents;
    total.expenseCents += f.expenseCents;
    porMes.set(clave, total);
  }

  const delMes = porMes.get(month) ?? { month, incomeCents: 0, expenseCents: 0 };

  const months = [...porMes.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, MESES_VISIBLES);
  // El mes elegido siempre está en la lista, aunque sea antiguo o esté vacío:
  // si no, no habría forma de ver cuál se está mirando.
  if (!months.some((m) => m.month === month)) {
    months.push(delMes);
    months.sort((a, b) => b.month.localeCompare(a.month));
  }

  const dentists = libros
    .map(({ dentistId, dentistName, filas }) => {
      const suyas = filas.filter((f) => f.date.startsWith(month));
      return {
        dentistId,
        dentistName,
        consultas: suyas.length,
        budgetCents: suyas.reduce((s, f) => s + f.budgetCents, 0),
        dentistShareCents: suyas.reduce((s, f) => s + f.dentistShareCents, 0),
        clinicShareCents: suyas.reduce((s, f) => s + f.clinicShareCents, 0),
      };
    })
    .filter((d) => d.consultas > 0);

  return {
    month,
    incomeCents: delMes.incomeCents,
    expenseCents: delMes.expenseCents,
    filas: gastos.filter((f) => f.date.startsWith(month)).length,
    pettyCashBalanceCents: cajaChica.reduce((s, f) => s + f.incomeCents - f.expenseCents, 0),
    months,
    dentists,
  };
}
