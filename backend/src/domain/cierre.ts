import type { AdminLedgerEntry, DentistLedgerEntry } from '@/backend/domain/types';

/**
 * ===========================================================================
 *  El cierre de un mes o de un año
 * ===========================================================================
 *  TODO lo de Administración junto, para un periodo: el libro general, la
 *  caja chica y el libro de cada odontóloga. Lo cobrado en Caja lo añade la página al lado, para poder
 *  comparar lo anotado con lo que de verdad entró.
 *
 *  «CUÁNTO SE GANÓ» es el Total General del libro: lo que entró menos lo que
 *  salió —pagos a doctoras y gastos—. El mismo número que da la pestaña
 *  Gastos Administrativos si se filtrara por esas fechas.
 *
 *  Función PURA: recibe las filas y devuelve los totales.
 * ===========================================================================
 */

export interface CierreDesglose {
  /** 'YYYY-MM-DD' en un cierre mensual; 'YYYY-MM' en uno anual. */
  clave: string;
  incomeCents: number;
  expenseCents: number;
  filas: number;
}

export interface Cierre {
  /** 'YYYY-MM' o 'YYYY'. */
  period: string;
  esAnual: boolean;
  incomeCents: number;
  expenseCents: number;
  /** De los egresos, lo que fue la parte de las odontólogas. */
  pagosDoctorasCents: number;
  /** De los egresos, lo que fue gasto de la clínica. */
  gastosCents: number;
  filas: number;
  /** Por día (mensual) o por mes (anual); sólo los que tienen movimiento. */
  desglose: CierreDesglose[];
  /** Los mayores gastos del periodo, sin los pagos a doctoras. */
  mayoresGastos: Array<{ description: string; cents: number; veces: number }>;
  cajaChica: { inicialCents: number; entroCents: number; salioCents: number; finalCents: number };
  dentists: Array<{
    dentistId: string;
    dentistName: string;
    consultas: number;
    budgetCents: number;
    dentistShareCents: number;
    clinicShareCents: number;
  }>;
}

/**
 * ¿Este egreso es la parte de una odontóloga y no un gasto de la clínica?
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

/** Primer y último día de 'YYYY-MM' o 'YYYY', como 'YYYY-MM-DD'. */
export function rangoDelCierre(period: string): { desde: string; hasta: string } {
  if (period.length === 4) return { desde: `${period}-01-01`, hasta: `${period}-12-31` };
  const [y, m] = [Number(period.slice(0, 4)), Number(period.slice(5, 7))];
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${period}-01`, hasta: `${period}-${String(ultimo).padStart(2, '0')}` };
}

export function calcularCierre(params: {
  period: string;
  /** El libro general (Gastos Administrativos). */
  libro: AdminLedgerEntry[];
  cajaChica: AdminLedgerEntry[];
  libros: Array<{ dentistId: string; dentistName: string; filas: DentistLedgerEntry[] }>;
}): Cierre {
  const { period, libro, cajaChica, libros } = params;
  const esAnual = period.length === 4;
  const { desde, hasta } = rangoDelCierre(period);
  const dentro = (fecha: string) => fecha >= desde && fecha <= hasta;

  const delPeriodo = libro.filter((f) => dentro(f.date));

  const porClave = new Map<string, CierreDesglose>();
  const porGasto = new Map<string, { description: string; cents: number; veces: number }>();
  let incomeCents = 0;
  let expenseCents = 0;
  let pagosDoctorasCents = 0;

  for (const f of delPeriodo) {
    incomeCents += f.incomeCents;
    expenseCents += f.expenseCents;

    const clave = esAnual ? f.date.slice(0, 7) : f.date;
    const d = porClave.get(clave) ?? { clave, incomeCents: 0, expenseCents: 0, filas: 0 };
    d.incomeCents += f.incomeCents;
    d.expenseCents += f.expenseCents;
    d.filas += 1;
    porClave.set(clave, d);

    if (f.expenseCents === 0) continue;
    if (esPagoADoctora(f)) {
      pagosDoctorasCents += f.expenseCents;
      continue;
    }
    // «Compra de 2 Botellones de Agua» y «compra de 2 botellones de agua»
    // son el mismo gasto repetido.
    const nombre = f.description.trim().toLowerCase();
    const g = porGasto.get(nombre) ?? { description: f.description.trim(), cents: 0, veces: 0 };
    g.cents += f.expenseCents;
    g.veces += 1;
    porGasto.set(nombre, g);
  }

  const saldo = (filas: AdminLedgerEntry[]) => filas.reduce((s, f) => s + f.incomeCents - f.expenseCents, 0);
  const cajaAntes = cajaChica.filter((f) => f.date < desde);
  const cajaDentro = cajaChica.filter((f) => dentro(f.date));
  const inicialCents = saldo(cajaAntes);
  const entroCents = cajaDentro.reduce((s, f) => s + f.incomeCents, 0);
  const salioCents = cajaDentro.reduce((s, f) => s + f.expenseCents, 0);

  return {
    period,
    esAnual,
    incomeCents,
    expenseCents,
    pagosDoctorasCents,
    gastosCents: expenseCents - pagosDoctorasCents,
    filas: delPeriodo.length,
    desglose: [...porClave.values()].sort((a, b) => a.clave.localeCompare(b.clave)),
    mayoresGastos: [...porGasto.values()].sort((a, b) => b.cents - a.cents).slice(0, 8),
    cajaChica: { inicialCents, entroCents, salioCents, finalCents: inicialCents + entroCents - salioCents },
    dentists: libros
      .map(({ dentistId, dentistName, filas }) => {
        const suyas = filas.filter((f) => dentro(f.date));
        return {
          dentistId,
          dentistName,
          consultas: suyas.length,
          budgetCents: suyas.reduce((s, f) => s + f.budgetCents, 0),
          dentistShareCents: suyas.reduce((s, f) => s + f.dentistShareCents, 0),
          clinicShareCents: suyas.reduce((s, f) => s + f.clinicShareCents, 0),
        };
      })
      .filter((d) => d.consultas > 0),
  };
}
