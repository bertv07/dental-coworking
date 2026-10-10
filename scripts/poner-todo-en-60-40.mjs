/**
 * ===========================================================================
 *  Pone TODO lo ya registrado en 60 % clínica / 40 % odontóloga
 * ===========================================================================
 *  Lo acordado con administración: en vez de borrar todo y volver a cargar
 *  cada factura, se deja TODO en el reparto estándar de una vez y después se
 *  corrigen a mano, una por una, las pocas que eran otro reparto (50/50…).
 *
 *  Se ejecuta DENTRO del contenedor desplegado:
 *
 *      node scripts/poner-todo-en-60-40.mjs
 *
 *  Por defecto NO cambia nada: sólo cuenta y enseña qué cambiaría. Para
 *  aplicarlo de verdad:
 *
 *      CONFIRMAR=SI node scripts/poner-todo-en-60-40.mjs
 *
 *  Antes de confirmar, saca una copia de la base.
 *
 *  ---------------------------------------------------------------------
 *  QUÉ CAMBIA
 *  ---------------------------------------------------------------------
 *   · FACTURAS con odontóloga (no anuladas): cada línea pasa a 60 % clínica.
 *     Con la factura se vuelven a repartir sus cobros y se corrigen las
 *     filas «Auto» del libro de Administración (el «Pago Dra» y la fila en
 *     el libro de la odontóloga). Una factura que estaba en 50/50 queda en
 *     60/40: ésas son las que hay que volver a editar a mano después.
 *   · COBROS DE AGENDA sin factura: sólo los que estaban EXACTAMENTE al
 *     revés (40 % clínica) pasan a 60 %. Los demás no se tocan, porque un
 *     cobro sin factura no tiene pantalla donde corregirlo después.
 *
 *  ---------------------------------------------------------------------
 *  QUÉ SE RESPETA Y NO CAMBIA
 *  ---------------------------------------------------------------------
 *   · Lo que es 100 % de la clínica (radiografías y similares).
 *   · El porcentaje propio de un tratamiento (el que se pone en Precios) y
 *     los acuerdos aprobados de una odontóloga para un tratamiento.
 *   · Las facturas cuya parte YA se le pagó a la odontóloga: cambiarlas
 *     dejaría el pago entregado diciendo una cifra y sus cobros otra. Se
 *     listan para revisarlas a mano.
 *   · Las facturas sin odontóloga y las anuladas.
 *   · Las filas del libro escritas a mano o subidas por Excel: son lo que
 *     la clínica anotó, no lo que calculó el sistema.
 *   · El dinero cobrado: ningún importe ni total de factura cambia, sólo de
 *     quién es cada parte.
 *
 *  Todo en UNA transacción, con un único registro de auditoría.
 * ===========================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIRMADO = process.env.CONFIRMAR === 'SI';
const CLINICA = 60;

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

/** Igual que `splitCents` del panel: la clínica redondea, la odontóloga por resta. */
function parteClinica(cents, porcentaje) {
  return Math.round((cents * porcentaje) / 100);
}

async function main() {
  // Acuerdos aprobados odontóloga + tratamiento: mandan sobre el estándar.
  const acuerdos = new Map(
    (
      await prisma.dentistTreatment.findMany({
        where: { status: 'APPROVED', customCommissionPercent: { not: null } },
        select: { dentistId: true, treatmentId: true, customCommissionPercent: true },
      })
    ).map((a) => [`${a.dentistId}:${a.treatmentId}`, a.customCommissionPercent]),
  );

  const facturas = await prisma.invoice.findMany({
    where: { status: { not: 'VOID' } },
    orderBy: { number: 'asc' },
    select: {
      id: true,
      number: true,
      dentistId: true,
      totalCents: true,
      clinicShareCents: true,
      dentistShareCents: true,
      patient: { select: { fullName: true } },
      appointment: { select: { dentistId: true } },
      lines: {
        select: {
          id: true,
          quantity: true,
          unitPriceCents: true,
          discountCents: true,
          commissionPercent: true,
          treatmentId: true,
          treatment: { select: { clinicKeepsAll: true, clinicCommissionPercent: true } },
        },
      },
      payments: {
        where: { status: 'PAID' },
        orderBy: { paidAt: 'asc' },
        select: {
          id: true,
          amountCents: true,
          clinicShareCents: true,
          dentistShareCents: true,
          commissionPercentApplied: true,
          payoutId: true,
        },
      },
    },
  });

  const cambios = []; // lo que se va a escribir, factura por factura
  const liquidadas = []; // no se tocan
  let sinOdontologa = 0;
  let yaEstaban = 0;

  for (const f of facturas) {
    const dentistId = f.dentistId ?? f.appointment?.dentistId ?? null;
    if (!dentistId) {
      sinOdontologa += 1;
      continue;
    }

    // El porcentaje que le toca a cada línea, con las mismas reglas del panel.
    const lineas = f.lines.map((l) => {
      const acuerdo = l.treatmentId ? acuerdos.get(`${dentistId}:${l.treatmentId}`) : undefined;
      const porcentaje = l.treatment?.clinicKeepsAll
        ? 100
        : (acuerdo ?? l.treatment?.clinicCommissionPercent ?? CLINICA);
      return { id: l.id, antes: l.commissionPercent, porcentaje, cents: l.quantity * l.unitPriceCents - l.discountCents };
    });

    const clinica = lineas.reduce((s, l) => s + parteClinica(l.cents, l.porcentaje), 0);
    const total = lineas.reduce((s, l) => s + l.cents, 0);
    const odontologa = total - clinica;
    const aplicado = total === 0 ? 0 : Math.round((clinica / total) * 100);

    // Los cobros, repartidos de nuevo en orden: el que salda absorbe el resto.
    let cobrado = 0;
    let asignado = 0;
    const pagos = f.payments.map((p) => {
      const salda = cobrado + p.amountCents >= total;
      const suClinica = salda ? clinica - asignado : Math.round((p.amountCents * clinica) / (total || 1));
      cobrado += p.amountCents;
      asignado += suClinica;
      return { id: p.id, antes: p.dentistShareCents, clinica: suClinica, odontologa: p.amountCents - suClinica };
    });

    const cambiaAlgo =
      lineas.some((l) => l.antes !== l.porcentaje) ||
      f.clinicShareCents !== clinica ||
      pagos.some((p) => p.antes !== p.odontologa);

    if (!cambiaAlgo) {
      yaEstaban += 1;
      continue;
    }
    if (f.payments.some((p) => p.payoutId !== null)) {
      liquidadas.push(f);
      continue;
    }

    cambios.push({
      factura: f,
      lineas: lineas.filter((l) => l.antes !== l.porcentaje),
      clinica,
      odontologa,
      aplicado,
      pagos,
    });
  }

  // Cobros de agenda sin factura que quedaron exactamente al revés.
  const cobrosSueltos = await prisma.payment.findMany({
    where: {
      status: 'PAID',
      invoiceId: null,
      payoutId: null,
      appointmentId: { not: null },
      commissionPercentApplied: 100 - CLINICA,
    },
    select: { id: true, amountCents: true, dentistShareCents: true },
  });
  const sueltos = cobrosSueltos.map((p) => {
    const clinica = parteClinica(p.amountCents, CLINICA);
    return { id: p.id, antes: p.dentistShareCents, clinica, odontologa: p.amountCents - clinica };
  });

  const todosLosPagos = [...cambios.flatMap((c) => c.pagos), ...sueltos];
  const antes = todosLosPagos.reduce((s, p) => s + p.antes, 0);
  const despues = todosLosPagos.reduce((s, p) => s + p.odontologa, 0);

  console.log('===========================================================');
  console.log(' PONER TODO EN 60 % CLÍNICA / 40 % ODONTÓLOGA');
  console.log('===========================================================');
  console.log('Base de datos:', urlSinClave(process.env.DATABASE_URL ?? ''));
  console.log('');
  console.log(`Facturas que cambian:              ${cambios.length}`);
  console.log(`Cobros de agenda que estaban al revés: ${sueltos.length}`);
  console.log(`Facturas que ya estaban bien:      ${yaEstaban}`);
  console.log(`Facturas sin odontóloga (no se tocan): ${sinOdontologa}`);
  console.log(`Facturas ya pagadas a la odontóloga (no se tocan): ${liquidadas.length}`);
  console.log('');
  console.log('Lo que les corresponde a las odontólogas en esos cobros:');
  console.log(`  antes:   ${dolares(antes)}`);
  console.log(`  después: ${dolares(despues)}`);
  console.log(`  cambio:  ${despues - antes >= 0 ? '+' : '-'}${dolares(Math.abs(despues - antes))}`);
  console.log('');

  if (cambios.length > 0) {
    console.log('Facturas que cambian (reparto clínica/odontóloga de antes → 60/40):');
    for (const c of cambios) {
      const f = c.factura;
      const eraClinica = f.totalCents === 0 ? 0 : Math.round((f.clinicShareCents / f.totalCents) * 100);
      console.log(
        `  Nº ${f.number}  ${f.patient.fullName}  ${dolares(f.totalCents)}  ` +
          `${eraClinica}/${100 - eraClinica} → ${c.aplicado}/${100 - c.aplicado}`,
      );
    }
    console.log('');
    console.log('Las que NO eran 60/40 a propósito (un 50/50 pactado) hay que volver a');
    console.log('editarlas después, una por una, desde la propia factura.');
    console.log('');
  }

  if (liquidadas.length > 0) {
    console.log('NO se tocan porque su parte ya se le pagó a la odontóloga. Revísalas a mano:');
    for (const f of liquidadas) console.log(`  Nº ${f.number}  ${f.patient.fullName}  ${dolares(f.totalCents)}`);
    console.log('');
  }

  if (cambios.length === 0 && sueltos.length === 0) {
    console.log('No hay nada que cambiar.');
    return;
  }

  if (!CONFIRMADO) {
    console.log('Esto NO ha cambiado nada todavía: es sólo la revisión.');
    console.log('Saca antes una copia de la base. Para aplicarlo:');
    console.log('');
    console.log('  CONFIRMAR=SI node scripts/poner-todo-en-60-40.mjs');
    console.log('');
    return;
  }

  console.log('Confirmado. Aplicando...');

  /** El cobro y sus filas «Auto» del libro, con el reparto nuevo. */
  async function escribirPago(tx, pago, porcentajeClinica) {
    await tx.payment.update({
      where: { id: pago.id },
      data: {
        clinicShareCents: pago.clinica,
        dentistShareCents: pago.odontologa,
        commissionPercentApplied: porcentajeClinica,
      },
    });
    // En el sitio, sin crear ni resucitar filas: si alguien quitó una fila
    // «Auto» del libro a propósito, sigue quitada.
    await tx.dentistLedgerEntry.updateMany({
      where: { sourcePaymentId: pago.id },
      data: {
        dentistPercent: 100 - porcentajeClinica,
        dentistShareCents: pago.odontologa,
        clinicShareCents: pago.clinica,
      },
    });
    // De las dos filas del libro general, el «Pago Dra» es la que no trae ingreso.
    await tx.adminLedgerEntry.updateMany({
      where: { sourcePaymentId: pago.id, incomeCents: 0 },
      data: { expenseCents: pago.odontologa },
    });
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.auditLog.create({
        data: {
          userId: null,
          action: 'invoice.bulk_split_reset',
          entityType: 'Invoice',
          entityId: 'ALL',
          after: {
            clinicPercent: CLINICA,
            facturas: cambios.map((c) => c.factura.number),
            cobrosDeAgenda: sueltos.length,
            noTocadasPorLiquidadas: liquidadas.map((f) => f.number),
            odontologasAntesCents: antes,
            odontologasDespuesCents: despues,
            ejecutadoEn: new Date().toISOString(),
          },
        },
      });

      for (const c of cambios) {
        for (const l of c.lineas) {
          await tx.invoiceLine.update({ where: { id: l.id }, data: { commissionPercent: l.porcentaje } });
        }
        await tx.invoice.update({
          where: { id: c.factura.id },
          data: { clinicShareCents: c.clinica, dentistShareCents: c.odontologa },
        });
        for (const p of c.pagos) await escribirPago(tx, p, c.aplicado);
      }

      for (const p of sueltos) await escribirPago(tx, p, CLINICA);
    },
    { timeout: 300_000 },
  );

  console.log('');
  console.log(`Listo: ${cambios.length} factura(s) y ${sueltos.length} cobro(s) de agenda en 60/40.`);
  console.log('El libro de Administración y lo que se le debe a cada odontóloga ya lo reflejan.');
}

main()
  .catch((error) => {
    console.error('Falló. No se cambió nada:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
