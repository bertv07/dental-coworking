'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { cuidSchema } from '@/backend/validators/common';
import { getCurrentRate, resolveRateSource } from '@/backend/services/exchange-rate.service';

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

  /*
   * La tasa se lee AQUÍ, no llega del formulario.
   *
   * Es lo que convierte dólares en los bolívares que entran en la gaveta: si
   * viniera del cliente, se podría registrar un cobro a una tasa inventada y
   * el arqueo cuadraría con dinero que nadie entregó.
   */
  const settings = await repository.getClinicSettings();
  const source = resolveRateSource(settings.preferredRateSource);
  const rate = await getCurrentRate(source);

  if (!rate) {
    return {
      ok: false,
      error: 'No hay tasa de cambio disponible. Actualízala antes de cobrar.',
    };
  }

  const result = await repository.registerInvoicePayment({
    invoiceId: d.invoiceId,
    amountCents: Math.round(d.amountInUsd * 100),
    method: kind as 'CASH' | 'CARD' | 'TRANSFER' | 'INSURANCE',
    methodLabel: labelParts.join('|') || null,
    externalReference: d.externalReference,
    exchangeRate: rate.rate,
    exchangeRateSource: rate.source,
    userId: auth.userId,
  });

  if (!result.ok) {
    if (result.reason === 'DUPLICATE') {
      const mensajes: Record<string, string> = {
        status: 'Esa factura está anulada.',
        invoiceId: 'Esa factura ya está saldada.',
        amountCents: 'El importe supera el saldo pendiente.',
      };
      return { ok: false, error: mensajes[result.field] ?? 'No se pudo registrar el cobro.' };
    }
    return { ok: false, error: 'Esa factura ya no existe.' };
  }

  revalidatePath(`/facturas/${d.invoiceId}`);
  revalidatePath('/caja');
  revalidatePath('/agenda');
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
