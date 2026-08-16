import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from '@/backend/auth/auth.config';
import type { UserRole } from '@/backend/domain/types';

/**
 * ===========================================================================
 *  Guards de autorización (lado servidor)
 * ===========================================================================
 *  PRINCIPIO: la autorización se decide SIEMPRE aquí, en el servidor.
 *
 *  Ocultar un enlace del menú no es seguridad — es cosmética. Cualquiera
 *  puede escribir la URL a mano o llamar al endpoint con curl. Por eso cada
 *  página y cada acción sensible invoca uno de estos guards.
 * ===========================================================================
 */

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

/**
 * Jerarquía de roles. Un número mayor incluye los permisos de los menores.
 *
 * Un modelo numérico es suficiente y legible mientras los roles sean
 * estrictamente jerárquicos. Si algún día aparece un rol transversal (p. ej.
 * "contador": ve finanzas pero no la agenda), hay que migrar a permisos
 * granulares — el modelo numérico no lo puede representar.
 */
const ROLE_LEVEL: Record<UserRole, number> = {
  DENTIST: 1,
  ASSISTANT: 2,
  SUPER_ADMIN: 3,
};

/**
 * Devuelve el usuario autenticado o `null`. No redirige.
 * Útil en layouts que se renderizan tanto para invitados como para usuarios.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
}

/**
 * Exige sesión activa. Redirige a /login si no la hay.
 * Para usar al principio de cualquier Server Component protegido.
 */
export async function requireAuth(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Exige un rol mínimo. Redirige si no se cumple.
 *
 * Se redirige a una página de "sin permiso" en vez de a /login: el usuario
 * SÍ está autenticado, sólo que no le corresponde esa sección. Mandarlo al
 * login sería confuso y le haría pensar que su sesión caducó.
 */
export async function requireRole(minimumRole: UserRole): Promise<AuthenticatedUser> {
  const user = await requireAuth();

  if (ROLE_LEVEL[user.role] < ROLE_LEVEL[minimumRole]) {
    redirect('/sin-permiso');
  }

  return user;
}

/** Atajo para las secciones exclusivas de Super Admin (finanzas, precios, personal). */
export async function requireSuperAdmin(): Promise<AuthenticatedUser> {
  return requireRole('SUPER_ADMIN');
}

/**
 * Variante para API Routes: devuelve un resultado en vez de redirigir.
 * Una API debe responder 401/403, no un 307 a una página HTML — un cliente
 * automatizado no sabría qué hacer con la redirección.
 */
export async function checkApiRole(
  minimumRole: UserRole,
): Promise<
  | { authorized: true; user: AuthenticatedUser }
  | { authorized: false; status: 401 | 403 }
> {
  const user = await getCurrentUser();
  if (!user) return { authorized: false, status: 401 };
  if (ROLE_LEVEL[user.role] < ROLE_LEVEL[minimumRole]) {
    return { authorized: false, status: 403 };
  }
  return { authorized: true, user };
}

/** Comprobación sincrónica de rol, para decidir qué pintar en la UI. */
export function hasRole(user: AuthenticatedUser, minimumRole: UserRole): boolean {
  return ROLE_LEVEL[user.role] >= ROLE_LEVEL[minimumRole];
}
