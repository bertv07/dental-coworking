import type {
  Appointment,
  AppointmentStatus,
  AppointmentSource,
  Dentist,
  Patient,
  Payment,
  PaymentMethod,
  PaymentMethodOption,
  Room,
  Treatment,
  User,
  WhatsAppConversation,
  WhatsAppMessage,
} from '@/backend/domain/types';
import { splitCents } from '@/backend/domain/money';
import { clinicDayKey, clinicWallClockToInstant } from '@/backend/domain/clinic-calendar';

/**
 * ===========================================================================
 *  DATOS DE PRUEBA (MOCK)
 * ===========================================================================
 *  Objetivo: que el panel sea navegable y creíble sin levantar Postgres.
 *
 *  DOS REGLAS DE DISEÑO QUE IMPORTAN:
 *
 *  1. DETERMINISMO. Nada de `Math.random()` ni `new Date()` suelto. Los
 *     Server Components de Next.js renderizan en el servidor y luego React
 *     hidrata en el cliente; si los datos difieren entre ambos, React lanza
 *     un error de hidratación. Se usa un PRNG con semilla fija y una fecha
 *     de referencia estable.
 *
 *  2. COHERENCIA CONTABLE. Los pagos se derivan de las citas con `splitCents`,
 *     la misma función que usa producción. Así los totales del dashboard
 *     cuadran de verdad y sirven para validar la UI — no son números sueltos.
 *
 *  MIGRACIÓN A DB REAL: no hay que tocar este archivo. Basta con poner
 *  `DATA_SOURCE=db` en el entorno; `repositories/index.ts` cambia de fuente.
 *  Este mismo dataset alimenta `prisma/seed.ts`.
 * ===========================================================================
 */

/**
 * PRNG determinista (mulberry32). Con la misma semilla, siempre la misma
 * secuencia — en el servidor y en el cliente.
 */
function createRandom(seed: number): () => number {
  let state = seed;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20260810);

/** Entero en [min, max]. */
function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

/** Elemento aleatorio de un array no vacío. */
function pick<T>(items: readonly T[]): T {
  // El `!` es seguro: sólo se llama con arrays literales no vacíos.
  return items[Math.floor(random() * items.length)]!;
}

/**
 * Fecha de referencia FIJA. No `new Date()`: cambiaría en cada render y
 * rompería tanto el determinismo como las capturas de pantalla de la demo.
 */
export const MOCK_NOW = new Date('2026-08-10T14:00:00.000Z');

/**
 * Tasa BCV de referencia (Bs por USD) para generar el histórico.
 *
 * Se aplica una deriva diaria: la tasa venezolana sube de forma sostenida, y
 * un histórico con la misma tasa todos los días sería irreal y ocultaría
 * justo el problema que el snapshot por pago resuelve.
 */
const SEED_BASE_RATE = 761.2167;

/** Tasa aproximada de un día concreto, retrocediendo desde la actual. */
function rateForDay(dayOffset: number): number {
  // ~0.35% de deriva diaria hacia atrás en el tiempo.
  return Math.round(SEED_BASE_RATE * Math.pow(1 - 0.0035, -dayOffset) * 10_000) / 10_000;
}

/** Genera un id con forma de CUID, para que pase `cuidSchema`. */
function mockId(prefix: string, index: number): string {
  return `c${prefix}${String(index).padStart(6, '0')}${'x'.repeat(14)}`.slice(0, 25);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

// ===========================================================================
//  CONSULTORIOS — los 3 físicos
// ===========================================================================

export const MOCK_ROOMS: Room[] = [
  {
    id: mockId('room', 1),
    name: 'Consultorio 1',
    code: 'C1',
    equipment: ['Unidad odontológica', 'Rayos X periapical', 'Lámpara LED'],
    assignedDentistId: null,
    isActive: true,
    notes: 'Consultorio principal, equipado para ortodoncia',
  },
  {
    id: mockId('room', 2),
    name: 'Consultorio 2',
    code: 'C2',
    equipment: ['Unidad odontológica', 'Cavitrón', 'Lámpara LED'],
    // Rotativo: se reparte según la especialidad del día.
    assignedDentistId: null,
    isActive: true,
    notes: 'Preferente para higiene y preventivo',
  },
  {
    id: mockId('room', 3),
    name: 'Consultorio 3',
    code: 'C3',
    equipment: ['Unidad odontológica', 'Microscopio', 'Rayos X periapical'],
    assignedDentistId: null,
    isActive: true,
    notes: 'Endodoncia y cirugía',
  },
];

// ===========================================================================
//  ODONTÓLOGOS — los 12
// ===========================================================================

const DENTIST_SEED: Array<{
  name: string;
  specialties: string[];
  /** Comisión pactada individualmente. La mayoría en 40, algunos negociados. */
  commission: number;
}> = [
  { name: 'Dra. Gabriela Ferreira', specialties: ['ORTODONCIA'], commission: 40 },
  { name: 'Dr. Andrés Perdomo', specialties: ['ENDODONCIA'], commission: 40 },
  { name: 'Dra. Valentina Chacón', specialties: ['ODONTOPEDIATRÍA'], commission: 40 },
  { name: 'Dr. Sebastián Urdaneta', specialties: ['PERIODONCIA', 'IMPLANTOLOGÍA'], commission: 35 },
  { name: 'Dra. Mariana Bracho', specialties: ['ESTÉTICA DENTAL'], commission: 40 },
  { name: 'Dr. Julián Anzola', specialties: ['CIRUGÍA ORAL'], commission: 38 },
  { name: 'Dra. Daniela Guerrero', specialties: ['ORTODONCIA', 'ESTÉTICA DENTAL'], commission: 40 },
  { name: 'Dr. Felipe Montilla', specialties: ['REHABILITACIÓN ORAL'], commission: 40 },
  { name: 'Dra. Laura Belisario', specialties: ['PREVENTIVO', 'PERIODONCIA'], commission: 45 },
  { name: 'Dr. Santiago Nucete', specialties: ['ENDODONCIA', 'CIRUGÍA ORAL'], commission: 40 },
  { name: 'Dra. Isabella Marcano', specialties: ['ODONTOPEDIATRÍA', 'PREVENTIVO'], commission: 42 },
  { name: 'Dr. Tomás Rondón', specialties: ['IMPLANTOLOGÍA'], commission: 35 },
];

export const MOCK_DENTISTS: Dentist[] = DENTIST_SEED.map((seed, index) => ({
  id: mockId('dent', index + 1),
  userId: index === 0 ? mockId('user', 3) : null,
  fullName: seed.name,
  licenseNumber: `RM-${10_000 + index * 137}`,
  email: `${seed.name
    .toLowerCase()
    .replace(/^dra?\.\s*/, '')
    .replace(/\s+/g, '.')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')}@dentalcoworking.com.ve`,
  phone: `+584${String(120_000_000 + index * 1_111_111).slice(0, 9)}`,
  photoUrl: null,
  specialties: seed.specialties,
  clinicCommissionPercent: seed.commission,
  isActive: index !== 11, // Uno inactivo: la UI debe manejar ese caso.
  createdAt: addDays(MOCK_NOW, -400 + index * 12),
  deletedAt: null,
}));

// ===========================================================================
//  MEDIOS DE PAGO — lo que la clínica acepta y cómo se lo dice al paciente
// ===========================================================================
//  Valores por defecto pensados para una clínica venezolana. El administrador
//  los edita en /configuracion; el bot los lee del catálogo.
//
//  Los datos bancarios de aquí son de ejemplo. Hay que sustituirlos por los
//  reales antes de conectar el bot: si no, mandará a los pacientes a pagar a
//  una cuenta que no existe.

export const MOCK_PAYMENT_METHODS: PaymentMethodOption[] = [
  {
    id: mockId('pmo', 1),
    label: 'Pago móvil',
    kind: 'TRANSFER',
    instructions:
      'Banco: 0102 Banco de Venezuela\nTeléfono: 0412-000-0000\nRIF: J-40123456-7\nEnvía la captura del pago por aquí.',
    currency: 'VES',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: mockId('pmo', 2),
    label: 'Transferencia bancaria',
    kind: 'TRANSFER',
    instructions:
      'Banco: 0102 Banco de Venezuela\nCuenta corriente: 0102-0000-00-0000000000\nA nombre de: Dental Coworking C.A.\nRIF: J-40123456-7',
    currency: 'VES',
    sortOrder: 2,
    isActive: true,
  },
  {
    id: mockId('pmo', 3),
    label: 'Efectivo (Bs o divisas)',
    kind: 'CASH',
    instructions: 'Se paga en recepción al terminar la consulta.',
    currency: 'VES',
    sortOrder: 3,
    isActive: true,
  },
  {
    id: mockId('pmo', 4),
    label: 'Zelle',
    kind: 'TRANSFER',
    instructions: 'Correo: pagos@dentalcoworking.com.ve\nA nombre de: Dental Coworking',
    currency: 'USD',
    sortOrder: 4,
    isActive: true,
  },
  {
    id: mockId('pmo', 5),
    label: 'Punto de venta',
    kind: 'CARD',
    instructions: 'Débito y crédito en recepción.',
    currency: 'VES',
    sortOrder: 5,
    isActive: true,
  },
];

// ===========================================================================
//  TRATAMIENTOS — catálogo con precios en CENTAVOS
// ===========================================================================

const TREATMENT_SEED: Array<{
  code: string;
  name: string;
  category: string;
  /** Precio en DÓLARES; se convierte a centavos abajo. */
  price: number;
  duration: number;
}> = [
  { code: 'CONSULTA', name: 'Consulta y valoración', category: 'DIAGNÓSTICO', price: 15, duration: 30 },
  { code: 'LIMPIEZA', name: 'Limpieza dental (profilaxis)', category: 'PREVENTIVO', price: 30, duration: 45 },
  { code: 'ORTHO_INIT', name: 'Ortodoncia - instalación de brackets', category: 'ORTODONCIA', price: 350, duration: 90 },
  { code: 'ORTHO_CTRL', name: 'Ortodoncia - control mensual', category: 'ORTODONCIA', price: 25, duration: 30 },
  { code: 'RESINA', name: 'Resina dental (obturación)', category: 'OPERATORIA', price: 35, duration: 45 },
  { code: 'ENDO_UNI', name: 'Endodoncia unirradicular', category: 'ENDODONCIA', price: 80, duration: 90 },
  { code: 'ENDO_MULTI', name: 'Endodoncia multirradicular', category: 'ENDODONCIA', price: 120, duration: 120 },
  { code: 'EXODONCIA', name: 'Exodoncia simple', category: 'CIRUGÍA', price: 30, duration: 45 },
  { code: 'CORDAL', name: 'Extracción de cordal incluido', category: 'CIRUGÍA', price: 90, duration: 90 },
  { code: 'BLANQUEAM', name: 'Blanqueamiento dental', category: 'ESTÉTICA', price: 120, duration: 60 },
  { code: 'IMPLANTE', name: 'Implante dental unitario', category: 'IMPLANTOLOGÍA', price: 600, duration: 120 },
  { code: 'CORONA', name: 'Corona en zirconio', category: 'REHABILITACIÓN', price: 250, duration: 90 },
];

export const MOCK_TREATMENTS: Treatment[] = TREATMENT_SEED.map((seed, index) => ({
  id: mockId('trmt', index + 1),
  name: seed.name,
  code: seed.code,
  description: null,
  // El conducto se cotiza «desde»: depende de cuántos conductos tenga la pieza,
  // y eso no se sabe hasta ver la radiografía.
  isPriceVariable: seed.code.startsWith('ENDO'),
  // La radiografía la hace el equipo de la clínica, no el odontólogo: no hay
  // reparto que hacer.
  clinicKeepsAll: seed.code === 'RX',
  category: seed.category,
  basePriceCents: seed.price * 100, // dólares → centavos de USD
  durationMinutes: seed.duration,
  bufferMinutes: seed.duration >= 90 ? 15 : 10,
  isActive: true,
}));

// ===========================================================================
//  USUARIOS DEL PANEL
// ===========================================================================

/**
 * ⚠️  El hash corresponde a la contraseña de desarrollo `SuperAdmin2026!`.
 *  Existe únicamente para poder entrar en local. `prisma/seed.ts` se niega a
 *  ejecutarse con NODE_ENV=production precisamente para que esto nunca llegue
 *  a un entorno real.
 */
export const MOCK_DEV_PASSWORD = 'SuperAdmin2026!';

/**
 * Contraseña por usuario, para poder probar la separación de roles de verdad.
 *
 * Si todos compartieran clave sería imposible comprobar que un asistente NO
 * ve las finanzas — que es justo lo que hay que verificar.
 *
 * Todas cumplen la política (mínimo 12 caracteres, ver `PASSWORD_POLICY`).
 */
export const MOCK_CREDENTIALS: Record<string, string> = {
  'admin@dentalcoworking.com.ve': MOCK_DEV_PASSWORD,
  'recepcion@dentalcoworking.com.ve': 'Asistente2026!',
  'gabriela.ferreira@dentalcoworking.com.ve': 'Odontologa2026!',
};

export const MOCK_USERS: User[] = [
  {
    id: mockId('user', 1),
    email: 'admin@dentalcoworking.com.ve',
    fullName: 'Gleybert Martínez',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    lastLoginAt: addMinutes(MOCK_NOW, -35),
    createdAt: addDays(MOCK_NOW, -420),
    deletedAt: null,
  },
  {
    id: mockId('user', 2),
    email: 'recepcion@dentalcoworking.com.ve',
    fullName: 'Paula Gómez',
    // Con teléfono: así el bot la reconoce como personal y no como paciente.
    phoneE164: '+584241112233',
    role: 'ASSISTANT',
    status: 'ACTIVE',
    lastLoginAt: addMinutes(MOCK_NOW, -120),
    createdAt: addDays(MOCK_NOW, -300),
    deletedAt: null,
  },
  {
    id: mockId('user', 3),
    email: 'gabriela.ferreira@dentalcoworking.com.ve',
    fullName: 'Dra. Gabriela Ferreira',
    role: 'DENTIST',
    status: 'ACTIVE',
    lastLoginAt: addDays(MOCK_NOW, -2),
    createdAt: addDays(MOCK_NOW, -390),
    deletedAt: null,
  },
];

// ===========================================================================
//  PACIENTES
// ===========================================================================

const PATIENT_NAMES = [
  'Juan Pablo Marcano', 'María Fernanda Istúriz', 'Carlos Andrés Villasmil',
  'Ana Sofía Nucete', 'Diego Alejandro Sanoja', 'Luisa Fernanda Berríos',
  'Ricardo Peñaloza', 'Catalina Escalante', 'Miguel Ángel Duque', 'Sara Valentina Ríos',
  'Jorge Iván Salazar', 'Natalia Andrea Colmenares', 'Óscar Mauricio Vielma',
  'Paola Andrea Mujica', 'Esteban Cárdenas', 'Juliana Marcela Ospino',
  'Fernando Aristimuño', 'Carolina Bethencourt', 'Alejandro Franco', 'Manuela Toro',
  'Héctor Villegas', 'Adriana Lucía Pacheco', 'Camilo Rangel Díaz',
  'Verónica Agudelo', 'Nicolás Mesa', 'Daniela Sánchez Loaiza',
  'Mateo Giraldo', 'Sofía Alejandra Pérez', 'Andrés Felipe Landaeta', 'Laura Ximena Cañas',
];

export const MOCK_PATIENTS: Patient[] = PATIENT_NAMES.map((name, index) => ({
  id: mockId('pat', index + 1),
  fullName: name,
  // Teléfonos únicos y válidos en E.164 colombiano.
  phoneE164: `+584${String(141_000_000 + index * 1_234_567).slice(0, 9)}`,
  email: index % 3 === 0 ? `${name.split(' ')[0]!.toLowerCase()}${index}@correo.com` : null,
  documentId: `V-${12_000_000 + index * 987_65}`,
  birthDate: addDays(MOCK_NOW, -(randomInt(18, 65) * 365)),
  notes: index % 7 === 0 ? 'Alergia a la penicilina. Verificar antes de medicar.' : null,
  marketingConsent: index % 4 !== 0,
  createdAt: addDays(MOCK_NOW, -randomInt(1, 500)),
  deletedAt: null,
}));

// ===========================================================================
//  CITAS Y PAGOS — generados juntos para que la contabilidad cuadre
// ===========================================================================

/**
 * Genera 90 días de historial (60 pasados + 30 futuros).
 *
 * La distribución de estados imita la realidad de una clínica: la mayoría se
 * completa, ~8% se cancela y ~5% son no-show. Esos números hacen que los
 * indicadores del dashboard se vean plausibles en lugar de perfectos.
 */
function generateAppointmentsAndPayments(): {
  appointments: Appointment[];
  payments: Payment[];
} {
  const appointments: Appointment[] = [];
  const payments: Payment[] = [];

  const activeDentists = MOCK_DENTISTS.filter((d) => d.isActive);
  const paymentMethods: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'INSURANCE'];

  let appointmentIndex = 0;
  let paymentIndex = 0;

  for (let dayOffset = -60; dayOffset <= 30; dayOffset += 1) {
    const day = addDays(MOCK_NOW, dayOffset);

    // Sin actividad los domingos (0). Los sábados, media jornada.
    const weekday = day.getUTCDay();
    if (weekday === 0) continue;

    const appointmentsToday = weekday === 6 ? randomInt(3, 6) : randomInt(8, 16);

    for (let slot = 0; slot < appointmentsToday; slot += 1) {
      appointmentIndex += 1;

      const dentist = pick(activeDentists);
      const room = pick(MOCK_ROOMS);
      const treatment = pick(MOCK_TREATMENTS);
      const patient = pick(MOCK_PATIENTS);

      // Jornada 08:00–18:00 EN HORA DE LA CLÍNICA, en bloques de 30 min.
      //
      // El matiz de "en hora de la clínica" no es cosmético: construir el
      // instante con `Date.UTC(..., 8, 0)` genera las 08:00 UTC, que en
      // Caracas son las 04:00 de la madrugada. La agenda se llenaba de citas
      // antes de que la clínica abriera.
      const startMinuteOfDay = 8 * 60 + slot * 30;
      const startsAt = clinicWallClockToInstant(clinicDayKey(day), startMinuteOfDay);
      const endsAt = addMinutes(startsAt, treatment.durationMinutes);

      const isPast = startsAt < MOCK_NOW;

      // --- Estado según sea pasado o futuro -----------------------------
      let status: AppointmentStatus;
      if (isPast) {
        const roll = random();
        if (roll < 0.87) status = 'COMPLETED';
        else if (roll < 0.95) status = 'CANCELLED';
        else status = 'NO_SHOW';
      } else {
        status = random() < 0.7 ? 'CONFIRMED' : 'PENDING';
      }

      // ~68% de las citas las agenda la IA: el dato que justifica el proyecto.
      const sourceRoll = random();
      const source: AppointmentSource =
        sourceRoll < 0.68 ? 'WHATSAPP_AI'
        : sourceRoll < 0.85 ? 'ADMIN_PANEL'
        : sourceRoll < 0.95 ? 'PHONE_CALL'
        : 'WALK_IN';

      const appointment: Appointment = {
        id: mockId('appt', appointmentIndex),
        patientId: patient.id,
        dentistId: dentist.id,
        roomId: room.id,
        treatmentId: treatment.id,
        startsAt,
        endsAt,
        status,
        source,
        agreedPriceCents: treatment.basePriceCents,
        notes: null,
        idempotencyKey: `mock-${appointmentIndex}`,
        createdAt: addDays(startsAt, -randomInt(1, 14)),
      };
      appointments.push(appointment);

      // --- Pago: sólo para citas completadas -----------------------------
      // Una cita cancelada no genera ingreso. Respetarlo es lo que hace que
      // los totales del dashboard sean auditables.
      if (status === 'COMPLETED') {
        paymentIndex += 1;

        // El reparto usa la MISMA función que producción → los totales cuadran.
        const split = splitCents(
          appointment.agreedPriceCents,
          dentist.clinicCommissionPercent,
        );

        // Las liquidaciones se hacen quincenalmente: lo de hace más de 15
        // días ya está pagado; lo reciente sigue como deuda viva.
        const isSettled = dayOffset < -15;

        // Tasa vigente EL DÍA DEL COBRO, no la de hoy. Es exactamente el
        // motivo por el que `Payment` guarda su propia tasa.
        const rate = rateForDay(dayOffset);

        payments.push({
          id: mockId('pay', paymentIndex),
          appointmentId: appointment.id,
          amountCents: split.totalCents,
          exchangeRate: rate,
          amountBs: Math.round((split.totalCents / 100) * rate * 100) / 100,
          exchangeRateSource: 'BCV',
          commissionPercentApplied: split.clinicPercent,
          clinicShareCents: split.clinicShareCents,
          dentistShareCents: split.dentistShareCents,
          method: pick(paymentMethods),
          status: 'PAID',
          paidAt: endsAt,
          payoutId: isSettled ? `cpout-${dentist.id}` : null,
        });
      }
    }
  }

  return { appointments, payments };
}

const generated = generateAppointmentsAndPayments();
export const MOCK_APPOINTMENTS = generated.appointments;
export const MOCK_PAYMENTS = generated.payments;

// ===========================================================================
//  CONVERSACIONES DE WHATSAPP
// ===========================================================================

/** Guiones realistas: la IA agendando, escalando y siendo apagada. */
const CONVERSATION_SCRIPTS: Array<{
  patientIndex: number;
  aiEnabled: boolean;
  needsHuman: boolean;
  disabledReason?: string;
  minutesAgo: number;
  messages: Array<{ author: 'PATIENT' | 'AI_BOT' | 'HUMAN_AGENT' | 'SYSTEM'; body: string }>;
}> = [
  {
    patientIndex: 0,
    aiEnabled: true,
    needsHuman: false,
    minutesAgo: 3,
    messages: [
      { author: 'PATIENT', body: 'Buenas tardes, quiero agendar una limpieza dental' },
      { author: 'AI_BOT', body: '¡Hola! Con gusto te ayudo 😊 Tengo disponibilidad para limpieza dental. ¿Prefieres esta semana o la próxima?' },
      { author: 'PATIENT', body: 'Esta semana si se puede, en la tarde' },
      { author: 'AI_BOT', body: 'Perfecto. Tengo estos horarios disponibles:\n\n• Jueves 14 - 2:00 PM\n• Jueves 14 - 4:30 PM\n• Viernes 15 - 3:00 PM\n\n¿Cuál te sirve?' },
      { author: 'PATIENT', body: 'El jueves a las 2 está bien' },
      { author: 'AI_BOT', body: '¡Listo! Tu cita quedó agendada:\n\n📅 Jueves 14 de agosto, 2:00 PM\n🦷 Limpieza dental (profilaxis)\n👩‍⚕️ Dra. Laura Mejía\n📍 Consultorio 2\n\nTe enviaré un recordatorio un día antes. ¡Nos vemos!' },
    ],
  },
  {
    patientIndex: 1,
    aiEnabled: false,
    needsHuman: true,
    disabledReason: 'Caso clínico complejo: requiere valoración de un profesional',
    minutesAgo: 12,
    messages: [
      { author: 'PATIENT', body: 'Hola, tengo un dolor muy fuerte en una muela desde anoche' },
      { author: 'AI_BOT', body: 'Lamento que estés con dolor. ¿Podrías contarme si el dolor es constante o aparece al masticar?' },
      { author: 'PATIENT', body: 'Es constante y se me hinchó la cara de ese lado' },
      { author: 'AI_BOT', body: 'Entiendo. La inflamación facial requiere valoración prioritaria. Voy a comunicarte con nuestro equipo ahora mismo.' },
      { author: 'SYSTEM', body: '⚠️ IA desactivada automáticamente — posible urgencia odontológica' },
      { author: 'HUMAN_AGENT', body: 'Buenas tardes, le habla Paula de Dental Coworking. Vamos a darle prioridad. ¿Puede venir hoy a las 5:00 PM? El Dr. Julián Betancur lo atendería de urgencia.' },
      { author: 'PATIENT', body: 'Sí, allá estaré. Muchas gracias' },
    ],
  },
  {
    patientIndex: 2,
    aiEnabled: true,
    needsHuman: false,
    minutesAgo: 47,
    messages: [
      { author: 'PATIENT', body: 'Cuánto cuesta la ortodoncia?' },
      { author: 'AI_BOT', body: 'La instalación de brackets tiene un valor de $2.800.000 e incluye la valoración inicial. Los controles mensuales son $150.000.\n\n¿Te gustaría agendar una valoración para conocer tu caso? La consulta cuesta $60.000 y se descuenta del tratamiento si decides continuar.' },
      { author: 'PATIENT', body: 'Sí, me interesa. Qué días tienen?' },
    ],
  },
  {
    patientIndex: 3,
    aiEnabled: true,
    needsHuman: false,
    minutesAgo: 95,
    messages: [
      { author: 'SYSTEM', body: 'Recordatorio automático enviado' },
      { author: 'AI_BOT', body: 'Hola Ana Sofía 👋 Te recordamos tu cita de mañana:\n\n📅 Martes 11 de agosto, 9:00 AM\n🦷 Ortodoncia - control mensual\n👩‍⚕️ Dra. Camila Restrepo\n\nResponde CONFIRMAR o CANCELAR.' },
      { author: 'PATIENT', body: 'CONFIRMAR' },
      { author: 'AI_BOT', body: '¡Gracias! Tu cita quedó confirmada. Te esperamos 😊' },
    ],
  },
  {
    patientIndex: 4,
    aiEnabled: false,
    needsHuman: false,
    disabledReason: 'Paciente pidió expresamente hablar con una persona',
    minutesAgo: 180,
    messages: [
      { author: 'PATIENT', body: 'Necesito hablar con una persona real, no con un bot' },
      { author: 'SYSTEM', body: 'IA desactivada por solicitud del paciente' },
      { author: 'HUMAN_AGENT', body: 'Buenas tardes, con mucho gusto le atiendo. Soy Paula, de recepción. ¿En qué le puedo ayudar?' },
      { author: 'PATIENT', body: 'Quiero reclamar por el cobro de mi última cita' },
    ],
  },
  {
    patientIndex: 5,
    aiEnabled: true,
    needsHuman: false,
    minutesAgo: 320,
    messages: [
      { author: 'PATIENT', body: 'Buenas, necesito cancelar mi cita del viernes' },
      { author: 'AI_BOT', body: 'Claro, encontré tu cita del viernes 15 a las 10:00 AM con el Dr. Santiago Hoyos. ¿Deseas cancelarla o prefieres reprogramarla?' },
      { author: 'PATIENT', body: 'Reprogramar para la otra semana' },
      { author: 'AI_BOT', body: 'Tengo estos espacios la próxima semana:\n\n• Lunes 18 - 10:00 AM\n• Miércoles 20 - 11:30 AM\n• Jueves 21 - 9:00 AM\n\n¿Cuál prefieres?' },
    ],
  },
  {
    patientIndex: 6,
    aiEnabled: true,
    needsHuman: true,
    minutesAgo: 400,
    messages: [
      { author: 'PATIENT', body: 'Ustedes trabajan con Sura? Tengo póliza' },
      { author: 'AI_BOT', body: 'Déjame verificar esa información con el equipo administrativo y te confirmo en un momento.' },
      { author: 'SYSTEM', body: '⚠️ La IA no pudo resolver la consulta — escalado a un humano' },
    ],
  },
  {
    patientIndex: 7,
    aiEnabled: true,
    needsHuman: false,
    minutesAgo: 1440,
    messages: [
      { author: 'PATIENT', body: 'Gracias por la atención de ayer, quedé muy contenta' },
      { author: 'AI_BOT', body: '¡Nos alegra muchísimo saberlo! 🦷✨ Gracias por confiar en Dental Coworking. Recuerda que tu próximo control es en 6 meses, te escribiremos para agendarlo.' },
    ],
  },
];

function generateConversations(): {
  conversations: WhatsAppConversation[];
  messages: WhatsAppMessage[];
} {
  const conversations: WhatsAppConversation[] = [];
  const messages: WhatsAppMessage[] = [];

  let messageIndex = 0;

  CONVERSATION_SCRIPTS.forEach((script, index) => {
    const patient = MOCK_PATIENTS[script.patientIndex]!;
    const conversationId = mockId('conv', index + 1);
    const lastMessageAt = addMinutes(MOCK_NOW, -script.minutesAgo);

    // Los mensajes se distribuyen hacia atrás desde el último, 2 min entre sí.
    script.messages.forEach((message, messageOrder) => {
      messageIndex += 1;
      const minutesBefore = (script.messages.length - 1 - messageOrder) * 2;

      messages.push({
        id: mockId('msg', messageIndex),
        conversationId,
        direction: message.author === 'PATIENT' ? 'INBOUND' : 'OUTBOUND',
        author: message.author,
        body: message.body,
        mediaUrl: null,
        sentAt: addMinutes(lastMessageAt, -minutesBefore),
      });
    });

    conversations.push({
      id: conversationId,
      phoneE164: patient.phoneE164,
      patientId: patient.id,
      displayName: patient.fullName,
      aiEnabled: script.aiEnabled,
      aiToggledByUserId: script.aiEnabled ? null : MOCK_USERS[0]!.id,
      aiToggledAt: script.aiEnabled ? null : addMinutes(lastMessageAt, -10),
      aiDisabledReason: script.disabledReason ?? null,
      unreadCount: script.needsHuman ? randomInt(1, 3) : 0,
      needsHumanAttention: script.needsHuman,
      lastMessageAt,
    });
  });

  return { conversations, messages };
}

const conversationData = generateConversations();
export const MOCK_CONVERSATIONS = conversationData.conversations;
export const MOCK_MESSAGES = conversationData.messages;
