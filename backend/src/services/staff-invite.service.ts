import 'server-only';
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { env } from '@/backend/config/env';

/**
 * ===========================================================================
 *  Invitaciones al personal — el correo lo manda n8n
 * ===========================================================================
 *  Cuando se da de alta a un odontólogo con acceso al panel, hay que hacerle
 *  llegar sus credenciales. Este proyecto NO habla con Gmail ni con ningún
 *  proveedor de correo: hace un POST al webhook de n8n, que es quien ya tiene
 *  la cuenta conectada y la credencial de envío.
 *
 *  Es la misma decisión que con WhatsApp (`whatsapp-outbound.service.ts`) y
 *  por el mismo motivo: duplicar la integración aquí significaría mantener
 *  dos caminos de salida, dos juegos de credenciales y dos sitios donde
 *  revocarlas el día que haga falta.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ SE MANDA UNA CLAVE TEMPORAL Y NO LA DEFINITIVA
 *  ---------------------------------------------------------------------
 *  Un correo no es un canal seguro: queda en el buzón, pasa por n8n, y
 *  cualquiera con acceso a cualquiera de esas dos cosas la lee. Así que lo
 *  que viaja es una clave de un solo uso práctico: la cuenta nace con
 *  `mustChangePassword`, y el panel no deja hacer NADA hasta cambiarla.
 *
 *  La ventana de exposición existe —entre que se envía y se cambia— y no se
 *  puede eliminar sin un canal aparte. Lo que sí se hace es acortarla: la
 *  clave no sirve para nada más que para poner la definitiva.
 *
 *  ⚠️  La contraseña temporal NO se guarda en claro en ningún sitio. Se
 *   genera, se hashea para la base y se manda al webhook. Si el envío falla,
 *   NO se puede reenviar la misma: hay que regenerarla.
 * ===========================================================================
 */

export type InviteOutcome =
  | { status: 'SENT' }
  | { status: 'PENDING'; reason: string }
  | { status: 'FAILED'; reason: string };

/** No se deja colgada la petición del alta esperando a un webhook lento. */
const INVITE_TIMEOUT_MS = 8000;

/**
 * Alfabeto sin caracteres ambiguos.
 *
 * Fuera `O`/`0`, `l`/`1`/`I`: la clave se lee de un correo y a veces se
 * teclea a mano. Una confusión ahí gasta un intento de login y, a la tercera,
 * bloquea la cuenta recién creada.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Contraseña temporal de 16 caracteres.
 *
 * `randomInt` del módulo `crypto`, no `Math.random()`: la segunda es
 * predecible a partir de unas pocas salidas, y esto protege una cuenta con
 * acceso a datos clínicos.
 *
 * El rechazo de módulo lo maneja `randomInt` internamente, así que la
 * distribución sobre el alfabeto es uniforme.
 */
export function generateTemporaryPassword(): string {
  let password = '';
  for (let i = 0; i < 16; i += 1) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }
  return password;
}

/**
 * Token de recuperación de contraseña.
 *
 * 32 bytes en hex: 256 bits de entropía real. Va en la URL del correo, así
 * que usa el alfabeto hexadecimal —sin caracteres que un cliente de correo
 * pueda romper al construir el enlace.
 *
 * Lo que se guarda en la base es su SHA-256, nunca esto.
 */
export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

/** Hashea un token para guardarlo o para buscarlo al canjearlo. */
export function hashResetToken(token: string): string {
  /*
   * SHA-256 y no Argon2, a diferencia de las contraseñas: el token lo genera
   * el servidor con 256 bits de entropía, así que no hay diccionario que lo
   * ataque. El coste de Argon2 sólo se justifica frente a secretos de baja
   * entropía elegidos por humanos.
   */
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Qué correo se pide. n8n redacta cada uno distinto: no es lo mismo darle la
 * bienvenida a alguien que avisarle de que le restablecieron la clave.
 */
export type StaffEmailKind =
  /** Alta: «te hemos creado una cuenta». */
  | 'STAFF_INVITE'
  /** El administrador le regeneró la clave. */
  | 'STAFF_PASSWORD_RESET'
  /** Ella misma pidió recuperarla desde el login: va un ENLACE, no una clave. */
  | 'STAFF_PASSWORD_RECOVERY';

/**
 * Pide a n8n que envíe el correo de bienvenida con las credenciales.
 *
 * Nunca lanza: devuelve el resultado para que el llamador decida. Un fallo de
 * envío no debe deshacer el alta del odontólogo —ya está en el sistema y se
 * le pueden agendar citas—, pero sí tiene que verse en la interfaz para que
 * alguien le haga llegar la clave por otra vía.
 */
export async function sendStaffInvite(params: {
  email: string;
  fullName: string;
  /** Clave temporal. Ausente en `STAFF_PASSWORD_RECOVERY`, que manda enlace. */
  temporaryPassword?: string;
  /** Enlace de un solo uso. Sólo en `STAFF_PASSWORD_RECOVERY`. */
  resetUrl?: string;
  role: string;
  loginUrl: string;
  kind?: StaffEmailKind;
}): Promise<InviteOutcome> {
  const webhookUrl = process.env.STAFF_EMAIL_WEBHOOK_URL;

  // Sin webhook no se puede entregar. Se dice claramente en vez de fingir que
  // se mandó: el administrador tiene que saber que debe dar la clave a mano.
  if (!webhookUrl) {
    return {
      status: 'PENDING',
      reason: 'Falta configurar STAFF_EMAIL_WEBHOOK_URL',
    };
  }

  const payload = JSON.stringify({
    type: params.kind ?? 'STAFF_INVITE',
    to: params.email,
    fullName: params.fullName,
    role: params.role,
    // Sólo va uno de los dos, según el tipo: la clave temporal en el alta y
    // el restablecimiento; el enlace cuando la pidió ella desde el login.
    temporaryPassword: params.temporaryPassword ?? null,
    resetUrl: params.resetUrl ?? null,
    loginUrl: params.loginUrl,
    // Para que n8n pueda descartar reenvíos si el mismo evento le llega dos
    // veces por un reintento.
    issuedAt: new Date().toISOString(),
  });

  // Misma firma HMAC que el resto de la integración: n8n ya sabe verificarla
  // y no hay un segundo esquema de autenticación que mantener.
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', env.AUTOMATION_HMAC_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(INVITE_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'X-Automation-Timestamp': String(timestamp),
        'X-Automation-Signature': signature,
      },
      body: payload,
    });

    if (!response.ok) {
      return { status: 'FAILED', reason: `n8n respondió ${response.status}` };
    }

    return { status: 'SENT' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    /*
     * Se registra el fallo pero NUNCA el payload: lleva la contraseña
     * temporal en claro, y los logs se copian, se agregan y se miran desde
     * sitios donde esa clave no debería acabar.
     */
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'staff_invite.delivery_failed',
        email: params.email,
        message,
      }),
    );

    return {
      status: 'FAILED',
      reason: message.includes('timeout') ? 'Tiempo de espera agotado' : 'Error de conexión',
    };
  }
}

/** ¿Está configurado el envío de correo? Lo consulta la UI para avisar. */
export function isStaffEmailConfigured(): boolean {
  return Boolean(process.env.STAFF_EMAIL_WEBHOOK_URL);
}
