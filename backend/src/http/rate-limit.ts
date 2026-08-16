import 'server-only';
import { env } from '@/backend/config/env';

/**
 * ===========================================================================
 *  Rate limiting — ventana deslizante en memoria
 * ===========================================================================
 *  ⚠️  ALCANCE DE ESTA IMPLEMENTACIÓN
 *
 *  Guarda el estado en memoria del proceso. Funciona perfectamente para un
 *  solo servidor, que es donde arranca este proyecto.
 *
 *  NO sirve tal cual si escalas a varias instancias o a serverless: cada
 *  proceso llevaría su propia cuenta y el límite efectivo se multiplicaría
 *  por el número de instancias. Al llegar ahí, sustituir el `Map` por Redis
 *  (`@upstash/ratelimit`) — la firma de `checkRateLimit()` no cambia, sólo
 *  pasa a ser async.
 * ===========================================================================
 */

interface RateLimitEntry {
  /** Timestamps (ms) de las peticiones dentro de la ventana actual. */
  timestamps: number[];
}

const buckets = new Map<string, RateLimitEntry>();

/** Máximo de claves en memoria: cota superior al uso de RAM (anti-DoS). */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitConfig {
  /** Máximo de peticiones permitidas en la ventana. */
  limit: number;
  /** Tamaño de la ventana en segundos. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Segundos hasta que se libere un cupo. Alimenta la cabecera `Retry-After`. */
  retryAfterSeconds: number;
}

/**
 * Ventana deslizante real: se descartan los timestamps fuera de la ventana y
 * se cuentan los que quedan.
 *
 * Frente a la ventana fija, evita el pico de borde — con ventana fija un
 * atacante puede meter 2× el límite a caballo entre dos ventanas.
 *
 * @param key    Identidad a limitar. Elegirla bien es lo importante:
 *               login → email + IP; automatización → prefijo de la API key.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const cutoff = now - windowMs;

  // Purga simple cuando el mapa crece demasiado. Barata y suficiente: evita
  // que claves de un solo uso (IPs rotativas) consuman memoria sin límite.
  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [existingKey, entry] of buckets) {
      if (entry.timestamps.every((t) => t <= cutoff)) buckets.delete(existingKey);
    }
  }

  const entry = buckets.get(key) ?? { timestamps: [] };

  // Se conservan sólo las peticiones dentro de la ventana.
  const recent = entry.timestamps.filter((t) => t > cutoff);

  if (recent.length >= config.limit) {
    // `recent[0]` existe porque length >= limit >= 1.
    const oldest = recent[0]!;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));

    buckets.set(key, { timestamps: recent });
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  recent.push(now);
  buckets.set(key, { timestamps: recent });

  return {
    allowed: true,
    remaining: config.limit - recent.length,
    retryAfterSeconds: 0,
  };
}

/** Limpia el estado de una clave. Se usa tras un login exitoso. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Presets por tipo de endpoint. Centralizarlos evita el "cada ruta inventa
 * su propio número" y hace la política auditable de un vistazo.
 */
export const RATE_LIMITS = {
  /** Login: agresivo. Es la principal defensa contra password spraying. */
  LOGIN: { limit: 5, windowSeconds: 300 },

  /** Consultas de disponibilidad: el bot las hace mucho, son baratas. */
  AUTOMATION_READ: { limit: 120, windowSeconds: 60 },

  /** Escrituras del bot (agendar, cobrar): caras y con efectos secundarios. */
  AUTOMATION_WRITE: { limit: 30, windowSeconds: 60 },

  /** Endpoints del panel para usuarios ya autenticados. */
  ADMIN_API: { limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitConfig>;

/**
 * Extrae la IP del cliente contando los proxies de confianza que hay delante.
 *
 * ---------------------------------------------------------------------------
 *  POR QUÉ NO SE COGE EL PRIMER VALOR DE `X-Forwarded-For`
 * ---------------------------------------------------------------------------
 *  Un proxy inverso (Traefik en EasyPanel, nginx, Cloudflare) AÑADE la IP que
 *  ve al final de la cabecera; no la reescribe. Así que si alguien manda a
 *  mano:
 *
 *      X-Forwarded-For: 1.2.3.4
 *
 *  lo que llega a la aplicación es:
 *
 *      X-Forwarded-For: 1.2.3.4, 203.0.113.9      ← la real va al FINAL
 *
 *  Leer el primer valor significaba leer justo el que controla quien ataca.
 *  Y con el limitador de intentos de login, eso no es un detalle: bastaba
 *  cambiar ese número en cada intento para tener intentos infinitos y probar
 *  contraseñas sin límite.
 *
 *  Con N proxies de confianza delante, la IP real es la que está en la
 *  posición N empezando por el final. Todo lo que quede a su izquierda lo
 *  puso el cliente y no vale nada.
 *
 *  `TRUSTED_PROXY_HOPS` debe valer exactamente el número de proxies que hay
 *  entre internet y este proceso:
 *   · 1 → detrás de EasyPanel / Traefik / nginx (lo normal al desplegar)
 *   · 2 → Cloudflare por delante de ese proxy
 *   · 0 → proceso expuesto directamente; entonces la cabecera se ignora
 *         entera, porque nadie de confianza la ha escrito.
 * ---------------------------------------------------------------------------
 */
export function getClientIp(request: Request): string {
  const hops = env.TRUSTED_PROXY_HOPS;

  if (hops > 0) {
    const chain = request.headers
      .get('x-forwarded-for')
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (chain && chain.length > 0) {
      // Si la cadena es más corta de lo esperado, se coge la primera: es lo
      // más a la izquierda que un proxy de confianza pudo haber escrito.
      const index = Math.max(0, chain.length - hops);
      const ip = chain[index];
      if (ip) return ip;
    }
  }

  /*
   * `x-real-ip` como respaldo: los proxies la SOBREESCRIBEN con la dirección
   * de la conexión en vez de acumular, así que no se puede envenenar desde
   * fuera. Se consulta después de la cadena porque no toda instalación la
   * envía.
   */
  return request.headers.get('x-real-ip')?.trim() ?? 'unknown';
}
