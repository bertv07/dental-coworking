'use server';

import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { z } from 'zod';
import { signIn, signOut } from '@/backend/auth/auth.config';

/**
 * ===========================================================================
 *  Server Actions de autenticación
 * ===========================================================================
 *  `'use server'` marca estas funciones como invocables desde el cliente,
 *  pero ejecutables SÓLO en el servidor.
 *
 *  PROTECCIÓN CSRF: Next.js valida el header `Origin` de toda invocación
 *  contra `experimental.serverActions.allowedOrigins` (next.config.mjs).
 *  Un formulario alojado en otro dominio no puede dispararlas. Esto cubre
 *  todas las Server Actions del proyecto, no sólo estas.
 *
 *  ⚠️  Una Server Action es un ENDPOINT PÚBLICO. Que sólo se llame desde un
 *   componente protegido no la protege: hay que autenticar y validar dentro
 *   de cada una, igual que en una API Route.
 * ===========================================================================
 */

const loginSchema = z.object({
  email: z.string().email('Correo electrónico inválido').max(255),
  password: z.string().min(1, 'La contraseña es obligatoria').max(128),
});

export interface LoginState {
  error?: string;
}

/**
 * Inicia sesión.
 *
 * Devuelve un mensaje de error GENÉRICO en todos los casos de fallo. No se
 * distingue "el usuario no existe" de "la contraseña es incorrecta": esa
 * diferencia permitiría enumerar qué correos tienen cuenta en el sistema.
 */
export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: 'Revisa los datos ingresados' };
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      // Se redirige a la raíz, no a /dashboard: `app/page.tsx` decide el
      // destino según el rol. Un asistente no tiene acceso a las finanzas y
      // mandarlo allí lo dejaría en "sin permiso" nada más entrar.
      redirectTo: '/',
    });
  } catch (error) {
    // NextAuth señala el éxito lanzando un redirect. Hay que dejarlo pasar:
    // capturarlo dejaría al usuario autenticado pero varado en el login.
    if (error instanceof AuthError) {
      return { error: 'Correo o contraseña incorrectos' };
    }
    throw error;
  }

  // Inalcanzable en la práctica (`signIn` redirige), pero satisface al
  // compilador y documenta la intención.
  return {};
}

/**
 * Cierra sesión y borra la cookie en el servidor.
 *
 * Acepta (e ignora) un `FormData` para poder usarse directamente como
 * `<form action={logoutAction}>`. Así el cierre de sesión funciona incluso
 * sin JavaScript — es un envío de formulario normal, no un manejador de
 * clic que muere si el bundle del cliente falla.
 */
export async function logoutAction(_formData?: FormData): Promise<void> {
  await signOut({ redirect: false });
  redirect('/login');
}
