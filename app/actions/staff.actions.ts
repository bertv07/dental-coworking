'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { env } from '@/backend/config/env';
import { hashPassword } from '@/backend/auth/password';
import {
  generateTemporaryPassword,
  sendStaffInvite,
} from '@/backend/services/staff-invite.service';

/**
 * ===========================================================================
 *  Cuentas del panel
 * ===========================================================================
 *  El administrador da de alta a quien sea —otro administrador, una asistente
 *  o una odontóloga— y el sistema le manda la clave por correo a través de
 *  n8n.
 *
 *  ---------------------------------------------------------------------
 *  LA CLAVE NO LA ESCRIBE NADIE
 *  ---------------------------------------------------------------------
 *  La genera el servidor, se hashea y se envía. Nunca vuelve a la interfaz:
 *  si se devolviera, quedaría en el HTML, en el historial del navegador y en
 *  cualquier captura de pantalla. Y quien la recibe está obligado a cambiarla
 *  al entrar, porque hasta entonces la conocen dos partes.
 *
 *  ---------------------------------------------------------------------
 *  TRES CANDADOS PARA NO QUEDARSE FUERA
 *  ---------------------------------------------------------------------
 *  Son el motivo por el que esta pantalla es peligrosa, y por eso están aquí
 *  y no en la interfaz:
 *
 *   1. Nadie se suspende a sí mismo.
 *   2. Nadie se quita a sí mismo el rol de administrador.
 *   3. No se puede suspender ni degradar al ÚLTIMO administrador activo.
 *
 *  Sin el tercero, dos clics dejan la clínica sin nadie que pueda entrar a
 *  arreglarlo, y eso sólo se resuelve tocando la base a mano.
 * ===========================================================================
 */

export interface StaffResult {
  ok: boolean;
  error?: string;
  warning?: string;
  id?: string;
}

const ROLES = ['SUPER_ADMIN', 'ASSISTANT', 'DENTIST'] as const;

const ROL_LEGIBLE: Record<(typeof ROLES)[number], string> = {
  SUPER_ADMIN: 'Administrador',
  ASSISTANT: 'Asistente',
  DENTIST: 'Odontólogo',
};

const staffSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo inválido').max(160),
  fullName: z.string().trim().min(3, 'Escribe el nombre completo').max(120),
  role: z.enum(ROLES),
  /** E.164 o vacío. Es como el bot identifica al personal por WhatsApp. */
  phoneE164: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\+[1-9]\d{7,14}$/.test(v), {
      message: 'El teléfono va en formato internacional: +584141234567',
    }),
  birthDate: z
    .string()
    .trim()
    .max(10)
    .optional()
    .transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), { message: 'Fecha inválida' }),
  /** Ficha de odontólogo a la que enlazar la cuenta. */
  dentistId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null)),
});

async function autorizar() {
  const authorization = await checkApiRole('SUPER_ADMIN');
  if (!authorization.authorized) {
    return {
      ok: false as const,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'Sólo un administrador puede gestionar las cuentas del panel.',
    };
  }
  return { ok: true as const, userId: authorization.user.id };
}

function leer(formData: FormData) {
  return staffSchema.safeParse({
    email: formData.get('email'),
    fullName: formData.get('fullName'),
    role: formData.get('role'),
    phoneE164: formData.get('phoneE164') ?? undefined,
    birthDate: formData.get('birthDate') ?? undefined,
    dentistId: formData.get('dentistId') ?? undefined,
  });
}

/**
 * El aviso cuando la operación salió bien pero el correo no.
 *
 * `hecho` es la frase ya conjugada —«La cuenta quedó creada»— y no un sujeto
 * suelto: al construirlo con un verbo fijo salía «La cuenta quedó creado».
 */
function avisoDeCorreo(delivery: { status: string; reason?: string }, hecho: string) {
  if (delivery.status === 'SENT') return undefined;
  return delivery.status === 'PENDING'
    ? `${hecho}, pero el envío de correo no está configurado (STAFF_EMAIL_WEBHOOK_URL). Tendrás que usar «Clave nueva» cuando lo configures para que pueda entrar.`
    : `${hecho}, pero el correo no se pudo enviar (${delivery.reason}). Usa «Clave nueva» cuando el correo funcione.`;
}

// ---------------------------------------------------------------------------
//  Alta
// ---------------------------------------------------------------------------

export async function createStaffUserAction(formData: FormData): Promise<StaffResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = leer(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const data = parsed.data;

  if (data.dentistId && data.role !== 'DENTIST') {
    return {
      ok: false,
      error: 'Sólo una cuenta de odontólogo puede enlazarse a una ficha de odontólogo.',
    };
  }

  try {
    /*
     * ORDEN DELIBERADO — primero la base, después el correo.
     *
     * Si se enviara antes, un fallo al guardar dejaría a alguien con una
     * clave por correo para una cuenta que no existe. Al revés, la cuenta
     * queda creada y la pantalla avisa de que hay que darle la clave a mano:
     * eso lo resuelve el administrador en un minuto.
     */
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    const result = await repository.createStaffUser({
      email: data.email,
      fullName: data.fullName,
      role: data.role,
      phoneE164: data.phoneE164,
      birthDate: data.birthDate,
      passwordHash,
      dentistId: data.dentistId,
      createdByUserId: auth.userId,
    });

    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === 'DUPLICATE'
            ? 'Ya hay una cuenta con ese correo o ese teléfono.'
            : 'No se pudo crear la cuenta.',
      };
    }

    const delivery = await sendStaffInvite({
      email: data.email,
      fullName: data.fullName,
      temporaryPassword,
      role: ROL_LEGIBLE[data.role],
      loginUrl: `${env.APP_ORIGIN}/login`,
    });

    revalidatePath('/usuarios');
    return {
      ok: true,
      id: result.data.id,
      warning: avisoDeCorreo(delivery, 'La cuenta quedó creada'),
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'staff.create_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo crear la cuenta. Intenta de nuevo.' };
  }
}

// ---------------------------------------------------------------------------
//  Edición
// ---------------------------------------------------------------------------

export async function updateStaffUserAction(formData: FormData): Promise<StaffResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Falta la cuenta.' };

  const parsed = leer(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  }

  const usuarios = await repository.listStaffUsers();
  const actual = usuarios.find((u) => u.id === id);
  if (!actual) return { ok: false, error: 'Esa cuenta ya no existe.' };

  // Candado 2: nadie se quita a sí mismo el rol de administrador.
  if (id === auth.userId && actual.role === 'SUPER_ADMIN' && parsed.data.role !== 'SUPER_ADMIN') {
    return {
      ok: false,
      error:
        'No puedes quitarte a ti mismo el rol de administrador: perderías el acceso a esta pantalla en el acto.',
    };
  }

  // Candado 3: el último administrador activo no se degrada.
  if (actual.role === 'SUPER_ADMIN' && parsed.data.role !== 'SUPER_ADMIN') {
    const quedan = await repository.countActiveAdmins();
    if (quedan <= 1) {
      return {
        ok: false,
        error:
          'Es el único administrador activo. Crea o reactiva otro antes de cambiarle el rol, o la clínica se queda sin nadie que pueda entrar aquí.',
      };
    }
  }

  const result = await repository.updateStaffUser({
    id,
    fullName: parsed.data.fullName,
    role: parsed.data.role,
    phoneE164: parsed.data.phoneE164,
    birthDate: parsed.data.birthDate,
    userId: auth.userId,
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === 'DUPLICATE'
          ? 'Ese teléfono ya lo tiene otra cuenta.'
          : 'No se pudo guardar la cuenta.',
    };
  }

  revalidatePath('/usuarios');
  return {
    ok: true,
    warning: result.data.roleChanged
      ? 'Le cambiaste el rol, así que se cerró su sesión: tendrá que volver a entrar.'
      : undefined,
  };
}

// ---------------------------------------------------------------------------
//  Suspender / reactivar
// ---------------------------------------------------------------------------

export async function setStaffUserStatusAction(input: unknown): Promise<StaffResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = z
    .object({ id: z.string().min(1).max(40), status: z.enum(['ACTIVE', 'SUSPENDED']) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  // Candado 1: nadie se suspende a sí mismo.
  if (parsed.data.id === auth.userId && parsed.data.status === 'SUSPENDED') {
    return { ok: false, error: 'No puedes suspender tu propia cuenta.' };
  }

  if (parsed.data.status === 'SUSPENDED') {
    const usuarios = await repository.listStaffUsers();
    const objetivo = usuarios.find((u) => u.id === parsed.data.id);
    if (objetivo?.role === 'SUPER_ADMIN') {
      const quedan = await repository.countActiveAdmins();
      if (quedan <= 1) {
        return {
          ok: false,
          error:
            'Es el único administrador activo. Si lo suspendes, nadie podrá entrar a reactivarlo.',
        };
      }
    }
  }

  const result = await repository.setStaffUserStatus({ ...parsed.data, userId: auth.userId });
  if (!result.ok) return { ok: false, error: 'No se pudo cambiar el estado de la cuenta.' };

  revalidatePath('/usuarios');
  return {
    ok: true,
    warning:
      parsed.data.status === 'SUSPENDED'
        ? 'Cuenta suspendida. Se cerraron sus sesiones abiertas.'
        : undefined,
  };
}

// ---------------------------------------------------------------------------
//  Reenviar credenciales
// ---------------------------------------------------------------------------

export async function resendStaffCredentialsAction(id: unknown): Promise<StaffResult> {
  const auth = await autorizar();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = z.string().min(1).max(40).safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido' };

  try {
    /*
     * Se genera una clave NUEVA; la anterior no se puede recuperar porque
     * sólo existe su hash. Es lo correcto además de lo único posible: si la
     * vieja se pudiera reenviar, es que estaba guardada en algún sitio.
     */
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    const result = await repository.resetStaffUserPassword({
      id: parsed.data,
      passwordHash,
      userId: auth.userId,
    });
    if (!result.ok) return { ok: false, error: 'No se pudo restablecer la clave.' };

    const delivery = await sendStaffInvite({
      email: result.data.email,
      fullName: result.data.fullName,
      temporaryPassword,
      role: ROL_LEGIBLE[result.data.role as (typeof ROLES)[number]] ?? result.data.role,
      loginUrl: `${env.APP_ORIGIN}/login`,
    });

    revalidatePath('/usuarios');

    if (delivery.status !== 'SENT') {
      return {
        ok: true,
        warning: avisoDeCorreo(delivery, 'La clave se cambió'),
      };
    }

    return { ok: true, warning: 'Clave nueva enviada. La anterior ya no sirve.' };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'staff.resend_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo reenviar la clave.' };
  }
}
