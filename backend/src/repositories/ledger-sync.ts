import type { Prisma } from '@prisma/client';
import { clinicDayKey } from '@/backend/domain/clinic-calendar';

/**
 * ===========================================================================
 *  El libro de Administración se sincroniza SOLO con los cobros reales
 * ===========================================================================
 *  Antes había que escribir cada consulta dos veces: una vez al cobrarla
 *  (Facturas/Caja) y otra a mano en la hoja de Excel. Esto cierra ese
 *  círculo: cada `Payment` que se registra escribe SOLO las filas del libro
 *  que le corresponden, con los mismos números que de verdad entraron en
 *  caja — nunca al revés, editar una fila del libro no cambia ningún cobro.
 *
 *  DOS FILAS POR PAGO, como en la hoja original:
 *   · Un ingreso "Coworking" en Gastos Administrados — lo que entró.
 *   · Un egreso "Pago Dra." en Gastos Administrados — lo que le toca a ella.
 *   · Y UNA fila en el libro de la odontóloga, con el reparto exacto que se
 *     aplicó en ESE cobro (varía: 40/60 unas veces, 50/50 otras).
 *
 *  Se identifican por `sourcePaymentId`, así que:
 *   · Sincronizar el mismo pago dos veces actualiza las mismas filas, no las
 *     duplica (`upsert`).
 *   · Reversar o borrar el pago borra las filas que nacieron de él — nunca
 *     las manuales, que no tienen `sourcePaymentId`.
 *
 *  Si no hay odontólogo (venta directa, sin cita) no se escribe nada: el
 *  libro es de consultas, y una venta de mostrador no tiene "Pago Dra." que
 *  registrar.
 * ===========================================================================
 */

export async function sincronizarLibroDePago(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<void> {
  const pago = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      paidAt: true,
      amountCents: true,
      commissionPercentApplied: true,
      dentistShareCents: true,
      clinicShareCents: true,
      appointment: {
        select: {
          patient: { select: { fullName: true } },
          dentist: { select: { id: true, fullName: true } },
        },
      },
      invoice: {
        select: {
          patient: { select: { fullName: true } },
          dentist: { select: { id: true, fullName: true } },
        },
      },
    },
  });
  if (!pago || !pago.paidAt) return;

  const dentist = pago.appointment?.dentist ?? pago.invoice?.dentist ?? null;
  const patientName = pago.appointment?.patient.fullName ?? pago.invoice?.patient.fullName ?? null;
  if (!dentist || !patientName) return;

  const fecha = new Date(`${clinicDayKey(pago.paidAt)}T12:00:00Z`);

  await tx.dentistLedgerEntry.upsert({
    where: { sourcePaymentId: pago.id },
    create: {
      dentistId: dentist.id,
      date: fecha,
      patientName,
      budgetCents: pago.amountCents,
      depositCents: 0,
      dentistPercent: 100 - pago.commissionPercentApplied,
      dentistShareCents: pago.dentistShareCents,
      clinicShareCents: pago.clinicShareCents,
      sourcePaymentId: pago.id,
    },
    update: {
      date: fecha,
      patientName,
      budgetCents: pago.amountCents,
      dentistPercent: 100 - pago.commissionPercentApplied,
      dentistShareCents: pago.dentistShareCents,
      clinicShareCents: pago.clinicShareCents,
    },
  });

  /*
   * En Gastos Administrados NO se puede usar `upsert` por `sourcePaymentId`:
   * no es único ahí (dos filas por pago), así que primero se borran las
   * filas anteriores de este pago y se vuelven a escribir. Es re-sincronizar,
   * no acumular: si el pago cambió de importe, el libro tiene que decir el
   * importe nuevo, no los dos.
   */
  await tx.adminLedgerEntry.deleteMany({ where: { sourcePaymentId: pago.id } });
  await tx.adminLedgerEntry.createMany({
    data: [
      {
        book: 'GASTOS_ADMIN',
        date: fecha,
        description: `Consulta Odontología ${dentist.fullName} / PX. ${patientName} / Coworking`,
        incomeCents: pago.amountCents,
        expenseCents: 0,
        sourcePaymentId: pago.id,
      },
      {
        book: 'GASTOS_ADMIN',
        date: fecha,
        description: `Consulta Odontología ${dentist.fullName} / PX. ${patientName} / Pago Dra`,
        incomeCents: 0,
        expenseCents: pago.dentistShareCents,
        sourcePaymentId: pago.id,
      },
    ],
  });
}

/** Deshace lo que `sincronizarLibroDePago` escribió, para uno o varios cobros. */
export async function borrarLibroDePagos(
  tx: Prisma.TransactionClient,
  paymentIds: string[],
): Promise<void> {
  if (paymentIds.length === 0) return;
  await tx.dentistLedgerEntry.deleteMany({ where: { sourcePaymentId: { in: paymentIds } } });
  await tx.adminLedgerEntry.deleteMany({ where: { sourcePaymentId: { in: paymentIds } } });
}
