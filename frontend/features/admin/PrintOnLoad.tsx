'use client';

import { useEffect } from 'react';

/**
 * Lanza el diálogo de impresión al abrir la página.
 *
 * La factura se abre en pestaña nueva desde el botón «Imprimir», así que lo
 * único que se quiere hacer aquí es imprimir. Obligar a un segundo clic en el
 * menú del navegador es fricción en el mostrador, con el paciente esperando.
 *
 * Va en un componente de cliente mínimo para que la página en sí siga siendo
 * de servidor: así el papel se arma con los datos ya resueltos.
 */
export function PrintOnLoad() {
  useEffect(() => {
    // Un tick de margen para que la hoja esté pintada: sin él, algunos
    // navegadores abren el diálogo sobre una página a medio renderizar.
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);

  return null;
}
