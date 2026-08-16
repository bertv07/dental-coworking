import 'server-only';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { env } from '@/backend/config/env';

/**
 * ===========================================================================
 *  Autenticación de la automatización (n8n / bot de WhatsApp)
 * ===========================================================================
 *  Estos endpoints NO usan sesión de usuario: los llama una máquina, no un
 *  navegador. Por tanto tampoco aplica CSRF (no hay cookies implicadas).
 *
 *  Esquema: HMAC-SHA256 sobre el cuerpo, con timestamp y anti-replay.
 *
 *  ¿Por qué no un simple `Authorization: Bearer <token>`?
 *  Un bearer estático se filtra en logs, en el historial de un proxy o en
 *  una captura, y quien lo tenga puede reproducir la petición para siempre.
 *  Con HMAC:
 *    - El secreto nunca viaja por la red, sólo la firma derivada.
 *    - La firma cubre el CUERPO: nadie puede alterar la cita en tránsito.
 *    - El timestamp acota la ventana de replay a unos minutos.
 *
 *  Cabeceras que debe enviar n8n:
 *    X-Automation-Key-Id   → prefijo público de la llave (identifica cuál es)
 *    X-Automation-Timestamp→ epoch en SEGUNDOS
 *    X-Automation-Signature→ hex de HMAC-SHA256(`${timestamp}.${rawBody}`)
 * ===========================================================================
 */

export interface AutomationAuthResult {
  ok: boolean;
  /** Prefijo de la llave usada. Sirve para rate-limit y auditoría. */
  keyId?: string;
  /** Motivo del fallo. SÓLO para logs del servidor — nunca al cliente. */
  reason?: string;
}

/**
 * Comparación en tiempo constante de dos cadenas hexadecimales.
 *
 * `a === b` en JS corta en el primer byte distinto, lo que filtra por tiempo
 * cuántos caracteres iniciales acertó el atacante — suficiente para
 * reconstruir una firma byte a byte. `timingSafeEqual` compara siempre el
 * buffer completo.
 */
function safeCompareHex(a: string, b: string): boolean {
  // `timingSafeEqual` lanza si las longitudes difieren; se comprueba antes.
  // La longitud de un HMAC-SHA256 es pública (64 hex), así que no filtra nada.
  if (a.length !== b.length) return false;

  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    // Hex malformado.
    return false;
  }
}

/**
 * Verifica la firma HMAC de una petición entrante.
 *
 * ⚠️  IMPORTANTE: hay que pasar el cuerpo CRUDO, exactamente como llegó.
 *  Si se hace `JSON.parse` y luego `JSON.stringify`, el orden de las claves
 *  o el espaciado cambian y la firma deja de coincidir. En la ruta:
 *      const rawBody = await request.text();   // ← primero firmar
 *      const data = JSON.parse(rawBody);       // ← después parsear
 */
export function verifyAutomationSignature(
  headers: Headers,
  rawBody: string,
): AutomationAuthResult {
  const keyId = headers.get('x-automation-key-id');
  const timestamp = headers.get('x-automation-timestamp');
  const signature = headers.get('x-automation-signature');

  if (!keyId || !timestamp || !signature) {
    return { ok: false, reason: 'Faltan cabeceras de autenticación' };
  }

  // --- 1. Anti-replay: la firma caduca ------------------------------------
  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, keyId, reason: 'Timestamp malformado' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const drift = Math.abs(nowSeconds - timestampSeconds);

  if (drift > env.AUTOMATION_SIGNATURE_TOLERANCE_SECONDS) {
    // Se rechaza también el futuro lejano: un reloj adelantado en el emisor
    // permitiría fabricar firmas válidas por adelantado.
    return { ok: false, keyId, reason: `Timestamp fuera de ventana (${drift}s)` };
  }

  // --- 2. Verificación de la firma ----------------------------------------
  // El timestamp entra en el payload firmado; si no, un atacante podría
  // reutilizar una firma válida cambiando sólo la cabecera de tiempo.
  const expectedSignature = createHmac('sha256', env.AUTOMATION_HMAC_SECRET)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');

  if (!safeCompareHex(signature, expectedSignature)) {
    return { ok: false, keyId, reason: 'Firma inválida' };
  }

  return { ok: true, keyId };
}

/**
 * Genera una llave de automatización nueva.
 *
 * Devuelve el secreto en claro UNA sola vez — se muestra al admin y no se
 * puede recuperar después, igual que un token de GitHub. En la DB queda sólo
 * el hash.
 */
export function generateAutomationKey(): {
  plainKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Buffer.from(randomBytes).toString('base64url');

  // Prefijo reconocible: si se filtra en un repo público, los escáneres de
  // secretos (GitHub, GitLab) pueden identificarlo por el patrón.
  const plainKey = `dck_live_${secret}`;
  const keyPrefix = plainKey.slice(0, 16);

  // SHA-256 basta aquí, a diferencia de las contraseñas: la llave tiene 256
  // bits de entropía real, así que no hay diccionario que la ataque. El coste
  // de Argon2 sólo se justifica frente a secretos de baja entropía elegidos
  // por humanos.
  const keyHash = createHash('sha256').update(plainKey).digest('hex');

  return { plainKey, keyPrefix, keyHash };
}

/** Hashea una llave recibida para compararla contra la almacenada. */
export function hashAutomationKey(plainKey: string): string {
  return createHash('sha256').update(plainKey).digest('hex');
}

/**
 * Utilidad de referencia para configurar el nodo "Code" de n8n.
 * No se usa en runtime; está aquí para que el equipo de automatización tenga
 * la implementación exacta del emisor a mano.
 *
 * ```javascript
 * // n8n — nodo Code, antes del nodo HTTP Request
 * const crypto = require('crypto');
 * const body = JSON.stringify($json.payload);
 * const ts = Math.floor(Date.now() / 1000);
 * const signature = crypto
 *   .createHmac('sha256', $env.AUTOMATION_HMAC_SECRET)
 *   .update(`${ts}.${body}`)
 *   .digest('hex');
 *
 * return [{ json: { body, headers: {
 *   'Content-Type': 'application/json',
 *   'X-Automation-Key-Id': $env.AUTOMATION_KEY_ID,
 *   'X-Automation-Timestamp': String(ts),
 *   'X-Automation-Signature': signature,
 * }}}];
 * ```
 */
export const N8N_SIGNING_REFERENCE = true;
