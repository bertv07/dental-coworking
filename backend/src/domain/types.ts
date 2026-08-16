/**
 * ===========================================================================
 *  Tipos del dominio
 * ===========================================================================
 *  Estos tipos son el CONTRATO entre backend y frontend.
 *
 *  Se declaran a mano en vez de reexportar los de `@prisma/client` por una
 *  razón concreta: permiten que la UI compile y funcione con datos mock, sin
 *  Postgres ni `prisma generate`. Cuando se pasa a la DB real, los tipos
 *  generados por Prisma encajan estructuralmente con estos.
 *
 *  Sin `server-only`: la UI necesita estos tipos. Son sólo formas, no datos.
 * ===========================================================================
 */

export type UserRole = 'SUPER_ADMIN' | 'ASSISTANT' | 'DENTIST';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

export type AppointmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type AppointmentSource = 'WHATSAPP_AI' | 'ADMIN_PANEL' | 'PHONE_CALL' | 'WALK_IN';
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'INSURANCE';
export type PaymentStatus = 'PENDING' | 'PAID' | 'REFUNDED' | 'FAILED';
export type PayoutStatus = 'ACCRUED' | 'PAID' | 'ON_HOLD';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageAuthor = 'PATIENT' | 'AI_BOT' | 'HUMAN_AGENT' | 'SYSTEM';

// --- Entidades --------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /**
   * WhatsApp del personal, en E.164. Opcional.
   *
   * Es lo que permite al bot distinguir a la asistente de un paciente cuando
   * ambos escriben al mismo número de la clínica.
   */
  phoneE164?: string | null;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

/**
 * `User` con los campos sensibles necesarios SÓLO para el flujo de login.
 * Tipo aparte, deliberadamente: hace evidente en la firma de cada función si
 * está manejando material sensible, y evita que un `passwordHash` se cuele
 * en una respuesta por descuido.
 */
export interface UserWithSecrets extends User {
  passwordHash: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  sessionsValidFrom: Date;
}

export interface Dentist {
  id: string;
  userId: string | null;
  fullName: string;
  licenseNumber: string;
  email: string;
  phone: string;
  photoUrl: string | null;
  specialties: string[];
  /** Porcentaje que retiene la clínica (0-100). El resto va al odontólogo. */
  clinicCommissionPercent: number;
  isActive: boolean;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface Room {
  id: string;
  name: string;
  code: string;
  equipment: string[];
  isActive: boolean;
  notes: string | null;
}

export interface Patient {
  id: string;
  fullName: string;
  /** E.164, ej: "+573001234567". Llave natural del bot de WhatsApp. */
  phoneE164: string;
  email: string | null;
  documentId: string | null;
  birthDate: Date | null;
  notes: string | null;
  marketingConsent: boolean;
  createdAt: Date;
  deletedAt: Date | null;
}

/**
 * Una forma concreta en la que la clínica acepta dinero.
 *
 * Distinta del enum `PaymentMethod`, que es contable y sólo tiene cuatro
 * valores: aquí caben "Pago móvil Banesco" y "Pago móvil Mercantil" como dos
 * entradas separadas, porque para el paciente son dos instrucciones distintas
 * aunque para la caja sean lo mismo.
 */
export interface PaymentMethodOption {
  id: string;
  label: string;
  /** Categoría contable a la que pertenece. */
  kind: PaymentMethod;
  /** Datos que se le dictan al paciente: banco, teléfono, correo, cédula. */
  instructions: string | null;
  currency: 'VES' | 'USD';
  sortOrder: number;
  isActive: boolean;
}

export interface Treatment {
  id: string;
  name: string;
  code: string;
  description: string | null;
  category: string;
  /** Precio de lista en CENTAVOS. */
  basePriceCents: number;
  durationMinutes: number;
  bufferMinutes: number;
  isActive: boolean;
}

export interface Appointment {
  id: string;
  patientId: string;
  dentistId: string;
  roomId: string;
  treatmentId: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  source: AppointmentSource;
  /** Precio congelado al agendar, en CENTAVOS. */
  agreedPriceCents: number;
  notes: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface Payment {
  id: string;
  appointmentId: string;
  /** Total cobrado, en centavos de DÓLAR. */
  amountCents: number;
  /** Tasa Bs/USD congelada en el momento del cobro. */
  exchangeRate: number;
  /** Equivalente en bolívares al cobrar. Es el importe que entró en caja. */
  amountBs: number;
  exchangeRateSource: string;
  commissionPercentApplied: number;
  clinicShareCents: number;
  dentistShareCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: Date | null;
  payoutId: string | null;
}

export interface WhatsAppConversation {
  id: string;
  phoneE164: string;
  patientId: string | null;
  displayName: string | null;
  /** EL TOGGLE. `false` = la IA se calla y responde un humano. */
  aiEnabled: boolean;
  aiToggledByUserId: string | null;
  aiToggledAt: Date | null;
  aiDisabledReason: string | null;
  unreadCount: number;
  needsHumanAttention: boolean;
  lastMessageAt: Date | null;
}

export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface WhatsAppMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  author: MessageAuthor;
  body: string;
  mediaUrl: string | null;
  sentAt: Date;
  /** Sólo relevante en OUTBOUND: si el proveedor llegó a entregarlo. */
  deliveryStatus?: DeliveryStatus;
  deliveryError?: string | null;
  /**
   * Id del mensaje en la API de WhatsApp.
   *
   * Sirve para deduplicar: Meta reintenta sus webhooks con agresividad y n8n
   * también reintenta, así que el mismo mensaje puede llegar varias veces.
   */
  externalMessageId?: string | null;
}

// --- Vistas compuestas (lo que consume la UI) ------------------------------

/** Cita con sus relaciones resueltas, para pintar tablas sin N+1 en el cliente. */
export interface AppointmentWithRelations extends Appointment {
  patient: Pick<Patient, 'id' | 'fullName' | 'phoneE164'>;
  dentist: Pick<Dentist, 'id' | 'fullName'>;
  room: Pick<Room, 'id' | 'name' | 'code'>;
  treatment: Pick<Treatment, 'id' | 'name' | 'durationMinutes'>;
}

/**
 * Cita tal y como la ve SU odontólogo.
 *
 * Es deliberadamente más pobre que `AppointmentWithRelations`: no lleva
 * `agreedPriceCents` ni los ids de las relaciones. El odontólogo cobra por
 * liquidación mensual, no por cita, así que la tarifa no le aporta nada en la
 * agenda; y un tipo que no tiene el campo hace imposible enviarlo sin querer.
 *
 * Los nombres van aplanados (`patientName` y no `patient.fullName`) porque
 * este tipo es el contrato con una vista concreta, no un reflejo de la
 * estructura de la base.
 */
export interface DentistAgendaItem {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  source: AppointmentSource;
  notes: string | null;
  patientName: string;
  patientPhone: string;
  treatmentName: string;
  treatmentDurationMinutes: number;
  roomName: string;
  roomCode: string;
}

/** Fila del dashboard: cuánto produjo un odontólogo y cuánto se le debe. */
export interface DentistEarnings {
  dentistId: string;
  dentistName: string;
  commissionPercent: number;
  /** Total facturado por este odontólogo en el periodo, en CENTAVOS. */
  grossCents: number;
  /** Parte de la clínica (40%). */
  clinicShareCents: number;
  /** Parte del odontólogo (60%) — lo que la clínica le DEBE. */
  dentistShareCents: number;
  /** Ya liquidado y transferido. */
  paidOutCents: number;
  /** Pendiente de pago = dentistShare - paidOut. Es la deuda viva. */
  outstandingCents: number;
  appointmentCount: number;
}

/** Cifras de cabecera del dashboard financiero. */
export interface FinancialSummary {
  periodStart: Date;
  periodEnd: Date;
  /** Ingresos totales cobrados en el periodo, en CENTAVOS. */
  totalRevenueCents: number;
  /** Ganancia de la clínica (suma de los 40%). */
  clinicEarningsCents: number;
  /** Total devengado por los odontólogos (suma de los 60%). */
  dentistEarningsCents: number;
  /** Deuda viva total con los odontólogos. */
  outstandingPayoutsCents: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  /** Citas generadas por la IA — mide el retorno de la automatización. */
  aiBookedAppointments: number;
  /** Variación de ingresos vs. periodo anterior. `null` si no hay base. */
  revenueChangePercent: number | null;
}

/** Fila del monitor de WhatsApp. */
export interface ConversationListItem extends WhatsAppConversation {
  patientName: string | null;
  lastMessagePreview: string | null;
  lastMessageAuthor: MessageAuthor | null;
}
