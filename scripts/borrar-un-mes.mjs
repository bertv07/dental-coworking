/**
 * ===========================================================================
 *  Vacía UN mes (octubre) del libro de Administración — el «Excel»
 * ===========================================================================
 *  Para que ese mes se vuelva a cargar a mano desde cero en Administración,
 *  sin tocar los meses anteriores ni nada fuera del libro.
 *
 *  Se ejecuta DENTRO del contenedor desplegado:
 *
 *      node scripts/borrar-un-mes.mjs
 *
 *  Es SÓLO octubre de 2026, fijo: no hay forma de pedirle otro mes. Por
 *  defecto NO borra nada: sólo cuenta y enseña qué va a desaparecer. Para
 *  borrar de verdad:
 *
 *      CONFIRMAR=SI node scripts/borrar-un-mes.mjs
 *
 *  NO SE PUEDE DESHACER. Antes de confirmar, saca una copia de la base.
 *
 *  ---------------------------------------------------------------------
 *  QUÉ BORRA (sólo las filas con fecha en ese mes)
 *  ---------------------------------------------------------------------
 *   · Gastos Administrativos.
 *   · Caja Chica.
 *   · El libro de cada odontóloga.
 *   · El cierre mensual de ese mes, si se había hecho: hablaría de unas
 *     filas que ya no existen.
 *
 *  Borra TODAS las filas del mes: las escritas a mano, las subidas por Excel
 *  y las «Auto» que nacieron de un cobro.
 *
 *  ---------------------------------------------------------------------
 *  QUÉ NO TOCA
 *  ---------------------------------------------------------------------
 *  Facturas, cobros, Caja, pagos a odontólogas y deudas: siguen tal cual.
 *  Tampoco los meses anteriores, pacientes, citas ni configuración.
 *
 *  ⚠ Un cobro de octubre que se registre, reverse o corrija DESPUÉS volverá
 *  a escribir su fila «Auto» en el libro. Si ese mismo cobro ya se cargó a
 *  mano, quedaría dos veces: el script lo avisa.
 *
 *  Todo va en UNA transacción: o se borra todo, o no se borra nada.
 * ===========================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIRMADO = process.env.CONFIRMAR === 'SI';
// Fijo a propósito: este script es para octubre y para nada más.
const MES = '2026-10';

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

async function main() {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(MES)) {
    console.error(`MES inválido: «${MES}». Usa el formato 2026-10.`);
    process.exitCode = 1;
    return;
  }

  const [y, m] = MES.split('-').map(Number);
  const siguiente = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  // Las fechas del libro son días sin hora, guardados a mediodía UTC.
  const delMes = { gte: new Date(`${MES}-01T00:00:00Z`), lt: new Date(`${siguiente}-01T00:00:00Z`) };

  const nombreMes = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${MES}-15T12:00:00Z`),
  );

  const [general, cajaChica, odontologas, cierre] = await Promise.all([
    prisma.adminLedgerEntry.findMany({
      where: { book: 'GASTOS_ADMIN', date: delMes },
      select: { incomeCents: true, expenseCents: true, sourcePaymentId: true },
    }),
    prisma.adminLedgerEntry.findMany({
      where: { book: 'CAJA_CHICA', date: delMes },
      select: { incomeCents: true, expenseCents: true },
    }),
    prisma.dentistLedgerEntry.findMany({
      where: { date: delMes },
      select: { budgetCents: true, sourcePaymentId: true, dentist: { select: { fullName: true } } },
    }),
    prisma.periodClosing.count({ where: { period: MES } }),
  ]);

  const suma = (filas, campo) => filas.reduce((s, f) => s + f[campo], 0);
  const auto = general.filter((f) => f.sourcePaymentId).length + odontologas.filter((f) => f.sourcePaymentId).length;

  const porOdontologa = new Map();
  for (const f of odontologas) porOdontologa.set(f.dentist.fullName, (porOdontologa.get(f.dentist.fullName) ?? 0) + 1);

  console.log('===========================================================');
  console.log(` VACIAR ${nombreMes.toUpperCase()} EN EL LIBRO DE ADMINISTRACIÓN`);
  console.log('===========================================================');
  console.log('Base de datos:', urlSinClave(process.env.DATABASE_URL ?? ''));
  console.log('');
  console.log('Se van a borrar:');
  console.log(
    `  Gastos Administrativos: ${general.length} fila(s) — ingresos ${dolares(suma(general, 'incomeCents'))}, ` +
      `egresos ${dolares(suma(general, 'expenseCents'))}`,
  );
  console.log(
    `  Caja Chica:             ${cajaChica.length} fila(s) — entró ${dolares(suma(cajaChica, 'incomeCents'))}, ` +
      `salió ${dolares(suma(cajaChica, 'expenseCents'))}`,
  );
  console.log(`  Libros de odontólogas:  ${odontologas.length} fila(s)`);
  for (const [nombre, n] of porOdontologa) console.log(`    ${nombre}: ${n}`);
  if (cierre > 0) console.log(`  El cierre mensual de ${nombreMes}`);
  console.log('');
  console.log('NO se tocan: facturas, cobros, Caja, pagos a odontólogas ni los meses anteriores.');
  console.log('');

  if (auto > 0) {
    console.log(`Ojo: ${auto} de esas filas son «Auto» (nacieron de un cobro registrado en el sistema).`);
    console.log('  Si después se registra, reversa o corrige alguno de esos cobros, su fila vuelve a');
    console.log('  aparecer sola. Si ya la cargaste a mano, quedaría repetida: bórrala en ese caso.');
    console.log('');
  }

  if (general.length + cajaChica.length + odontologas.length + cierre === 0) {
    console.log(`El libro no tiene nada en ${nombreMes}.`);
    return;
  }

  if (!CONFIRMADO) {
    console.log('Esto NO ha borrado nada todavía: es sólo el conteo.');
    console.log('');
    console.log('NO SE PUEDE DESHACER. Saca antes una copia de la base.');
    console.log('Para borrar de verdad, vuelve a correrlo así:');
    console.log('');
    console.log('  CONFIRMAR=SI node scripts/borrar-un-mes.mjs');
    console.log('');
    return;
  }

  console.log('Confirmado. Borrando...');

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: null,
        action: 'admin_ledger.month_deleted',
        entityType: 'AdminLedgerEntry',
        entityId: MES,
        after: {
          mes: MES,
          gastosAdministrativos: general.length,
          cajaChica: cajaChica.length,
          librosOdontologas: odontologas.length,
          cierre: cierre > 0,
          ejecutadoEn: new Date().toISOString(),
        },
      },
    });
    await tx.adminLedgerEntry.deleteMany({ where: { date: delMes } });
    await tx.dentistLedgerEntry.deleteMany({ where: { date: delMes } });
    await tx.periodClosing.deleteMany({ where: { period: MES } });
  });

  console.log('');
  console.log(`Listo: ${nombreMes} quedó vacío en Administración y se puede volver a cargar a mano.`);
  console.log('El saldo de Caja Chica de los meses siguientes cambia, porque ya no cuenta lo de este mes.');
}

main()
  .catch((error) => {
    console.error('Falló el borrado. No se borró nada:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
