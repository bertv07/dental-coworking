/**
 * ===========================================================================
 *  Borra SÓLO las facturas de octubre de 2026
 * ===========================================================================
 *  Para que administración las vuelva a cargar con calma desde su Excel.
 *  Septiembre y todo lo demás se quedan como están.
 *
 *  Se ejecuta DENTRO del contenedor desplegado:
 *
 *      node scripts/borrar-facturas-de-octubre.mjs
 *
 *  Por defecto NO borra nada: sólo enseña la lista de facturas que se irían.
 *  Para borrar de verdad:
 *
 *      CONFIRMAR=SI node scripts/borrar-facturas-de-octubre.mjs
 *
 *  NO SE PUEDE DESHACER. Antes de confirmar, saca una copia de la base.
 *
 *  ---------------------------------------------------------------------
 *  QUÉ BORRA
 *  ---------------------------------------------------------------------
 *  Las facturas con FECHA en octubre de 2026 (la fecha que sale en la lista
 *  de Facturas, en hora de Caracas), de cualquier estado, y con cada una:
 *   · sus líneas y sus cobros,
 *   · las filas «Auto» que esos cobros escribieron en el libro de
 *     Administración (el ingreso «Coworking», el «Pago Dra» y la fila en el
 *     libro de la odontóloga).
 *
 *  ---------------------------------------------------------------------
 *  QUÉ NO TOCA
 *  ---------------------------------------------------------------------
 *   · Ninguna factura de septiembre ni de otro mes. El mes va fijo en el
 *     código: no hay forma de pedirle otro.
 *   · Las filas del libro escritas a mano o subidas por Excel (los gastos y
 *     egresos que se cargaron en Administración).
 *   · Cobros de la agenda que no tienen factura, pacientes, citas, Caja de
 *     otros meses, odontólogas y configuración.
 *   · Las facturas cuya parte YA se le pagó a la odontóloga: borrarlas
 *     dejaría ese pago entregado sin los cobros que lo explican. Se listan
 *     aparte, y sólo se borran si además se pide con FORZAR=SI.
 *
 *  Todo va en UNA transacción: o se borra todo, o no se borra nada.
 * ===========================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIRMADO = process.env.CONFIRMAR === 'SI';
const FORZAR = process.env.FORZAR === 'SI';

// Fijo a propósito: este script es para octubre de 2026 y para nada más.
// Venezuela es UTC-4 todo el año: es el mismo día que enseña el panel.
const DESDE = new Date('2026-10-01T00:00:00-04:00');
const HASTA = new Date('2026-11-01T00:00:00-04:00');

function urlSinClave(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(no se pudo leer DATABASE_URL)';
  }
}

const dolares = (cents) => `$${(cents / 100).toFixed(2)}`;
const dia = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', timeZone: 'America/Caracas' });
const ESTADO = { OPEN: 'pendiente', PAID: 'saldada', VOID: 'anulada' };

async function main() {
  const facturas = await prisma.invoice.findMany({
    where: { issuedAt: { gte: DESDE, lt: HASTA } },
    orderBy: { number: 'asc' },
    select: {
      id: true,
      number: true,
      issuedAt: true,
      status: true,
      totalCents: true,
      appointmentId: true,
      patient: { select: { fullName: true } },
      dentist: { select: { fullName: true } },
      payments: { select: { id: true, amountCents: true, method: true, payoutId: true } },
    },
  });

  const liquidadas = facturas.filter((f) => f.payments.some((p) => p.payoutId !== null));
  const aBorrar = FORZAR ? facturas : facturas.filter((f) => !liquidadas.includes(f));
  const cobros = aBorrar.flatMap((f) => f.payments);
  const idsCobros = cobros.map((c) => c.id);

  const [autoGeneral, autoOdontologas] = await Promise.all([
    prisma.adminLedgerEntry.count({ where: { sourcePaymentId: { in: idsCobros } } }),
    prisma.dentistLedgerEntry.count({ where: { sourcePaymentId: { in: idsCobros } } }),
  ]);

  const conSaldo = aBorrar.filter((f) => f.payments.some((p) => p.method === 'CREDIT'));
  const deCitas = aBorrar.filter((f) => f.appointmentId !== null);

  console.log('===========================================================');
  console.log(' BORRAR SÓLO LAS FACTURAS DE OCTUBRE DE 2026');
  console.log('===========================================================');
  console.log('Base de datos:', urlSinClave(process.env.DATABASE_URL ?? ''));
  console.log('');

  if (facturas.length === 0) {
    console.log('No hay ninguna factura con fecha en octubre de 2026.');
    return;
  }

  console.log(`Facturas de octubre: ${facturas.length}`);
  console.log('');
  for (const f of facturas) {
    const marca = liquidadas.includes(f) ? (FORZAR ? '  [ya pagada a la odontóloga — se borra por FORZAR]' : '  [NO se borra: ya pagada a la odontóloga]') : '';
    console.log(
      `  Nº ${f.number}  ${dia.format(f.issuedAt)}  ${f.patient.fullName}  ` +
        `${f.dentist?.fullName ?? 'sin odontóloga'}  ${dolares(f.totalCents)}  ${ESTADO[f.status]}${marca}`,
    );
  }
  console.log('');
  console.log('Se van a borrar:');
  console.log(`  ${aBorrar.length} factura(s), con sus líneas`);
  console.log(`  ${cobros.length} cobro(s) — ${dolares(cobros.reduce((s, c) => s + c.amountCents, 0))}`);
  console.log(`  ${autoGeneral} fila(s) «Auto» de Gastos Administrativos y ${autoOdontologas} de los libros de las odontólogas`);
  console.log('');
  console.log('NO se tocan: septiembre ni ningún otro mes, ni las filas del libro escritas a mano');
  console.log('o subidas por Excel (los gastos y egresos que cargaste en Administración).');
  console.log('');

  if (liquidadas.length > 0 && !FORZAR) {
    console.log(`${liquidadas.length} factura(s) NO se borran porque su parte ya se le pagó a la odontóloga.`);
    console.log('Si de verdad hay que borrarlas también, añade FORZAR=SI: ese pago a la odontóloga');
    console.log('se recalcula sin esos cobros (o desaparece si no le queda ninguno).');
    console.log('');
  }
  if (deCitas.length > 0) {
    console.log(`${deCitas.length} de estas facturas venían de una cita. La cita se queda, y al no tener cobro`);
    console.log('vuelve a salir como «pendiente de cobro» en la Caja de su día. Al volver a cargarla,');
    console.log('cóbrala desde la Agenda o desde ahí para que no quede pendiente.');
    console.log('');
  }
  if (conSaldo.length > 0) {
    console.log('Estas se pagaron con saldo a favor: revisa a mano el saldo de esos pacientes.');
    for (const f of conSaldo) console.log(`  Nº ${f.number}  ${f.patient.fullName}`);
    console.log('');
  }

  if (aBorrar.length === 0) {
    console.log('No queda nada que borrar.');
    return;
  }

  if (!CONFIRMADO) {
    console.log('Esto NO ha borrado nada todavía: es sólo la lista.');
    console.log('');
    console.log('NO SE PUEDE DESHACER. Saca antes una copia de la base.');
    console.log('Para borrar de verdad:');
    console.log('');
    console.log(`  CONFIRMAR=SI${FORZAR ? ' FORZAR=SI' : ''} node scripts/borrar-facturas-de-octubre.mjs`);
    console.log('');
    return;
  }

  console.log('Confirmado. Borrando...');

  const idsFacturas = aBorrar.map((f) => f.id);
  const pagosAOdontologas = [...new Set(cobros.map((c) => c.payoutId).filter(Boolean))];

  await prisma.$transaction(
    async (tx) => {
      await tx.auditLog.create({
        data: {
          userId: null,
          action: 'invoice.october_deleted',
          entityType: 'Invoice',
          entityId: '2026-10',
          after: {
            facturas: aBorrar.map((f) => f.number),
            cobros: cobros.length,
            forzado: FORZAR,
            ejecutadoEn: new Date().toISOString(),
          },
        },
      });

      // Sólo las filas «Auto» de ESTOS cobros: lo escrito a mano no se toca.
      await tx.adminLedgerEntry.deleteMany({ where: { sourcePaymentId: { in: idsCobros } } });
      await tx.dentistLedgerEntry.deleteMany({ where: { sourcePaymentId: { in: idsCobros } } });

      await tx.payment.deleteMany({ where: { id: { in: idsCobros } } });

      // Sólo con FORZAR hay pagos a odontólogas afectados: se recalculan con
      // lo que les queda, o desaparecen si se quedaron sin cobros.
      for (const payoutId of pagosAOdontologas) {
        const restantes = await tx.payment.findMany({ where: { payoutId }, select: { dentistShareCents: true } });
        if (restantes.length === 0) {
          await tx.dentistPayout.delete({ where: { id: payoutId } });
        } else {
          await tx.dentistPayout.update({
            where: { id: payoutId },
            data: { totalCents: restantes.reduce((s, p) => s + p.dentistShareCents, 0) },
          });
        }
      }

      // Las líneas se van solas, en cascada.
      await tx.invoice.deleteMany({ where: { id: { in: idsFacturas } } });
    },
    { timeout: 120_000 },
  );

  console.log('');
  console.log(`Listo: ${aBorrar.length} factura(s) de octubre borradas. Septiembre sigue intacto.`);
}

main()
  .catch((error) => {
    console.error('Falló el borrado. No se borró nada:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
