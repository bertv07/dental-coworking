import 'server-only';
import { prisma } from '@/backend/db/client';

/**
 * ===========================================================================
 *  Tipo de cambio — integración con DolarAPI
 * ===========================================================================
 *  Fuente: https://ve.dolarapi.com — expone la tasa oficial del BCV y la
 *  del mercado paralelo.
 *
 *  ESTRATEGIA (y por qué):
 *
 *  1. La tasa se PERSISTE en `exchange_rates`. La UI lee siempre de la base
 *     de datos, nunca de la API. Consecuencia práctica: si DolarAPI se cae,
 *     la clínica sigue cobrando con la última tasa conocida en vez de
 *     quedarse bloqueada.
 *
 *  2. Se refresca como mucho una vez por hora. El BCV publica una vez al
 *     día; consultar en cada carga de página sería castigar a un servicio
 *     gratuito sin obtener un dato más fresco.
 *
 *  3. Nunca lanza hacia arriba. Si la API falla, se registra y se devuelve
 *     lo que haya en la base. Una clínica no puede dejar de facturar porque
 *     un tercero tenga un mal día.
 * ===========================================================================
 */

/** Fuentes soportadas. La clínica factura a BCV; el paralelo es referencia. */
export type RateSource = 'BCV' | 'PARALELO';

const DOLARAPI_ENDPOINTS: Record<RateSource, string> = {
  BCV: 'https://ve.dolarapi.com/v1/dolares/oficial',
  PARALELO: 'https://ve.dolarapi.com/v1/dolares/paralelo',
};

/** No se vuelve a consultar la API si la última lectura tiene menos de esto. */
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

/** Corta la espera si DolarAPI no responde: no bloquear el render. */
const FETCH_TIMEOUT_MS = 6000;

export interface CurrentRate {
  source: RateSource;
  /** Bolívares por dólar. */
  rate: number;
  publishedAt: Date;
  fetchedAt: Date;
  /** `true` si viene de la base porque la API no respondió. */
  isStale: boolean;
}

/** Forma de la respuesta de DolarAPI. */
interface DolarApiResponse {
  moneda?: string;
  fuente?: string;
  nombre?: string;
  compra?: number | null;
  venta?: number | null;
  promedio?: number | null;
  fechaActualizacion?: string;
}

/**
 * Consulta DolarAPI y guarda la tasa. Devuelve `null` si falla.
 *
 * `AbortSignal.timeout` cancela la petición pasado el límite: sin él, una
 * API colgada dejaría el render esperando indefinidamente.
 */
async function fetchFromApi(source: RateSource): Promise<CurrentRate | null> {
  try {
    const response = await fetch(DOLARAPI_ENDPOINTS[source], {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
      // Cachear aquí ocultaría los fallos reales de red; el control de
      // frescura lo lleva la base de datos.
      cache: 'no-store',
    });

    if (!response.ok) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'dolarapi.http_error',
          source,
          status: response.status,
        }),
      );
      return null;
    }

    const data = (await response.json()) as DolarApiResponse;

    // `promedio` es el campo que trae la tasa; `compra`/`venta` pueden venir
    // en null para la oficial. Se valida antes de escribir nada: un `null`
    // guardado como 0 corrompería todos los importes del sistema.
    const rate = data.promedio ?? data.venta ?? data.compra;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      console.warn(
        JSON.stringify({ level: 'warn', event: 'dolarapi.invalid_rate', source, rate }),
      );
      return null;
    }

    const publishedAt = data.fechaActualizacion
      ? new Date(data.fechaActualizacion)
      : new Date();

    // Transacción: se desmarca la anterior y se inserta la nueva de golpe.
    // El índice único parcial `exchange_rates_one_current_per_source` impide
    // que queden dos vigentes si algo va mal a medio camino.
    const saved = await prisma.$transaction(async (tx) => {
      await tx.exchangeRate.updateMany({
        where: { source, isCurrent: true },
        data: { isCurrent: false },
      });

      return tx.exchangeRate.create({
        data: { source, rate, publishedAt, isCurrent: true },
      });
    });

    return {
      source,
      rate: Number(saved.rate),
      publishedAt: saved.publishedAt,
      fetchedAt: saved.fetchedAt,
      isStale: false,
    };
  } catch (error) {
    // Timeout, DNS, red caída… Se registra y se sigue con lo que haya en DB.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'dolarapi.fetch_failed',
        source,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

/** Última tasa almacenada de una fuente. */
async function readFromDatabase(source: RateSource): Promise<CurrentRate | null> {
  const stored = await prisma.exchangeRate.findFirst({
    where: { source },
    orderBy: { fetchedAt: 'desc' },
  });
  if (!stored) return null;

  return {
    source,
    rate: Number(stored.rate),
    publishedAt: stored.publishedAt,
    fetchedAt: stored.fetchedAt,
    isStale: Date.now() - stored.fetchedAt.getTime() > REFRESH_INTERVAL_MS,
  };
}

/**
 * Tasa vigente de una fuente. Es la función que usa todo el panel.
 *
 * Refresca desde la API sólo si lo almacenado está caducado. Si la API
 * falla, devuelve lo almacenado marcado como `isStale` para que la UI pueda
 * avisar de que el dato no es fresco — mostrar una tasa vieja sin decirlo
 * sería peor que no mostrarla.
 */
export async function getCurrentRate(source: RateSource = 'BCV'): Promise<CurrentRate | null> {
  const stored = await readFromDatabase(source);

  // Fresca: se usa tal cual, sin tocar la red.
  if (stored && !stored.isStale) return stored;

  const fresh = await fetchFromApi(source);
  if (fresh) return fresh;

  // La API falló: se sigue operando con lo último conocido.
  return stored;
}

/** Ambas fuentes a la vez, para el panel de control cambiario. */
export async function getAllRates(): Promise<{
  bcv: CurrentRate | null;
  paralelo: CurrentRate | null;
}> {
  const [bcv, paralelo] = await Promise.all([
    getCurrentRate('BCV'),
    getCurrentRate('PARALELO'),
  ]);
  return { bcv, paralelo };
}

/** Fuerza la actualización, ignorando la ventana de 1 hora. */
export async function refreshRate(source: RateSource): Promise<CurrentRate | null> {
  const fresh = await fetchFromApi(source);
  return fresh ?? readFromDatabase(source);
}

/** Historial de una fuente, para la tabla y el gráfico de evolución. */
export async function getRateHistory(source: RateSource, limit = 30) {
  const rows = await prisma.exchangeRate.findMany({
    where: { source },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    rate: Number(row.rate),
    publishedAt: row.publishedAt,
    fetchedAt: row.fetchedAt,
    isCurrent: row.isCurrent,
  }));
}
