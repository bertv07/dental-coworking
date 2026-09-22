'use server';

import { revalidatePath } from 'next/cache';
import { preguntarPorOdontologoDePreferencia } from '@/backend/services/preferencia-odontologo.service';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema } from '@/backend/validators/common';
import {
  getCurrentRate,
  getRateAsOf,
  guardarTasaDeEseDia,
  resolveRateSource,
} from '@/backend/services/exchange-rate.service';
import { clinicDayKey, clinicWallClockToInstant } from '@/backend/domain/clinic-calendar';

/**
 * ===========================================================================
 *  Server Actions de facturación
 * ===========================================================================
 *  Las usa recepción. NO son facturas fiscales: son el comprobante interno de
 *  la clínica, el papel que se le entrega al paciente.
 *
 *  ACCESO: asistente o superior. El odontólogo no factura ni cobra.
 *
 *  ⚠️  Lo que NUNCA llega del formulario:
 *   · La comisión de cada línea — la deriva el servidor del tratamiento y del
 *     acuerdo aprobado con el odontólogo.
 *   · La tasa de cambio — se lee de la fuente configurada al cobrar.
 *   · Los totales — se recalculan desde las líneas en cada cambio.
 *
 *  Lo que sí se acepta es el PRECIO y el DESCUENTO: los pacta recepción con
 *  el paciente delante, y el sistema no puede saber más que quien atiende.
 * ===========================================================================
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
  /** Id de la factura recién abierta, para poder navegar a ella. */
  invoiceId?: string;
  /** La operación salió bien, pero hay algo que decir (ej: quedó bonificación). */
  warning?: string;
}

async function autorizar() {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false as const,
      result: {
        ok: false,
        error:
          authorization.status === 401
            ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
            : 'No tienes permiso para facturar.',
      } satisfies ActionResult,
    };
  }
  return { ok: true as const, userId: authorization.user.id };
}

/** Abre la factura de una cita, creándola con sus líneas si no existe. */
export async function openInvoiceAction(appointmentId: string): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const parsed = cuidSchema.safeParse(appointmentId);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };

  const result = await repository.openInvoiceForAppointment({
    appointmentId: parsed.data,
    userId: auth.userId,
  });

  if (!result.ok) return { ok: false, error: 'Esa cita ya no existe.' };

  revalidatePath('/agenda');
  return { ok: true, invoiceId: result.data.id };
}

/**
 * Pacientes para el buscador de "Registrar venta atrasada" — el mismo que
 * usa `/pacientes`, sin paginar: aquí sólo hace falta encontrar UNO rápido.
 */
export async function searchPatientsForInvoiceAction(
  query: string,
): Promise<Array<{ id: string; fullName: string; phoneE164: string }>> {
  const auth = await autorizar();
  if (!auth.ok) return [];

  const term = query.trim().slice(0, 100);
  if (term.length < 2) return [];

  const { items } = await repository.listPatients({ search: term, page: 1, limit: 8 });
  return items.map((p) => ({ id: p.id, fullName: p.fullName, phoneE164: p.phoneE164 }));
}

const ventaAtrasadaSchema = z.object({
  patientId: cuidSchema,
  dentistId: z
    .union([cuidSchema, z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),
  // 'YYYY-MM-DD'. Vacío = hoy.
  fecha: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),

  /**
   * La tasa de ese día, tal como la dejó recepción en el formulario.
   *
   * Llega ya rellena con la oficial: normalmente se manda igual que vino y
   * no cambia nada. Sólo importa cuando no coincide con el recibo que
   * tienen delante, que es quien de verdad sabe a cuánto se cobró.
   */
  tasa: z
    .union([z.string(), z.number(), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v == null ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0), {
      message: 'La tasa debe ser mayor que cero',
    }),
});

/**
 * Abre una factura SIN cita — la venta de mostrador que se olvidó registrar
 * el día que pasó, o cualquier venta directa. Nace vacía; las líneas y el
 * cobro se añaden desde la propia factura, donde ya se puede fechar el
 * cobro en el pasado.
 */
export async function createBackdatedInvoiceAction(input: unknown): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const validation = ventaAtrasadaSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }
  const d = validation.data;

  let issuedAt = new Date();
  if (d.fecha) {
    if (d.fecha > clinicDayKey(issuedAt)) {
      return { ok: false, error: 'La fecha no puede ser futura.', field: 'fecha' };
    }
    issuedAt = clinicWallClockToInstant(d.fecha, 12 * 60);

    /*
     * La tasa del día de la venta queda escrita AHORA, al abrir la factura.
     *
     * Si no, el cobro se registraba después y volvía a preguntar —o peor,
     * caía en la de hoy—: fechar una venta el 3 de septiembre y cobrarla a
     * la tasa de tres semanas más tarde escribe en la factura unos bolívares
     * que nunca entraron en la gaveta. Dejándola aquí, `getRateAsOf` la
     * encuentra en su primer paso cuando se registre el cobro.
     *
     * Si falla, la factura se abre igual: el cobro volverá a pedir la tasa,
     * que es molesto pero recuperable. Perder la venta entera no lo es.
     */
    if (d.tasa !== null) {
      const settings = await repository.getClinicSettings();
      try {
        await guardarTasaDeEseDia(
          resolveRateSource(settings.preferredRateSource),
          d.fecha,
          d.tasa,
        );
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'venta_atrasada.tasa_no_guardada',
            fecha: d.fecha,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }

  const result = await repository.createDirectInvoice({
    patientId: d.patientId,
    dentistId: d.dentistId,
    issuedAt,
    userId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, error: 'Ese paciente ya no existe.' };
  }

  revalidatePath('/facturas');
  return { ok: true, invoiceId: result.data.id };
}

const lineaSchema = z.object({
  invoiceId: cuidSchema,
  treatmentId: z
    .union([cuidSchema, z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),
  description: z
    .union([z.string().trim().max(200), z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),
  quantity: z.coerce.number().int().min(1, 'Mínimo 1').max(99).default(1),
  priceInUsd: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === '' || v == null ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), {
      message: 'El precio no puede ser negativo',
    })
    .transform((v) => (v === null ? null : Math.round(v * 100))),
});

export async function addInvoiceLineAction(input: unknown): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const validation = lineaSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const d = validation.data;

  // O sale del catálogo, o se escribe a mano. Sin ninguna de las dos no hay
  // línea que añadir.
  if (!d.treatmentId && !d.description) {
    return { ok: false, error: 'Elige un tratamiento o escribe un concepto.', field: 'treatmentId' };
  }

  const result = await repository.addInvoiceLine({
    invoiceId: d.invoiceId,
    treatmentId: d.treatmentId,
    description: d.description,
    quantity: d.quantity,
    unitPriceCents: d.priceInUsd,
    userId: auth.userId,
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === 'DUPLICATE'
          ? 'Esa factura está anulada: no se puede editar.'
          : 'No se pudo añadir la línea.',
    };
  }

  revalidatePath(`/facturas/${d.invoiceId}`);
  return { ok: true };
}

const ajusteSchema = z.object({
  id: cuidSchema,
  invoiceId: cuidSchema,
  quantity: z.coerce.number().int().min(1).max(99),
  priceInUsd: z.coerce.number().min(0, 'El precio no puede ser negativo'),
  discountInUsd: z.coerce.number().min(0, 'El descuento no puede ser negativo').default(0),
  discountReason: z
    .union([z.string().trim().max(200), z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),
});

/**
 * Ajusta una línea: cantidad, precio o descuento.
 *
 * El descuento es el «si haces esto, esto va gratis». Se guarda como REBAJA y
 * no poniendo el precio a cero: así queda registrado el precio real y cuánto
 * se regaló, que es lo que a fin de mes permite saber qué se está regalando.
 */
export async function updateInvoiceLineAction(input: unknown): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const validation = ajusteSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const d = validation.data;
  const unitPriceCents = Math.round(d.priceInUsd * 100);
  const discountCents = Math.round(d.discountInUsd * 100);

  // No se descuenta más de lo que vale la línea: el resultado sería devolverle
  // dinero al paciente sin que nadie lo haya decidido. Postgres también lo
  // rechaza; aquí se avisa con un mensaje entendible.
  if (discountCents > unitPriceCents * d.quantity) {
    return {
      ok: false,
      error: 'El descuento no puede ser mayor que la línea.',
      field: 'discountInUsd',
    };
  }

  // Un descuento sin motivo es un descuadre que nadie sabrá explicar después.
  if (discountCents > 0 && !d.discountReason) {
    return { ok: false, error: 'Escribe por qué se rebaja.', field: 'discountReason' };
  }

  const result = await repository.updateInvoiceLine({
    id: d.id,
    quantity: d.quantity,
    unitPriceCents,
    discountCents,
    discountReason: d.discountReason,
    userId: auth.userId,
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === 'DUPLICATE'
          ? 'Esa factura está anulada: no se puede editar.'
          : 'Esa línea ya no existe.',
    };
  }

  revalidatePath(`/facturas/${d.invoiceId}`);
  return { ok: true };
}

const repartoSchema = z.object({
  invoiceId: cuidSchema,
  /** Porcentaje de la CLÍNICA. 60 = el 60/40 habitual; 50 = 50/50; 40 = 40/60. */
  clinicPercent: z.coerce.number().int('Sin decimales').min(0, 'Mínimo 0').max(100, 'Máximo 100'),
});

/**
 * Cambia el reparto clínica/odontólogo de una factura entera.
 *
 * Es la decisión que recepción toma con el caso delante —«con esta doctora
 * esta vez va 50/50»— y por eso se acepta del formulario, a diferencia del
 * reparto calculado, que jamás. Queda en auditoría con quién lo hizo.
 */
export async function setInvoiceSplitAction(input: unknown): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const validation = repartoSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }
  const d = validation.data;

  const result = await repository.setInvoiceSplit({
    invoiceId: d.invoiceId,
    clinicPercent: d.clinicPercent,
    userId: auth.userId,
  });

  if (!result.ok) {
    if (result.reason === 'DUPLICATE') {
      return {
        ok: false,
        error:
          result.field === 'payments'
            ? 'Esta factura ya tiene cobros: el reparto se fija antes de cobrar. Reversa el cobro si hace falta cambiarlo.'
            : 'Esa factura está anulada.',
      };
    }
    return { ok: false, error: 'Esa factura ya no existe.' };
  }

  revalidatePath(`/facturas/${d.invoiceId}`);
  return { ok: true };
}

export async function removeInvoiceLineAction(
  id: string,
  invoiceId: string,
): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const parsed = cuidSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };

  const result = await repository.removeInvoiceLine({ id: parsed.data, userId: auth.userId });
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === 'DUPLICATE'
          ? 'Esa factura está anulada: no se puede editar.'
          : 'Esa línea ya no existe.',
    };
  }

  revalidatePath(`/facturas/${invoiceId}`);
  return { ok: true };
}

const cobroSchema = z.object({
  invoiceId: cuidSchema,
  amountInUsd: z.coerce.number().min(0.01, 'El importe tiene que ser mayor que cero'),
  methodChoice: z.string().min(1, 'Elige un medio de pago'),
  externalReference: z
    .union([z.string().trim().max(120), z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),
  /**
   * 'YYYY-MM-DD'. Vacío = hoy, el caso normal. Con fecha es para una venta
   * que se olvidó registrar el día que pasó: el cobro se cuenta en la caja
   * de ESE día, con la tasa que regía entonces — no la de hoy.
   */
  fechaCobro: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')])
    .optional()
    .transform((v) => (v ? v : null)),

  /**
   * Tasa de ese día, escrita a mano. SÓLO se usa —y sólo se acepta— cuando
   * el cobro va con fecha atrasada y el sistema no guardó la tasa de ese
   * día. En un cobro de hoy se ignora: ahí manda la fuente oficial, porque
   * si no cualquiera podría cobrar a una tasa inventada.
   */
  tasaManual: z
    .union([z.coerce.number().positive('La tasa tiene que ser mayor que cero'), z.literal('')])
    .optional()
    .transform((v) => (typeof v === 'number' ? v : null)),
});

/**
 * Registra un cobro. Puede ser PARCIAL.
 *
 * «Sólo se guarda lo que se pague ese día»: cada pago lleva su fecha y su tasa
 * congeladas, así que el arqueo de cada jornada cuenta lo que de verdad entró
 * en ella. La factura sigue abierta hasta que el saldo llega a cero.
 */
export async function registerInvoicePaymentAction(input: unknown): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const validation = cobroSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const d = validation.data;

  // "TRANSFER|Zelle" → categoría contable + etiqueta concreta.
  const [kind, ...labelParts] = d.methodChoice.split('|');
  if (!['CASH', 'CARD', 'TRANSFER', 'INSURANCE'].includes(kind ?? '')) {
    return { ok: false, error: 'Medio de pago inválido', field: 'methodChoice' };
  }

  // Fecha del cobro: hoy si no se indicó otra. Nunca en el futuro — eso no
  // es "se me olvidó registrarlo", es cobrar algo que todavía no pasó.
  let paidAt: Date | undefined;
  if (d.fechaCobro) {
    if (d.fechaCobro > clinicDayKey(new Date())) {
      return { ok: false, error: 'La fecha del cobro no puede ser futura.', field: 'fechaCobro' };
    }
    // Mediodía en Caracas: cae dentro del día elegido pase lo que pase con
    // el desfase horario, y no aparenta una hora exacta que no ocurrió.
    paidAt = clinicWallClockToInstant(d.fechaCobro, 12 * 60);
  }

  /*
   * La tasa se lee AQUÍ, no llega del formulario.
   *
   * Es lo que convierte dólares en los bolívares que entran en la gaveta: si
   * viniera del cliente, se podría registrar un cobro a una tasa inventada y
   * el arqueo cuadraría con dinero que nadie entregó.
   *
   * Con fecha atrasada se usa la tasa que regía ESE día, no la de hoy: si no,
   * el monto en bolívares de un cobro de hace tres días quedaría escrito con
   * una tasa que ese día ni existía.
   */
  const settings = await repository.getClinicSettings();
  const source = resolveRateSource(settings.preferredRateSource);

  let tasa: number;
  let fuenteTasa: string;

  if (paidAt) {
    /*
     * COBRO ATRASADO: se usa la tasa de ESE día.
     *
     * `getRateAsOf` la busca primero en lo que el sistema guardó ese día y,
     * si no está, en el histórico oficial de DolarAPI, que sí publica día a
     * día; de paso la guarda para la próxima. La pantalla ya se la enseñó a
     * recepción al elegir la fecha.
     *
     * Si no hay ninguna, NO se coge una cercana: la tasa se mueve casi a
     * diario, y una aproximada escribe en la factura unos bolívares que
     * nunca entraron en la gaveta. Se le pide a quien cobra, que ese día sí
     * la sabe.
     */
    const delDia = await getRateAsOf(source, paidAt);

    if (delDia.rate) {
      tasa = delDia.rate.rate;
      fuenteTasa = delDia.rate.source;
    } else if (d.tasaManual !== null) {
      tasa = d.tasaManual;
      // Queda escrito que esa tasa la puso una persona, no la fuente oficial.
      fuenteTasa = `${source}_MANUAL`;
    } else {
      const pista = delDia.aproximada
        ? ` La más cercana que tengo es ${delDia.aproximada.rate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs del ${new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'long', timeZone: 'America/Caracas' }).format(delDia.aproximada.publishedAt)}.`
        : '';
      return {
        ok: false,
        field: 'tasaManual',
        error:
          `No tengo la tasa del ${d.fechaCobro}, así que no puedo calcular los bolívares de ese día.${pista}` +
          ' Escribe la tasa que se usó ese día para registrarlo.',
      };
    }
  } else {
    const actual = await getCurrentRate(source);
    if (!actual) {
      return {
        ok: false,
        error: 'No hay tasa de cambio disponible. Actualízala antes de cobrar.',
      };
    }
    tasa = actual.rate;
    fuenteTasa = actual.source;
  }

  const result = await repository.registerInvoicePayment({
    invoiceId: d.invoiceId,
    amountCents: Math.round(d.amountInUsd * 100),
    method: kind as 'CASH' | 'CARD' | 'TRANSFER' | 'INSURANCE',
    methodLabel: labelParts.join('|') || null,
    externalReference: d.externalReference,
    exchangeRate: tasa,
    exchangeRateSource: fuenteTasa,
    userId: auth.userId,
    paidAt,
  });

  if (!result.ok) {
    if (result.reason === 'DUPLICATE') {
      const mensajes: Record<string, string> = {
        status: 'Esa factura está anulada.',
        invoiceId: 'Esa factura ya está saldada.',
      };
      return { ok: false, error: mensajes[result.field] ?? 'No se pudo registrar el cobro.' };
    }
    return { ok: false, error: 'Esa factura ya no existe.' };
  }

  revalidatePath(`/facturas/${d.invoiceId}`);
  revalidatePath('/caja');
  revalidatePath('/agenda');

  // Un cobro que salda la factura cierra la cita: misma pregunta que
  // «Completar» en la agenda. El servicio se calla si sólo fue un abono.
  await preguntarSiCerroLaCita(d.invoiceId);

  // Pagó de más: el vuelto quedó de bonificación. Se avisa para que quien
  // cobró sepa que no hay que devolverlo en efectivo — ya quedó guardado.
  if (result.data.creditAddedCents > 0) {
    return {
      ok: true,
      warning: `Pagó de más: se guardaron $${(result.data.creditAddedCents / 100).toFixed(2)} como bonificación a favor del paciente.`,
    };
  }
  return { ok: true };
}

/**
 * Gasta la bonificación disponible del paciente contra el saldo de esta
 * factura. Queda registrada como un cobro más, con método "Bonificación".
 */
export async function applyPatientCreditAction(invoiceId: string): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const parsed = cuidSchema.safeParse(invoiceId);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };

  const settings = await repository.getClinicSettings();
  const source = resolveRateSource(settings.preferredRateSource);
  const rate = await getCurrentRate(source);
  if (!rate) {
    return { ok: false, error: 'No hay tasa de cambio disponible. Actualízala antes de cobrar.' };
  }

  const result = await repository.applyPatientCredit({
    invoiceId: parsed.data,
    exchangeRate: rate.rate,
    exchangeRateSource: rate.source,
    userId: auth.userId,
  });

  if (!result.ok) {
    const mensajes: Record<string, string> = {
      NO_CREDIT: 'Este paciente no tiene bonificación disponible.',
      status: 'Esa factura está anulada.',
      invoiceId: 'Esa factura ya está saldada.',
    };
    const clave = result.reason === 'DUPLICATE' ? result.field : result.reason;
    return { ok: false, error: mensajes[clave] ?? 'No se pudo aplicar la bonificación.' };
  }

  revalidatePath(`/facturas/${parsed.data}`);
  revalidatePath('/caja');
  await preguntarSiCerroLaCita(parsed.data);
  return { ok: true };
}

export async function voidInvoiceAction(id: string, reason: string): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const parsed = cuidSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };
  if (!reason.trim()) return { ok: false, error: 'Indica por qué se anula.' };

  const result = await repository.voidInvoice({
    id: parsed.data,
    reason: reason.trim().slice(0, 300),
    userId: auth.userId,
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === 'DUPLICATE'
          ? 'Esa factura ya tiene cobros: para deshacerlos hace falta una devolución, no una anulación.'
          : 'Esa factura ya no existe.',
    };
  }

  revalidatePath(`/facturas/${parsed.data}`);
  revalidatePath('/facturas');
  return { ok: true };
}

/**
 * Reversa una venta YA COBRADA — para limpiar pruebas, no para devoluciones
 * a un paciente real. Sólo Super Admin: deshace dinero que el dashboard y la
 * caja ya contaron, así que no puede quedar a un clic de cualquiera.
 */
export async function reverseInvoiceAction(
  id: string,
  reason: string,
  force = false,
): Promise<ActionResult> {
  const authorization = await checkApiRole('SUPER_ADMIN');
  if (!authorization.authorized) {
    return {
      ok: false,
      error: authorization.status === 401 ? 'Tu sesión expiró.' : 'Sólo un administrador puede hacer esto.',
    };
  }

  const parsed = cuidSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };
  if (!reason.trim()) return { ok: false, error: 'Indica por qué se reversa.' };

  const result = await repository.reverseInvoice({
    id: parsed.data,
    reason: reason.trim().slice(0, 300),
    userId: authorization.user.id,
    force,
  });

  if (!result.ok) {
    const mensajes: Record<string, string> = {
      ALREADY_VOID: 'Esa factura ya está anulada.',
      NO_PAYMENTS: 'Esa factura no tiene cobros: para anularla usa «Anular factura».',
      PAID_OUT:
        'Ya se liquidó al odontólogo su parte de este cobro. Si era una liquidación de PRUEBA, puedes forzarlo — ajusta esa liquidación.',
      NOT_FOUND: 'Esa factura ya no existe.',
    };
    return { ok: false, error: mensajes[result.reason] ?? 'No se pudo reversar la venta.', field: result.reason };
  }

  revalidatePath(`/facturas/${parsed.data}`);
  revalidatePath('/facturas');
  revalidatePath('/caja');
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Borra una factura de PRUEBA de verdad — la fila desaparece, no queda ni
 * anulada. Es la excepción a "una factura entregada existió y no se borra":
 * sólo para limpiar lo que nunca debió existir. Sólo Super Admin.
 */
export async function deleteInvoicePermanentlyAction(
  id: string,
  force = false,
): Promise<ActionResult> {
  const authorization = await checkApiRole('SUPER_ADMIN');
  if (!authorization.authorized) {
    return {
      ok: false,
      error: authorization.status === 401 ? 'Tu sesión expiró.' : 'Sólo un administrador puede hacer esto.',
    };
  }

  const parsed = cuidSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };

  const result = await repository.deleteInvoicePermanently({
    id: parsed.data,
    userId: authorization.user.id,
    force,
  });

  if (!result.ok) {
    const mensajes: Record<string, string> = {
      PAID_OUT:
        'Ya se liquidó al odontólogo su parte de este cobro. Si era una liquidación de PRUEBA, puedes forzarlo — ajusta esa liquidación.',
      NOT_FOUND: 'Esa factura ya no existe.',
    };
    return { ok: false, error: mensajes[result.reason] ?? 'No se pudo borrar la factura.', field: result.reason };
  }

  revalidatePath('/facturas');
  revalidatePath('/caja');
  revalidatePath('/dashboard');
  return { ok: true };
}

const RAZON_APLICAR_PROMOCION: Record<string, string> = {
  NOT_FOUND: 'Esa factura o esa promoción ya no existen.',
  VOID: 'Esta factura está anulada; no se le puede aplicar nada.',
  INACTIVE: 'Esta promoción no está vigente ahora mismo.',
  ALREADY_APPLIED: 'Esta promoción ya se aplicó a esta factura.',
  MISSING_TREATMENTS:
    'Algún tratamiento de la promoción ya no existe en el catálogo. Revísala en Descuentos.',
  NO_LINES:
    'Esta promoción no exige un tratamiento concreto: añade primero algo a la factura para poder repartir el descuento.',
  PACKAGE_NOT_CHEAPER:
    'El precio del paquete no es menor que la suma de sus tratamientos. Revisa el importe de la promoción.',
};

/**
 * Aplica una promoción del catálogo a esta factura: añade lo que haga falta
 * y calcula el descuento, en un solo clic.
 */
export async function applyPromotionAction(input: unknown): Promise<ActionResult> {
  const auth = await autorizar();
  if (!auth.ok) return auth.result;

  const parsed = z
    .object({ invoiceId: cuidSchema, promotionId: cuidSchema })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const result = await repository.applyPromotion({ ...parsed.data, userId: auth.userId });

  if (!result.ok) {
    return { ok: false, error: RAZON_APLICAR_PROMOCION[result.reason] ?? 'No se pudo aplicar.' };
  }

  revalidatePath(`/facturas/${parsed.data.invoiceId}`);
  return { ok: true, invoiceId: parsed.data.invoiceId };
}

/* ===========================================================================
 *  Consultar la tasa de un día pasado ANTES de cobrar
 * ===========================================================================
 *  Sin esto, la única forma de enterarse de que faltaba la tasa era mandar
 *  el cobro y que lo rebotara. Ahora, al elegir la fecha, recepción ve la
 *  tasa que se va a usar —o el aviso de que hay que escribirla— antes de
 *  tocar nada.
 *
 *  Es SÓLO informativa: el cobro vuelve a leer la tasa en el servidor. Que
 *  se enseñe aquí no la convierte en un dato en el que se pueda confiar.
 * =========================================================================== */

export interface TasaDelDiaConsulta {
  /** Tasa oficial de ese día. `null` → hay que escribirla a mano. */
  rate: number | null;
  /** 'EURO', 'BCV'… La fuente configurada en la clínica. */
  source: string;
  /** Día del que es la tasa, ya en texto: "1 de septiembre de 2026". */
  fechaLabel: string;
  /** Referencia más cercana cuando no hay la del día. Nunca se cobra con ella. */
  aproximada: { rate: number; fechaLabel: string } | null;
}

export async function consultarTasaDelDiaAction(
  fecha: unknown,
): Promise<TasaDelDiaConsulta | null> {
  const auth = await autorizar();
  if (!auth.ok) return null;

  const dia = typeof fecha === 'string' ? fecha.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;

  const settings = await repository.getClinicSettings();
  const source = resolveRateSource(settings.preferredRateSource);

  // Mediodía: así la conversión a instante no cae en el borde del día.
  const instante = clinicWallClockToInstant(dia, 12 * 60);
  if (dia > clinicDayKey(new Date())) return null;

  const etiqueta = (d: Date) =>
    new Intl.DateTimeFormat('es-VE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Caracas',
    }).format(d);

  const delDia = await getRateAsOf(source, instante);

  return {
    rate: delDia.rate?.rate ?? null,
    source,
    fechaLabel: etiqueta(instante),
    aproximada: delDia.aproximada
      ? { rate: delDia.aproximada.rate, fechaLabel: etiqueta(delDia.aproximada.publishedAt) }
      : null,
  };
}

/**
 * Si la factura venía de una cita y el cobro la dejó atendida, se le
 * pregunta al paciente por su odontólogo de preferencia. Una venta directa
 * sin cita no tiene con quién seguir, así que no hay nada que preguntar.
 */
async function preguntarSiCerroLaCita(invoiceId: string): Promise<void> {
  const factura = await repository.getInvoice(invoiceId);
  if (factura?.appointmentId) {
    await preguntarPorOdontologoDePreferencia({ appointmentId: factura.appointmentId });
  }
}
