import type {
  Appointment,
  AppointmentAddon,
  AppointmentWithRelations,
  ApprovalStatus,
  ConversationListItem,
  Dentist,
  DentistAgendaItem,
  DentistEarnings,
  DentistInstrument,
  DentistTreatmentAgreement,
  Invoice,
  InvoiceStatus,
  PatientDocument,
  PatientDocumentKind,
  ScheduleBlock,
  ScheduleChangeRequest,
  FinancialSummary,
  Patient,
  PaymentMethodOption,
  Room,
  Treatment,
  UserStatus,
  UserWithSecrets,
  WhatsAppMessage,
} from '@/backend/domain/types';

/**
 * ===========================================================================
 *  Contrato del repositorio
 * ===========================================================================
 *  Única interfaz que implementan tanto el repositorio mock como el de
 *  Prisma. Las capas superiores (servicios, rutas, Server Components) sólo
 *  conocen ESTE contrato, nunca Prisma directamente.
 *
 *  Qué compra esta indirección:
 *   · La UI funciona sin Postgres (`DATA_SOURCE=mock`).
 *   · Los servicios se testean sin base de datos.
 *   · Cambiar de ORM afectaría a un archivo, no a toda la app.
 *
 *  Qué NO se pretende: no es un patrón Repository dogmático con genéricos
 *  para todo. Son las consultas que el sistema realmente hace, nombradas por
 *  su intención de negocio.
 * ===========================================================================
 */

/** Rango temporal cerrado, usado en todos los informes. */
export interface DateRange {
  from: Date;
  to: Date;
}

/** Datos necesarios para crear una cita, ya validados y resueltos. */
export interface CreateAppointmentData {
  patientId: string;
  dentistId: string;
  roomId: string;
  treatmentId: string;
  startsAt: Date;
  endsAt: Date;
  agreedPriceCents: number;
  source: Appointment['source'];
  notes: string | null;
  idempotencyKey: string;
}

// --- Entradas de los CRUD del panel ---------------------------------------
//  Se declaran como tipos propios (y no `Partial<Patient>`) para que la firma
//  diga exactamente qué campos acepta cada operación. Un `Partial` dejaría
//  colar `id` o `createdAt` desde un formulario.

export interface PatientInput {
  fullName: string;
  phoneE164: string;
  email: string | null;
  documentId: string | null;
  birthDate: Date | null;
  notes: string | null;
  marketingConsent: boolean;
}

export interface DentistInput {
  fullName: string;
  licenseNumber: string;
  email: string;
  phone: string;
  specialties: string[];
  clinicCommissionPercent: number;
  isActive: boolean;
}

export interface TreatmentInput {
  name: string;
  code: string;
  category: string;
  basePriceCents: number;
  durationMinutes: number;
  bufferMinutes: number;
  isActive: boolean;
}

/** Alta o reprogramación de una cita desde el PANEL (no desde el bot). */
export interface AppointmentInput {
  patientId: string;
  dentistId: string;
  roomId: string;
  treatmentId: string;
  startsAt: Date;
  notes: string | null;
}

/** Alta o edición de un medio de pago desde el panel. */
export interface PaymentMethodInput {
  label: string;
  kind: 'CASH' | 'CARD' | 'TRANSFER' | 'INSURANCE';
  instructions: string | null;
  currency: 'VES' | 'USD';
  sortOrder: number;
  isActive: boolean;
}

export interface RoomInput {
  name: string;
  code: string;
  equipment: string[];
  /** Odontólogo fijo, o `null` si el consultorio es rotativo. */
  assignedDentistId: string | null;
  notes: string | null;
  isActive: boolean;
}

/** Cobro registrado desde el mostrador. */
export interface PaymentInput {
  appointmentId: string;
  /** Monto en centavos de USD. Puede diferir del pactado (descuento, abono). */
  amountCents: number;
  method: 'CASH' | 'CARD' | 'TRANSFER' | 'INSURANCE';
  /** Etiqueta del medio concreto ("Pago móvil Banesco"). Se congela en el cobro. */
  methodLabel: string | null;
  /**
   * Reparto pactado para ESTE cobro, si recepción lo ajustó (el 50/50).
   *
   * `null` = se aplican las reglas normales. Cuando viene, gana sobre todo lo
   * demás: es una decisión tomada con el caso delante, y queda en auditoría.
   */
  commissionOverride: number | null;
  externalReference: string | null;
}

/** Resumen de caja de un día. */
export interface DailyCash {
  date: Date;
  totalCents: number;
  totalBs: number;
  clinicShareCents: number;
  dentistShareCents: number;
  paymentCount: number;
  /** Desglose por medio de pago. */
  byMethod: Array<{ method: string; cents: number; bs: number; count: number }>;
  /** Cobros del día con su contexto. */
  payments: Array<{
    id: string;
    patientName: string;
    dentistName: string;
    treatmentName: string;
    amountCents: number;
    amountBs: number;
    exchangeRate: number;
    method: string;
    paidAt: Date;
  }>;
}

/**
 * Arqueo firmado de un día.
 *
 * Sólo se cuenta el EFECTIVO. Tarjeta y transferencia se concilian con el
 * banco, no con la gaveta: pedirle a recepción que "cuente" una transferencia
 * es pedirle que copie un número del sistema, y eso no verifica nada.
 */
export interface CashClosingInput {
  /** 'YYYY-MM-DD' en hora de la clínica. */
  businessDate: string;
  expectedCents: number;
  expectedBs: number;
  expectedCashBs: number;
  countedCashBs: number;
  paymentCount: number;
  notes: string | null;
}

export interface CashClosing extends CashClosingInput {
  id: string;
  closedByUserId: string;
  closedByName: string;
  closedAt: Date;
  /** contado − esperado. Positivo = sobra; negativo = falta. */
  differenceBs: number;
}

/** Ajustes de negocio editables desde el panel. */
export interface ClinicSettingsInput {
  clinicName: string;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  defaultCommissionPercent: number;
  openingMinute: number;
  closingMinute: number;
  slotMinutes: number;
  displayCurrency: string;
  preferredRateSource: string;
}

export interface ClinicSettings extends ClinicSettingsInput {
  id: string;
  updatedAt: Date;
}

/**
 * Lo que se le debe a un odontólogo por lo cobrado en un día.
 *
 * «Se paga al final del día»: al cerrar la caja, cada quien se lleva su parte
 * de lo que produjo esa jornada, en vez de esperar a una liquidación
 * quincenal.
 */
export interface DailySettlement {
  dentistId: string;
  dentistName: string;
  /** Cobros del día que todavía no se han liquidado. */
  paymentCount: number;
  /** Total facturado por este odontólogo hoy. */
  grossCents: number;
  /** Parte de la clínica. */
  clinicShareCents: number;
  /** Lo que hay que entregarle. */
  dentistShareCents: number;
  /** `true` si su parte del día ya se pagó. */
  isSettled: boolean;
  /** Lo ya liquidado hoy, para poder enseñarlo cuando `isSettled`. */
  settledCents: number;
}

/** Campos editables de una pieza de instrumental. */
export interface InstrumentInput {
  name: string;
  category: string | null;
  quantity: number;
  serialNumber: string | null;
  condition: 'GOOD' | 'NEEDS_SERVICE' | 'OUT_OF_SERVICE' | 'LOST';
  location: string | null;
  notes: string | null;
  lastServicedOn: Date | null;
}

/** Resultado de una escritura: permite distinguir el conflicto del fallo. */
export type WriteResult<T> =
  | { ok: true; data: T }
  /** Violación de unicidad: teléfono, código o licencia ya existente. */
  | { ok: false; reason: 'DUPLICATE'; field: string }
  | { ok: false; reason: 'NOT_FOUND' };

export interface DataRepository {
  // --- Autenticación -------------------------------------------------------
  findUserForLogin(email: string): Promise<UserWithSecrets | null>;
  /**
   * Registra el resultado de un intento de login: resetea o incrementa el
   * contador de fallos y aplica el bloqueo temporal.
   */
  registerLoginOutcome(userId: string, success: boolean): Promise<void>;

  /**
   * Estado vivo de una cuenta, para validar la sesión en cada petición.
   *
   * El JWT lleva el rol y `sessionsValidFrom` congelados desde el login. Eso
   * basta para pintar la interfaz, pero no para decidir si la sesión SIGUE
   * siendo válida: una cuenta suspendida hace diez minutos, o una contraseña
   * cambiada desde otro dispositivo, seguirían teniendo un token con firma
   * correcta. Esto es lo que se contrasta contra el token.
   */
  getAccountState(userId: string): Promise<{
    status: UserStatus;
    sessionsValidFrom: Date;
    mustChangePassword: boolean;
    deletedAt: Date | null;
  } | null>;

  /**
   * El administrador le regenera la clave a alguien.
   *
   * Distinto de `changePassword`: aquí NO se pide la contraseña actual —quien
   * la pide es un tercero— y la cuenta queda obligada a cambiarla, porque la
   * clave nueva viajó por correo. También cierra sus sesiones: si se le
   * restablece la clave a alguien es porque perdió el control de la cuenta o
   * del correo, y dejarle la sesión abierta a quien la tenga no arreglaría
   * nada.
   */
  resetPasswordAsAdmin(params: {
    /** Ficha del odontólogo. La cuenta se resuelve por su `userId`. */
    dentistId: string;
    passwordHash: string;
    userId: string;
  }): Promise<WriteResult<{ userId: string; email: string; fullName: string }>>;

  /**
   * Emite un enlace de recuperación, si la cuenta existe.
   *
   * Devuelve `null` cuando no existe, está suspendida o borrada — y el
   * llamador debe responder EXACTAMENTE igual que si existiera. Si la
   * respuesta cambiara, el formulario de «olvidé mi contraseña» se convertiría
   * en una forma de averiguar qué correos tienen cuenta.
   *
   * Invalida los enlaces pendientes de esa cuenta: pedir uno nuevo tiene que
   * dejar sin valor al anterior, o cada solicitud sumaría una llave viva más.
   */
  createPasswordResetToken(params: {
    email: string;
    tokenHash: string;
    expiresAt: Date;
    requestedIp: string | null;
  }): Promise<{ email: string; fullName: string } | null>;

  /**
   * Canjea un enlace: pone la contraseña nueva y quema el token.
   *
   * Todo en una transacción. El token se marca usado Y se cambia la clave: si
   * se hicieran por separado, un fallo entre medias dejaría un enlace válido
   * para una contraseña ya cambiada.
   */
  redeemPasswordResetToken(params: {
    tokenHash: string;
    passwordHash: string;
  }): Promise<WriteResult<{ userId: string }>>;

  /**
   * Cambia la contraseña y CIERRA las demás sesiones.
   *
   * Las dos cosas van juntas y en la misma transacción a propósito: el motivo
   * habitual para cambiar una clave es sospechar que alguien la tiene, y
   * dejarle la sesión abierta a ese alguien vacía la operación de sentido.
   */
  changePassword(params: {
    userId: string;
    passwordHash: string;
  }): Promise<WriteResult<{ id: string }>>;

  // --- Catálogos (lectura) -------------------------------------------------
  listDentists(options?: { includeInactive?: boolean }): Promise<Dentist[]>;
  listRooms(options?: { includeInactive?: boolean }): Promise<Room[]>;
  listTreatments(options?: { includeInactive?: boolean }): Promise<Treatment[]>;
  findTreatmentByCode(code: string): Promise<Treatment | null>;
  findDentistById(id: string): Promise<Dentist | null>;

  // --- Medios de pago ------------------------------------------------------
  /** Formas de pago configuradas. Sin `includeInactive`, sólo las vigentes. */
  listPaymentMethods(options?: {
    includeInactive?: boolean;
  }): Promise<PaymentMethodOption[]>;

  createPaymentMethod(
    data: PaymentMethodInput,
    userId: string,
  ): Promise<WriteResult<PaymentMethodOption>>;

  updatePaymentMethod(
    id: string,
    data: PaymentMethodInput,
    userId: string,
  ): Promise<WriteResult<PaymentMethodOption>>;

  /**
   * Borrado lógico. No se elimina la fila: los cobros históricos copiaron la
   * etiqueta, pero el registro sigue siendo útil para reactivarlo si la
   * clínica vuelve a ese banco.
   */
  deletePaymentMethod(id: string, userId: string): Promise<boolean>;

  /**
   * Perfil clínico asociado a una cuenta de usuario, o `null` si no lo tiene.
   *
   * Es la consulta que necesita un odontólogo al entrar en su agenda.
   * Resolverlo con `listDentists()` y un `find` en memoria funcionaba, pero
   * traía la ficha de los doce —incluida la comisión pactada de cada uno— para
   * quedarse con una. Ese sobrante acaba en la respuesta del servidor.
   */
  findDentistByUserId(userId: string): Promise<Dentist | null>;

  // --- Pacientes -----------------------------------------------------------
  findPatientByPhone(phoneE164: string): Promise<Patient | null>;
  /**
   * Crea el paciente si no existe; si ya existe, lo devuelve.
   *
   * Upsert deliberado: dos mensajes casi simultáneos del mismo número nuevo
   * provocarían una colisión de la restricción única. Aquí se resuelve en un
   * solo viaje y de forma atómica.
   */
  upsertPatientByPhone(data: { phoneE164: string; fullName: string }): Promise<Patient>;

  /**
   * Listado paginado con búsqueda por nombre, teléfono o documento.
   * `search` se pasa como PARÁMETRO al ORM, nunca concatenado a SQL.
   */
  listPatients(params: {
    search?: string;
    page: number;
    limit: number;
  }): Promise<{ items: Patient[]; total: number }>;

  createPatient(data: PatientInput): Promise<WriteResult<Patient>>;
  updatePatient(id: string, data: PatientInput): Promise<WriteResult<Patient>>;
  /** Borrado LÓGICO: preserva historial clínico y contable. */
  softDeletePatient(id: string): Promise<WriteResult<Patient>>;

  // --- Odontólogos (escritura) ---------------------------------------------
  createDentist(data: DentistInput): Promise<WriteResult<Dentist>>;

  /**
   * Alta de odontólogo CON cuenta de acceso, en una sola transacción.
   *
   * Va junto y no en dos llamadas porque el estado intermedio es malo de las
   * dos formas: un odontólogo sin cuenta al que se le dijo que la tendría, o
   * una cuenta huérfana que puede entrar al panel sin perfil clínico. O las
   * dos cosas o ninguna.
   *
   * El `passwordHash` llega ya calculado: hashear es caro (~80 ms con Argon2)
   * y hacerlo DENTRO de la transacción la mantendría abierta todo ese rato
   * sin necesidad.
   */
  createDentistWithAccount(params: {
    dentist: DentistInput;
    passwordHash: string;
  }): Promise<WriteResult<{ id: string; userId: string }>>;
  updateDentist(id: string, data: DentistInput): Promise<WriteResult<Dentist>>;
  softDeleteDentist(id: string): Promise<WriteResult<Dentist>>;

  // --- Tratamientos (escritura) --------------------------------------------
  createTreatment(data: TreatmentInput): Promise<WriteResult<Treatment>>;
  /**
   * Actualiza un tratamiento. Si cambia el precio, registra la variación en
   * `TreatmentPriceHistory` — poder responder "¿cuánto costaba en marzo?" es
   * un requisito contable, no un lujo.
   */
  updateTreatment(
    id: string,
    data: TreatmentInput,
    changedByUserId: string,
  ): Promise<WriteResult<Treatment>>;
  softDeleteTreatment(id: string): Promise<WriteResult<Treatment>>;

  // --- Consultorios (escritura) --------------------------------------------
  createRoom(data: RoomInput): Promise<WriteResult<Room>>;
  updateRoom(id: string, data: RoomInput): Promise<WriteResult<Room>>;
  softDeleteRoom(id: string): Promise<WriteResult<Room>>;

  // --- Agenda --------------------------------------------------------------
  /** Búsqueda por llave de idempotencia — primer paso de toda escritura del bot. */
  findAppointmentByIdempotencyKey(key: string): Promise<Appointment | null>;
  /**
   * Citas activas que se solapan con el rango dado.
   * Filtra ya por CANCELLED / NO_SHOW: esos huecos están libres.
   */
  findOverlappingAppointments(params: {
    startsAt: Date;
    endsAt: Date;
    dentistId?: string;
    roomId?: string;
  }): Promise<Appointment[]>;
  createAppointment(data: CreateAppointmentData): Promise<Appointment>;

  /** Una sola cita con sus relaciones resueltas. */
  findAppointmentById(id: string): Promise<AppointmentWithRelations | null>;

  /**
   * Alta desde el panel. A diferencia del bot, aquí el operador elige
   * explícitamente paciente, odontólogo y sala; el servidor sigue calculando
   * `endsAt` y el precio a partir del tratamiento.
   */
  createAppointmentFromPanel(data: AppointmentInput): Promise<WriteResult<Appointment>>;

  /** Reprograma o reasigna una cita ya existente. */
  updateAppointment(id: string, data: AppointmentInput): Promise<WriteResult<Appointment>>;

  /** Cambia el estado (confirmar, completar, cancelar, no-show). */
  updateAppointmentStatus(params: {
    id: string;
    status: Appointment['status'];
    cancellationReason: string | null;
  }): Promise<WriteResult<Appointment>>;
  listAppointments(params: {
    range: DateRange;
    dentistId?: string;
    limit?: number;
  }): Promise<AppointmentWithRelations[]>;

  /**
   * Añade un procedimiento a una cita ya agendada.
   *
   * El precio y la comisión NO llegan del formulario: se derivan aquí del
   * tratamiento y del acuerdo aprobado con el odontólogo. Aceptarlos del
   * cliente permitiría añadir una radiografía «al 0 % de clínica» tecleando
   * el porcentaje a mano.
   *
   * Se rechaza si la cita ya está cobrada: el cobro congela el reparto, y
   * añadir una línea después dejaría el pago sin cuadrar con sus conceptos.
   */
  addAppointmentAddon(params: {
    appointmentId: string;
    treatmentId: string;
    /** Precio pactado en consulta. `null` = el que corresponda por reglas. */
    priceCents: number | null;
    notes: string | null;
    userId: string;
  }): Promise<WriteResult<AppointmentAddon>>;

  /**
   * Quita un procedimiento añadido. Sólo mientras la cita no esté cobrada,
   * por el mismo motivo que no se puede añadir.
   */
  removeAppointmentAddon(params: {
    id: string;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  // --- Tarifas pactadas por odontólogo -------------------------------------

  /**
   * Acuerdos de precio, opcionalmente los de un solo odontólogo.
   *
   * `dentistId` no es un filtro de comodidad: es lo que permite servir esta
   * pantalla al odontólogo sin enseñarle lo que ha pactado el resto.
   */
  listDentistTreatments(params?: {
    dentistId?: string;
    status?: ApprovalStatus;
  }): Promise<DentistTreatmentAgreement[]>;

  /**
   * Crea o reemplaza un acuerdo.
   *
   * `status` lo decide quien llama según su rol: el administrador guarda
   * directamente en `APPROVED` porque él es el aprobador; el odontólogo sólo
   * puede dejarlo en `PENDING`. Volver a proponer sobre un acuerdo ya
   * aprobado lo devuelve a `PENDING`: si no, bastaría con editar un acuerdo
   * aprobado para saltarse la revisión.
   */
  upsertDentistTreatment(params: {
    dentistId: string;
    treatmentId: string;
    customPriceCents: number | null;
    customCommissionPercent: number | null;
    status: Extract<ApprovalStatus, 'PENDING' | 'APPROVED'>;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  /** Aprueba o rechaza una propuesta. Sólo el administrador. */
  reviewDentistTreatment(params: {
    id: string;
    status: Extract<ApprovalStatus, 'APPROVED' | 'REJECTED'>;
    reviewNotes: string | null;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  /** Elimina un acuerdo: se vuelve a cobrar el precio de lista. */
  deleteDentistTreatment(params: {
    id: string;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  // --- Liquidación diaria («se paga al final del día») ----------------------

  /**
   * Lo que la clínica le debe a cada odontólogo por lo cobrado HOY.
   *
   * Sólo cuenta lo que todavía no se ha liquidado (`payoutId IS NULL`): una
   * vez pagado, ese dinero deja de deberse aunque el cobro siga siendo del
   * mismo día.
   */
  getDailySettlements(businessDate: string): Promise<DailySettlement[]>;

  /**
   * Marca como pagada la parte de UN odontólogo por UN día.
   *
   * Crea el `DentistPayout` y le engancha los cobros incluidos, en una sola
   * transacción. Enganchar los pagos es lo que hace que no se pueda pagar dos
   * veces lo mismo: a partir de ahí ya no salen como pendientes.
   */
  settleDentistDay(params: {
    dentistId: string;
    businessDate: string;
    userId: string;
  }): Promise<WriteResult<{ id: string; totalCents: number }>>;

  // --- Facturas -------------------------------------------------------------

  /**
   * Abre la factura de una cita, creándola si no existe.
   *
   * Las líneas salen del tratamiento de la cita más los procedimientos que se
   * le añadieron en consulta. Si ya existe, se devuelve tal cual: volver a
   * generarla borraría los descuentos que recepción ya hubiera marcado.
   */
  openInvoiceForAppointment(params: {
    appointmentId: string;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  listInvoices(params?: {
    status?: InvoiceStatus;
    patientId?: string;
    limit?: number;
  }): Promise<Invoice[]>;

  getInvoice(id: string): Promise<Invoice | null>;

  /** Añade una línea. El precio y la comisión los decide el SERVIDOR. */
  addInvoiceLine(params: {
    invoiceId: string;
    treatmentId: string | null;
    /** Sólo para líneas escritas a mano. */
    description: string | null;
    quantity: number;
    /** Precio pactado. `null` = el que corresponda por reglas. */
    unitPriceCents: number | null;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  /**
   * Ajusta una línea: cantidad, precio o DESCUENTO.
   *
   * El descuento lo marca recepción a mano — es el «si haces esto, esto va
   * gratis», que no es gratis porque lo otro sube.
   */
  updateInvoiceLine(params: {
    id: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    discountReason: string | null;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  removeInvoiceLine(params: { id: string; userId: string }): Promise<WriteResult<{ id: string }>>;

  /**
   * Registra un cobro contra la factura. Puede ser PARCIAL.
   *
   * «Sólo se guarda lo que se pague ese día»: cada pago lleva su fecha y su
   * tasa, así que el arqueo de cada jornada cuenta lo que de verdad entró en
   * ella. La factura queda OPEN hasta que el saldo llega a cero.
   */
  registerInvoicePayment(params: {
    invoiceId: string;
    amountCents: number;
    method: 'CASH' | 'CARD' | 'TRANSFER' | 'INSURANCE';
    methodLabel: string | null;
    externalReference: string | null;
    exchangeRate: number;
    exchangeRateSource: string;
    userId: string;
  }): Promise<WriteResult<{ id: string; balanceCents: number }>>;

  /** Anula la factura. No se borra: el papel se entregó. */
  voidInvoice(params: {
    id: string;
    reason: string;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  // --- Documentos escaneados del paciente ----------------------------------

  /** Los documentos de un paciente. SIN el binario: sólo la ficha de cada uno. */
  listPatientDocuments(patientId: string): Promise<PatientDocument[]>;

  /**
   * El archivo en sí, para servirlo por HTTP.
   *
   * Va aparte de `listPatientDocuments` porque el binario sólo hace falta
   * cuando alguien lo abre. Traerlo en el listado mandaría megas al navegador
   * por el simple hecho de entrar a la ficha.
   */
  getPatientDocumentFile(id: string): Promise<{
    fileName: string;
    mimeType: string;
    content: Uint8Array;
  } | null>;

  savePatientDocument(params: {
    patientId: string;
    kind: PatientDocumentKind;
    fileName: string;
    mimeType: string;
    content: Uint8Array;
    notes: string | null;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  /** Borrado lógico: un documento clínico que existió no se destruye. */
  deletePatientDocument(params: {
    id: string;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  // --- Instrumental del odontólogo -----------------------------------------

  /** Instrumental, opcionalmente el de un solo odontólogo. */
  listInstruments(params?: { dentistId?: string }): Promise<DentistInstrument[]>;

  saveInstrument(params: {
    /** `null` = alta. Con id, edición. */
    id: string | null;
    dentistId: string;
    data: InstrumentInput;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  /** Borrado lógico: el historial de quién tenía qué no se destruye. */
  deleteInstrument(params: {
    id: string;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  // --- Horarios y sus cambios ----------------------------------------------

  /**
   * Horario de un odontólogo.
   *
   * Sin `weekStart` devuelve el BASE, que es el que pone recepción y el que
   * rige mientras nadie diga lo contrario.
   *
   * Con `weekStart` devuelve el que rige ESA semana: la excepción aprobada si
   * la hay, y el base si no. Que no haya excepción ES la respuesta — por eso
   * no existe ninguna marca de «esta semana es normal».
   */
  listSchedule(dentistId: string, weekStart?: string): Promise<ScheduleBlock[]>;

  /**
   * Recepción fija el horario BASE de un odontólogo.
   *
   * Reemplaza la semana entera: es lo que se está editando, y un merge
   * dejaría bloques viejos que nadie quiso conservar.
   */
  setBaseSchedule(params: {
    dentistId: string;
    blocks: ScheduleBlock[];
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  listScheduleRequests(params?: {
    dentistId?: string;
    status?: ApprovalStatus;
  }): Promise<ScheduleChangeRequest[]>;

  /**
   * El odontólogo propone una semana nueva.
   *
   * Sólo puede haber UNA pendiente por persona Y SEMANA —lo fuerza un índice
   * único parcial en Postgres—: dos solicitudes para la misma semana dejarían
   * a recepción sin saber cuál es la buena. Para semanas distintas sí puede
   * tener varias, que es un caso legítimo.
   */
  createScheduleRequest(params: {
    dentistId: string;
    /** Lunes de la semana a la que aplica, 'YYYY-MM-DD'. */
    weekStart: string;
    proposedBlocks: ScheduleBlock[];
    reason: string | null;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  /**
   * Aprueba o rechaza. Al aprobar, los bloques se guardan como la excepción
   * DE ESA SEMANA, en la misma transacción — el horario base no se toca.
   * Aprobar sin aplicar dejaría al odontólogo creyendo que su horario cambió
   * mientras el bot sigue ofreciendo el viejo.
   */
  reviewScheduleRequest(params: {
    id: string;
    status: Extract<ApprovalStatus, 'APPROVED' | 'REJECTED'>;
    reviewNotes: string | null;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  /**
   * Agenda de UN odontólogo, recortada a lo que él puede ver.
   *
   * Existe aparte de `listAppointments` por una razón concreta: la consulta
   * NO lee `agreedPriceCents`. El odontólogo no ve tarifas, y la forma
   * fiable de garantizarlo no es ocultar una columna en la pantalla sino no
   * traer el dato. Lo que nunca sale de la base de datos no se puede filtrar
   * después por descuido — ni en el HTML, ni en el payload de React, ni en
   * la información de depuración que Next.js incrusta en modo desarrollo.
   */
  listDentistAgenda(params: {
    dentistId: string;
    range: DateRange;
    limit?: number;
  }): Promise<DentistAgendaItem[]>;

  // --- Finanzas ------------------------------------------------------------
  getFinancialSummary(range: DateRange): Promise<FinancialSummary>;
  getDentistEarnings(range: DateRange): Promise<DentistEarnings[]>;

  // --- WhatsApp ------------------------------------------------------------
  listConversations(options?: { limit?: number }): Promise<ConversationListItem[]>;
  getConversationMessages(conversationId: string): Promise<WhatsAppMessage[]>;
  /**
   * Registra un mensaje SALIENTE escrito por un humano desde el panel.
   *
   * Devuelve el mensaje ya creado para que el llamador intente la entrega y
   * luego actualice su estado. Persistir primero y entregar después es
   * deliberado: un fallo del proveedor no debe borrar lo que se escribió.
   */
  createOutboundMessage(params: {
    conversationId: string;
    body: string;
    userId: string;
  }): Promise<WriteResult<{ id: string; phoneE164: string }>>;

  /** Marca el resultado de la entrega de un mensaje saliente. */
  setMessageDelivery(params: {
    messageId: string;
    status: 'PENDING' | 'SENT' | 'FAILED';
    error: string | null;
  }): Promise<void>;

  /** El toggle Apagar/Encender IA. Devuelve `null` si la conversación no existe. */
  setConversationAiEnabled(params: {
    conversationId: string;
    aiEnabled: boolean;
    userId: string;
    reason: string | null;
  }): Promise<ConversationListItem | null>;

  // --- WhatsApp: lo que consume la automatización --------------------------

  /**
   * Estado de la conversación de un número, creándola si es la primera vez.
   *
   * Es lo PRIMERO que el bot debe llamar al recibir un mensaje: le dice si la
   * IA sigue encendida en ese chat. Sin esta consulta, un agente que apaga la
   * IA desde el panel no tendría ningún efecto — el bot seguiría contestando
   * en paralelo y contradiciendo a la persona delante del paciente.
   */
  getConversationStateByPhone(params: {
    phoneE164: string;
    displayName?: string | null;
  }): Promise<{
    conversationId: string;
    phoneE164: string;
    aiEnabled: boolean;
    aiDisabledReason: string | null;
    needsHumanAttention: boolean;
    patientId: string | null;
    patientName: string | null;
    isNewConversation: boolean;
    /**
     * Con quién habla el bot.
     *
     * Se resuelve por el teléfono, contra el personal primero y los pacientes
     * después. Un odontólogo que además es paciente de la clínica cuenta como
     * odontólogo: es el rol con el que va a escribir.
     */
    contact: {
      role: 'PATIENT' | 'DENTIST' | 'ASSISTANT' | 'ADMIN' | 'UNKNOWN';
      name: string | null;
      /** Id del perfil de odontólogo, si lo es. Sirve para filtrar su agenda. */
      dentistId: string | null;
    };
  }>;

  /**
   * Guarda en el panel un mensaje que pasó por WhatsApp.
   *
   * Lo llama n8n en las dos direcciones: lo que escribe el paciente y lo que
   * responde el bot. Sin esto el monitor estaría vacío y nadie podría
   * retomar una conversación a media charla, que es justo el momento en el
   * que hace falta.
   */
  recordAutomationMessage(params: {
    phoneE164: string;
    direction: 'INBOUND' | 'OUTBOUND';
    author: 'PATIENT' | 'AI_BOT' | 'SYSTEM';
    body: string;
    mediaUrl?: string | null;
    /** Id del mensaje en WhatsApp: evita duplicar si n8n reintenta. */
    externalId?: string | null;
  }): Promise<{ conversationId: string; messageId: string; duplicate: boolean }>;

  /**
   * El bot pide ayuda: apaga la IA y marca el chat para que recepción lo vea.
   *
   * Que sea el propio bot quien se calle —y no sólo una notificación— es lo
   * que evita que siga respondiendo mientras espera a que alguien lea el
   * aviso.
   */
  requestHumanHandoff(params: {
    phoneE164: string;
    reason: string;
  }): Promise<{ conversationId: string; aiEnabled: boolean } | null>;

  // --- Métricas de uso del panel -------------------------------------------
  // --- Cobros --------------------------------------------------------------
  /**
   * Registra un cobro y cierra la cita.
   *
   * Es la operación que conecta el mostrador con las finanzas: el reparto
   * 40/60 y la tasa Bs/USD se calculan y CONGELAN aquí, y desde ese momento
   * el importe aparece en el dashboard del administrador.
   *
   * Todo ocurre en una transacción: si el pago se registra pero la cita no
   * pasa a COMPLETED, la contabilidad y la agenda quedan en desacuerdo
   * permanente.
   */
  createPayment(params: {
    data: PaymentInput;
    /** Tasa Bs/USD vigente, ya resuelta por el llamador. */
    exchangeRate: number;
    exchangeRateSource: string;
    userId: string;
  }): Promise<WriteResult<{ id: string }>>;

  /** Caja del día: lo que recepción cobró en una fecha concreta. */
  getDailyCash(date: Date): Promise<DailyCash>;

  // --- Cierre de caja ------------------------------------------------------
  /** Arqueo de un día, o `null` si aún no se ha cerrado. */
  getCashClosing(businessDate: string): Promise<CashClosing | null>;

  /**
   * Firma el arqueo del día.
   *
   * Devuelve `ALREADY_CLOSED` en vez de sobreescribir: dos cierres del mismo
   * día dejarían dos versiones del descuadre y ninguna sería la buena. Para
   * rehacerlo hay que reabrir primero, y eso queda en el registro de auditoría.
   */
  closeCash(input: CashClosingInput, userId: string): Promise<
    { ok: true; data: CashClosing } | { ok: false; reason: 'ALREADY_CLOSED' }
  >;

  /** Reabre un día ya cerrado. Sólo el administrador; queda auditado. */
  reopenCash(businessDate: string, userId: string): Promise<boolean>;

  /** Cobros del día que aún no se han registrado, para cerrarlos desde caja. */
  listUnpaidAppointmentsForDay(businessDate: string): Promise<AppointmentWithRelations[]>;

  /**
   * De un conjunto de citas, cuáles ya tienen cobro registrado.
   *
   * Se consulta en bloque en vez de una por una: la agenda muestra 80 citas
   * y comprobarlas de una en una serían 80 viajes a la base de datos.
   */
  getPaidAppointmentIds(appointmentIds: string[]): Promise<string[]>;

  // --- Ajustes de la clínica -----------------------------------------------
  /** Lee la fila única de ajustes, creándola con valores por defecto si falta. */
  getClinicSettings(): Promise<ClinicSettings>;
  updateClinicSettings(
    data: ClinicSettingsInput,
    userId: string,
  ): Promise<WriteResult<ClinicSettings>>;

  /** Contadores para las tarjetas de cabecera de cada sección CRUD. */
  getEntityCounts(): Promise<{
    patients: number;
    dentists: number;
    activeDentists: number;
    treatments: number;
    rooms: number;
  }>;
}
