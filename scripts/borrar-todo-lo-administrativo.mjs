/**
 * ===========================================================================
 *  Borra TODO lo de dinero y administración, y deja los pacientes
 * ===========================================================================
 *  Para empezar la contabilidad desde cero sin perder a nadie.
 *
 *  Se ejecuta DENTRO del contenedor desplegado:
 *
 *      node scripts/borrar-todo-lo-administrativo.mjs
 *
 *  Por defecto NO borra nada: sólo cuenta y enseña qué va a desaparecer. Para
 *  borrar de verdad hay que confirmarlo explícitamente:
 *
 *      CONFIRMAR=SI node scripts/borrar-todo-lo-administrativo.mjs
 *
 *  NO SE PUEDE DESHACER. Antes de confirmar, saca una copia de la base.
 *
 *  ---------------------------------------------------------------------
 *  QUÉ BORRA
 *  ---------------------------------------------------------------------
 *   · Facturas y sus líneas.
 *   · Cobros (todo lo de Caja).
 *   · Pagos entregados a odontólogas (liquidaciones) y, con ellos, las
 *     deudas pendientes: sin cobros no queda nada que deber.
 *   · Arqueos de caja de cada día.
 *   · El libro de Administración entero: Gastos Administrativos, Caja Chica
 *     y el libro de cada odontóloga.
 *   · Los gastos de la antigua pantalla Gastos.
 *   · Los cierres mensuales y anuales.
 *   · El saldo a favor de cada paciente, que vuelve a cero: es dinero, y sin
 *     las facturas que lo originaron ya no tendría de dónde salir.
 *
 *  ---------------------------------------------------------------------
 *  QUÉ NO TOCA
 *  ---------------------------------------------------------------------
 *  Pacientes (fichas, documentos, expedientes), citas, odontólogas y sus
 *  horarios, tratamientos y precios, tarifas, promociones, medicamentos,
 *  recetarios, usuarios, la configuración, las tasas de cambio y todo lo
 *  del bot de WhatsApp.
 *
 *  Las citas se quedan como están: una que ya se cobró sigue «completada»,
 *  sólo desaparece el papel del cobro. Si se vuelve a cobrar desde la
 *  agenda, entra como un cobro nuevo.
 *
 *  Todo va en UNA transacción: o se borra todo, o no se borra nada. Un único
 *  registro de auditoría deja constancia de qué se borró y cuándo.
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

/**
 * Lo que se borra, EN ORDEN: los cobros antes que las facturas y las
 * liquidaciones, porque cuelgan de ellas y no cascadean.
 */
const TABLAS = [
  { clave: 'cobros', nombre: 'cobro(s)', modelo: 'payment' },
  { clave: 'liquidaciones', nombre: 'pago(s) entregado(s) a odontólogas', modelo: 'dentistPayout' },
  { clave: 'facturas', nombre: 'factura(s), con sus líneas', modelo: 'invoice' },
  { clave: 'arqueos', nombre: 'arqueo(s) de caja', modelo: 'cashClosing' },
  { clave: 'libroGeneral', nombre: 'fila(s) de Gastos Administrativos y Caja Chica', modelo: 'adminLedgerEntry' },
  { clave: 'libroOdontologas', nombre: 'fila(s) de los libros de las odontólogas', modelo: 'dentistLedgerEntry' },
  { clave: 'gastos', nombre: 'gasto(s) de la antigua pantalla Gastos', modelo: 'expense' },
  { clave: 'cierres', nombre: 'cierre(s) mensuales y anuales', modelo: 'periodClosing' },
];

async function main() {
  const conteo = {};
  for (const t of TABLAS) {
    conteo[t.clave] = await prisma[t.modelo].count();
  }
  const conSaldo = await prisma.patient.count({ where: { creditBalanceCents: { not: 0 } } });
  const pacientes = await prisma.patient.count();

  console.log('===========================================================');
  console.log(' BORRAR TODO LO DE DINERO Y ADMINISTRACIÓN');
  console.log('===========================================================');
  console.log('Base de datos:', urlSinClave(process.env.DATABASE_URL ?? ''));
  console.log('');
  console.log('Se van a borrar:');
  for (const t of TABLAS) console.log(`  ${conteo[t.clave]} ${t.nombre}`);
  console.log(`  el saldo a favor de ${conSaldo} paciente(s), que vuelve a cero`);
  console.log('');
  console.log(`NO se tocan: los ${pacientes} paciente(s), ni citas, odontólogas, tratamientos,`);
  console.log('precios, usuarios, configuración ni WhatsApp.');
  console.log('');

  const total = Object.values(conteo).reduce((s, n) => s + n, 0) + conSaldo;
  if (total === 0) {
    console.log('No hay nada que borrar.');
    return;
  }

  if (!CONFIRMADO) {
    console.log('Esto NO ha borrado nada todavía: es sólo el conteo.');
    console.log('');
    console.log('NO SE PUEDE DESHACER. Saca antes una copia de la base.');
    console.log('Para borrar de verdad, vuelve a correrlo así:');
    console.log('');
    console.log('  CONFIRMAR=SI node scripts/borrar-todo-lo-administrativo.mjs');
    console.log('');
    return;
  }

  console.log('Confirmado. Borrando...');

  await prisma.$transaction(
    async (tx) => {
      await tx.auditLog.create({
        data: {
          userId: null,
          action: 'administration.bulk_deleted',
          entityType: 'Administration',
          entityId: 'ALL',
          after: { ...conteo, pacientesConSaldo: conSaldo, ejecutadoEn: new Date().toISOString() },
        },
      });

      for (const t of TABLAS) {
        await tx[t.modelo].deleteMany({});
      }

      await tx.patient.updateMany({
        where: { creditBalanceCents: { not: 0 } },
        data: { creditBalanceCents: 0 },
      });
    },
    // Una base con años de cobros tarda más que los 5 s por defecto.
    { timeout: 120_000 },
  );

  const quedan = await prisma.patient.count();
  console.log('');
  console.log('Listo. Borrado:');
  for (const t of TABLAS) console.log(`  ${conteo[t.clave]} ${t.nombre}`);
  console.log(`  saldo a favor de ${conSaldo} paciente(s) puesto en cero`);
  console.log('');
  console.log(`Pacientes antes: ${pacientes}. Pacientes ahora: ${quedan}.`);
}

main()
  .catch((error) => {
    console.error('Falló el borrado. No se borró nada:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
