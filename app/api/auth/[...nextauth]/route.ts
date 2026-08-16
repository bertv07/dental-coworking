import { handlers } from '@/backend/auth/auth.config';

/**
 * ===========================================================================
 *  Rutas de NextAuth — /api/auth/*
 * ===========================================================================
 *  Un único catch-all que atiende signin, signout, callback, session y csrf.
 *
 *  NextAuth genera y valida el token CSRF de todas sus rutas POST de forma
 *  automática (patrón de doble envío: cookie + campo del formulario). No hay
 *  que añadir nada — pero sí conviene saber que la protección está aquí y no
 *  en un middleware propio.
 * ===========================================================================
 */

export const { GET, POST } = handlers;

// NextAuth necesita `node:crypto` para firmar el JWT.
export const runtime = 'nodejs';
