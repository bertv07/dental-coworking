import 'server-only';
import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '@/backend/config/env';

/**
 * ===========================================================================
 *  Cliente Prisma (singleton)
 * ===========================================================================
 *  En desarrollo, el hot-reload de Next.js re-evalúa los módulos en cada
 *  cambio. Sin este singleton se crea un PrismaClient nuevo cada vez y en
 *  pocos minutos Postgres rechaza conexiones por agotamiento del pool.
 *  Se guarda en `globalThis`, que sí sobrevive al hot-reload.
 * ===========================================================================
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // En producción sólo errores: los logs de query contienen datos de
    // pacientes (nombres, teléfonos) y no deben acabar en el agregador de logs.
    log: isProduction ? ['error'] : ['query', 'warn', 'error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!isProduction) globalForPrisma.prisma = prisma;

/**
 * Códigos de error de Prisma que sí conviene traducir a respuestas HTTP
 * específicas. El resto se convierte en 500 genérico sin filtrar detalles.
 * Referencia: https://www.prisma.io/docs/reference/api-reference/error-reference
 */
export const PRISMA_ERROR = {
  UNIQUE_CONSTRAINT: 'P2002',
  FOREIGN_KEY_CONSTRAINT: 'P2003',
  RECORD_NOT_FOUND: 'P2025',
} as const;

/** Type guard para errores conocidos de Prisma, sin importar el namespace. */
export function isPrismaError(
  error: unknown,
): error is { code: string; meta?: Record<string, unknown> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

/**
 * Detecta la violación de los constraints `EXCLUDE` de la migración 0001.
 * Postgres los reporta con SQLSTATE 23P01 (exclusion_violation), que Prisma
 * envuelve en un error crudo. Es la señal de "alguien tomó ese hueco primero".
 */
export function isOverlapViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('23P01') ||
    message.includes('appointments_no_room_overlap') ||
    message.includes('appointments_no_dentist_overlap')
  );
}
