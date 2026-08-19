/**
 * ===========================================================================
 *  Configuración inicial de la clínica
 * ===========================================================================
 *      node scripts/configurar-clinica.mjs
 *
 *  Deja el panel operativo tras un despliegue nuevo: jornada, moneda y
 *  medios de pago. Complementa a `crear-usuarios.mjs`, que sólo crea cuentas.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ HACE FALTA
 *  ---------------------------------------------------------------------
 *  Sin medios de pago configurados pasan dos cosas, ninguna evidente:
 *
 *   · El bot no sabe qué contestar a «¿cómo pago?» y tiene que escalar a un
 *     humano cada vez.
 *   · El modal de cobro cae a una lista genérica de respaldo, así que
 *     recepción registra «Transferencia» un pago hecho por Zelle y el arqueo
 *     deja de reflejar la realidad.
 *
 *  ---------------------------------------------------------------------
 *  ES IDEMPOTENTE Y NO PISA LO QUE YA HAYA
 *  ---------------------------------------------------------------------
 *  Los medios de pago se crean SÓLO si la lista está vacía. Si el
 *  administrador ya metió los datos bancarios reales desde `/configuracion`,
 *  volver a ejecutar esto no se los sobreescribe con los de ejemplo.
 * ===========================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Jornada de la clínica, en minutos desde medianoche. */
const APERTURA = Number(process.env.CLINIC_OPENS ?? 9) * 60;   // 09:00
const CIERRE = Number(process.env.CLINIC_CLOSES ?? 18) * 60;   // 18:00

/**
 * Medios de pago habituales en Venezuela.
 *
 * `kind` es la categoría CONTABLE (la que agrupa el cierre de caja) y sólo
 * tiene cuatro valores. La etiqueta es lo que ve el paciente: Zelle y Binance
 * son dos entradas distintas aunque ambas cuenten como transferencia.
 *
 * ⚠️  Los datos de `instructions` son PLACEHOLDERS. Sustitúyelos por los
 *  reales en `/configuracion` → Medios de pago antes de conectar el bot: son
 *  literalmente lo que el bot le dicta al paciente para que pague.
 */
const MEDIOS_DE_PAGO = [
  {
    label: 'Pago móvil',
    kind: 'TRANSFER',
    currency: 'VES',
    instructions: 'Banco: —\nTeléfono: —\nRIF/Cédula: —\n\n⚠️ CAMBIAR estos datos en Configuración.',
    sortOrder: 1,
  },
  {
    label: 'Zelle',
    kind: 'TRANSFER',
    currency: 'USD',
    instructions: 'Correo: —\nA nombre de: —\n\n⚠️ CAMBIAR estos datos en Configuración.',
    sortOrder: 2,
  },
  {
    label: 'Binance',
    kind: 'TRANSFER',
    // USDT: se cotiza en dólares, no en bolívares.
    currency: 'USD',
    instructions: 'Binance Pay ID: —\nCorreo: —\nRed: USDT\n\n⚠️ CAMBIAR estos datos en Configuración.',
    sortOrder: 3,
  },
  {
    label: 'Efectivo',
    kind: 'CASH',
    currency: 'VES',
    // El efectivo no lleva datos que dictar: se paga en el mostrador. Es el
    // único que además se cuenta a mano en el cierre de caja.
    instructions: 'Se paga en recepción, en bolívares o en divisas.',
    sortOrder: 4,
  },
];

async function main() {
  console.log('Configurando la clínica…\n');

  // --- Jornada -----------------------------------------------------------
  const ajustes = await prisma.clinicSettings.upsert({
    where: { id: 'singleton' },
    update: { openingMinute: APERTURA, closingMinute: CIERRE },
    create: { id: 'singleton', openingMinute: APERTURA, closingMinute: CIERRE },
    select: { clinicName: true, openingMinute: true, closingMinute: true, defaultCommissionPercent: true },
  });

  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  console.log(`  ✓ jornada  ${hhmm(ajustes.openingMinute)} – ${hhmm(ajustes.closingMinute)}`);
  console.log(`  ✓ comisión por defecto  ${ajustes.defaultCommissionPercent}% para la clínica`);

  // --- Medios de pago ----------------------------------------------------
  const existentes = await prisma.paymentMethodOption.count({ where: { deletedAt: null } });

  if (existentes > 0) {
    console.log(`  · medios de pago: ya hay ${existentes}, no se tocan`);
  } else {
    await prisma.paymentMethodOption.createMany({ data: MEDIOS_DE_PAGO });
    console.log(`  ✓ ${MEDIOS_DE_PAGO.length} medios de pago creados`);
    for (const m of MEDIOS_DE_PAGO) {
      console.log(`      · ${m.label.padEnd(12)} ${m.currency}`);
    }
  }

  // --- Horarios del personal --------------------------------------------
  // Se ajustan los bloques que quedaran fuera de la nueva jornada: un horario
  // que empieza antes de que abra la clínica ofrece huecos que nadie puede
  // atender, y el paciente se presenta a una puerta cerrada.
  const corregidos = await prisma.dentistSchedule.updateMany({
    where: { startMinute: { lt: APERTURA } },
    data: { startMinute: APERTURA },
  });
  if (corregidos.count > 0) {
    console.log(`  ✓ ${corregidos.count} bloques de horario movidos a las ${hhmm(APERTURA)}`);
  }

  console.log('\n⚠️  Los datos bancarios son marcadores de posición.');
  console.log('   Ponlos de verdad en Configuración → Medios de pago antes de');
  console.log('   conectar el bot: son lo que le dicta a los pacientes para pagar.');
}

main()
  .catch((error) => {
    console.error('\n❌ Falló la configuración:\n');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
