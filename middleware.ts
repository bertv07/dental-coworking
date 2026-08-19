import { NextResponse, type NextRequest } from 'next/server';

/**
 * ===========================================================================
 *  Middleware — primera línea de defensa
 * ===========================================================================
 *  Se ejecuta en el EDGE, antes que cualquier página o API Route. Es el
 *  lugar más barato para rechazar tráfico que no debería llegar más lejos.
 *
 *  ⚠️  LIMITACIÓN IMPORTANTE: el Edge Runtime no tiene acceso a Node.js APIs
 *   ni a Prisma. Aquí NO se puede consultar la base de datos ni verificar
 *   contraseñas. El middleware hace comprobaciones baratas; la autorización
 *   de verdad la hacen `requireRole()` en las páginas y `checkApiRole()` en
 *   las APIs.
 *
 *  Qué se hace aquí:
 *   1. Redirigir al login si no hay cookie de sesión (UX, no seguridad)
 *   2. Validar el Origin en peticiones que mutan estado (anti-CSRF)
 *   3. Propagar un identificador de petición para correlacionar logs
 * ===========================================================================
 */

/*
 * Rutas accesibles sin sesión. `/recuperar` y `/restablecer` lo son por definición: las
 * abre alguien que no puede entrar. Su protección no es la sesión sino el
 * token de un solo uso que llega por correo, más el límite por correo.
 */
const PUBLIC_PATHS = ['/login', '/sin-permiso', '/recuperar', '/restablecer'];

/**
 * Rutas exentas de la validación de Origin.
 *
 * `/api/automation/*` lo llama n8n de servidor a servidor: no manda Origin,
 * y no lo necesita — se autentica con HMAC, un mecanismo más fuerte que
 * cualquier comprobación de cabecera.
 */
const ORIGIN_EXEMPT_PREFIXES = ['/api/automation'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // -----------------------------------------------------------------------
  //  1. VALIDACIÓN DE ORIGIN (anti-CSRF)
  // -----------------------------------------------------------------------
  //  Defensa en profundidad: NextAuth ya valida CSRF en sus rutas y Next.js
  //  valida el Origin de las Server Actions. Esta capa cubre el resto de
  //  endpoints que muten estado.
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
  const isExempt = ORIGIN_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (isMutation && !isExempt) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');

    // Un Origin presente que NO coincide con nuestro host es, por definición,
    // una petición cross-site. Se rechaza.
    if (origin && host) {
      try {
        if (new URL(origin).host !== host) {
          return NextResponse.json(
            { ok: false, error: { code: 'FORBIDDEN', message: 'Origen no permitido' } },
            { status: 403 },
          );
        }
      } catch {
        // Origin malformado: no es tráfico legítimo de un navegador.
        return NextResponse.json(
          { ok: false, error: { code: 'FORBIDDEN', message: 'Origen no permitido' } },
          { status: 403 },
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  //  2. GATE DE SESIÓN (sólo UX)
  // -----------------------------------------------------------------------
  //  Comprueba únicamente la PRESENCIA de la cookie, no su validez — para
  //  eso haría falta verificar la firma, y el Edge Runtime no da para eso de
  //  forma barata.
  //
  //  Esto NO es un control de seguridad: alguien puede fabricar una cookie
  //  con cualquier contenido y pasar de aquí. Lo que le espera después es
  //  `requireAuth()`, que sí verifica la firma en el servidor. La ganancia
  //  es evitar renderizar una página entera para luego descartarla.
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const isApiRoute = pathname.startsWith('/api');

  if (!isPublicPath && !isApiRoute) {
    const hasSessionCookie =
      request.cookies.has('authjs.session-token') ||
      request.cookies.has('__Secure-authjs.session-token');

    if (!hasSessionCookie) {
      const loginUrl = new URL('/login', request.url);
      // Se conserva el destino para volver ahí tras iniciar sesión.
      // Sólo la ruta, nunca una URL completa: aceptar un destino absoluto
      // abriría un open redirect hacia un sitio de phishing.
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // -----------------------------------------------------------------------
  //  3. IDENTIFICADOR DE PETICIÓN
  // -----------------------------------------------------------------------
  //  Permite seguir una petición a través de middleware, página y API en los
  //  logs. Cuando alguien reporta un fallo con su `requestId`, aparece la
  //  traza completa.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', crypto.randomUUID());

  return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * El middleware NO debe correr sobre archivos estáticos: sería un coste por
 * cada imagen y cada chunk de JS, sin ningún beneficio.
 */
export const config = {
  matcher: [
    /*
     * Todo excepto:
     *  - _next/static   (build assets)
     *  - _next/image    (optimizador de imágenes)
     *  - favicon.ico, robots.txt, sitemap.xml
     *  - archivos con extensión (.png, .svg, .css…)
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)',
  ],
};
