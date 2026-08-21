import 'server-only';
import type { Prisma } from '@prisma/client';
import { repartirCobro } from '@/backend/domain/pricing';

/**
 * ===========================================================================
 *  Recálculo de una factura
 * ===========================================================================
 *  Los totales y el reparto NUNCA se editan a mano: se derivan de las líneas
 *  cada vez que una cambia. Guardarlos calculados y volver a calcularlos aquí
 *  es lo que impide que el papel entregado diga una cosa y la contabilidad
 *  otra.
 * ===========================================================================
 */

/** Lo que suma una línea: cantidad por precio, menos su descuento. */
export function totalLinea(linea: {
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}): number {
  return linea.quantity * linea.unitPriceCents - linea.discountCents;
}

/**
 * Recalcula totales y reparto de una factura, y actualiza su estado.
 *
 * ---------------------------------------------------------------------
 * EL REPARTO SE HACE LÍNEA A LÍNEA
 * ---------------------------------------------------------------------
 * Cada línea puede tener su propia comisión: una limpieza va al 40/60 y una
 * radiografía se la queda entera la clínica. Aplicar un solo porcentaje al
 * total le pagaría al odontólogo parte de un trabajo que no hizo.
 *
 * El descuento se reparte con la línea que lo lleva, no aparte: si se rebaja
 * la limpieza, lo que baja es lo que se reparte 40/60 — no la radiografía.
 *
 * @param tx La transacción en curso. Se exige transacción porque leer las
 *           líneas y escribir el total tienen que ser un solo paso: entre
 *           medias, otra petición podría añadir una línea y el total quedaría
 *           describiendo una factura que ya no existe.
 */
export async function recalcularFactura(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<void> {
  const [lineas, factura] = await Promise.all([
    tx.invoiceLine.findMany({
      where: { invoiceId },
      select: {
        quantity: true,
        unitPriceCents: true,
        discountCents: true,
        commissionPercent: true,
      },
    }),
    tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, payments: { where: { status: 'PAID' }, select: { amountCents: true } } },
    }),
  ]);

  const subtotalCents = lineas.reduce(
    (suma, l) => suma + l.quantity * l.unitPriceCents,
    0,
  );
  const discountCents = lineas.reduce((suma, l) => suma + l.discountCents, 0);
  const totalCents = subtotalCents - discountCents;

  const split = repartirCobro(
    lineas.map((l) => ({ cents: totalLinea(l), clinicPercent: l.commissionPercent })),
  );

  const cobrado = (factura?.payments ?? []).reduce((suma, p) => suma + p.amountCents, 0);

  /*
   * El estado sale del saldo, no de un clic.
   *
   * Una factura anulada se queda anulada: recalcularla no debe resucitarla.
   * Y una que estaba saldada vuelve a OPEN si se le añade una línea, que es
   * justo el caso de «entró a consulta y se hizo algo más».
   */
  const status =
    factura?.status === 'VOID' ? 'VOID' : cobrado >= totalCents && totalCents > 0 ? 'PAID' : 'OPEN';

  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotalCents,
      discountCents,
      totalCents,
      clinicShareCents: split.clinicShareCents,
      dentistShareCents: split.dentistShareCents,
      status,
    },
  });
}

/**
 * Cómo se reparte UN pago concreto entre clínica y odontólogo.
 *
 * Con pagos parciales el reparto no puede calcularse sobre el importe suelto:
 * redondear cada uno por su cuenta haría que la suma de las partes no cuadre
 * con el reparto de la factura.
 *
 * Se reparte por lo PENDIENTE: a cada pago le toca la parte de clínica que
 * queda por asignar, proporcional a lo que cubre. Y el pago que salda la
 * factura absorbe el resto, así que la suma cierra exacta por construcción.
 */
export function repartirPago(params: {
  /** Importe de este pago. */
  amountCents: number;
  /** Total de la factura. */
  totalCents: number;
  /** Parte de la clínica en el total. */
  clinicShareCents: number;
  /** Lo ya cobrado antes de este pago. */
  yaCobradoCents: number;
  /** Parte de clínica ya asignada a pagos anteriores. */
  yaAsignadoClinicaCents: number;
}): { clinicShareCents: number; dentistShareCents: number } {
  const saldaLaFactura = params.yaCobradoCents + params.amountCents >= params.totalCents;

  // El último pago se lleva lo que quede: sin esto, el redondeo dejaría
  // céntimos sin asignar y el reparto de la factura no cuadraría con el de
  // sus pagos.
  const clinicShareCents = saldaLaFactura
    ? params.clinicShareCents - params.yaAsignadoClinicaCents
    : Math.round((params.amountCents * params.clinicShareCents) / params.totalCents);

  return {
    clinicShareCents,
    dentistShareCents: params.amountCents - clinicShareCents,
  };
}
