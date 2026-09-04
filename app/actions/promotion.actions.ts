'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';

/**
 * ===========================================================================
 *  Promociones
 * ===========================================================================
 *  «Si te haces la limpieza, la consulta va gratis.»
 *
 *  Este archivo sólo guarda el CATÁLOGO: qué ofrece la clínica y cómo se lo
 *  dice el bot por WhatsApp. Guardar o editar una promoción aquí NUNCA toca
 *  dinero — ni de facturas abiertas ni de nada.
 *
 *  Aplicar de verdad una promoción a una factura concreta —la parte que sí
 *  calcula el descuento— es una acción aparte y vive en
 *  `applyPromotionAction`, en `invoice.actions.ts`: recepción la dispara con
 *  un clic desde la factura, nunca ocurre sola. Así, cambiar el precio de una
 *  promoción hoy no mueve ni un centavo de lo que ya se le aplicó ayer a otro
 *  paciente — eso ya quedó congelado en esa factura.
 *
 *  ACCESO: asistente o superior. Recepción es quien negocia en el mostrador.
 * ===========================================================================
 */

export interface PromotionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const CODIGO = /^[A-Z0-9_]{2,40}$/;

const promotionSchema = z
  .object({
    name: z.string().trim().min(3, 'Ponle un nombre').max(80),
    description: z.string().trim().max(400).optional(),
    /** Códigos separados por comas, como se escriben de verdad. */
    requiredTreatmentCodes: z
      .string()
      .max(400)
      .optional()
      .transform((v) =>
        (v ?? '')
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
      )
      .refine((lista) => lista.every((c) => CODIGO.test(c)), {
        message: 'Hay un código de tratamiento con caracteres no permitidos',
      }),
    benefitKind: z.enum(['FREE_TREATMENT', 'PERCENT_OFF', 'AMOUNT_OFF', 'PACKAGE_PRICE']),
    benefitTreatmentCode: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v ? v.toUpperCase() : null)),
    /**
     * Porcentaje, o importe en DÓLARES tal como se escribe en pantalla.
     *
     * Se convierte a centavos aquí abajo: quien rellena el formulario piensa
     * en «10», no en «1000».
     */
    benefitValue: z.coerce.number().min(0).max(100_000),
    botPitch: z.string().trim().max(300).optional(),
    startsAt: z.string().trim().max(10).optional(),
    endsAt: z.string().trim().max(10).optional(),
    isActive: z.coerce.boolean().default(true),
  })
  .refine(
    (d) => d.benefitKind !== 'FREE_TREATMENT' || Boolean(d.benefitTreatmentCode),
    { message: 'Di qué tratamiento va gratis', path: ['benefitTreatmentCode'] },
  )
  .refine((d) => d.benefitKind !== 'PERCENT_OFF' || (d.benefitValue >= 1 && d.benefitValue <= 100), {
    message: 'El porcentaje va de 1 a 100',
    path: ['benefitValue'],
  })
  .refine((d) => d.benefitKind !== 'AMOUNT_OFF' || d.benefitValue > 0, {
    message: 'Pon el importe del descuento',
    path: ['benefitValue'],
  })
  .refine((d) => d.benefitKind !== 'PACKAGE_PRICE' || d.requiredTreatmentCodes.length >= 2, {
    message: 'Un paquete necesita al menos dos tratamientos',
    path: ['requiredTreatmentCodes'],
  })
  .refine((d) => d.benefitKind !== 'PACKAGE_PRICE' || d.benefitValue > 0, {
    message: 'Pon el precio del paquete',
    path: ['benefitValue'],
  });

function aFecha(valor: string | undefined): Date | null {
  if (!valor) return null;
  const d = new Date(`${valor}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function leer(formData: FormData) {
  return promotionSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description') ?? undefined,
    requiredTreatmentCodes: formData.get('requiredTreatmentCodes') ?? undefined,
    benefitKind: formData.get('benefitKind'),
    benefitTreatmentCode: formData.get('benefitTreatmentCode') ?? undefined,
    benefitValue: formData.get('benefitValue') ?? 0,
    botPitch: formData.get('botPitch') ?? undefined,
    startsAt: formData.get('startsAt') ?? undefined,
    endsAt: formData.get('endsAt') ?? undefined,
    isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true',
  });
}

function aEntrada(data: z.infer<typeof promotionSchema>) {
  return {
    name: data.name,
    description: data.description || null,
    requiredTreatmentCodes: data.requiredTreatmentCodes,
    benefitKind: data.benefitKind,
    benefitTreatmentCode: data.benefitTreatmentCode,
    // Los importes viven en centavos en toda la aplicación; el porcentaje no.
    // El paquete se escribe en dólares igual que el importe fijo: quien
    // rellena el formulario piensa en "$45", no en "4500".
    benefitValue:
      data.benefitKind === 'AMOUNT_OFF' || data.benefitKind === 'PACKAGE_PRICE'
        ? Math.round(data.benefitValue * 100)
        : Math.round(data.benefitValue),
    botPitch: data.botPitch || null,
    startsAt: aFecha(data.startsAt),
    endsAt: aFecha(data.endsAt),
    isActive: data.isActive,
  };
}

async function autorizar() {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return {
      ok: false as const,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para esto.',
    };
  }
  return { ok: true as const, userId: authorization.user.id };
}

export async function savePromotionAction(formData: FormData): Promise<PromotionResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = leer(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const id = String(formData.get('id') ?? '').trim();
  const entrada = aEntrada(parsed.data);

  const result = id
    ? await repository.updatePromotion(id, entrada)
    : await repository.createPromotion(entrada, auth.userId);

  if (!result.ok) return { ok: false, error: 'No se pudo guardar la promoción.' };

  revalidatePath('/descuentos');
  return { ok: true, id: result.data?.id };
}

export async function deletePromotionAction(id: unknown): Promise<PromotionResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = z.string().min(1).max(40).safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };

  const result = await repository.deletePromotion(parsed.data);
  if (!result.ok) return { ok: false, error: 'No se pudo quitar la promoción.' };

  revalidatePath('/descuentos');
  return { ok: true };
}
