import type { CommissionSplit } from '@/backend/domain/money';
import { splitCents } from '@/backend/domain/money';

/**
 * ===========================================================================
 *  Reglas de precio y de reparto
 * ===========================================================================
 *  Un único sitio donde se decide CUÁNTO cuesta algo y CÓMO se reparte.
 *
 *  Antes esto estaba disperso: el precio salía del tratamiento, la comisión
 *  del odontólogo, y quien las juntaba era cada pantalla por su cuenta. Con
 *  cuatro reglas nuevas —precio por odontólogo, tratamientos que no se
 *  reparten, precios variables y ajuste manual en caja— eso era garantía de
 *  que dos pantallas acabaran calculando distinto sobre el mismo cobro.
 *
 *  ---------------------------------------------------------------------
 *  LA CADENA DE PRECEDENCIA, DE MÁS FUERTE A MÁS DÉBIL
 *  ---------------------------------------------------------------------
 *  PRECIO
 *   1. Lo que teclea recepción al cobrar   (descuento, abono, conducto)
 *   2. Precio pactado para ese odontólogo  (DentistTreatment APROBADO)
 *   3. Precio de lista del tratamiento
 *
 *  COMISIÓN
 *   1. Ajuste manual de recepción en caja  (el 50/50 puntual)
 *   2. `clinicKeepsAll` del tratamiento    → 100 % clínica, sin excepción
 *   3. Comisión pactada odontólogo+tratamiento (APROBADA)
 *   4. Comisión general del odontólogo
 *   5. Comisión por defecto de la clínica
 *
 *  El orden importa y no es arbitrario: lo más específico gana, salvo
 *  `clinicKeepsAll`, que está por encima de los acuerdos porque describe un
 *  hecho —ese trabajo no lo hizo el odontólogo— y no una negociación.
 * ===========================================================================
 */

/** Lo que hace falta saber del tratamiento para poner precio. */
export interface ReglasTratamiento {
  basePriceCents: number;
  isPriceVariable: boolean;
  clinicKeepsAll: boolean;
}

/** Acuerdo específico entre un odontólogo y un tratamiento, ya aprobado. */
export interface AcuerdoOdontologo {
  customPriceCents: number | null;
  customCommissionPercent: number | null;
}

export interface ResultadoPrecio {
  /** Precio a cobrar, en centavos de USD. */
  priceCents: number;
  /** `true` si es orientativo y hay que confirmarlo en consulta. */
  esOrientativo: boolean;
  /** De dónde salió, para poder explicarlo en la interfaz. */
  origen: 'LISTA' | 'ACUERDO_ODONTOLOGO';
}

/**
 * Precio de un tratamiento para un odontólogo concreto.
 *
 * `acuerdo` debe llegar ya filtrado a los APROBADOS. Esta función no consulta
 * la base: recibe hechos y decide. Así se puede probar sin Postgres y no hay
 * forma de que una propuesta pendiente se cuele por descuido.
 */
export function calcularPrecio(
  tratamiento: ReglasTratamiento,
  acuerdo: AcuerdoOdontologo | null,
): ResultadoPrecio {
  if (acuerdo?.customPriceCents != null) {
    return {
      priceCents: acuerdo.customPriceCents,
      esOrientativo: tratamiento.isPriceVariable,
      origen: 'ACUERDO_ODONTOLOGO',
    };
  }

  return {
    priceCents: tratamiento.basePriceCents,
    esOrientativo: tratamiento.isPriceVariable,
    origen: 'LISTA',
  };
}

/**
 * Lo que se le va a cobrar al paciente por una cita: lo agendado más lo que
 * se le añadió en consulta.
 *
 * Existe como función y no como un `reduce` en cada pantalla porque el mismo
 * total hace falta en cuatro sitios —agenda, cobro, pendientes del turno y
 * cierre de caja— y los cuatro tienen que decir lo mismo. Que una sola se
 * olvidara los añadidos no daría error: enseñaría de menos, y el descuadre
 * no aparecería hasta el arqueo.
 */
export function totalCitaCents(cita: {
  agreedPriceCents: number;
  addons: Array<{ priceCents: number }>;
}): number {
  return cita.addons.reduce((suma, addon) => suma + addon.priceCents, cita.agreedPriceCents);
}

export interface ResultadoComision {
  /** Porcentaje que se queda la clínica (0-100). */
  clinicPercent: number;
  /** Por qué ese porcentaje. Se muestra al cobrar. */
  motivo:
    | 'AJUSTE_MANUAL'
    | 'SIN_REPARTO'
    | 'ACUERDO_ODONTOLOGO'
    | 'COMISION_ODONTOLOGO'
    | 'POR_DEFECTO';
}

/**
 * Porcentaje que retiene la clínica en un cobro concreto.
 *
 * `ajusteManual` es el 50/50 puntual que teclea recepción en caja. Va primero
 * porque es una decisión tomada con el caso delante, y el sistema no puede
 * saber más que la persona que está atendiendo.
 *
 * La excepción es `clinicKeepsAll`: ahí no hay reparto que ajustar. Se deja
 * que el ajuste manual lo pise igualmente —recepción puede tener un motivo—
 * pero el motivo devuelto lo delata, y eso es lo que acaba en la auditoría.
 */
export function calcularComision(params: {
  tratamiento: Pick<ReglasTratamiento, 'clinicKeepsAll'>;
  acuerdo: AcuerdoOdontologo | null;
  comisionOdontologo: number | null;
  comisionPorDefecto: number;
  ajusteManual?: number | null;
}): ResultadoComision {
  if (params.ajusteManual != null) {
    return { clinicPercent: params.ajusteManual, motivo: 'AJUSTE_MANUAL' };
  }

  // Por encima de cualquier acuerdo: no es una negociación, es que ese trabajo
  // no lo hizo el odontólogo.
  if (params.tratamiento.clinicKeepsAll) {
    return { clinicPercent: 100, motivo: 'SIN_REPARTO' };
  }

  if (params.acuerdo?.customCommissionPercent != null) {
    return { clinicPercent: params.acuerdo.customCommissionPercent, motivo: 'ACUERDO_ODONTOLOGO' };
  }

  if (params.comisionOdontologo != null) {
    return { clinicPercent: params.comisionOdontologo, motivo: 'COMISION_ODONTOLOGO' };
  }

  return { clinicPercent: params.comisionPorDefecto, motivo: 'POR_DEFECTO' };
}

/**
 * Reparto total de un cobro, sumando los procedimientos añadidos.
 *
 * ---------------------------------------------------------------------
 *  POR QUÉ SE REPARTE LÍNEA A LÍNEA Y NO SOBRE EL TOTAL
 * ---------------------------------------------------------------------
 *  Porque cada línea puede tener su propia comisión. Si a una limpieza
 *  (40/60) se le añade una radiografía (100 % clínica), repartir el total con
 *  un solo porcentaje le pagaría al odontólogo parte de la radiografía o le
 *  quitaría parte de la limpieza. Ninguna de las dos cosas es correcta.
 *
 *  Cada línea se reparte con `splitCents`, que deriva la parte del odontólogo
 *  por resta y hace imposible que la suma no cuadre. Luego se suman las
 *  partes, no los porcentajes: sumar porcentajes de bases distintas no
 *  significa nada.
 */
export function repartirCobro(
  lineas: Array<{ cents: number; clinicPercent: number }>,
): CommissionSplit {
  let clinicShareCents = 0;
  let dentistShareCents = 0;
  let totalCents = 0;

  for (const linea of lineas) {
    const parte = splitCents(linea.cents, linea.clinicPercent);
    clinicShareCents += parte.clinicShareCents;
    dentistShareCents += parte.dentistShareCents;
    totalCents += parte.totalCents;
  }

  /*
   * `clinicPercent` del conjunto es el porcentaje EFECTIVO: lo que la clínica
   * se quedó sobre el total, no la media de los porcentajes aplicados.
   *
   * Con una limpieza de $30 al 40 % y una radiografía de $10 al 100 %, la
   * media de porcentajes daría 70 %; el efectivo es 55 %, que es el que
   * describe lo que de verdad pasó con el dinero. Se redondea porque el campo
   * es un entero: el importe exacto son las partes, no este número.
   */
  return {
    totalCents,
    clinicPercent: totalCents === 0 ? 0 : Math.round((clinicShareCents / totalCents) * 100),
    clinicShareCents,
    dentistShareCents,
  };
}
