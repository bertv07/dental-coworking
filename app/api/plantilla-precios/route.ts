import ExcelJS from 'exceljs';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';

/**
 * ===========================================================================
 *  GET /api/plantilla-precios — el Excel para editar la lista
 * ===========================================================================
 *  Se descarga con la lista ACTUAL ya dentro, no vacío.
 *
 *  Es la diferencia entre «rellena estas columnas» y «cambia lo que quieras y
 *  vuelve a subirlo»: partiendo de la lista real no hay que teclear sesenta
 *  códigos a mano, y los códigos son justo lo que no puede fallar — son la
 *  llave con la que el bot identifica cada tratamiento.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const authorization = await checkApiRole('ASSISTANT');
  if (!authorization.authorized) {
    return new Response('No autorizado', { status: authorization.status });
  }

  const treatments = await repository.listTreatments({ includeInactive: true });

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Precios');

  hoja.columns = [
    { header: 'Código', key: 'code', width: 16 },
    { header: 'Nombre', key: 'name', width: 42 },
    { header: 'Categoría', key: 'category', width: 20 },
    { header: 'Precio', key: 'price', width: 12 },
    { header: 'Duración', key: 'duration', width: 11 },
    { header: 'Buffer', key: 'buffer', width: 10 },
  ];

  hoja.getRow(1).font = { bold: true };
  // Se congela la cabecera: con sesenta filas, saber qué columna es cuál sin
  // subir hasta arriba evita justamente el error que más caro sale aquí.
  hoja.views = [{ state: 'frozen', ySplit: 1 }];

  for (const t of treatments) {
    hoja.addRow({
      code: t.code,
      name: t.name,
      category: t.category,
      // En DÓLARES, no en centavos: quien edita esto piensa en «35», no en
      // «3500». La conversión la hace el sistema al leer.
      price: t.basePriceCents / 100,
      duration: t.durationMinutes,
      buffer: t.bufferMinutes,
    });
  }

  hoja.getColumn('price').numFmt = '#,##0.00';

  const buffer = await libro.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="precios-dental-coworking.xlsx"',
      'Cache-Control': 'private, no-store',
    },
  });
}
