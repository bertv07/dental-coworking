'use client';

/**
 * Botón de imprimir.
 *
 * Es lo único de la página del expediente que necesita JavaScript, así que
 * vive aislado: el resto es un Server Component y no viaja al navegador.
 *
 * Llama a `window.print()` en vez de generar un PDF en el servidor. El
 * navegador ya sabe imprimir y guardar como PDF, y hacerlo aquí garantiza que
 * lo impreso sea exactamente lo que se ve — un renderizador de PDF aparte
 * tendría otras fuentes y otro cálculo de saltos de página.
 */
export function PrintButton() {
  return (
    <button type="button" className="btn btn--primary" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
