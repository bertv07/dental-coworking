/**
 * ===========================================================================
 *  SEED — pobla PostgreSQL con los mismos datos del modo mock
 * ===========================================================================
 *  Ejecutar:  npm run db:seed
 *
 *  Reutiliza `mock/data.ts` a propósito: así la demo con mock y la base de
 *  datos real muestran EXACTAMENTE lo mismo, y cualquier diferencia de
 *  comportamiento entre ambos modos es un bug detectable, no ruido.
 *
 *  ⚠️  Se niega a ejecutarse con NODE_ENV=production. Contiene una
 *   contraseña conocida y borra tablas: nunca debe correr contra datos
 *   reales.
 * ===========================================================================
 */

import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import {
  MOCK_APPOINTMENTS,
  MOCK_CREDENTIALS,
  MOCK_CONVERSATIONS,
  MOCK_DENTISTS,
  MOCK_DEV_PASSWORD,
  MOCK_MESSAGES,
  MOCK_PATIENTS,
  MOCK_PAYMENTS,
  MOCK_PAYMENT_METHODS,
  MOCK_ROOMS,
  MOCK_TREATMENTS,
  MOCK_USERS,
} from '../src/mock/data';

const prisma = new PrismaClient();

async function main() {
  // --- Salvaguarda --------------------------------------------------------
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'El seed NO puede ejecutarse en producción: contiene credenciales de ' +
        'desarrollo y borra las tablas.',
    );
  }

  console.log('🌱 Sembrando base de datos…\n');

  // --- Limpieza en orden inverso a las dependencias -----------------------
  // Si se borra `patients` antes que `appointments`, las claves foráneas
  // rechazan la operación.
  console.log('  Limpiando tablas…');
  await prisma.whatsAppMessage.deleteMany();
  await prisma.whatsAppConversation.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.dentistPayout.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.treatmentPriceHistory.deleteMany();
  await prisma.dentistTreatment.deleteMany();
  await prisma.timeOff.deleteMany();
  await prisma.dentistSchedule.deleteMany();
  await prisma.treatment.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.dentist.deleteMany();
  await prisma.paymentMethodOption.deleteMany();
  await prisma.room.deleteMany();
  /*
   * `audit_logs` NO se borra con DELETE: un trigger de la base lo prohíbe, y
   * ese trigger es justamente lo que hace creíble la auditoría. Si el seed
   * pudiera borrarla, cualquiera con acceso a este script podría limpiar el
   * rastro de un cambio de precio o de un arqueo reabierto.
   *
   * TRUNCATE no dispara triggers de fila, así que es la única vía — y se usa
   * sólo aquí, en un script que ya se niega a ejecutarse en producción.
   */
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs" CASCADE');
  await prisma.exchangeRate.deleteMany();
  await prisma.clinicSettings.deleteMany();
  await prisma.user.deleteMany();

  // --- Usuarios -----------------------------------------------------------
  // El hash se calcula UNA vez y se reutiliza: Argon2 tarda ~80 ms y
  // hacerlo por usuario no aporta nada en un seed de desarrollo.
  // Un hash POR usuario: cada cuenta tiene su propia contraseña, así se
  // puede comprobar de verdad la separación de roles.
  const hashes = new Map<string, string>();
  for (const user of MOCK_USERS) {
    hashes.set(
      user.email,
      await hash(MOCK_CREDENTIALS[user.email] ?? MOCK_DEV_PASSWORD, {
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      }),
    );
  }

  await prisma.user.createMany({
    data: MOCK_USERS.map((user) => ({
      id: user.id,
      email: user.email,
      passwordHash: hashes.get(user.email)!,
      fullName: user.fullName,
      role: user.role,
      // El teléfono es lo que permite al bot reconocer al personal.
      phoneE164: user.phoneE164 ?? null,
      status: user.status,
      createdAt: user.createdAt,
    })),
  });
  console.log(`  ✓ ${MOCK_USERS.length} usuarios`);

  // --- Medios de pago -----------------------------------------------------
  // Valores de ejemplo para una clínica venezolana. HAY QUE SUSTITUIRLOS por
  // los datos bancarios reales antes de conectar el bot: si no, mandará a los
  // pacientes a pagar a una cuenta que no existe.
  await prisma.paymentMethodOption.createMany({
    data: MOCK_PAYMENT_METHODS.map((method) => ({
      id: method.id,
      label: method.label,
      kind: method.kind,
      instructions: method.instructions,
      currency: method.currency,
      sortOrder: method.sortOrder,
      isActive: method.isActive,
    })),
  });
  console.log(`  ✓ ${MOCK_PAYMENT_METHODS.length} medios de pago`);

  // --- Consultorios -------------------------------------------------------
  await prisma.room.createMany({
    data: MOCK_ROOMS.map((room) => ({
      id: room.id,
      name: room.name,
      code: room.code,
      equipment: room.equipment,
      isActive: room.isActive,
      notes: room.notes,
    })),
  });
  console.log(`  ✓ ${MOCK_ROOMS.length} consultorios`);

  // --- Odontólogos --------------------------------------------------------
  await prisma.dentist.createMany({
    data: MOCK_DENTISTS.map((dentist) => ({
      id: dentist.id,
      userId: dentist.userId,
      fullName: dentist.fullName,
      licenseNumber: dentist.licenseNumber,
      email: dentist.email,
      phone: dentist.phone,
      specialties: dentist.specialties,
      clinicCommissionPercent: dentist.clinicCommissionPercent,
      isActive: dentist.isActive,
      createdAt: dentist.createdAt,
    })),
  });
  console.log(`  ✓ ${MOCK_DENTISTS.length} odontólogos`);

  // --- Horarios: lunes a viernes 08:00-18:00, sábados 08:00-13:00 ---------
  await prisma.dentistSchedule.createMany({
    data: MOCK_DENTISTS.flatMap((dentist) =>
      [1, 2, 3, 4, 5, 6].map((weekday) => ({
        dentistId: dentist.id,
        weekday,
        startMinute: 8 * 60,
        endMinute: weekday === 6 ? 13 * 60 : 18 * 60,
      })),
    ),
  });
  console.log('  ✓ horarios semanales');

  // --- Tratamientos -------------------------------------------------------
  await prisma.treatment.createMany({
    data: MOCK_TREATMENTS.map((treatment) => ({
      id: treatment.id,
      name: treatment.name,
      code: treatment.code,
      category: treatment.category,
      basePriceCents: treatment.basePriceCents,
      durationMinutes: treatment.durationMinutes,
      bufferMinutes: treatment.bufferMinutes,
      isActive: treatment.isActive,
    })),
  });
  console.log(`  ✓ ${MOCK_TREATMENTS.length} tratamientos`);

  // --- Pacientes ----------------------------------------------------------
  await prisma.patient.createMany({
    data: MOCK_PATIENTS.map((patient) => ({
      id: patient.id,
      fullName: patient.fullName,
      phoneE164: patient.phoneE164,
      email: patient.email,
      documentId: patient.documentId,
      birthDate: patient.birthDate,
      notes: patient.notes,
      marketingConsent: patient.marketingConsent,
      createdAt: patient.createdAt,
    })),
  });
  console.log(`  ✓ ${MOCK_PATIENTS.length} pacientes`);

  // --- Citas --------------------------------------------------------------
  // ⚠️  Los constraints EXCLUDE de la migración 0001 rechazan solapamientos.
  //  Los datos mock generan algunos (se reparten al azar entre 3 salas), así
  //  que se insertan de una en una y se ignoran las que colisionen. Es
  //  precisamente la prueba de que el constraint funciona.
  let inserted = 0;
  let skipped = 0;

  for (const appointment of MOCK_APPOINTMENTS) {
    try {
      await prisma.appointment.create({
        data: {
          id: appointment.id,
          patientId: appointment.patientId,
          dentistId: appointment.dentistId,
          roomId: appointment.roomId,
          treatmentId: appointment.treatmentId,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          status: appointment.status,
          source: appointment.source,
          agreedPriceCents: appointment.agreedPriceCents,
          idempotencyKey: appointment.idempotencyKey,
          createdAt: appointment.createdAt,
        },
      });
      inserted += 1;
    } catch {
      // Solapamiento rechazado por Postgres: se descarta y se sigue.
      skipped += 1;
    }
  }
  console.log(`  ✓ ${inserted} citas (${skipped} descartadas por solapamiento)`);

  // --- Pagos --------------------------------------------------------------
  // Sólo los de citas que sí se insertaron.
  const insertedIds = new Set(
    (await prisma.appointment.findMany({ select: { id: true } })).map((a) => a.id),
  );

  const validPayments = MOCK_PAYMENTS.filter((payment) =>
    insertedIds.has(payment.appointmentId),
  );

  await prisma.payment.createMany({
    data: validPayments.map((payment) => ({
      id: payment.id,
      appointmentId: payment.appointmentId,
      amountCents: payment.amountCents,
      commissionPercentApplied: payment.commissionPercentApplied,
      clinicShareCents: payment.clinicShareCents,
      dentistShareCents: payment.dentistShareCents,
      method: payment.method,
      status: payment.status,
      paidAt: payment.paidAt,
      // Snapshot cambiario del día del cobro. Ver nota en el esquema.
      exchangeRate: payment.exchangeRate,
      amountBs: payment.amountBs,
      exchangeRateSource: payment.exchangeRateSource,
      // `payoutId` se omite: las liquidaciones se generan con el proceso real,
      // no se inventan aquí.
    })),
  });
  console.log(`  ✓ ${validPayments.length} pagos`);

  // --- WhatsApp -----------------------------------------------------------
  await prisma.whatsAppConversation.createMany({
    data: MOCK_CONVERSATIONS.map((conversation) => ({
      id: conversation.id,
      phoneE164: conversation.phoneE164,
      patientId: conversation.patientId,
      displayName: conversation.displayName,
      aiEnabled: conversation.aiEnabled,
      aiToggledByUserId: conversation.aiToggledByUserId,
      aiToggledAt: conversation.aiToggledAt,
      aiDisabledReason: conversation.aiDisabledReason,
      unreadCount: conversation.unreadCount,
      needsHumanAttention: conversation.needsHumanAttention,
      lastMessageAt: conversation.lastMessageAt,
    })),
  });

  await prisma.whatsAppMessage.createMany({
    data: MOCK_MESSAGES.map((message) => ({
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction,
      author: message.author,
      body: message.body,
      sentAt: message.sentAt,
    })),
  });
  console.log(
    `  ✓ ${MOCK_CONVERSATIONS.length} conversaciones, ${MOCK_MESSAGES.length} mensajes`,
  );

  // --- Tipo de cambio: tasa REAL desde DolarAPI --------------------------
  // Se consulta al sembrar para que el sistema arranque con la tasa del día
  // en vez de un número inventado. Si la API falla, se usa un valor de
  // respaldo: la clínica debe poder operar igualmente.
  console.log('  Consultando DolarAPI…');
  const FALLBACK_RATE = 761.2167;

  for (const [source, url] of [
    ['BCV', 'https://ve.dolarapi.com/v1/dolares/oficial'],
    ['PARALELO', 'https://ve.dolarapi.com/v1/dolares/paralelo'],
  ] as const) {
    let rate = FALLBACK_RATE;
    let publishedAt = new Date();

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = (await response.json()) as {
        promedio?: number | null;
        venta?: number | null;
        fechaActualizacion?: string;
      };
      const value = data.promedio ?? data.venta;
      if (typeof value === 'number' && value > 0) {
        rate = value;
        if (data.fechaActualizacion) publishedAt = new Date(data.fechaActualizacion);
      }
      console.log(`  ✓ ${source}: ${rate} Bs/USD`);
    } catch {
      console.log(`  ⚠ ${source}: DolarAPI no respondió, usando ${FALLBACK_RATE}`);
    }

    await prisma.exchangeRate.create({
      data: { source, rate, publishedAt, isCurrent: true },
    });
  }

  // --- Ajustes de la clínica (fila única) --------------------------------
  await prisma.clinicSettings.create({
    data: {
      id: 'singleton',
      clinicName: 'Dental Coworking',
      taxId: 'J-40123456-7',
      address: 'Av. Francisco de Miranda, Caracas',
      phone: '+582125551234',
      email: 'contacto@dentalcoworking.com.ve',
      defaultCommissionPercent: 40,
      openingMinute: 8 * 60,
      closingMinute: 18 * 60,
      slotMinutes: 30,
      displayCurrency: 'USD',
      preferredRateSource: 'BCV',
    },
  });
  console.log('  ✓ ajustes de clínica');

  console.log('\n✅ Listo.');
  console.log('   Credenciales de acceso:');
  for (const user of MOCK_USERS) {
    const password = MOCK_CREDENTIALS[user.email] ?? MOCK_DEV_PASSWORD;
    console.log(`     ${user.role.padEnd(12)} ${user.email.padEnd(42)} ${password}`);
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error('❌ Falló el seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
