/**
 * ===========================================================================
 *  Borra TODAS las facturas, para volver a cargarlas desde cero
 * ===========================================================================
 *  Se ejecuta DENTRO del contenedor desplegado:
 *
 *      node scripts/borrar-todas-las-facturas.mjs
 *
 *  Por defecto NO borra nada: sólo cuenta y enseña qué va a desaparecer. Para
 *  borrar de verdad hay que confirmarlo explícitamente:
 *
 *      CONFIRMAR=SI node scripts/borrar-todas-las-facturas.mjs
 *
 *  ---------------------------------------------------------------------
 *  QUÉ BORRA Y QUÉ NO
 *  ---------------------------------------------------------------------
 *  Borra: TODAS las facturas, sus líneas (cascada), TODOS los cobros y
 *  TODAS las liquidaciones a odontólogos —quedarían huérfanas y con un
 *  total que ya no sumaría nada real, así que se limpian también—.
 *
 *  NO toca: pacientes, citas, odontólogos, tratamientos, ni nada del bot de
 *  WhatsApp. Una cita que ya se cobró queda con su estado tal cual (p. ej.
 *  "COMPLETED"); lo único que desaparece es el papel del cobro, no que
 *  ocurrió la consulta. Si además hace falta reabrir esas citas para
 *  recargarlas, eso es otro paso, no lo hace este script.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ NO SE USA `deleteInvoicePermanently` FACTURA POR FACTURA
 *  ---------------------------------------------------------------------
 *  Esa función es la del panel: una factura a la vez, con su propio
 *  registro de auditoría y su propio ajuste de liquidaciones. Para TODAS
 *  las facturas a la vez, ajustar liquidaciones una por una no tiene
 *  sentido —se van a borrar igual—, así que aquí se hace en bloque: es el
 *  mismo resultado, sin recorrer la base fila por fila.
 *
 *  Un único registro de auditoría resume la operación completa.
 * ===========================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIRMADO = process.env.CONFIRMAR === 'SI';

/** Oculta la contraseña de la URL al enseñar contra qué base se corre. */
function urlSinClave(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(no se pudo leer DATABASE_URL)';
  }
}

async function main() {
  const [facturas, cobros, liquidaciones] = await Promise.all([
    prisma.invoice.count(),
    prisma.payment.count(),
    prisma.dentistPayout.count(),
  ]);

  console.log('===========================================================');
  console.log(' BORRAR TODAS LAS FACTURAS');
  console.log('===========================================================');
  console.log('Base de datos:', urlSinClave(process.env.DATABASE_URL ?? ''));
  console.log('');
  console.log('Se van a borrar:');
  console.log(`  ${facturas} factura(s)`);
  console.log(`  ${cobros} cobro(s)`);
  console.log(`  ${liquidaciones} liquidación(es) a odontólogos`);
  console.log('');
  console.log('NO se tocan: pacientes, citas, odontólogos, tratamientos, WhatsApp.');
  console.log('');

  if (facturas === 0 && cobros === 0 && liquidaciones === 0) {
    console.log('No hay nada que borrar.');
    await prisma.$disconnect();
    return;
  }

  if (!CONFIRMADO) {
    console.log('Esto NO ha borrado nada todavía: es sólo el conteo.');
    console.log('');
    console.log('Para borrar de verdad, vuelve a correrlo así:');
    console.log('');
    console.log('  CONFIRMAR=SI node scripts/borrar-todas-las-facturas.mjs');
    console.log('');
    await prisma.$disconnect();
    return;
  }

  console.log('Confirmado. Borrando...');

  await prisma.$transaction(async (tx) => {
    // Un solo registro de auditoría que resume la operación entera, en vez
    // de uno por factura: van a desaparecer todas, así que registrar cada
    // una por separado no deja nada que consultar después.
    await tx.auditLog.create({
      data: {
        userId: null,
        action: 'invoice.bulk_deleted',
        entityType: 'Invoice',
        entityId: 'ALL',
        after: { facturas, cobros, liquidaciones, ejecutadoEn: new Date().toISOString() },
      },
    });

    // Los cobros no cascadean desde la factura (misma protección que evita
    // anular una factura cobrada sin querer): se borran primero a mano.
    await tx.payment.deleteMany({});

    // Las liquidaciones quedarían con un `totalCents` que ya no suma nada
    // real una vez borrados los cobros que las componían.
    await tx.dentistPayout.deleteMany({});

    // Las líneas sí cascadean solas (`onDelete: Cascade` en el esquema).
    await tx.invoice.deleteMany({});
  });

  console.log('');
  console.log(`Listo: ${facturas} factura(s), ${cobros} cobro(s) y ${liquidaciones} liquidación(es) borrados.`);
  console.log('Ya se puede volver a cargar todo desde cero.');

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Falló el borrado:', error);
  await prisma.$disconnect();
  process.exit(1);
});
