/**
 * ===========================================================================
 *  Dinero — aritmética en centavos de DÓLAR + conversión a bolívares
 * ===========================================================================
 *  Regla única e innegociable: el dinero es un ENTERO de centavos de USD.
 *  Nunca `number` con decimales. `0.1 + 0.2 !== 0.3` en IEEE-754, y en un
 *  sistema de comisiones eso se traduce en descuadres imposibles de auditar.
 *
 *  POR QUÉ USD COMO UNIDAD BASE:
 *  Con la inflación venezolana, una lista de precios en bolívares habría que
 *  reescribirla cada semana. Se guarda en USD (estable) y se MUESTRA en Bs a
 *  la tasa BCV vigente. Cada cobro congela la tasa que usó, así la
 *  contabilidad histórica no se mueve cuando la tasa cambie mañana.
 *
 *  Este módulo NO importa 'server-only' a propósito: la UI necesita formatear
 *  montos, y las funciones puras son seguras de compartir. Lo que jamás cruza
 *  al cliente son los datos, no las fórmulas.
 * ===========================================================================
 */

/** Reparto de un cobro entre clínica y odontólogo. */
export interface CommissionSplit {
  /** Total cobrado al paciente, en centavos. */
  totalCents: number;
  /** Porcentaje que retiene la clínica (0-100). */
  clinicPercent: number;
  /** Parte de la clínica, en centavos. */
  clinicShareCents: number;
  /** Parte del odontólogo, en centavos. */
  dentistShareCents: number;
}

/**
 * Reparte un monto entre clínica y odontólogo garantizando que las partes
 * sumen EXACTAMENTE el total.
 *
 * El problema real: 40% de 33.333 centavos = 13.333,2 → no es entero.
 * Si se redondea cada parte por separado, la suma puede quedar 1 centavo por
 * encima o por debajo del total. Repetido miles de veces, el balance no cierra.
 *
 * Solución: se calcula UNA parte con `Math.round` y la otra por RESTA. Así el
 * total siempre cuadra por construcción, y el centavo residual queda en un
 * lado conocido y documentado (la clínica) en vez de perderse.
 *
 * @example
 * splitCents(10000, 40) // → clínica 4000, odontólogo 6000
 * splitCents(33333, 40) // → clínica 13333, odontólogo 20000 (suma 33333 ✓)
 */
export function splitCents(totalCents: number, clinicPercent: number): CommissionSplit {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new RangeError(`totalCents debe ser un entero >= 0, recibido: ${totalCents}`);
  }
  if (!Number.isInteger(clinicPercent) || clinicPercent < 0 || clinicPercent > 100) {
    throw new RangeError(
      `clinicPercent debe ser un entero entre 0 y 100, recibido: ${clinicPercent}`,
    );
  }

  const clinicShareCents = Math.round((totalCents * clinicPercent) / 100);
  // Por resta: la invariante `clinic + dentist === total` es imposible de romper.
  const dentistShareCents = totalCents - clinicShareCents;

  return { totalCents, clinicPercent, clinicShareCents, dentistShareCents };
}

/**
 * Convierte una cantidad en unidades mayores (pesos) a centavos.
 * Pensado para entradas de formulario, donde el usuario escribe "150.50".
 */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Monto no finito: ${amount}`);
  }
  // `Math.round` sobre el producto absorbe el error de coma flotante:
  // 150.55 * 100 = 15054.999... → 15055.
  return Math.round(amount * 100);
}

/** Convierte centavos a unidades mayores. Sólo para mostrar, nunca para calcular. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Formatea centavos como moneda localizada.
 *
 * `Intl.NumberFormat` es parte del runtime, sin dependencias. Ojo: debe
 * producir la misma salida en servidor y cliente o React reporta un error de
 * hidratación — por eso el locale es explícito y no se toma del navegador.
 */
export function formatCents(cents: number): string {
  // Se formatea el NÚMERO y se antepone el símbolo a mano, en vez de usar
  // `style: 'currency'`.
  //
  // Motivo: `Intl` con locale es-VE y moneda USD produce "USD 350,00" —
  // correcto según el estándar, pero nadie en una clínica venezolana escribe
  // eso. Se espera "$350,00": símbolo delante, coma decimal y punto de miles.
  const formatted = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(fromCents(cents)));

  return `${cents < 0 ? '-' : ''}$${formatted}`;
}

// ===========================================================================
//  CONVERSIÓN A BOLÍVARES
// ===========================================================================

/**
 * Convierte centavos de dólar a bolívares.
 *
 * Devuelve un `number` con 2 decimales, no centavos enteros: el bolívar se
 * usa aquí sólo para MOSTRAR y para registrar el importe cobrado. Los
 * cálculos de comisión siempre ocurren en USD, que es la unidad base.
 *
 * @param rate Bolívares por dólar (ej: 761.2167).
 */
export function centsToBs(cents: number, rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`Tasa de cambio inválida: ${rate}`);
  }
  // Se redondea a 2 decimales al final, no en pasos intermedios.
  return Math.round(fromCents(cents) * rate * 100) / 100;
}

/** Formatea un importe en bolívares. */
export function formatBs(amountBs: number): string {
  // Igual que arriba: `style: 'currency'` con VES da "Bs.S 267.522,01".
  // En la práctica se escribe "Bs 267.522,01".
  const formatted = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amountBs));

  return `${amountBs < 0 ? '-' : ''}Bs ${formatted}`;
}

/**
 * Formatea un importe mostrando AMBAS monedas: "$25,50 · Bs 19.411,04".
 *
 * Es el formato por defecto del panel porque responde a las dos preguntas
 * que se hacen a la vez en una clínica venezolana: cuánto vale en dólares
 * (referencia estable) y cuánto hay que cobrar hoy en bolívares.
 */
export function formatDual(cents: number, rate: number | null): string {
  const usd = formatCents(cents);
  if (rate === null) return usd;
  return `${usd} · ${formatBs(centsToBs(cents, rate))}`;
}

/** Suma segura de centavos. Reemplazo directo y con intención de `.reduce((a,b)=>a+b,0)`. */
export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Variación porcentual entre dos periodos, para los indicadores del dashboard.
 * Devuelve `null` cuando la base es 0: mostrar "+∞%" o "+100%" al pasar de 0
 * a algo es información falsa.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
