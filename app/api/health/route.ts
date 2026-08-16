import { prisma } from '@/backend/db/client';

/**
 * ===========================================================================
 *  GET /api/health
 * ===========================================================================
 *  Sonda para el orquestador (EasyPanel, Docker, un balanceador).
 *
 *  ---------------------------------------------------------------------
 *  QUÉ COMPRUEBA Y QUÉ NO DICE
 *  ---------------------------------------------------------------------
 *  Comprueba que el proceso responde Y que la base de datos contesta. Sin lo
 *  segundo, un contenedor con Postgres caído seguiría marcándose como sano y
 *  el proxy le mandaría tráfico que sólo puede fallar.
 *
 *  Lo que NO devuelve: versión, nombre de la base, variables de entorno ni
 *  mensajes de error. Un endpoint de salud suele quedar abierto a internet, y
 *  cada dato que dé es información gratis para quien esté buscando por dónde
 *  entrar. Sano o no sano, y ya.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // `SELECT 1` es la comprobación más barata que confirma que la conexión
    // está viva: no lee tablas ni depende de que existan.
    await prisma.$queryRaw`SELECT 1`;

    return Response.json(
      { status: 'ok' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // El detalle va al log del servidor, no a la respuesta.
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'health.database_unreachable',
        message: error instanceof Error ? error.message : String(error),
      }),
    );

    // 503 y no 500: le dice al orquestador «no me mandes tráfico todavía»,
    // que es distinto de «me he roto».
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
