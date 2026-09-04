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
  /** Sólo día y mes se usan: es para felicitar, no para calcular nada. */
  birthDate: Date | null;
  isActive: boolean;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface Room {
  id: string;
  name: string;
  code: string;
  equipment: string[];
  /**
   * Odontólogo dueño del consultorio, o `null` si es rotativo.
   *
   * Algunos consultorios son fijos de una persona; otros se reparten según la
   * especialidad del día.
   */
  assignedDentistId: string | null;
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
  /**
   * El precio de lista es sólo una referencia y se pacta en consulta.
   *
   * El tratamiento de conducto cuesta distinto según cuántos conductos tenga
   * la pieza, y eso no se sabe hasta ver la radiografía.
   */
  isPriceVariable: boolean;
  /**
   * La clínica se queda con el 100 %: el odontólogo no cobra comisión.
   *
   * Es el caso de la radiografía, que la hace el equipo de la clínica.
   */
  clinicKeepsAll: boolean;
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
  /**
   * Cuándo vuelve el bot solo. `null` = no vuelve hasta que lo encienda
   * alguien, porque lo apagó una persona a propósito.
   */
  aiAutoResumeAt: Date | null;
  unreadCount: number;
  needsHumanAttention: boolean;
  lastMessageAt: Date | null;
  /** Fuera de la lista principal, pero conservada entera. */
  archivedAt?: Date | null;
  /** Borrado lógico: la fila nunca se elimina. */
  deletedAt?: Date | null;
}

export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface WhatsAppMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  author: MessageAuthor;
  body: string;
  mediaUrl: string | null;
  /** MIME del adjunto: decide si se pinta como foto, audio o enlace. */
  mediaType: string | null;
  /**
   * Id del archivo guardado en el panel, cuando lo envió la clínica.
   *
   * Los que ENTRAN traen `mediaUrl` (una URL de WhatsApp); los que SALEN
   * traen esto, y se piden a `/api/whatsapp/adjuntos/:id` con la sesión.
   */
  attachmentId: string | null;
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

export type InvoiceStatus = 'OPEN' | 'PAID' | 'VOID';

/** Una línea de la factura. Precio y descripción congelados al añadirla. */
export interface InvoiceLine {
  id: string;
  treatmentId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  /** Rebaja de ESTA línea, marcada a mano por recepción. */
  discountCents: number;
  discountReason: string | null;
  commissionPercent: number;
  /** `quantity * unitPrice - discount`. Lo que suma esta línea al total. */
  totalCents: number;
}

/** Un cobro concreto contra la factura. Puede haber varios. */
export interface InvoicePayment {
  id: string;
  amountCents: number;
  amountBs: number;
  exchangeRate: number;
  method: PaymentMethod;
  methodLabel: string | null;
  paidAt: Date;
}

/**
 * Factura interna de la clínica. NO es fiscal.
 *
 * Es el comprobante que se le entrega al paciente y el documento que recepción
 * edita cuando en la consulta se hace algo más de lo previsto.
 */
export interface Invoice {
  id: string;
  number: number;
  patientId: string;
  patientName: string;
  dentistId: string | null;
  dentistName: string | null;
  appointmentId: string | null;
  status: InvoiceStatus;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  clinicShareCents: number;
  dentistShareCents: number;
  /** Suma de lo cobrado hasta ahora. */
  paidCents: number;
  /** `total - paid`. Lo que falta por cobrar. */
  balanceCents: number;
  notes: string | null;
  issuedAt: Date;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
}

export type PatientDocumentKind = 'EXPEDIENTE' | 'CONSENTIMIENTO' | 'RADIOGRAFIA' | 'OTRO';

/**
 * Un papel escaneado y anexado a la ficha del paciente.
 *
 * El expediente lo rellena EL PACIENTE a mano y el consentimiento lo firma;
 * recepción sólo escanea y anexa. No se transcribe nada — el original es el
 * papel firmado.
 *
 * ⚠️  NO lleva `content`. El binario sólo viaja por la ruta que lo sirve, y
 *  meterlo en este tipo lo arrastraría a cada listado: un paciente con diez
 *  escaneos mandaría varios MB al navegador sólo por abrir su ficha.
 */
export interface PatientDocument {
  id: string;
  patientId: string;
  kind: PatientDocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  notes: string | null;
  createdAt: Date;
}

/** Estado de todo lo que necesita el visto bueno de otra persona. */
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type InstrumentCondition = 'GOOD' | 'NEEDS_SERVICE' | 'OUT_OF_SERVICE' | 'LOST';

/**
 * Una pieza del instrumental de un odontólogo.
 *
 * Es SUYO: el fórceps, la turbina, la cureta que trajo él y que se lleva si se
 * va. No es un almacén de insumos que se descuenta al usarlos — aquí no hay
 * consumo, hay una lista de bienes con dueño.
 */
export interface DentistInstrument {
  id: string;
  dentistId: string;
  name: string;
  category: string | null;
  quantity: number;
  serialNumber: string | null;
  condition: InstrumentCondition;
  location: string | null;
  notes: string | null;
  lastServicedOn: Date | null;
}

/** Un bloque del horario semanal: `weekday` 0=domingo … 6=sábado. */
export interface ScheduleBlock {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/**
 * Solicitud de cambio de horario. La pide el odontólogo, la aprueba
 * recepción o administración.
 *
 * `proposedBlocks` es la semana ENTERA propuesta, no un delta: se aprueba o
 * se rechaza completa. Una aprobación parcial dejaría al odontólogo con un
 * horario que él nunca propuso.
 */
export interface ScheduleChangeRequest {
  id: string;
  dentistId: string;
  dentistName: string;
  /**
   * Lunes de la SEMANA a la que aplica, 'YYYY-MM-DD'.
   *
   * El cambio es de esa semana y sólo de esa: pasada, se vuelve solo al
   * horario base sin que nadie tenga que deshacer nada.
   */
  weekStart: string;
  proposedBlocks: ScheduleBlock[];
  /** El horario que regiría esa semana sin este cambio, para comparar. */
  currentBlocks: ScheduleBlock[];
  reason: string | null;
  status: ApprovalStatus;
  reviewNotes: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/**
 * Precio y reparto pactados entre UN odontólogo y UN tratamiento.
 *
 * Lo propone el odontólogo y lo aprueba el administrador. Mientras esté en
 * `PENDING` no se aplica: se sigue cobrando el precio de lista. Aplicarlo
 * antes del visto bueno significaría que cualquiera con cuenta de odontólogo
 * puede cambiar lo que se le cobra a los pacientes.
 *
 * Los nombres vienen aplanados porque este tipo es el contrato con la
 * pantalla de tarifas, no un reflejo de las tablas.
 */
export interface DentistTreatmentAgreement {
  id: string;
  dentistId: string;
  dentistName: string;
  treatmentId: string;
  treatmentName: string;
  /** Precio de lista, para poder comparar con lo pactado. */
  treatmentBasePriceCents: number;
  /** `null` = se cobra el precio de lista. */
  customPriceCents: number | null;
  /** `null` = se aplica la comisión general del odontólogo. */
  customCommissionPercent: number | null;
  status: ApprovalStatus;
  /** Por qué se rechazó. Sin esto, se vuelve a proponer lo mismo. */
  reviewNotes: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/**
 * Procedimiento añadido a una cita YA agendada.
 *
 * Viene a una limpieza, el odontólogo ve una caries y la obtura en la misma
 * sesión: se agendó por una cosa y se cobra por dos.
 *
 * `priceCents` y `commissionPercent` se congelan al añadirlo. El porcentaje
 * se copia y no se lee del tratamiento al cobrar porque son dos momentos
 * distintos: si mañana la radiografía pasa a repartirse, los cobros de hoy
 * no deben cambiar de reparto retroactivamente.
 */
export interface AppointmentAddon {
  id: string;
  appointmentId: string;
  treatmentId: string;
  treatmentName: string;
  priceCents: number;
  commissionPercent: number;
  notes: string | null;
  createdAt: Date;
}

/** Cita con sus relaciones resueltas, para pintar tablas sin N+1 en el cliente. */
export interface AppointmentWithRelations extends Appointment {
  patient: Pick<Patient, 'id' | 'fullName' | 'phoneE164'>;
  dentist: Pick<Dentist, 'id' | 'fullName'>;
  room: Pick<Room, 'id' | 'name' | 'code'>;
  treatment: Pick<Treatment, 'id' | 'name' | 'durationMinutes'>;
  /**
   * Procedimientos añadidos durante la consulta.
   *
   * Va en la vista de recepción porque cambia lo que se cobra: el modal de
   * cobro tiene que enseñar el total real, no sólo el precio de la cita.
   */
  addons: AppointmentAddon[];
}

/**
 * Cita tal y como la ve SU odontólogo.
 *
 * Es deliberadamente más pobre que `AppointmentWithRelations`: no lleva
 * `agreedPriceCents`, NI EL TELÉFONO DEL PACIENTE, ni los ids de las
 * relaciones.
 *
 * El teléfono es dato de contacto de la clínica, no del odontólogo: quien
 * llama al paciente para confirmar o reprogramar es recepción. Igual que con
 * el precio, no se oculta en la pantalla — no se selecciona en la consulta,
 * así que no llega al navegador y no hay nada que filtrar por descuido. El odontólogo cobra por
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
/**
 * Plantilla de respuesta rápida.
 *
 * El `body` conserva los marcadores `[Precio]`, `[Hora]` sin rellenar: son el
 * recordatorio visible de lo que hay que sustituir antes de enviar.
 */
export interface MessageTemplate {
  id: string;
  category: string;
  title: string;
  body: string;
  sortOrder: number;
  usageCount: number;
  isActive: boolean;
}

export interface ConversationListItem extends WhatsAppConversation {
  patientName: string | null;
  lastMessagePreview: string | null;
  lastMessageAuthor: MessageAuthor | null;
}

/**
 * Lo mínimo para listar recetarios: sin `elements`, que puede ser grande.
 *
 * La lista de una odontóloga con seis recetarios traería seis hojas enteras
 * de JSON para pintar seis nombres. Los elementos sólo se cargan al abrir uno.
 */
export interface PrescriptionTemplateSummary {
  id: string;
  dentistId: string | null;
  dentistName: string | null;
  name: string;
  widthPx: number;
  heightPx: number;
  /** Cuántos elementos tiene, para poder decir «vacío» sin cargarlos. */
  elementCount: number;
  updatedAt: Date;
}

export interface PrescriptionTemplateFull extends PrescriptionTemplateSummary {
  /** Sin tipar aquí a propósito: lo valida `prescriptionElementsSchema`. */
  elements: unknown;
}

export type PromotionBenefit = 'FREE_TREATMENT' | 'PERCENT_OFF' | 'AMOUNT_OFF';

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  /** Qué hay que hacerse para que aplique. Vacío = siempre. */
  requiredTreatmentCodes: string[];
  benefitKind: PromotionBenefit;
  benefitTreatmentCode: string | null;
  /** Porcentaje (1-100) o centavos, según `benefitKind`. */
  benefitValue: number;
  botPitch: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

/** Una cuenta del panel, tal como la ve el administrador. */
export interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED';
  phoneE164: string | null;
  birthDate: Date | null;
  /** Si aún no ha cambiado la clave temporal que se le envió. */
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  /** Ficha de odontólogo enlazada, si la tiene. */
  dentistId: string | null;
  dentistName: string | null;
  createdAt: Date;
}
