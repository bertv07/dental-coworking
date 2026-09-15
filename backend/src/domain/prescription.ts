/**
 * ===========================================================================
 *  Recetarios — tamaños de papel
 * ===========================================================================
 *  Aquí vivían además los esquemas de los elementos que se colocaban encima
 *  de la hoja (cajas de texto, líneas, recuadros) y los marcadores tipo
 *  `{{paciente}}` que se sustituían al emitir.
 *
 *  Se quitó todo con el editor: el recipe que vale es el que la odontóloga
 *  ya usa en papel, y recomponerlo dentro del panel sólo creaba una segunda
 *  versión capaz de salir distinta de la impresa. Hoy el recipe se sube
 *  escaneado y se imprime tal cual, así que lo único que queda es el tamaño
 *  del papel en el que se va a imprimir.
 * ===========================================================================
 */

export const PAPER_SIZES = {
  MEDIA_CARTA: { label: 'Media carta vertical (5,5 × 8,5")', width: 528, height: 816 },
  CARTA: { label: 'Carta vertical (8,5 × 11")', width: 816, height: 1056 },
  A5: { label: 'A5 vertical (148 × 210 mm)', width: 559, height: 794 },
  A4: { label: 'A4 vertical (210 × 297 mm)', width: 794, height: 1123 },
  /*
   * Horizontales. Los recetarios reales suelen serlo: el de la Od. Martini
   * son dos mitades una al lado de la otra, prescripción e indicaciones, y en
   * vertical no cabrían.
   */
  A4_H: { label: 'A4 horizontal (297 × 210 mm)', width: 1123, height: 794 },
  CARTA_H: { label: 'Carta horizontal (11 × 8,5")', width: 1056, height: 816 },
  A5_H: { label: 'A5 horizontal (210 × 148 mm)', width: 794, height: 559 },
  MEDIA_CARTA_H: { label: 'Media carta horizontal (8,5 × 5,5")', width: 816, height: 528 },
} as const;
