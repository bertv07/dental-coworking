import 'server-only';
import { prisma } from '@/backend/db/client';
import {
  clinicDayKey,
  clinicDayRange,
  clinicWallClockToInstant,
} from '@/backend/domain/clinic-calendar';

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

/**
 * Fuentes soportadas.
 *
 * `EURO` es la tasa OFICIAL DEL EURO que publica el BCV, no el dólar. Se
 * añadió porque la clínica cobra referenciada al euro.
 *
 *  CÓMO SE USA AQUÍ, QUE NO ES OBVIO: la lista de precios se escribe y se
 *  guarda en dólares, pero se COBRA multiplicando por la tasa del euro. Es
 *  la práctica habitual en Venezuela —fijar en dólares y cobrar a euro— y es
 *  como opera esta clínica.
 *
 *  Por eso las pantallas siguen diciendo «$30»: los 30 son dólares de lista.
 *  Lo único que cambia es la tasa con la que esos 30 se pasan a bolívares.
 */
export type RateSource = 'BCV' | 'PARALELO' | 'EURO';

const DOLARAPI_ENDPOINTS: Record<RateSource, string> = {
  BCV: 'https://ve.dolarapi.com/v1/dolares/oficial',
  PARALELO: 'https://ve.dolarapi.com/v1/dolares/paralelo',
  EURO: 'https://ve.dolarapi.com/v1/euros/oficial',
};

/**
 * Histórico oficial, por fecha. La fecha va en la RUTA y con barras
 * (`2026/09/10`), no como `?fecha=` ni con guiones: con cualquier otra
 * forma la API responde vacío sin error, que es justo lo que despista.
 */
const DOLARAPI_HISTORICO: Record<RateSource, string> = {
  BCV: 'https://ve.dolarapi.com/v1/historicos/dolares/oficial',
  PARALELO: 'https://ve.dolarapi.com/v1/historicos/dolares/paralelo',
  EURO: 'https://ve.dolarapi.com/v1/historicos/euros/oficial',
};

/** Etiqueta para pantallas y comprobantes. */
export const RATE_SOURCE_LABEL: Record<RateSource, string> = {
  BCV: 'BCV (dólar oficial)',
  PARALELO: 'Paralelo',
  EURO: 'Euro oficial (BCV)',
};

/**
 * Convierte lo guardado en ajustes a una fuente válida.
 *
 * Existe para no repetir el ternario por siete pantallas: cada vez que se
 * añade una fuente habría que acordarse de las siete, y la que se olvida
 * sigue cobrando con la tasa vieja sin avisar.
 *
 * EL RESPALDO ES EURO, NO BCV. La clínica lista en dólares y cobra en
 * bolívares al euro oficial; ésa es la regla del negocio, no una preferencia
 * que se pueda perder. Con el respaldo anterior, un ajuste sin valor o con
 * uno viejo hacía cobrar en silencio a la tasa BCV —unos cuantos bolívares
 * por dólar de diferencia en cada factura—. Coincide con el `@default` de
 * `ClinicSettings.preferredRateSource`, para que la base y el código no
 * puedan discrepar.
 */
export function resolveRateSource(valor: string | null | undefined): RateSource {
  return valor === 'PARALELO' || valor === 'BCV' ? valor : 'EURO';
}

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

/**
 * La tasa vigente EN una fecha pasada, no la de hoy.
 *
 * Existe para los cobros con fecha atrasada («se me olvidó registrar la
 * venta del martes»): usar la tasa de HOY para un cobro de hace tres días
 * dejaría un monto en bolívares que nunca entró de verdad a la gaveta ese
 * día. Se toma la última tasa publicada EN o ANTES de esa fecha; si la
 * clínica no tenía ninguna tan vieja, se usa la más antigua que haya.
 */
export interface TasaDeEseDia {
  /** La tasa que regía ese día. `null` sólo si la API no la tiene y no hay nada guardado. */
  rate: CurrentRate | null;
  /** Lo más cercano encontrado, para poder explicarlo si no hay nada mejor. */
  aproximada: CurrentRate | null;
}

function aCurrentRate(
  row: { rate: unknown; publishedAt: Date; fetchedAt: Date },
  source: RateSource,
): CurrentRate {
  return {
    rate: Number(row.rate),
    source,
    publishedAt: row.publishedAt,
    fetchedAt: row.fetchedAt,
    isStale: false,
  };
}

/** Una fila del histórico de DolarAPI. */
interface FilaHistorico {
  fecha?: string;
  promedio?: number | null;
  venta?: number | null;
  compra?: number | null;
}

/**
 * Trae del histórico OFICIAL la tasa que regía en una fecha, y la guarda.
 *
 * ---------------------------------------------------------------------
 *  POR QUÉ SE PIDE LA LISTA Y NO EL DÍA SUELTO
 * ---------------------------------------------------------------------
 *  El endpoint por día existe, pero devuelve VACÍO en fines de semana y
 *  feriados: el BCV no publica esos días. Y "no publicó" no significa "no
 *  hay tasa" — significa que sigue vigente la última publicada. Un cobro
 *  de un sábado se hizo a la tasa del viernes.
 *
 *  Pidiendo la lista se resuelven los dos casos con una sola llamada: se
 *  busca la última publicación EN o ANTES de esa fecha, que es la
 *  definición exacta de "la tasa que regía ese día".
 *
 *  Lo que se trae se GUARDA con la fecha oficial de publicación, así que la
 *  segunda vez que alguien facture ese día ya no hace falta la red.
 */
async function traerDelHistorico(
  source: RateSource,
  date: Date,
): Promise<CurrentRate | null> {
  try {
    const response = await fetch(DOLARAPI_HISTORICO[source], {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const filas = (await response.json()) as FilaHistorico[];
    if (!Array.isArray(filas)) return null;

    // El día de la clínica al que pertenece la fecha pedida.
    const diaPedido = clinicDayKey(date);

    // La última publicación en o antes de ese día. La lista viene ordenada
    // de más antigua a más reciente, pero no se da por hecho.
    let mejor: { fecha: string; valor: number } | null = null;
    for (const fila of filas) {
      if (!fila.fecha || fila.fecha > diaPedido) continue;
      const valor = fila.promedio ?? fila.venta ?? fila.compra;
      if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) continue;
      if (!mejor || fila.fecha > mejor.fecha) mejor = { fecha: fila.fecha, valor };
    }

    if (!mejor) return null;

    /*
     * Se guarda con la fecha OFICIAL de publicación, no con la del cobro:
     * es la misma tasa para todos los días que van hasta la siguiente
     * publicación, y duplicarla por cada día facturado llenaría la tabla de
     * filas que dicen lo mismo.
     *
     * `isCurrent: false` siempre: esto es historia, no la tasa de hoy.
     * Marcarla vigente pondría a cobrar al mostrador con una tasa vieja.
     */
    const publishedAt = clinicWallClockToInstant(mejor.fecha, 0);

    /*
     * Se busca por DÍA y no por instante exacto: si esa tasa ya la habíamos
     * capturado en vivo, su `publishedAt` lleva la hora que reportó la API
     * ese día y no coincidiría con esta medianoche. Comparando por instante
     * se insertaría una fila duplicada por cada factura atrasada.
     */
    const diaOficial = clinicDayRange(publishedAt);
    const yaEsta = await prisma.exchangeRate.findFirst({
      where: { source, publishedAt: { gte: diaOficial.from, lt: diaOficial.to } },
    });

    const guardada =
      yaEsta ??
      (await prisma.exchangeRate.create({
        data: { source, rate: mejor.valor, publishedAt, isCurrent: false },
      }));

    return aCurrentRate(guardada, source);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'dolarapi.historico_failed',
        source,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

/**
 * La tasa que regía EN UNA FECHA CONCRETA.
 *
 * Orden: lo que ya está guardado de ese día → el histórico oficial de la
 * API (que además se guarda) → nada, y entonces quien cobra la escribe.
 *
 * Lo que NO se hace es coger "la más parecida" de lo que hubiera suelto en
 * la base. La tasa se mueve casi a diario —954 a 977 en una semana— y
 * nuestras filas son sólo las que alguien capturó al abrir el panel: con
 * huecos de días. El histórico del BCV sí es continuo y autoritativo.
 */
export async function getRateAsOf(source: RateSource, date: Date): Promise<TasaDeEseDia> {
  const { from, to } = clinicDayRange(date);

  // 1. ¿La capturamos ese mismo día?
  const delDia = await prisma.exchangeRate.findFirst({
    where: { source, publishedAt: { gte: from, lt: to } },
    orderBy: { publishedAt: 'desc' },
  });
  if (delDia) return { rate: aCurrentRate(delDia, source), aproximada: null };

  // 2. Si no, al histórico oficial — y queda guardada para la próxima.
  const historica = await traerDelHistorico(source, date);
  if (historica) return { rate: historica, aproximada: null };

  // 3. Sin red y sin histórico: se ofrece la referencia más cercana, pero
  //    NO se usa para cobrar. La escribe quien cobró ese día.
  const cercana = await prisma.exchangeRate.findFirst({
    where: { source, publishedAt: { lt: to } },
    orderBy: { publishedAt: 'desc' },
  });

  return { rate: null, aproximada: cercana ? aCurrentRate(cercana, source) : null };
}

/** Las tres fuentes a la vez, para el panel de control cambiario. */
export async function getAllRates(): Promise<{
  bcv: CurrentRate | null;
  paralelo: CurrentRate | null;
  euro: CurrentRate | null;
}> {
  const [bcv, paralelo, euro] = await Promise.all([
    getCurrentRate('BCV'),
    getCurrentRate('PARALELO'),
    getCurrentRate('EURO'),
  ]);
  return { bcv, paralelo, euro };
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
