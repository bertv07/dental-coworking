import 'server-only';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
// Importación necesaria para poder AUMENTAR el módulo al final del archivo:
// TypeScript sólo permite `declare module 'x'` si `x` ya está resuelto aquí.
import type { JWT } from 'next-auth/jwt';
import { z } from 'zod';
import { env, isProduction } from '@/backend/config/env';
import { verifyPassword, fakeVerifyPassword } from '@/backend/auth/password';
import { checkRateLimit, resetRateLimit, RATE_LIMITS } from '@/backend/http/rate-limit';
import { findUserForLogin, registerLoginOutcome } from '@/backend/repositories';
import type { UserRole } from '@/backend/domain/types';

/**
 * ===========================================================================
 *  NextAuth v5 — configuración
 * ===========================================================================
 *  Decisiones y su porqué:
 *
 *  · ESTRATEGIA JWT, no sesión en DB. El panel hace muchas comprobaciones de
 *    rol por render; ir a Postgres en cada una es un coste innecesario. El
 *    precio es que revocar una sesión no es instantáneo — se compensa con
 *    `sessionsValidFrom` (ver callback `jwt`).
 *
 *  · CSRF: NextAuth genera y valida un token CSRF de doble envío en todas sus
 *    rutas POST automáticamente. Para las Server Actions, Next.js valida el
 *    header Origin contra `allowedOrigins` (ver next.config.mjs). Ambas capas
 *    cubren el panel completo.
 *
 *  · Sólo proveedor de credenciales. Sin OAuth: es un panel interno para 12
 *    odontólogos y unos pocos administrativos, y OAuth añadiría dependencia
 *    de un tercero sin beneficio real.
 * ===========================================================================
 */

/** Validación del formulario de login. Primera barrera antes de tocar la DB. */
const loginSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z.string().min(1).max(128),
});

export const authConfig: NextAuthConfig = {
  secret: env.AUTH_SECRET,

  session: {
    strategy: 'jwt',
    /** 8 horas: una jornada laboral. Al día siguiente se vuelve a entrar. */
    maxAge: 8 * 60 * 60,
    /** Renueva el token si hay actividad, para no expulsar a alguien a media tarea. */
    updateAge: 60 * 60,
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  cookies: {
    sessionToken: {
      // El prefijo `__Secure-` es una instrucción para el navegador: rechaza
      // la cookie si no llega por HTTPS. Sólo en producción, porque en
      // localhost (HTTP) impediría el login.
      name: isProduction ? '__Secure-authjs.session-token' : 'authjs.session-token',
      options: {
        // Inaccesible desde JavaScript → un XSS no puede robar la sesión.
        httpOnly: true,
        // 'lax' permite la navegación normal desde enlaces externos pero
        // bloquea el envío en POST cross-site: la defensa CSRF a nivel cookie.
        sameSite: 'lax',
        path: '/',
        secure: isProduction,
      },
    },
  },

  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Correo', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
      },

      /**
       * `authorize` devuelve el usuario si las credenciales son válidas, o
       * `null` si no. NUNCA lanza con un mensaje descriptivo: cualquier
       * diferencia observable entre "no existe", "bloqueado" y "contraseña
       * incorrecta" se convierte en un oráculo de enumeración de cuentas.
       */
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        // --- Rate limit por email + IP ---------------------------------
        // Combinar ambos evita los dos ataques: fuerza bruta sobre una cuenta
        // (mismo email) y password spraying (misma IP, muchos emails).
        const ip =
          request?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
        const limit = checkRateLimit(`login:${email}:${ip}`, RATE_LIMITS.LOGIN);
        if (!limit.allowed) return null;

        const user = await findUserForLogin(email);

        // --- Usuario inexistente ---------------------------------------
        // Se gasta el mismo tiempo que una verificación real (ver
        // `fakeVerifyPassword`) para no filtrar la existencia por timing.
        if (!user) {
          await fakeVerifyPassword();
          return null;
        }

        // --- Cuenta bloqueada o suspendida ------------------------------
        const isLocked = user.lockedUntil !== null && user.lockedUntil > new Date();
        if (isLocked || user.status !== 'ACTIVE' || user.deletedAt !== null) {
          await fakeVerifyPassword();
          return null;
        }

        // --- Verificación real ------------------------------------------
        const isValid = await verifyPassword(password, user.passwordHash);

        if (!isValid) {
          // Incrementa el contador y bloquea temporalmente tras N fallos.
          await registerLoginOutcome(user.id, false);
          return null;
        }

        await registerLoginOutcome(user.id, true);
        resetRateLimit(`login:${email}:${ip}`);

        // Lo que se devuelve acaba dentro del JWT. Se incluye el MÍNIMO
        // imprescindible: nada de hash, ni teléfono, ni datos personales.
        return {
          id: user.id,
          email: user.email,
          name: user.fullName,
          role: user.role,
          sessionsValidFrom: user.sessionsValidFrom.getTime(),
        };
      },
    }),
  ],

  callbacks: {
    /**
     * Se ejecuta al crear el JWT (login) y en cada petición posterior.
     * Aquí se propaga el rol y se aplica la revocación de sesiones.
     */
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.sessionsValidFrom = user.sessionsValidFrom;
      }
      return token;
    },

    /**
     * Da forma al objeto `session` que consume la app.
     *
     * El rol viaja en el token firmado: el cliente NO puede manipularlo (la
     * firma no cuadraría). Aun así, la autorización real se decide siempre en
     * el servidor con `requireRole()` — el rol en sesión es para pintar la UI,
     * no para conceder acceso.
     */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
        session.user.role = (token.role as UserRole) ?? 'ASSISTANT';
      }
      return session;
    },

    /**
     * Gate de nivel middleware. Corre en el Edge Runtime, así que aquí no se
     * puede tocar Prisma — sólo lógica sobre el token.
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      // Rutas públicas.
      if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) return true;

      // Las rutas de automatización tienen su propio esquema (HMAC), no sesión.
      if (pathname.startsWith('/api/automation')) return true;

      return Boolean(auth?.user);
    },
  },

  // Confía en el header Host del proxy. Necesario detrás de Vercel/nginx.
  trustHost: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/**
 * Ampliación de los tipos de NextAuth para incluir `role`.
 * Sin esto, `session.user.role` sería un error de TypeScript.
 */
declare module 'next-auth' {
  interface User {
    role: UserRole;
    sessionsValidFrom: number;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: UserRole;
    sessionsValidFrom: number;
  }
}
