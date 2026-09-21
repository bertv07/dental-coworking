/**
 * ===========================================================================
 *  ¿Puede este odontólogo hacer este tratamiento?
 * ===========================================================================
 *  La clínica tiene los dos datos, pero escritos por manos distintas y en
 *  momentos distintos, así que NO coinciden letra a letra:
 *
 *    categorías de tratamiento →  CIRUGÍA · ESTÉTICA · ENDODONCIA ·
 *                                 PERIODONCIA · OPERATORIA · DIAGNÓSTICO
 *    especialidades de la ficha →  CIRUGÍA ORAL · ESTÉTICA DENTAL ·
 *                                 ENDODONCIA · PERIODONCIA · IMPLANTOLOGÍA ·
 *                                 ODONTOLOGÍA GENERAL · ODONTOPEDIATRÍA · …
 *
 *  Comparar con `===` no encuentra nada: «CIRUGÍA» no es «CIRUGÍA ORAL».
 *  Comparar con `includes` sobre el texto crudo tampoco, porque los acentos
 *  se escriben de dos maneras según el teclado.
 *
 *  ---------------------------------------------------------------------
 *  LA REGLA QUE IMPORTA: ANTE LA DUDA, NO SE BLOQUEA
 *  ---------------------------------------------------------------------
 *  Si NADIE tiene la especialidad de un tratamiento, vale cualquiera. Esto
 *  no es laxitud: OPERATORIA y DIAGNÓSTICO son odontología general y ninguna
 *  ficha las lleva escritas. Filtrando a rajatabla, el bot se quedaría sin
 *  candidatos y devolvería «no hay huecos» para media lista de precios —el
 *  mismo fallo que ya nos costó semanas con los códigos de tratamiento, y
 *  que desde fuera es indistinguible de una agenda llena.
 *
 *  Cuando SÍ hay especialistas, se filtra de verdad: la endodoncia la hace
 *  quien sabe hacerla.
 * ===========================================================================
 */

/**
 * Deja el texto comparable: sin acentos, en mayúsculas y sin dobles espacios.
 *
 * `normalize('NFD')` separa la letra de su tilde y el rango ̀-ͯ
 * borra las tildes sueltas, así que «CIRUGÍA» y «CIRUGIA» acaban iguales.
 */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palabras que no distinguen nada: aparecen en media lista. */
const RUIDO = new Set(['ORAL', 'DENTAL', 'DE', 'Y', 'LA', 'EL', 'GENERAL']);

/** Las palabras con carga de un texto, ya normalizadas. */
function palabrasUtiles(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((palabra) => palabra.length >= 4 && !RUIDO.has(palabra));
}

/**
 * Un generalista puede con el trabajo general.
 *
 * No se le da como comodín para TODO: quien pone «odontología general» no
 * está diciendo que haga endodoncias. Sólo cuenta cuando el tratamiento no
 * tiene especialistas propios, y eso ya lo resuelve la regla de arriba.
 */
function esGeneralista(especialidades: string[]): boolean {
  return especialidades.some((e) => normalizar(e).includes('GENERAL'));
}

/**
 * ¿Encaja esta especialidad con esta categoría?
 *
 * Basta con que compartan una palabra con carga: «CIRUGÍA ORAL» encaja con
 * «CIRUGÍA» por CIRUGIA, y «ESTÉTICA DENTAL» con «ESTÉTICA» por ESTETICA.
 * ORAL y DENTAL no cuentan porque los llevan media docena de especialidades
 * distintas y harían encajar todo con todo.
 */
function encaja(especialidad: string, categoria: string): boolean {
  const deLaCategoria = palabrasUtiles(categoria);
  if (deLaCategoria.length === 0) return false;
  const deLaEspecialidad = new Set(palabrasUtiles(especialidad));
  return deLaCategoria.some((palabra) => deLaEspecialidad.has(palabra));
}

export interface ConEspecialidades {
  id: string;
  specialties: string[];
}

/**
 * Los odontólogos que pueden hacer un tratamiento de esa categoría.
 *
 * Devuelve la lista ENTERA cuando nadie tiene esa especialidad: ver la regla
 * de arriba. Nunca devuelve vacío si `candidatos` no lo estaba, y esa
 * garantía es el motivo de que exista esta función en vez de un `.filter()`
 * suelto en el servicio de agenda.
 */
export function filtrarPorEspecialidad<T extends ConEspecialidades>(
  candidatos: T[],
  categoria: string | null | undefined,
): T[] {
  if (!categoria || candidatos.length === 0) return candidatos;

  const especialistas = candidatos.filter((c) =>
    c.specialties.some((e) => encaja(e, categoria)),
  );

  if (especialistas.length > 0) return especialistas;

  // Nadie tiene la especialidad: es trabajo general. Los generalistas
  // primero si los hay; si tampoco, todos.
  const generalistas = candidatos.filter((c) => esGeneralista(c.specialties));
  return generalistas.length > 0 ? generalistas : candidatos;
}

/** Para explicárselo al bot y a recepción sin que tengan que deducirlo. */
export function describirEspecialidades(especialidades: string[]): string {
  return especialidades.length > 0 ? especialidades.join(', ') : 'Odontología general';
}
