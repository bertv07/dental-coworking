import 'server-only';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { parsearPrecio } from '@/backend/services/price-import.service';

/**
 * ===========================================================================
 *  Cargar el libro de Administración desde Excel
 * ===========================================================================
 *  La misma hoja que Deimara ya lleva —fecha, descripción, ingreso, egreso,
 *  información— subida de una vez en lugar de fila por fila.
 *
 *  Igual que con la lista de precios: esta capa SÓLO LEE. Devuelve las filas
 *  tal como las entendió, con las que no se pudieron leer señaladas una a
 *  una, y guardar es otro paso que alguien confirma mirando la vista previa.
 *
 *  DOS FORMAS DE HOJA, según a dónde va:
 *   · General / Caja Chica: Fecha · Descripción · Ingreso · Egreso · Información
 *   · Odontóloga:           Fecha · Paciente · Presupuesto · Abono · reparto
 *
 *  La hoja real no empieza en la fila 1: trae un título encima («Control
 *  Ingresos y Egresos Coworking General») y los totales al final. Por eso la
 *  fila de títulos se BUSCA, y las filas de totales se saltan sin marcarlas
 *  como error.
 * ===========================================================================
 */

export interface FilaGeneralLeida {
  tipo: 'GENERAL';
  /** Número de fila en el Excel, para poder decir «arréglala en la fila 12». */
  fila: number;
  /** 'YYYY-MM-DD', o `''` si no se pudo leer. */
  date: string;
  description: string;
  incomeCents: number;
  expenseCents: number;
  notes: string | null;
  error?: string;
}

export interface FilaDentistaLeida {
  tipo: 'DENTISTA';
  fila: number;
  date: string;
  patientName: string;
  budgetCents: number;
  depositCents: number;
  /** Lo que se quedó ELLA en esta fila. `0` = cortesía o sin reparto anotado. */
  dentistPercent: number;
  dentistShareCents: number;
  clinicShareCents: number;
  notes: string | null;
  error?: string;
}

export interface LibroLeido<F> {
  filas: F[];
  /** Todas las hojas del archivo, para poder elegir otra. */
  hojas: string[];
  /** La que se leyó. */
  hoja: string;
  error?: string;
}

const COLUMNAS_GENERAL = {
  date: ['fecha', 'dia', 'date'],
  description: ['descripcion', 'concepto', 'detalle', 'description'],
  income: ['ingreso', 'ingresos', 'entrada', 'entradas', 'haber'],
  expense: ['egreso', 'egresos', 'salida', 'salidas', 'gasto', 'gastos', 'debe'],
  notes: ['informacion', 'info', 'nota', 'notas', 'observacion', 'observaciones'],
};

const COLUMNAS_DENTISTA = {
  date: ['fecha', 'dia', 'date'],
  patient: ['paciente', 'pacientes', 'px', 'nombre', 'nombre del paciente'],
  budget: ['presupuesto', 'monto', 'total', 'costo', 'consulta', 'tratamiento'],
  deposit: ['abono', 'abonos', 'abonado'],
  percent: ['%', '% dra', '% doctora', 'porcentaje', 'porcentaje dra', 'porcentaje doctora'],
  dentistShare: ['dra', 'doctora', 'pago dra', 'pago doctora', 'odontologa', 'odontologo'],
  notes: ['informacion', 'info', 'nota', 'notas', 'observacion', 'observaciones'],
};

/** Quita tildes, signos de puntuación del final y espacios para comparar títulos. */
function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[:.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * El valor «de verdad» de una celda.
 *
 * ExcelJS no devuelve siempre un texto o un número: una celda con fórmula es
 * `{ formula, result }`, una con formato parcial es `{ richText }` y un
 * enlace es `{ text, hyperlink }`. Un `String()` a secas las convierte todas
 * en «[object Object]».
 */
function valorDe(celda: ExcelJS.Cell): unknown {
  const v = celda.value as unknown;
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if ('result' in o) return o.result ?? null;
  if (Array.isArray(o.richText)) {
    return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('');
  }
  if ('text' in o) return o.text;
  // Fórmula sin resultado guardado, o una celda de error (#REF!).
  return null;
}

function textoDe(celda: ExcelJS.Cell): string {
  const v = valorDe(celda);
  if (v === null || v instanceof Date) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function aDayKey(anio: number, mes: number, dia: number): string | null {
  if (anio < 100) anio += 2000;
  if (anio < 2000 || anio > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 12));
  // '31/02' no existe: si el constructor la corrió de mes, se descarta.
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  return fecha.toISOString().slice(0, 10);
}

/** Las partes de una fecha escrita como texto: «9/14/2026», «14-09-2026». */
function partesDeFecha(texto: string): [number, number, number] | null {
  const m = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/.exec(texto.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * ¿Las fechas escritas como texto van con el MES primero?
 *
 * «9/1/2026» puede ser 1 de septiembre o 9 de enero, y una sola fecha no lo
 * dice. La hoja entera sí: si en alguna el segundo número pasa de 12
 * («9/14/2026») es mes/día; si es el primero el que pasa («14/9/2026»), es
 * día/mes. Se decide UNA vez para toda la hoja, no fecha a fecha — así una
 * hoja no puede quedar mitad en septiembre y mitad en enero.
 *
 * Sin ninguna pista se asume mes/día, que es como viene la hoja de la
 * clínica. La vista previa enseña las fechas ya interpretadas justamente
 * para que esto se pueda comprobar antes de guardar.
 */
function mesVaPrimero(textos: string[]): boolean {
  let mesPrimero = 0;
  let diaPrimero = 0;
  for (const t of textos) {
    const p = partesDeFecha(t);
    if (!p || p[0] > 31) continue;
    if (p[1] > 12) mesPrimero += 1;
    if (p[0] > 12) diaPrimero += 1;
  }
  return diaPrimero > mesPrimero ? false : true;
}

function leerFecha(valor: unknown, mesPrimero: boolean): string | null {
  // Celda de fecha de verdad: ExcelJS la entrega a medianoche UTC.
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return aDayKey(valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate());
  }
  // Número de serie de Excel, cuando la celda perdió el formato de fecha.
  if (typeof valor === 'number') {
    if (valor < 36526 || valor > 73415) return null;
    const d = new Date(Math.round((valor - 25569) * 86_400_000));
    return aDayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const p = partesDeFecha(String(valor ?? ''));
  if (!p) return null;
  const [a, b, c] = p;
  if (a > 31) return aDayKey(a, b, c); // 2026-09-14
  return mesPrimero ? aDayKey(c, a, b) : aDayKey(c, b, a);
}

/** Importe de una celda. Vacía = 0; ilegible = `null`. */
function leerImporte(celda: ExcelJS.Cell | null): number | null {
  if (!celda) return 0;
  const v = valorDe(celda);
  if (v === null || v === '') return 0;
  if (typeof v === 'string' && /^[\s\-–—]*$/.test(v)) return 0;
  if (typeof v === 'number' && v < 0) return null;
  return parsearPrecio(v);
}

/** ¿El título de la columna es un porcentaje («40%», o 0.4 con formato %)? */
function esTituloDePorcentaje(celda: ExcelJS.Cell): boolean {
  const v = valorDe(celda);
  if (typeof v === 'number') return v > 0 && v <= 1;
  return /^\d{1,3}\s*%/.test(String(v ?? '').trim());
}

async function abrirLibro(contenido: ArrayBuffer, nombreArchivo: string): Promise<ExcelJS.Workbook | null> {
  const libro = new ExcelJS.Workbook();
  try {
    if (nombreArchivo.toLowerCase().endsWith('.csv')) {
      const texto = new TextDecoder('utf-8').decode(contenido);
      const primeraLinea = texto.split(/\r?\n/, 1)[0] ?? '';
      const delimiter = [';', '\t', '|', ','].reduce((mejor, c) =>
        primeraLinea.split(c).length > primeraLinea.split(mejor).length ? c : mejor,
      );
      await libro.csv.read(Readable.from([texto]), {
        parserOptions: { delimiter },
        // Todo como texto: el conversor de ExcelJS adivina fechas por su
        // cuenta, y aquí se interpretan con la regla de la hoja entera.
        map: (v: unknown) => v,
      });
    } else {
      await libro.xlsx.load(contenido);
    }
    return libro;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'ledger_import.read_failed',
        file: nombreArchivo,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

/**
 * Qué hoja leer cuando el archivo trae varias.
 *
 * El libro completo de la clínica tiene una pestaña por cada cosa, así que
 * si no se pidió una en concreto se busca la que se llama como el destino
 * («Caja Chica», «Dra. Palma»). Si ninguna se parece, la primera.
 */
function elegirHoja(libro: ExcelJS.Workbook, pedida: string | null, pistas: string[]): ExcelJS.Worksheet | null {
  const hojas = libro.worksheets;
  if (hojas.length === 0) return null;
  if (pedida) {
    const exacta = hojas.find((h) => h.name === pedida);
    if (exacta) return exacta;
  }
  const buscadas = pistas.map(normalizar).filter((p) => p.length >= 3);
  const parecida = hojas.find((h) => buscadas.some((p) => normalizar(h.name).includes(p)));
  return parecida ?? hojas[0]!;
}

/**
 * Busca la fila de títulos entre las primeras de la hoja.
 *
 * `requeridas` son las columnas sin las que no hay nada que leer; devuelve
 * dónde está cada columna conocida, por su clave.
 */
function buscarCabecera<K extends string>(
  hoja: ExcelJS.Worksheet,
  columnas: Record<K, string[]>,
  requeridas: NoInfer<K>[],
): { fila: number; col: Partial<Record<K, number>> } | null {
  const hasta = Math.min(hoja.rowCount, 25);
  for (let n = 1; n <= hasta; n += 1) {
    const col: Partial<Record<K, number>> = {};
    hoja.getRow(n).eachCell((celda, c) => {
      const titulo = normalizar(textoDe(celda));
      if (!titulo) return;
      for (const clave of Object.keys(columnas) as K[]) {
        // La primera que coincida gana: una segunda columna «Total» más a la
        // derecha no debe pisar a la del presupuesto.
        if (col[clave] === undefined && columnas[clave].includes(titulo)) col[clave] = c;
      }
    });
    if (requeridas.every((r) => col[r] !== undefined)) return { fila: n, col };
  }
  return null;
}

function fechasEnTexto(hoja: ExcelJS.Worksheet, desde: number, colFecha: number): string[] {
  const textos: string[] = [];
  for (let n = desde; n <= hoja.rowCount; n += 1) {
    const v = valorDe(hoja.getRow(n).getCell(colFecha));
    if (typeof v === 'string') textos.push(v);
  }
  return textos;
}

const SIN_FILAS = 'No se encontró ninguna fila con datos en esa hoja.';

/** Lee una hoja con la forma de Gastos Administrativos / Caja Chica. */
export async function leerLibroGeneral(
  contenido: ArrayBuffer,
  nombreArchivo: string,
  opciones: { hoja: string | null; pistas: string[] },
): Promise<LibroLeido<FilaGeneralLeida>> {
  const libro = await abrirLibro(contenido, nombreArchivo);
  const hoja = libro && elegirHoja(libro, opciones.hoja, opciones.pistas);
  if (!libro || !hoja) {
    return { filas: [], hojas: [], hoja: '', error: 'No se pudo leer el archivo. ¿Es un Excel (.xlsx) o un CSV?' };
  }
  const hojas = libro.worksheets.map((h) => h.name);
  const base = { hojas, hoja: hoja.name };

  const cabecera = buscarCabecera(hoja, COLUMNAS_GENERAL, ['date', 'description']);
  if (!cabecera || (cabecera.col.income === undefined && cabecera.col.expense === undefined)) {
    return {
      ...base,
      filas: [],
      error:
        `En la hoja «${hoja.name}» no encontré los títulos Fecha, Descripción, Ingreso y Egreso. ` +
        (hojas.length > 1 ? 'Prueba con otra hoja del archivo.' : 'Revisa que la hoja los tenga.'),
    };
  }

  const { col } = cabecera;
  const mesPrimero = mesVaPrimero(fechasEnTexto(hoja, cabecera.fila + 1, col.date!));
  const filas: FilaGeneralLeida[] = [];

  for (let n = cabecera.fila + 1; n <= hoja.rowCount; n += 1) {
    const fila = hoja.getRow(n);
    const celda = (c: number | undefined) => (c === undefined ? null : fila.getCell(c));

    const fechaCruda = valorDe(fila.getCell(col.date!));
    const description = textoDe(fila.getCell(col.description!));
    const incomeCents = leerImporte(celda(col.income));
    const expenseCents = leerImporte(celda(col.expense));
    const sinFecha = fechaCruda === null || fechaCruda === '';

    if (sinFecha && !description && !incomeCents && !expenseCents) continue;
    // «Total Ingreso:», «Total General:»: el pie de la hoja, no un movimiento.
    if (sinFecha && /^(sub)?total|^saldo\b/.test(normalizar(description))) continue;

    const leida: FilaGeneralLeida = {
      tipo: 'GENERAL',
      fila: n,
      date: leerFecha(fechaCruda, mesPrimero) ?? '',
      description: description.slice(0, 200),
      incomeCents: incomeCents ?? 0,
      expenseCents: expenseCents ?? 0,
      notes: (col.notes !== undefined && textoDe(fila.getCell(col.notes)).slice(0, 300)) || null,
    };

    if (!leida.date) leida.error = sinFecha ? 'Falta la fecha.' : `Fecha ilegible: «${String(fechaCruda)}».`;
    else if (description.length < 2) leida.error = 'Falta la descripción.';
    else if (incomeCents === null || expenseCents === null) leida.error = 'Importe ilegible.';
    else if (incomeCents > 0 && expenseCents > 0) leida.error = 'Tiene ingreso y egreso a la vez; una fila es una cosa o la otra.';
    else if (incomeCents === 0 && expenseCents === 0) leida.error = 'No tiene ingreso ni egreso.';
    else if (Math.max(incomeCents, expenseCents) > 1_000_000_00) leida.error = 'Importe fuera de rango. Revisa el separador decimal.';

    filas.push(leida);
  }

  return filas.length === 0 ? { ...base, filas, error: SIN_FILAS } : { ...base, filas };
}

/** Lee una hoja con la forma del libro de una odontóloga. */
export async function leerLibroDentista(
  contenido: ArrayBuffer,
  nombreArchivo: string,
  opciones: { hoja: string | null; pistas: string[] },
): Promise<LibroLeido<FilaDentistaLeida>> {
  const libro = await abrirLibro(contenido, nombreArchivo);
  const hoja = libro && elegirHoja(libro, opciones.hoja, opciones.pistas);
  if (!libro || !hoja) {
    return { filas: [], hojas: [], hoja: '', error: 'No se pudo leer el archivo. ¿Es un Excel (.xlsx) o un CSV?' };
  }
  const hojas = libro.worksheets.map((h) => h.name);
  const base = { hojas, hoja: hoja.name };

  const cabecera = buscarCabecera(hoja, COLUMNAS_DENTISTA, ['date', 'patient', 'budget']);
  if (!cabecera) {
    const esGeneral = buscarCabecera(hoja, COLUMNAS_GENERAL, ['date', 'description']) !== null;
    return {
      ...base,
      filas: [],
      error: esGeneral
        ? `La hoja «${hoja.name}» tiene la forma del libro general (Ingreso / Egreso). ` +
          'Para una odontóloga hacen falta las columnas Fecha, Paciente y Presupuesto: ' +
          'elige su hoja, o cambia el destino a General o Caja Chica.'
        : `En la hoja «${hoja.name}» no encontré los títulos Fecha, Paciente y Presupuesto.`,
    };
  }

  const { col } = cabecera;

  /*
   * En la hoja original el reparto no es una columna «%», son cuatro con el
   * porcentaje POR TÍTULO —40 % y 50 % de ella, 50 % y 60 % de la clínica— y
   * en cada fila se rellenan sólo las dos que tocan. Las de ella van primero,
   * así que su parte es la primera de esas columnas que traiga un importe.
   */
  const columnasDeReparto: number[] = [];
  hoja.getRow(cabecera.fila).eachCell((celda, c) => {
    if (esTituloDePorcentaje(celda)) columnasDeReparto.push(c);
  });

  const mesPrimero = mesVaPrimero(fechasEnTexto(hoja, cabecera.fila + 1, col.date!));
  const filas: FilaDentistaLeida[] = [];

  for (let n = cabecera.fila + 1; n <= hoja.rowCount; n += 1) {
    const fila = hoja.getRow(n);
    const celda = (c: number | undefined) => (c === undefined ? null : fila.getCell(c));

    const fechaCruda = valorDe(fila.getCell(col.date!));
    const patientName = textoDe(fila.getCell(col.patient!));
    const budgetCents = leerImporte(fila.getCell(col.budget!));
    const depositCents = leerImporte(celda(col.deposit));
    const sinFecha = fechaCruda === null || fechaCruda === '';

    if (sinFecha && !patientName) continue;
    if (sinFecha && /^(sub)?total/.test(normalizar(patientName))) continue;

    // Su parte, por orden de confianza: el % escrito, su importe, o la
    // primera columna de reparto rellena.
    let dentistShareCents = 0;
    let dentistPercent = 0;
    const presupuesto = budgetCents ?? 0;
    const porcentajeCrudo = col.percent === undefined ? null : valorDe(fila.getCell(col.percent));
    if (typeof porcentajeCrudo === 'number' || (typeof porcentajeCrudo === 'string' && /\d/.test(porcentajeCrudo))) {
      const numero =
        typeof porcentajeCrudo === 'number'
          ? porcentajeCrudo <= 1 ? porcentajeCrudo * 100 : porcentajeCrudo
          : Number(porcentajeCrudo.replace(/[^\d.,]/g, '').replace(',', '.'));
      dentistPercent = Math.round(numero);
      dentistShareCents = Math.round((presupuesto * dentistPercent) / 100);
    } else {
      const propia = leerImporte(celda(col.dentistShare)) ?? 0;
      const deReparto = columnasDeReparto
        .map((c) => leerImporte(fila.getCell(c)) ?? 0)
        .find((importe) => importe > 0);
      dentistShareCents = propia > 0 ? propia : (deReparto ?? 0);
      dentistPercent = presupuesto > 0 ? Math.round((dentistShareCents / presupuesto) * 100) : 0;
    }

    const leida: FilaDentistaLeida = {
      tipo: 'DENTISTA',
      fila: n,
      date: leerFecha(fechaCruda, mesPrimero) ?? '',
      patientName: patientName.slice(0, 120),
      budgetCents: presupuesto,
      depositCents: depositCents ?? 0,
      dentistPercent,
      dentistShareCents,
      // Lo que no se queda ella, se lo queda la clínica — igual que al
      // escribir la fila a mano.
      clinicShareCents: presupuesto - dentistShareCents,
      notes: (col.notes !== undefined && textoDe(fila.getCell(col.notes)).slice(0, 300)) || null,
    };

    if (!leida.date) leida.error = sinFecha ? 'Falta la fecha.' : `Fecha ilegible: «${String(fechaCruda)}».`;
    else if (patientName.length < 2) leida.error = 'Falta el nombre del paciente.';
    else if (budgetCents === null || depositCents === null) leida.error = 'Importe ilegible.';
    else if (presupuesto > 1_000_000_00) leida.error = 'Importe fuera de rango. Revisa el separador decimal.';
    else if (!Number.isFinite(dentistPercent) || dentistPercent < 0 || dentistPercent > 100 || dentistShareCents > presupuesto) {
      leida.error = 'El reparto no cuadra con el presupuesto.';
    }

    filas.push(leida);
  }

  return filas.length === 0 ? { ...base, filas, error: SIN_FILAS } : { ...base, filas };
}

/**
 * Huella de una fila para saber si YA está en el libro.
 *
 * El texto se compara sin tildes, espacios ni signos: «Dra. Palma/ PX.
 * Gonzalez / Coworking» y «Dra. Palma /PX. Gonzalez/ Coworking» son la misma
 * fila escrita dos veces, y sin esto subir la hoja otra vez las duplicaría.
 */
export function huellaDeFila(date: string, texto: string, ...importes: number[]): string {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  return [date, limpio, ...importes].join('|');
}
