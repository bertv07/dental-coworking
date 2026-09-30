/**
 * ===========================================================================
 *  Carga el libro de septiembre que Deimara llevaba en Excel
 * ===========================================================================
 *  Se ejecuta DENTRO del contenedor desplegado:
 *
 *      node scripts/seed-administracion.mjs
 *
 *  Transcribe fila a fila lo que había en "CONTROL ADMINISTRATIVO DENTAL
 *  COWORKING.xlsx": la hoja general (Gastos Administrados), la caja chica,
 *  y las cuatro hojas de odontóloga (Palma, Martini, Cartagena, Guedez).
 *
 *  Busca a cada odontóloga POR APELLIDO (no por id, que cambia entre
 *  entornos) y AVISA — sin fallar — si alguna no existe en esta base.
 *
 *  IDEMPOTENTE: antes de insertar una fila comprueba si ya existe una igual
 *  (misma fecha + descripción, o misma fecha + paciente) y la salta. Se
 *  puede correr dos veces sin duplicar nada.
 * ===========================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 'YYYY-MM-DD', interpretado a mediodía UTC para que ningún huso lo mueva de día. */
function fecha(iso) {
  return new Date(`${iso}T12:00:00Z`);
}

async function buscarOdontologa(apellido) {
  const encontrada = await prisma.dentist.findFirst({
    where: { fullName: { contains: apellido, mode: 'insensitive' } },
  });
  if (!encontrada) {
    console.log(`  ⚠ No se encontró ninguna odontóloga con "${apellido}" — se salta su libro.`);
  }
  return encontrada;
}

async function cargarGeneral(book, filas) {
  let insertadas = 0;
  let saltadas = 0;
  for (const f of filas) {
    const existe = await prisma.adminLedgerEntry.findFirst({
      where: { book, date: fecha(f.date), description: f.description, deletedAt: null },
    });
    if (existe) { saltadas += 1; continue; }
    await prisma.adminLedgerEntry.create({
      data: {
        book,
        date: fecha(f.date),
        description: f.description,
        incomeCents: Math.round((f.income ?? 0) * 100),
        expenseCents: Math.round((f.expense ?? 0) * 100),
        notes: f.notes ?? null,
      },
    });
    insertadas += 1;
  }
  return { insertadas, saltadas };
}

async function cargarDentista(dentist, filas) {
  let insertadas = 0;
  let saltadas = 0;
  for (const f of filas) {
    const existe = await prisma.dentistLedgerEntry.findFirst({
      where: { dentistId: dentist.id, date: fecha(f.date), patientName: f.patientName, deletedAt: null },
    });
    if (existe) { saltadas += 1; continue; }
    const budgetCents = Math.round((f.budget ?? 0) * 100);
    const dentistPercent = f.dentistPercent ?? 0;
    const dentistShareCents = Math.round((budgetCents * dentistPercent) / 100);
    await prisma.dentistLedgerEntry.create({
      data: {
        dentistId: dentist.id,
        date: fecha(f.date),
        patientName: f.patientName,
        budgetCents,
        depositCents: Math.round((f.deposit ?? 0) * 100),
        dentistPercent,
        dentistShareCents,
        clinicShareCents: budgetCents - dentistShareCents,
        notes: f.notes ?? null,
      },
    });
    insertadas += 1;
  }
  return { insertadas, saltadas };
}

// ---------------------------------------------------------------------------
//  GASTOS ADMINISTRADOS — la hoja general, tal cual
// ---------------------------------------------------------------------------
const GASTOS_ADMIN = [
  { date: '2026-09-01', description: 'Propaganda Facebook', expense: 143 },
  { date: '2026-09-01', description: 'Consulta Odontologia Dra. Palma/ PX. Gonzalez/ Coworking', income: 85 },
  { date: '2026-09-01', description: 'Consulta Odontologia Dra. Palma /PX. Gonzalez /Pago Dra', expense: 42.5 },
  { date: '2026-09-02', description: 'Propagando Globovision', expense: 500 },
  { date: '2026-09-02', description: 'Pago de Renta de Celulares', expense: 20 },
  { date: '2026-09-02', description: 'Pago e Instalacion Unidad Odontologica', expense: 220 },
  { date: '2026-09-03', description: 'Compra de Timbre', expense: 50 },
  { date: '2026-09-03', description: 'Compra de 2 Botellones de Agua', expense: 4 },
  { date: '2026-09-04', description: 'Consulta Odontologia Dra. Palma/ PX. Grimaldo/ Coworking', income: 35 },
  { date: '2026-09-04', description: 'Consulta Odontologia Dra. Palma/ PX. Grimaldo /Pago Dra', expense: 17.5 },
  { date: '2026-09-04', description: 'Marketing', expense: 320 },
  { date: '2026-09-07', description: 'Reparacion de Unidad Odontologica', expense: 260 },
  { date: '2026-09-07', description: 'Sueldo Deimara Ofc. Don Bosco', expense: 175 },
  { date: '2026-09-08', description: 'Consulta Odontologia Dra. Palma /PX. Sanchez/ Coworking', income: 135 },
  { date: '2026-09-08', description: 'Consulta Odontologia Dra. Palma /PX. Sanchez / Pago Dra', expense: 54 },
  { date: '2026-09-08', description: 'Consulta Odontologia Dra. Palma /PX. Ramos/ Coworking', income: 225 },
  { date: '2026-09-08', description: 'Consulta Odontologia Dra. Palma/PX. Ramos/ Pago Dra', expense: 90 },
  { date: '2026-09-08', description: 'Consulta Odontologia Dra. Palma/PX. Francia / Coworking', income: 30 },
  { date: '2026-09-08', description: 'Consulta Odontologia Dra. Palma/PX. Francia / Pago Dra', expense: 15 },
  { date: '2026-09-08', description: 'Consulta Odontologia Dra. Palma/PX. Carmona/ Coworking', income: 30 },
  { date: '2026-09-08', description: 'Consulta Odontologia Dra. Palma/PX. Carmona/Pago Dra', expense: 12 },
  { date: '2026-09-09', description: 'Consulta Odontologia Dra. Palma/PX. Grimaldo/Coworking', income: 75 },
  { date: '2026-09-10', description: 'Consulta Odontologia Dra. Palma/PX. Grimaldo /Pago Dra', expense: 37.5 },
  { date: '2026-09-14', description: 'Consulta Odontologia Dra. Martini/ PX.Zamora / Cowoking', income: 50 },
  { date: '2026-09-14', description: 'Consulta Odontologia Dra. Martini/ PX. Zamora / Pago Dra', expense: 20 },
  { date: '2026-09-15', description: 'Consulta Odontologia Dra. Palma / PX Sanchez / Coworking', income: 50 },
  { date: '2026-09-15', description: 'Consulta Odontologia Dra. Palma / PX.Sanchez / Pago Dra', expense: 20 },
  { date: '2026-09-15', description: 'Consulta Odontologia Dra. Palma/ PX. Virguez / Coworking', income: 150 },
  { date: '2026-09-15', description: 'Consulta Odontologia Dra. Palma/ PX. Virguez / Pago Dra', expense: 60 },
  { date: '2026-09-15', description: 'Consulta Odontologia Dra. Cartagena/ PX. Sanchez / Coworking', income: 500 },
  { date: '2026-09-16', description: 'Consulta Odontologia Dra. Cartagena/ PX. Sanchez / Pago Dra', expense: 200 },
  { date: '2026-09-15', description: 'Consulta Odontologia Dra. Palma/ PX. Villarroel / Coworking', income: 35 },
  { date: '2026-09-15', description: 'Consulta Odontologia Dra. Palma/ PX. Villarroel /Pago Dra', expense: 17.5 },
  { date: '2026-09-16', description: 'Consulta Odontologia Dra. Palma / PX. Meza / Coworking', income: 45 },
  { date: '2026-09-16', description: 'Consulta Odontologia Dra. Palma/ PX. Meza /Pago Dra', expense: 22.5 },
  { date: '2026-09-17', description: 'Consulta Odontologia Dra. Palma/ PX. Martinez / Cworking', income: 60 },
  { date: '2026-09-17', description: 'Consulta Odontologia Dra. Palma/ PX. Martinez / Pago Dra', expense: 24 },
  { date: '2026-09-17', description: 'Compra de 1 Botellon de Agua', expense: 4 },
  { date: '2026-09-17', description: 'Consulta Odontologia Dra. Martini /PX. Brion / Coworking', income: 20 },
  { date: '2026-09-17', description: 'Consulta Odontologia Dra. Martini /PX. Brion / Pago Dra', expense: 12 },
  { date: '2026-09-17', description: 'Consulta Odontologia Dra. Cartagena/ PX. Brion / Coworking', income: 30 },
  { date: '2026-09-17', description: 'Consulta Odontologia Dra. Cartagena/ PX. Brion / Pago Dra', expense: 12 },
  { date: '2026-09-17', description: 'Consulta Odontologia Dra. Cartagena/ PX. Virguez / Coworking', income: 30 },
  { date: '2026-09-17', description: 'Consulta Odontologia Dra. Cartagena/ PX. Virguez/ Pago Dra', expense: 12 },
  { date: '2026-09-18', description: 'Consulta Odontologo Dra. Guedez /PX. Martinez / Coworking', income: 100 },
  { date: '2026-09-18', description: 'Consulta Odontologo Dra. Guedez /PX. Martinez /Pago Dra', expense: 40 },
  { date: '2026-09-21', description: 'Publicidad', expense: 120 },
  { date: '2026-09-21', description: 'Volantes de Publicidad', expense: 187 },
  { date: '2026-09-21', description: 'Consulta Odontologia Dra. Martini/ PX.Zamora / Cowoking', income: 50 },
  { date: '2026-09-21', description: 'Consulta Odontologia Dra. Martini/ PX. Zamora / Pago Dra', expense: 20 },
  { date: '2026-09-21', description: 'Limpieza Oficina', expense: 20 },
  { date: '2026-09-23', description: 'Consulta Odontologia Dra. Palma/PX. Belisario / Coworking', income: 30 },
  { date: '2026-09-23', description: 'Consulta Odontologia Dra. Palma / PX. Belisario / Pago Dra', expense: 15 },
  { date: '2026-09-23', description: 'Consulta Odontologia Dra. Palma /PX. Diaz / Coworking', income: 30 },
  { date: '2026-09-23', description: 'Consulta Odontologia Dra. Palma/ PX. Diaz/ Pago Dra', expense: 15 },
  { date: '2026-09-23', description: 'Consulta Odontologia Dra. Martini / PX. Garcia / Coworking', income: 30 },
  { date: '2026-09-23', description: 'Consulta Odontologia Dra. Martini / PX. Garcia / Pago Dra', expense: 15 },
  { date: '2026-09-24', description: 'Consulta Odontologia Dra. Palma/ PX. Martinez / Cworking', income: 45 },
  { date: '2026-09-24', description: 'Consulta Odontologia Dra. Palma/ PX. Martinez / Pago Dra', expense: 22.5 },
  { date: '2026-09-24', description: 'Consulta Odontologia Dra. Cartagena/PX. Magallanes / Coworking', income: 80 },
  { date: '2026-09-24', description: 'Consulta Odontologia Dra. Cartagena/PX. Magallanes /Pago Dra', expense: 32 },
  { date: '2026-09-25', description: 'Pago Electricidad y Releno', expense: 81 },
  { date: '2026-09-28', description: 'Publicidad de Facebook', expense: 91 },
  { date: '2026-09-28', description: 'Reparacion de aire acondicionado', expense: 30 },
  { date: '2026-09-28', description: 'Compra de 1 Botellones de Agua', expense: 2 },
];

// ---------------------------------------------------------------------------
//  CAJA CHICA
// ---------------------------------------------------------------------------
const CAJA_CHICA = [
  { date: '2026-09-01', description: 'Saldo Iniciacial', income: 220 },
];

// ---------------------------------------------------------------------------
//  DRA. PALMA (Emilmar Palma Faneite)
// ---------------------------------------------------------------------------
const DRA_PALMA = [
  { date: '2026-08-22', patientName: 'Franco Leterni', budget: 30, dentistPercent: 40,
    notes: 'Paciente pago parte de consulta la cual no ha asistido' },
  { date: '2026-09-01', patientName: 'Luis Gonzalez', budget: 85, dentistPercent: 50 },
  { date: '2026-09-04', patientName: 'Fabiana Grimaldo', budget: 35, dentistPercent: 50 },
  { date: '2026-09-04', patientName: 'Emilia Faneite', budget: 0,
    notes: 'Paciente de cortesia hermano de la Dra. Emilmar' },
  { date: '2026-09-04', patientName: 'Antonio Palma', budget: 0,
    notes: 'Paciente de cortesia mama de la Dra. Emilmar' },
  { date: '2026-09-08', patientName: 'Megan Francia', budget: 30, dentistPercent: 50 },
  { date: '2026-09-08', patientName: 'Luis Carmona', budget: 30, dentistPercent: 40 },
  { date: '2026-09-08', patientName: 'Sergio Ramos', budget: 225, dentistPercent: 40 },
  { date: '2026-09-08', patientName: 'Yancy Sanchez', budget: 135, dentistPercent: 40 },
  { date: '2026-09-09', patientName: 'Fabiana Grimaldo', budget: 75, dentistPercent: 50 },
  { date: '2026-09-15', patientName: 'Yancy Sanchez', budget: 50, dentistPercent: 40 },
  { date: '2026-09-15', patientName: 'Rachell Virguez', budget: 150, dentistPercent: 40 },
  { date: '2026-09-15', patientName: 'Yhonny Villarroel', budget: 35, dentistPercent: 50 },
  { date: '2026-09-16', patientName: 'Sptefani Meza', budget: 45, dentistPercent: 50 },
  { date: '2026-09-17', patientName: 'Miguel Martinez', budget: 60, dentistPercent: 40 },
  { date: '2026-09-23', patientName: 'Carmen Belizario', budget: 30, dentistPercent: 50 },
  { date: '2026-09-23', patientName: 'Esperanza Diaz', budget: 30, dentistPercent: 50 },
  { date: '2026-09-24', patientName: 'Sptefani Meza', budget: 45, dentistPercent: 50 },
];

// ---------------------------------------------------------------------------
//  DRA. MARTINI (Samantha Martini)
// ---------------------------------------------------------------------------
const DRA_MARTINI = [
  { date: '2026-09-04', patientName: 'Nelson Mora', budget: 0,
    notes: 'Paciente de Cortesia Novio Dra. Samantha' },
  { date: '2026-09-14', patientName: 'Leida Zamora', budget: 50, dentistPercent: 40, notes: 'Se exonero 5.00$' },
  { date: '2026-09-17', patientName: 'Victor Brion', budget: 20, dentistPercent: 40 },
  { date: '2026-09-21', patientName: 'Elda Garcia', budget: 30, dentistPercent: 50 },
  { date: '2026-09-21', patientName: 'Leida Zamora', budget: 50, dentistPercent: 40 },
  { date: '2026-09-23', patientName: 'Garcia', budget: 30, dentistPercent: 50,
    notes: 'Reconstruida desde Gastos Administrados (no salió en la foto de esta pestaña): Coworking 30 / Pago Dra 15' },
];

// ---------------------------------------------------------------------------
//  DRA. CARTAGENA (Yvette Cartagena) — de su propia pestaña
// ---------------------------------------------------------------------------
const DRA_CARTAGENA = [
  { date: '2026-09-15', patientName: 'Yancy Sanchez', budget: 500, dentistPercent: 40 },
  { date: '2026-09-17', patientName: 'Victor Brion', budget: 30, dentistPercent: 40 },
  { date: '2026-09-17', patientName: 'Rachell Virguez', budget: 30, dentistPercent: 40 },
  { date: '2026-09-17', patientName: 'Samantha Martini', budget: 0,
    notes: 'Paciente de Cortesia Dra. Samantha' },
  { date: '2026-09-24', patientName: 'Yeymy Magallanes', budget: 80, dentistPercent: 40 },
];

// ---------------------------------------------------------------------------
//  DRA. GUEDEZ (Genesis Guedez) — de su propia pestaña
// ---------------------------------------------------------------------------
const DRA_GUEDEZ = [
  { date: '2026-09-18', patientName: 'Miguel Martinez', budget: 100, deposit: 100, dentistPercent: 40,
    notes: 'Queda pendiente por abonar 100,00$ al tratamiento' },
];

async function main() {
  console.log('=== Gastos Administrados ===');
  const g = await cargarGeneral('GASTOS_ADMIN', GASTOS_ADMIN);
  console.log(`  ${g.insertadas} insertadas, ${g.saltadas} ya existían`);

  console.log('=== Caja Chica ===');
  const c = await cargarGeneral('CAJA_CHICA', CAJA_CHICA);
  console.log(`  ${c.insertadas} insertadas, ${c.saltadas} ya existían`);

  for (const [apellido, filas] of [
    ['Palma', DRA_PALMA],
    ['Martini', DRA_MARTINI],
    ['Cartagena', DRA_CARTAGENA],
    ['Guedez', DRA_GUEDEZ],
  ]) {
    console.log(`=== Dra. ${apellido} ===`);
    const dentist = await buscarOdontologa(apellido);
    if (!dentist) continue;
    const r = await cargarDentista(dentist, filas);
    console.log(`  ${dentist.fullName}: ${r.insertadas} insertadas, ${r.saltadas} ya existían`);
  }

  console.log('\nListo.');
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Falló la carga:', error);
  await prisma.$disconnect();
  process.exit(1);
});
