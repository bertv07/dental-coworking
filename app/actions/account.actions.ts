'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { hashPassword, verifyPassword, PASSWORD_POLICY } from '@/backend/auth/password';
import { passwordChangeSchema } from '@/backend/validators/admin.schema';
import { cuidSchema } from '@/backend/validators/common';
import { checkRateLimit } from '@/backend/http/rate-limit';
import { signOut } from '@/backend/auth/auth.config';
import { env } from '@/backend/config/env';
import {
  generateTemporaryPassword,
  generateResetToken,
  hashResetToken,
  sendStaffInvite,
} from '@/backend/services/staff-invite.service';

/**
 * ===========================================================================
 *  Server Actions de la propia cuenta
 * ===========================================================================
 *  Aquí sólo hay cosas que un usuario hace SOBRE SÍ MISMO. Ninguna acepta un
 *  `userId`: la cuenta afectada sale siempre de la sesión.
 *
 *  Es la diferencia entre «cambiar mi contraseña» y «cambiarle la contraseña
 *  a alguien». Lo segundo es una operación de administración con otras
 *  consecuencias (avisar a la persona, registrar quién lo hizo) y no se cuela
 *  aquí por aceptar un parámetro de más.
 * ===========================================================================
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
  /** Salió bien, pero hay algo que decir (ej: el correo no se pudo enviar). */
  warning?: string;
}

/**
 * El administrador le regenera la clave a un odontólogo.
 *
 * El caso real: perdió el correo de invitación, o se le olvidó y no tiene
 * acceso al buzón. No se le "recupera" la que tenía —nadie la sabe, está
 * hasheada— sino que se le pone una nueva y se le manda.
 *
 * Sólo Super Admin: es tomar el control de la cuenta de otra persona.
 */
export async function resetDentistPasswordAction(dentistId: string): Promise<ActionResult> {
  const authorization = await checkApiRole('SUPER_ADMIN');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para restablecer contraseñas.',
    };
  }

  const parsedId = cuidSchema.safeParse(dentistId);
  if (!parsedId.success) return { ok: false, error: 'Identificador inválido' };

  try {
    const temporaryPassword = generateTemporaryPassword();

    const result = await repository.resetPasswordAsAdmin({
      dentistId: parsedId.data,
      passwordHash: await hashPassword(temporaryPassword),
      userId: authorization.user.id,
    });

    if (!result.ok) {
      return {
        ok: false,
        error: 'Ese odontólogo no tiene cuenta de acceso al panel.',
      };
    }

    // Igual que en el alta: primero la base, después el correo. Al revés, un
    // fallo al guardar dejaría una clave enviada que no sirve.
    const delivery = await sendStaffInvite({
      kind: 'STAFF_PASSWORD_RESET',
      email: result.data.email,
      fullName: result.data.fullName,
      temporaryPassword,
      role: 'Odontólogo',
      loginUrl: `${env.APP_ORIGIN}/login`,
    });

    revalidatePath('/odontologos');

    if (delivery.status !== 'SENT') {
      /*
       * La clave NO se devuelve a la interfaz aunque el correo falle. Ya está
       * hasheada y no hay forma de recuperarla: hay que volver a
       * restablecerla. Devolverla aquí la dejaría en el HTML y en cualquier
       * captura de pantalla.
       */
      return {
        ok: true,
        warning:
          delivery.status === 'PENDING'
            ? 'La clave se restableció, pero el envío de correo no está configurado (STAFF_EMAIL_WEBHOOK_URL). Esa persona no puede entrar hasta que se lo configures y lo repitas.'
            : `La clave se restableció, pero el correo no salió (${delivery.reason}). Vuelve a intentarlo.`,
      };
    }

    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'user.admin_reset_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo restablecer la contraseña.' };
  }
}

/**
 * Cambia la contraseña de la cuenta en sesión.
 *
 * Pide la contraseña ACTUAL aunque ya haya sesión iniciada. No es burocracia:
 * una sesión abierta en un equipo compartido, o robada, alcanzaría para
 * quedarse con la cuenta para siempre. Exigir la actual hace que el poseedor
 * de un navegador no baste — hay que saber el secreto.
 */
export async function changePasswordAction(input: unknown): Promise<ActionResult> {
  const authorization = await checkApiRole('DENTIST');
  if (!authorization.authorized) {
    return {
      ok: false,
      error:
        authorization.status === 401
          ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
          : 'No tienes permiso para esto.',
    };
  }

  const { user } = authorization;

  /*
   * Límite por cuenta. Sin él, quien se sienta delante de una sesión abierta
   * puede probar contraseñas actuales a ciegas: el formulario de cambio se
   * convierte en un oráculo para adivinar la clave sin pasar por el login,
   * que sí está limitado.
   */
  const limit = checkRateLimit(`password-change:${user.id}`, {
    limit: 5,
    windowSeconds: 900,
  });

  if (!limit.allowed) {
    return {
      ok: false,
      error: `Demasiados intentos. Espera ${Math.ceil(limit.retryAfterSeconds / 60)} minutos.`,
    };
  }

  const validation = passwordChangeSchema.safeParse(input);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  const { currentPassword, newPassword } = validation.data;

  try {
    // La contraseña actual se verifica contra el hash guardado. `findUserForLogin`
    // es la única vía que devuelve el hash, y por eso lleva ese nombre.
    const account = await repository.findUserForLogin(user.email);
    if (!account) {
      return { ok: false, error: 'No se encontró la cuenta.' };
    }

    const correcta = await verifyPassword(currentPassword, account.passwordHash);
    if (!correcta) {
      return {
        ok: false,
        error: 'La contraseña actual no es correcta.',
        field: 'currentPassword',
      };
    }

    const result = await repository.changePassword({
      userId: user.id,
      passwordHash: await hashPassword(newPassword),
    });

    if (!result.ok) {
      return { ok: false, error: 'No se pudo cambiar la contraseña.' };
    }
  } catch (error) {
    // El detalle al log; al cliente nada que describa la estructura interna.
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'user.password_change_failed',
        userId: user.id,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo cambiar la contraseña. Intenta de nuevo.' };
  }

  /*
   * Fuera del `try`: `signOut` redirige lanzando una excepción de control de
   * Next, y capturarla aquí la convertiría en un "no se pudo cambiar" cuando
   * en realidad ya se cambió.
   *
   * Se cierra la sesión porque el cambio adelantó `sessionsValidFrom`, así
   * que este token acaba de quedar invalidado — incluido el de este mismo
   * navegador. Volver a entrar con la contraseña nueva es la confirmación de
   * que quedó puesta.
   */
  await signOut({ redirectTo: '/login?clave=cambiada' });

  // Inalcanzable: `signOut` ya redirigió. Está por si algún día deja de
  // hacerlo, para no devolver un `ok` silencioso sin haber redirigido.
  redirect('/login?clave=cambiada');
}

// ===========================================================================
//  RECUPERAR CONTRASEÑA OLVIDADA  (sin sesión)
// ===========================================================================
//  Estas dos acciones son PÚBLICAS: las llama alguien que no puede entrar.
//  Por eso son las más expuestas del sistema y las que más cuidado piden.
// ===========================================================================

/**
 * Pide un enlace de recuperación.
 *
 * ⚠️  RESPONDE SIEMPRE LO MISMO, exista la cuenta o no.
 *
 *  Si dijera «ese correo no está registrado», el formulario se convertiría en
 *  una forma de averiguar qué correos tienen cuenta en la clínica — y con esa
 *  lista, en un objetivo para adivinar contraseñas. La respuesta uniforme es
 *  la funcionalidad, no una omisión.
 */
export async function requestPasswordResetAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().email('Escribe un correo válido') })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: 'Escribe un correo válido', field: 'email' };
  }

  /*
   * Límite por correo. Sin él, este formulario es un cañón de spam gratuito:
   * cualquiera puede pedir cien enlaces al buzón de otra persona.
   */
  const limit = checkRateLimit(`password-reset:${parsed.data.email}`, {
    limit: 3,
    windowSeconds: 900,
  });

  // Incluso al limitar se responde igual: un mensaje distinto delataría que
  // ese correo recibió intentos, y por tanto que existe.
  if (!limit.allowed) return { ok: true };

  try {
    const token = generateResetToken();

    const account = await repository.createPasswordResetToken({
      email: parsed.data.email,
      tokenHash: hashResetToken(token),
      // Una hora. Un enlace que vale una semana es una llave de repuesto
      // olvidada en el buzón.
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      requestedIp: null,
    });

    // No existe, está suspendida o borrada: se corta aquí en silencio.
    if (account) {
      await sendStaffInvite({
        kind: 'STAFF_PASSWORD_RECOVERY',
        email: account.email,
        fullName: account.fullName,
        // Va el ENLACE, no una contraseña: nada utilizable si el correo se
        // filtra después de que ella lo use, porque el token es de un solo uso.
        resetUrl: `${env.APP_ORIGIN}/restablecer?token=${token}`,
        role: 'Personal',
        loginUrl: `${env.APP_ORIGIN}/login`,
      });
    }
  } catch (error) {
    // Ni siquiera un fallo interno cambia lo que ve quien lo pidió.
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'password_reset.request_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  return { ok: true };
}

/**
 * Canjea el enlace y pone la contraseña nueva.
 *
 * No dice si el token no existe, ya se usó o caducó: los tres son «este
 * enlace ya no vale». Distinguirlos permitiría sondear tokens.
 */
export async function redeemPasswordResetAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/, 'Enlace inválido'),
      newPassword: z
        .string()
        .min(
          PASSWORD_POLICY.minLength,
          `La contraseña debe tener al menos ${PASSWORD_POLICY.minLength} caracteres`,
        )
        .max(PASSWORD_POLICY.maxLength, 'La contraseña es demasiado larga'),
      confirmPassword: z.string(),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: 'Las dos contraseñas no coinciden',
      path: ['confirmPassword'],
    })
    .safeParse(input);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Datos inválidos', field: issue?.path.join('.') };
  }

  try {
    const result = await repository.redeemPasswordResetToken({
      tokenHash: hashResetToken(parsed.data.token),
      passwordHash: await hashPassword(parsed.data.newPassword),
    });

    if (!result.ok) {
      return {
        ok: false,
        error:
          'Este enlace ya no vale: puede haber caducado o haberse usado. Pide uno nuevo.',
      };
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'password_reset.redeem_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, error: 'No se pudo cambiar la contraseña. Intenta de nuevo.' };
  }

  return { ok: true };
}
