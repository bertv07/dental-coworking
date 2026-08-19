/**
 * ===========================================================================
 *  Crear las cuentas de acceso al panel
 * ===========================================================================
 *  Se ejecuta DENTRO del contenedor desplegado:
 *
 *      node scripts/crear-usuarios.mjs
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ ESTE ARCHIVO EXISTE, HABIENDO UN SEED
 *  ---------------------------------------------------------------------
 *  Dos motivos.
 *
 *  1. El seed está en TypeScript y se ejecuta con `tsx`, que es una
 *     dependencia de desarrollo. La imagen de producción no la lleva —a
 *     propósito, cada herramienta de más es una herramienta a mano de quien
 *     entre—, así que `npm run db:seed` no puede correr ahí. Este archivo es
 *     JavaScript plano y sólo usa lo que la aplicación ya necesita para
 *     funcionar.
 *
 *  2. El seed además carga 30 pacientes y 600 citas de mentira. En un
 *     servidor eso es basura que luego hay que limpiar a mano. Esto crea
 *     ÚNICAMENTE las cuentas.
 *
 *  ---------------------------------------------------------------------
 *  ES IDEMPOTENTE
 *  ---------------------------------------------------------------------
 *  Ejecutarlo dos veces no duplica nada: si la cuenta existe, le actualiza la
 *  contraseña y la reactiva. Sirve igual para crear que para recuperar el
 *  acceso cuando alguien olvidó su clave.
 *
 *  ---------------------------------------------------------------------
 *  CONTRASEÑAS
 *  ---------------------------------------------------------------------
 *  Sin variables de entorno, crea las tres cuentas de prueba documentadas en
 *  el README. Para una clínica de verdad, pásale las tuyas:
 *
 *      ADMIN_EMAIL="tu@correo.com" ADMIN_PASSWORD="..." \
 *        node scripts/crear-usuarios.mjs
 *
 *  El hash es Argon2id con los mismos parámetros que usa el login. Si no
 *  coincidieran, la verificación fallaría y el panel diría "credenciales
 *  inválidas" con la contraseña correcta.
 * ===========================================================================
 */

import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

/** Idénticos a `backend/src/auth/password.ts`. No los cambies sólo aquí. */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Las cuentas a crear.
 *
 * El teléfono del personal es lo que permite al bot de WhatsApp reconocer a
 * quien escribe: sin él, un mensaje de la asistente se atiende como si fuera
 * un paciente pidiendo cita.
 */
const CUENTAS = [
  {
    email: process.env.ADMIN_EMAIL ?? 'admin@dentalcoworking.com.ve',
    password: process.env.ADMIN_PASSWORD ?? 'SuperAdmin2026!',
    fullName: process.env.ADMIN_NAME ?? 'Administrador',
    role: 'SUPER_ADMIN',
    phoneE164: process.env.ADMIN_PHONE ?? null,
  },
  {
    email: process.env.ASSISTANT_EMAIL ?? 'recepcion@dentalcoworking.com.ve',
    password: process.env.ASSISTANT_PASSWORD ?? 'Asistente2026!',
    fullName: process.env.ASSISTANT_NAME ?? 'Recepción',
    role: 'ASSISTANT',
    phoneE164: process.env.ASSISTANT_PHONE ?? null,
  },
  {
    email: process.env.DENTIST_EMAIL ?? 'odontologo@dentalcoworking.com.ve',
    password: process.env.DENTIST_PASSWORD ?? 'Odontologo2026!',
    fullName: process.env.DENTIST_NAME ?? 'Odontólogo',
    role: 'DENTIST',
    phoneE164: process.env.DENTIST_PHONE ?? null,
  },
];

/**
 * Crea (o reutiliza) la ficha clínica del odontólogo y la enlaza a su cuenta.
 *
 * Le deja además un horario semanal: sin él, `/availability` no encuentra
 * ningún hueco y ni el panel ni el bot pueden agendarle nada.
 */
async function vincularFichaDeOdontologo(userId, cuenta) {
  const licencia = process.env.DENTIST_LICENSE ?? 'RM-00001';

  const ficha = await prisma.dentist.upsert({
    where: { licenseNumber: licencia },
    update: { userId, deletedAt: null, isActive: true },
    create: {
      userId,
      fullName: cuenta.fullName,
      licenseNumber: licencia,
      email: cuenta.email,
      // El teléfono de la ficha es el que usa el bot para reconocer al
      // odontólogo cuando escribe por WhatsApp.
      phone: cuenta.phoneE164 ?? '+584140000001',
      specialties: (process.env.DENTIST_SPECIALTIES ?? 'ODONTOLOGÍA GENERAL')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
      clinicCommissionPercent: Number(process.env.DENTIST_COMMISSION ?? 40),
    },
    select: { id: true, fullName: true, clinicCommissionPercent: true },
  });

  // Horario: lunes a sábado, la jornada de la clínica. `createMany` con
  // `skipDuplicates` lo hace repetible — el índice único es (odontólogo,
  // día, hora de inicio).
  const APERTURA = 9 * 60;   // 09:00
  const CIERRE = 18 * 60;    // 18:00
  await prisma.dentistSchedule.createMany({
    data: [1, 2, 3, 4, 5, 6].map((weekday) => ({
      dentistId: ficha.id,
      weekday,
      startMinute: APERTURA,
      endMinute: weekday === 6 ? 13 * 60 : CIERRE,
    })),
    skipDuplicates: true,
  });

  console.log(
    `                  ↳ ficha ${licencia} · comisión clínica ${ficha.clinicCommissionPercent}% · horario lun-sáb`,
  );
}

async function main() {
  console.log('Creando cuentas de acceso…\n');

  for (const cuenta of CUENTAS) {
    if (cuenta.password.length < 12) {
      throw new Error(
        `La contraseña de ${cuenta.email} tiene ${cuenta.password.length} caracteres. ` +
          'El mínimo son 12 (política NIST SP 800-63B).',
      );
    }

    const passwordHash = await hash(cuenta.password, ARGON2_OPTIONS);

    const usuario = await prisma.user.upsert({
      where: { email: cuenta.email },
      // Al actualizar NO se toca el nombre ni el rol: si el administrador los
      // cambió desde el panel, este script no debe pisarlos. Sólo restablece
      // la contraseña y devuelve el acceso.
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
        deletedAt: null,
        // Invalida las sesiones abiertas: si se restablece una contraseña es
        // porque puede estar comprometida, y las sesiones vivas seguirían
        // funcionando con la clave vieja.
        sessionsValidFrom: new Date(),
      },
      create: {
        email: cuenta.email,
        passwordHash,
        fullName: cuenta.fullName,
        role: cuenta.role,
        status: 'ACTIVE',
        phoneE164: cuenta.phoneE164,
      },
      select: { id: true, email: true, role: true, createdAt: true, updatedAt: true },
    });

    const esNueva = usuario.createdAt.getTime() === usuario.updatedAt.getTime();
    console.log(`  ${esNueva ? '✓ creada    ' : '↻ actualizada'}  ${usuario.role.padEnd(11)}  ${usuario.email}`);

    /*
     * Una cuenta con rol DENTIST no sirve de nada por sí sola.
     *
     * `User` es la credencial de acceso; `Dentist` es la ficha clínica con la
     * licencia, las especialidades y la comisión. La agenda del odontólogo
     * busca su ficha por `Dentist.userId`, y si no la encuentra muestra «tu
     * usuario todavía no está vinculado a una ficha de odontólogo».
     *
     * Están separados a propósito: hay odontólogos que no necesitan entrar al
     * panel, y un administrador no es un odontólogo. Pero cuando la cuenta ES
     * de un odontólogo, hay que crear las dos cosas y enlazarlas.
     */
    if (cuenta.role === 'DENTIST') {
      await vincularFichaDeOdontologo(usuario.id, cuenta);
    }
  }

  // Recuento final: si el panel sigue rechazando el login después de esto, el
  // problema no es la falta de usuarios y hay que mirar en otro sitio.
  const total = await prisma.user.count({ where: { deletedAt: null } });
  console.log(`\nCuentas activas en la base: ${total}`);

  if (!process.env.ADMIN_PASSWORD) {
    console.log(
      '\n⚠️  Se usaron las contraseñas de ejemplo del README.\n' +
        '   Cámbialas antes de que la clínica empiece a usar el panel.',
    );
  }
}

main()
  .catch((error) => {
    console.error('\n❌ No se pudieron crear las cuentas:\n');
    console.error(error instanceof Error ? error.message : error);
    // Código de salida distinto de cero: si esto corre en un script de
    // despliegue, tiene que notarse que falló.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
