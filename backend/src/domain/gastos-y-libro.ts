import type { AdminLedgerEntry, Expense } from '@/backend/domain/types';
import { mesesEntre } from '@/backend/domain/gastos';

/**
 * ===========================================================================
 *  Gastos y el libro de Administración, conectados
 * ===========================================================================
 *  Son dos pantallas que apuntan lo mismo desde dos lados: en Gastos se
 *  carga «la luz, cada mes»; en el libro se escribe —o se sube por Excel—
 *  «Propaganda Facebook, 143». Antes ninguna veía lo de la otra, y cada una
 *  daba un «lo que queda» distinto.
 *
 *  SE CONECTAN AL LEER, no copiando filas. Cada dato vive donde se cargó y
 *  se edita ahí; la otra pantalla lo ENSEÑA y lo SUMA:
 *   · El libro (y el dashboard) muestran los gastos de la clínica como
 *     egresos, con la insignia «Gastos».
 *   · Gastos suma los egresos del libro que son gasto de verdad.
 *
 *  Copiarlos habría dejado dos filas que mantener iguales, y un gasto
 *  mensual obligaría a fabricar una fila nueva cada mes. Así no hay nada que
 *  se pueda desincronizar.
 *
 *  Funciones PURAS: reciben filas y devuelven filas.
 * ===========================================================================
 */

function ultimoDiaDelMes(mes: string): number {
  const [y, m] = [Number(mes.slice(0, 4)), Number(mes.slice(5, 7))];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Los gastos de la CLÍNICA como filas de egreso del libro.
 *
 * Uno único es una fila en su fecha. Uno mensual es una fila por cada mes
 * vigente, el mismo día del mes en que empezó (un gasto del día 31 cae el 30
 * en los meses cortos), y sólo hasta `mesTope`: la luz de diciembre no es un
 * egreso todavía en octubre.
 *
 * Los de las odontólogas no entran: son suyos, no de la clínica.
 */
export function gastosComoFilasDelLibro(gastos: Expense[], mesTope: string): AdminLedgerEntry[] {
  const filas: AdminLedgerEntry[] = [];
  for (const g of gastos) {
    if (g.scope !== 'CLINIC' || g.amountCents <= 0) continue;

    const fechas: string[] = [];
    if (g.recurrence === 'ONE_TIME') {
      fechas.push(g.startsOn);
    } else {
      const primerMes = g.startsOn.slice(0, 7);
      const ultimoMes = g.endsOn && g.endsOn.slice(0, 7) < mesTope ? g.endsOn.slice(0, 7) : mesTope;
      if (primerMes <= ultimoMes) {
        const dia = Number(g.startsOn.slice(8, 10));
        for (const mes of mesesEntre(`${primerMes}-01`, `${ultimoMes}-01`)) {
          fechas.push(`${mes}-${String(Math.min(dia, ultimoDiaDelMes(mes))).padStart(2, '0')}`);
        }
      }
    }

    for (const date of fechas) {
      filas.push({
        id: `gasto:${g.id}:${date}`,
        book: 'GASTOS_ADMIN',
        date,
        description: g.description,
        incomeCents: 0,
        expenseCents: g.amountCents,
        notes: [g.category, g.recurrence === 'MONTHLY' ? 'cada mes' : null, g.notes].filter(Boolean).join(' · '),
        sourcePaymentId: null,
        sourceExpenseId: g.id,
        createdAt: g.createdAt,
      });
    }
  }
  return filas;
}

/** El libro general con los gastos de la clínica intercalados por fecha. */
export function libroConGastos(filas: AdminLedgerEntry[], gastos: Expense[], mesTope: string): AdminLedgerEntry[] {
  // `sort` es estable: dentro del mismo día, lo del libro sigue en su orden.
  return [...filas, ...gastosComoFilasDelLibro(gastos, mesTope)].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * ¿Este egreso es la parte de una odontóloga y no un gasto?
 *
 * En Gastos, «lo que le entra a la clínica» YA es su parte de cada cobro,
 * sin la de la doctora. Si además se restara el «Pago Dra» como gasto, se
 * descontaría dos veces.
 *
 * Las que nacen de un cobro se reconocen por `sourcePaymentId`. Las escritas
 * a mano o subidas por Excel, por cómo las escribe la clínica: todas
 * empiezan por «Consulta…» o dicen «Pago Dra».
 */
export function esPagoADoctora(fila: AdminLedgerEntry): boolean {
  if (fila.sourcePaymentId) return true;
  const texto = fila.description.toLowerCase();
  return /^\s*consulta\b/.test(texto) || /pago\s+(a\s+)?(la\s+)?(dra|dr|doctora|doctor)\b/.test(texto);
}

/** Los egresos del libro general que cuentan como gasto de la clínica entre dos días. */
export function egresosDelLibroComoGastos(
  filas: AdminLedgerEntry[],
  desde: string,
  hasta: string,
): { filas: AdminLedgerEntry[]; totalCents: number } {
  const suyas = filas.filter(
    (f) =>
      f.book === 'GASTOS_ADMIN' &&
      f.expenseCents > 0 &&
      f.date >= desde &&
      f.date <= hasta &&
      !esPagoADoctora(f),
  );
  return { filas: suyas, totalCents: suyas.reduce((s, f) => s + f.expenseCents, 0) };
}
