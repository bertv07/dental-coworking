import 'server-only';
import { z } from 'zod';

/**
 * ===========================================================================
 *  Validación de variables de entorno
 * ===========================================================================
 *  Se valida al arrancar, no al usarse. Un secreto faltante debe romper el
 *  build o el arranque — nunca producir un `undefined` que acabe generando
 *  firmas HMAC con la clave "undefined" en producción.
 *
 *  `import 'server-only'` hace que el build FALLE si algún componente de
 *  cliente importa este archivo por accidente. Es la barrera que impide que
 *  un secreto termine en el bundle del navegador.
 * ===========================================================================
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url('DATABASE_URL debe ser una URL de conexión válida'),

  // 32 bytes en base64 ≈ 44 caracteres. Exigimos un mínimo real para que
  // nadie despliegue con "secret123".
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET debe tener al menos 32 caracteres'),

  APP_ORIGIN: z.string().url().default('http://localhost:3000'),

  AUTOMATION_HMAC_SECRET: z
    .string()
    .min(32, 'AUTOMATION_HMAC_SECRET debe tener al menos 32 caracteres'),

  AUTOMATION_SIGNATURE_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),

  DATA_SOURCE: z.enum(['mock', 'db']).default('mock'),

  DEFAULT_CLINIC_COMMISSION_PERCENT: z.coerce.number().int().min(0).max(100).default(40),

  CLINIC_TIMEZONE: z.string().default('America/Bogota'),

  /**
   * Cuántos proxies inversos de confianza hay entre internet y este proceso.
   *
   * Es lo que decide qué parte de `X-Forwarded-For` es creíble. Ver el
   * comentario largo en `http/rate-limit.ts`: puesto de más, se limita por la
   * IP del proxy y una sola persona puede agotar el cupo de todos; puesto de
   * menos, el limitador se salta cambiando una cabecera.
   *
   * Detrás de EasyPanel / Traefik / nginx: 1.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(4).default(1),
});

/**
 * En desarrollo con `DATA_SOURCE=mock` no queremos obligar a tener Postgres
 * ni secretos reales sólo para ver la UI. Se rellenan valores de desarrollo
 * evidentes — y se rechazan de forma tajante si `NODE_ENV=production`.
 */
function loadEnv() {
  const isProduction = process.env.NODE_ENV === 'production';

  const raw = {
    ...process.env,
    ...(isProduction
      ? {}
      : {
          AUTH_SECRET:
            process.env.AUTH_SECRET ?? 'dev-only-secret-no-usar-en-produccion-32ch',
          AUTOMATION_HMAC_SECRET:
            process.env.AUTOMATION_HMAC_SECRET ??
            'dev-only-hmac-no-usar-en-produccion-32ch',
          DATABASE_URL:
            process.env.DATABASE_URL ??
            'postgresql://dental:dental@localhost:5432/dental_coworking?schema=public',
        }),
  };

  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    // Se listan los NOMBRES de las variables inválidas, jamás sus valores:
    // un log de arranque no debe filtrar secretos parciales.
    const invalid = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${invalid}`);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isUsingMockData = env.DATA_SOURCE === 'mock';
