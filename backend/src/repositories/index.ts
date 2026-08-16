import 'server-only';
import { isUsingMockData } from '@/backend/config/env';
import { mockRepository } from '@/backend/repositories/mock.repository';
import type { DataRepository } from '@/backend/repositories/types';

/**
 * ===========================================================================
 *  Selector de fuente de datos
 * ===========================================================================
 *  Punto ÚNICO donde se decide si el sistema habla con Postgres o con los
 *  datos mock. Todo lo demás (servicios, rutas, UI) importa desde aquí y no
 *  sabe —ni le importa— cuál está activo.
 *
 *  Para pasar a la base de datos real:
 *    1. `DATA_SOURCE=db` en `.env.local`
 *    2. `npm run db:migrate && npm run db:seed`
 *  Ni una línea de código de la aplicación cambia.
 *
 *  El repositorio de Prisma se importa de forma PEREZOSA a propósito: en
 *  modo mock, `@prisma/client` no llega a cargarse. Así el proyecto arranca
 *  sin haber ejecutado `prisma generate`, que es justo lo que permite ver la
 *  UI recién clonado el repo.
 * ===========================================================================
 */

let cachedRepository: DataRepository | null = null;

function resolveRepository(): DataRepository {
  if (cachedRepository) return cachedRepository;

  if (isUsingMockData) {
    cachedRepository = mockRepository;
  } else {
    // `require` síncrono en lugar de `await import`: mantiene la API del
    // módulo sincrónica y en el servidor de Next.js es seguro.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prismaRepository } = require('@/backend/repositories/prisma.repository') as {
      prismaRepository: DataRepository;
    };
    cachedRepository = prismaRepository;
  }

  return cachedRepository;
}

/** Repositorio activo. Punto de entrada a datos para toda la aplicación. */
export const repository: DataRepository = new Proxy({} as DataRepository, {
  // El Proxy difiere la resolución hasta la primera llamada real. Sin él,
  // importar este módulo cargaría Prisma en tiempo de import y rompería el
  // modo mock.
  get(_target, property) {
    return Reflect.get(resolveRepository(), property);
  },
});

/**
 * Reexportaciones directas. Permiten `import { findUserForLogin } from
 * '@/backend/repositories'` en sitios donde importar el objeto entero
 * resultaría más ruidoso — por ejemplo, la configuración de NextAuth.
 */
export const findUserForLogin: DataRepository['findUserForLogin'] = (email) =>
  resolveRepository().findUserForLogin(email);

export const registerLoginOutcome: DataRepository['registerLoginOutcome'] = (
  userId,
  success,
) => resolveRepository().registerLoginOutcome(userId, success);

export type { DataRepository, DateRange } from '@/backend/repositories/types';
