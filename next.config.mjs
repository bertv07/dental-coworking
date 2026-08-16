/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Cabeceras de seguridad aplicadas a TODAS las respuestas.
 *
 * ---------------------------------------------------------------------------
 *  CSP: POR QUÉ 'unsafe-eval' SÓLO EN DESARROLLO
 * ---------------------------------------------------------------------------
 *  El servidor de desarrollo de Next.js compila los módulos con `eval()`
 *  (react-refresh / Hot Module Replacement). Si la CSP lo bloquea, el primer
 *  módulo del bundle lanza `EvalError`, React nunca llega a hidratar y —lo
 *  peor— al fallar la hidratación React descarta el HTML del servidor y deja
 *  la página EN BLANCO. El contenido estaba ahí; el navegador lo borraba.
 *
 *  El build de PRODUCCIÓN no usa `eval` en absoluto, así que ahí la
 *  directiva se mantiene estricta. Relajarla en dev no debilita lo que se
 *  despliega.
 *
 *  `connect-src` necesita `ws:` en dev por el websocket de HMR.
 * ---------------------------------------------------------------------------
 */
const securityHeaders = [
  // Evita que el navegador "adivine" el MIME type (vector clásico de XSS
  // subiendo un .jpg que en realidad contiene JS).
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // Anti-clickjacking. El panel de Super Admin jamás debe embeberse.
  { key: 'X-Frame-Options', value: 'DENY' },

  // No filtrar la URL completa (que puede llevar IDs de paciente) a terceros.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // Fuerza HTTPS por 2 años. Solo tiene efecto sobre HTTPS.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },

  // Desactiva APIs del navegador que este panel no necesita.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },

  // Aísla el contexto de navegación (mitiga XS-Leaks / Spectre).
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },

  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // 'strict-dynamic' + nonce sería lo ideal; Next lo soporta vía middleware.
      // 'unsafe-eval' SÓLO en dev: lo exige react-refresh. Ver nota arriba.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // El bot de WhatsApp llega por webhook (server-to-server), el navegador
      // solo habla con nuestro propio origen. En dev se añade el websocket
      // de Hot Module Replacement.
      `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
];

const nextConfig = {
  reactStrictMode: true,

  // No exponer la versión del framework: menos huella para fingerprinting.
  poweredByHeader: false,

  /*
   * Build autocontenido: `next build` deja en `.next/standalone` un servidor
   * con SÓLO las dependencias que el código realmente importa.
   *
   * Para desplegar en EasyPanel es lo que separa una imagen de ~200 MB de una
   * de más de 1 GB: sin esto habría que copiar `node_modules` entero, con
   * Prisma CLI, TypeScript y todo el tooling de desarrollo dentro del
   * contenedor que corre en producción.
   */
  output: 'standalone',

  // Quita el botón flotante de Next.js de la esquina inferior izquierda.
  // Sólo existe en desarrollo (en producción nunca se pinta), pero tapa la
  // interfaz justo donde está el pie del menú lateral.
  devIndicators: false,

  experimental: {
    // Whitelist de orígenes permitidos para Server Actions.
    // Next.js valida el header Origin contra esta lista → protección CSRF
    // nativa para todas las Server Actions.
    serverActions: {
      allowedOrigins: [
        'localhost:3000',
        ...(process.env.APP_ORIGIN ? [new URL(process.env.APP_ORIGIN).host] : []),
      ],
    },
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
