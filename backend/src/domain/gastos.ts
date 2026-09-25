import type { Expense } from '@/backend/domain/types';

/**
 * ===========================================================================
 *  Cuánto pesa cada gasto en un periodo
 * ===========================================================================
 *  Un gasto ÚNICO cuenta si su fecha cae dentro del periodo. Uno MENSUAL
 *  cuenta una vez por cada mes del periodo en el que esté vigente: desde el
 *  mes de `startsOn` hasta el de `endsOn` incluido, o sin fin.
 *
 *  Todo en claves 'YYYY-MM-DD' y 'YYYY-MM': son fechas de calendario, no
 *  instantes, y compararlas como texto es exacto y no depende de zonas.
 * ===========================================================================
 */

/** Los meses 'YYYY-MM' que toca un rango de días [desde, hasta]. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const meses: string[] = [];
  let [y, m] = [Number(desde.slice(0, 4)), Number(desde.slice(5, 7))];
  const fin = hasta.slice(0, 7);
  for (let guard = 0; guard < 600; guard += 1) {
    const clave = `${y}-${String(m).padStart(2, '0')}`;
    meses.push(clave);
    if (clave >= fin) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return meses;
}

/** Cuántas veces cuenta un gasto entre dos días (ambos incluidos). */
export function vecesEnElPeriodo(gasto: Expense, desde: string, hasta: string): number {
  if (gasto.recurrence === 'ONE_TIME') {
    return gasto.startsOn >= desde && gasto.startsOn <= hasta ? 1 : 0;
  }
  const primerMes = gasto.startsOn.slice(0, 7);
  const ultimoMes = gasto.endsOn ? gasto.endsOn.slice(0, 7) : null;
  return mesesEntre(desde, hasta).filter(
    (mes) => mes >= primerMes && (ultimoMes === null || mes <= ultimoMes),
  ).length;
}

export interface GastoDelPeriodo {
  gasto: Expense;
  veces: number;
  totalCents: number;
}

/** Los gastos que cuentan en el periodo, con lo que suman, y el total. */
export function gastosDelPeriodo(
  gastos: Expense[],
  desde: string,
  hasta: string,
): { filas: GastoDelPeriodo[]; totalCents: number } {
  const filas = gastos
    .map((gasto) => {
      const veces = vecesEnElPeriodo(gasto, desde, hasta);
      return { gasto, veces, totalCents: veces * gasto.amountCents };
    })
    .filter((f) => f.veces > 0)
    .sort((a, b) => b.totalCents - a.totalCents);
  return { filas, totalCents: filas.reduce((s, f) => s + f.totalCents, 0) };
}
