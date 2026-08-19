/**
 * ===========================================================================
 *  Añade el tratamiento de bruxismo al catálogo
 * ===========================================================================
 *      node scripts/anadir-bruxismo.mjs
 *
 *  El bruxismo se trata con una FÉRULA DE DESCARGA: una placa a medida que el
 *  paciente usa de noche. Lleva impresión, laboratorio y ajuste, así que se
 *  cobra en dos actos —la toma de medidas y la entrega— pero se agenda y se
 *  cotiza como un tratamiento.
 *
 *  ---------------------------------------------------------------------
 *  ⚠️  EL PRECIO ES UN MARCADOR
 *  ---------------------------------------------------------------------
 *  Se crea con `isPriceVariable: true` y $150 de referencia porque el coste
 *  real depende del laboratorio, y ese dato no lo tengo. Marcado como
 *  variable, el bot cotiza «desde $150» en vez de cerrar un precio que luego
 *  habría que desdecir en el mostrador.
 *
 *  **Ajústalo en `/tratamientos` con el precio real de tu laboratorio.**
 *
 *  Es idempotente: si el código ya existe, no lo pisa.
 * ===========================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TRATAMIENTOS = [
  {
    code: 'FERULA',
    name: 'Férula de descarga (bruxismo)',
    category: 'REHABILITACIÓN',
    description:
      'Placa de descarga a medida para bruxismo. Incluye toma de impresión, ' +
      'laboratorio y ajuste. El precio final depende del laboratorio.',
    // Referencia. El bot lo cotiza como «desde $150».
    basePriceCents: 15000,
    durationMinutes: 45,
    bufferMinutes: 10,
    isPriceVariable: true,
    clinicKeepsAll: false,
  },
  {
    code: 'BRUX_CTRL',
    name: 'Control de bruxismo',
    category: 'REHABILITACIÓN',
    description: 'Revisión y ajuste de la férula de descarga.',
    basePriceCents: 2000,
    durationMinutes: 30,
    bufferMinutes: 10,
    isPriceVariable: false,
    clinicKeepsAll: false,
  },
];

try {
  for (const tratamiento of TRATAMIENTOS) {
    const existe = await prisma.treatment.findUnique({
      where: { code: tratamiento.code },
      select: { id: true, name: true },
    });

    if (existe) {
      console.log(`= Ya existe, no se toca: ${existe.name} (${tratamiento.code})`);
      continue;
    }

    const creado = await prisma.treatment.create({ data: tratamiento });
    console.log(
      `+ Creado: ${creado.name} — $${creado.basePriceCents / 100}` +
        `${creado.isPriceVariable ? ' (precio orientativo)' : ''}`,
    );
  }

  console.log();
  console.log('Listo. AJUSTA EL PRECIO de la férula en /tratamientos:');
  console.log('los $150 son un marcador, no el precio de tu laboratorio.');
} finally {
  await prisma.$disconnect();
}
