import 'server-only';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

/**
 * ===========================================================================
 *  Importación de precios desde Excel
 * ===========================================================================
 *  Cargar la lista entera de una vez, en vez de tratamiento por tratamiento.
 *
 *  ---------------------------------------------------------------------
 *  SE LEE Y SE ENSEÑA; APLICAR ES OTRO PASO
 *  ---------------------------------------------------------------------
 *  Esta capa NO escribe nada. Sólo convierte el archivo en una lista de
 *  cambios propuestos, con sus errores señalados fila a fila.
 *
 *  Es deliberado: una importación de precios que se aplica sola es la forma
 *  más rápida de cobrarle mal a todo el mundo. Una columna corrida, un punto
 *  decimal donde iba una coma, y la clínica factura mal hasta que alguien lo
 *  nota en el arqueo. Con la vista previa, quien sube el archivo ve «esta
 *  sube de $30 a $300» antes de que sea verdad.
 * ===========================================================================
 */

/** Lo que puede pasarle a una fila del archivo. */
export type EstadoFila = 'NUEVO' | 'ACTUALIZA' | 'SIN_CAMBIO' | 'ERROR';

export interface FilaImportada {
  /** Número de fila en el Excel, para poder decir «arréglala en la fila 12». */
  fila: number;
  code: string;
  name: string;
  category: string;
  priceCents: number;
  durationMinutes: number;
  bufferMinutes: number;
  estado: EstadoFila;
  /** Qué está mal, si `estado` es ERROR. */
  error?: string;
  /** Precio que tiene ahora, si ya existe. Para poder comparar. */
  precioActualCents?: number;
}

/** Lo que el catálogo actual necesita aportar para poder comparar. */
export interface TratamientoExistente {
  code: string;
  basePriceCents: number;
}

/**
 * Nombres aceptados para cada columna.
 *
 * Se admiten variantes porque el archivo lo escribe una persona, no un
 * sistema: «precio», «Precio USD» y «PRECIO ($)» son la misma columna, y
 * rechazar el archivo por una tilde sería absurdo.
 */
const COLUMNAS: Record<string, string[]> = {
  code: ['codigo', 'código', 'code', 'clave'],
  name: ['nombre', 'tratamiento', 'descripcion', 'descripción', 'name'],
  category: ['categoria', 'categoría', 'category', 'grupo'],
  price: ['precio', 'precio usd', 'precio ($)', 'precio $', 'price', 'costo'],
  duration: ['duracion', 'duración', 'minutos', 'duration'],
  buffer: ['buffer', 'margen', 'limpieza'],
};

/** Quita tildes y espacios sobrantes para comparar cabeceras. */
function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Interpreta un precio escrito por una persona.
 *
 * En Venezuela se escribe «1.234,56» y en el teclado inglés «1,234.56». Un
 * `Number()` a secas convierte «1.234,56» en `NaN` y «1,234.56» en 1 — y ese
 * segundo caso es el peligroso: no falla, cobra mil veces menos.
 *
 * La regla: manda el ÚLTIMO separador que aparezca. Es lo que distingue el
 * decimal del separador de miles sin tener que adivinar el idioma.
 */
export function parsearPrecio(valor: unknown): number | null {
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? Math.round(valor * 100) : null;
  }

  const texto = String(valor ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!texto) return null;

  const ultimaComa = texto.lastIndexOf(',');
  const ultimoPunto = texto.lastIndexOf('.');

  let limpio: string;
  if (ultimaComa > ultimoPunto) {
    // "1.234,56" → el decimal es la coma.
    limpio = texto.replace(/\./g, '').replace(',', '.');
  } else if (ultimoPunto > ultimaComa) {
    // "1,234.56" → el decimal es el punto.
    limpio = texto.replace(/,/g, '');
  } else {
    limpio = texto;
  }

  const numero = Number(limpio);
  if (!Number.isFinite(numero) || numero < 0) return null;

  return Math.round(numero * 100);
}

/**
 * Adivina con qué se separan las columnas de un CSV.
 *
 * Excel en español guarda con punto y coma, no con coma — precisamente porque
 * la coma ya es el separador decimal. Dar por hecho la coma parte «120,00» en
 * dos columnas y el archivo entra mal sin que salte ningún error.
 *
 * Se mira SÓLO la primera línea, la de los títulos: ahí no hay decimales que
 * confundan la cuenta.
 */
function detectarSeparador(texto: string): string {
  const primeraLinea = texto.split(/\r?\n/, 1)[0] ?? '';
  const candidatos = [';', ',', '\t', '|'];
  let mejor = ',';
  let maximo = 0;
  for (const c of candidatos) {
    const cuantos = primeraLinea.split(c).length - 1;
    if (cuantos > maximo) {
      maximo = cuantos;
      mejor = c;
    }
  }
  return mejor;
}

/**
 * Lee el archivo y devuelve los cambios propuestos.
 *
 * Acepta `.xlsx` y `.csv`: el segundo porque «Guardar como CSV» es lo primero
 * que hace mucha gente y rechazarlo sería gratuito.
 *
 * Nunca lanza por un dato malo: una fila mala se marca como ERROR y el resto
 * sigue. Si un archivo de sesenta tratamientos se rechazara entero por una
 * celda, habría que corregir a ciegas.
 */
export async function leerArchivoDePrecios(
  contenido: ArrayBuffer,
  nombreArchivo: string,
  existentes: TratamientoExistente[],
): Promise<{ filas: FilaImportada[]; error?: string }> {
  const libro = new ExcelJS.Workbook();

  try {
    if (nombreArchivo.toLowerCase().endsWith('.csv')) {
      // ExcelJS lee CSV desde un stream de texto.
      const texto = new TextDecoder('utf-8').decode(contenido);
      await libro.csv.read(Readable.from([texto]), {
        parserOptions: { delimiter: detectarSeparador(texto) },
      });
    } else {
      await libro.xlsx.load(contenido);
    }
  } catch (error) {
    // El motivo real se registra: al usuario no le sirve, pero sin esto un
    // archivo que no entra se vuelve imposible de diagnosticar.
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'price_import.read_failed',
        file: nombreArchivo,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return {
      filas: [],
      error: 'No se pudo leer el archivo. ¿Es un Excel (.xlsx) o un CSV?',
    };
  }

  const hoja = libro.worksheets[0];
  if (!hoja || hoja.rowCount < 2) {
    return { filas: [], error: 'El archivo está vacío o no tiene filas de datos.' };
  }

  // --- Cabeceras ----------------------------------------------------------
  const cabeceras: string[] = [];
  hoja.getRow(1).eachCell((celda, col) => {
    cabeceras[col] = normalizar(celda.value);
  });

  const columnaDe = (clave: keyof typeof COLUMNAS): number | null => {
    const aceptados = COLUMNAS[clave]!.map(normalizar);
    const indice = cabeceras.findIndex((c) => c && aceptados.includes(c));
    return indice === -1 ? null : indice;
  };

  const colCode = columnaDe('code');
  const colName = columnaDe('name');
  const colPrice = columnaDe('price');

  if (colCode === null || colName === null || colPrice === null) {
    return {
      filas: [],
      error:
        'Faltan columnas obligatorias. La primera fila debe tener al menos: ' +
        'código, nombre y precio.',
    };
  }

  const colCategory = columnaDe('category');
  const colDuration = columnaDe('duration');
  const colBuffer = columnaDe('buffer');

  const porCodigo = new Map(existentes.map((t) => [t.code, t.basePriceCents]));
  const vistos = new Set<string>();
  const filas: FilaImportada[] = [];

  for (let n = 2; n <= hoja.rowCount; n += 1) {
    const fila = hoja.getRow(n);
    const leer = (col: number | null) =>
      col === null ? '' : String(fila.getCell(col).value ?? '').trim();

    const code = leer(colCode).toUpperCase();
    const name = leer(colName);

    // Fila totalmente vacía: Excel las arrastra al final y no son un error.
    if (!code && !name) continue;

    const base = {
      fila: n,
      code,
      name,
      category: leer(colCategory) || 'GENERAL',
      priceCents: 0,
      durationMinutes: Number(leer(colDuration)) || 30,
      bufferMinutes: Number(leer(colBuffer)) || 10,
    };

    if (!code || !/^[A-Z0-9_]{2,40}$/.test(code)) {
      filas.push({
        ...base,
        estado: 'ERROR',
        error: 'Código vacío o con caracteres no permitidos (usa mayúsculas, números y _).',
      });
      continue;
    }

    if (!name || name.length < 3) {
      filas.push({ ...base, estado: 'ERROR', error: 'Falta el nombre del tratamiento.' });
      continue;
    }

    // Un código repetido dentro del MISMO archivo: la segunda fila pisaría a
    // la primera sin que nadie lo note.
    if (vistos.has(code)) {
      filas.push({
        ...base,
        estado: 'ERROR',
        error: `El código ${code} está repetido en el archivo.`,
      });
      continue;
    }
    vistos.add(code);

    const priceCents = parsearPrecio(fila.getCell(colPrice).value);
    if (priceCents === null) {
      filas.push({
        ...base,
        estado: 'ERROR',
        error: `Precio ilegible: «${leer(colPrice)}».`,
      });
      continue;
    }

    if (priceCents > 100_000_00) {
      filas.push({
        ...base,
        priceCents,
        estado: 'ERROR',
        // Casi siempre es un separador mal puesto, no un precio real.
        error: 'Precio fuera de rango. Revisa el separador decimal.',
      });
      continue;
    }

    const actual = porCodigo.get(code);
    filas.push({
      ...base,
      priceCents,
      precioActualCents: actual,
      estado:
        actual === undefined ? 'NUEVO' : actual === priceCents ? 'SIN_CAMBIO' : 'ACTUALIZA',
    });
  }

  if (filas.length === 0) {
    return { filas: [], error: 'No se encontró ninguna fila con datos.' };
  }

  return { filas };
}
