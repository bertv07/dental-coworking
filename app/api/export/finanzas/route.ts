import type { NextRequest } from 'next/server';
import { checkApiRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { getCurrentRate } from '@/backend/services/exchange-rate.service';
import { fromCents, centsToBs } from '@/backend/domain/money';
import { failUnauthorized, failForbidden, failInternal, newRequestId } from '@/backend/http/responses';

/**
 * ===========================================================================
 *  GET /api/export/finanzas — Informe financiero descargable
 * ===========================================================================
 *  ¿POR QUÉ CSV Y NO PDF?
 *
 *  El destinatario de este informe es quien administra la clínica, y lo que
 *  hace con él es SUMAR, FILTRAR y CRUZAR con su contabilidad. Un PDF se
 *  mira; una hoja de cálculo se trabaja.
 *
 *  Además, CSV no necesita ninguna dependencia: generar PDF exigiría meter
 *  una librería de ~500 KB al bundle del servidor para producir algo menos
 *  útil. Si más adelante hace falta un PDF con membrete para presentar a un
 *  tercero, se añade como formato ADICIONAL, no en sustitución.
 *
 *  Detalles que hacen que abra bien en Excel:
 *   · BOM UTF-8 al inicio → Excel reconoce los acentos. Sin él, "Odontólogo"
 *     aparece como "OdontÃ³logo".
 *   · Separador `;` → es lo que espera Excel en configuración regional
 *     española/latinoamericana, donde la coma es el separador DECIMAL.
 *   · Números con coma decimal, coherentes con esa misma configuración.
 * ===========================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Escapa un valor para CSV.
 *
 * Sin esto, un nombre con `;` partiría la fila en dos columnas y desplazaría
 * todo el resto del informe.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);

  // Comillas dobles internas se duplican, según RFC 4180.
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Número con coma decimal, para que Excel en español lo lea como número. */
function csvNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals).replace('.', ',');
}

export async function GET(request: NextRequest) {
  const requestId = newRequestId();

  try {
    // --- Autorización: los datos financieros son sólo del Super Admin ----
    const authorization = await checkApiRole('SUPER_ADMIN');
    if (!authorization.authorized) {
      return authorization.status === 401
        ? failUnauthorized(requestId)
        : failForbidden(requestId);
    }

    // Rango: por defecto 30 días. Acotado a 1 año para no generar informes
    // de 200 MB por un parámetro mal puesto.
    const daysParam = Number.parseInt(request.nextUrl.searchParams.get('dias') ?? '30', 10);
    const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 365) : 30;

    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const [summary, earnings, rate, settings] = await Promise.all([
      repository.getFinancialSummary({ from, to }),
      repository.getDentistEarnings({ from, to }),
      getCurrentRate('BCV'),
      repository.getClinicSettings(),
    ]);

    const bsRate = rate?.rate ?? null;
    const formatDate = (date: Date) =>
      new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeZone: 'America/Caracas' }).format(
        date,
      );

    const lines: string[] = [];

    // --- Cabecera del informe --------------------------------------------
    lines.push(csvCell(`INFORME FINANCIERO - ${settings.clinicName}`));
    lines.push(`${csvCell('RIF')};${csvCell(settings.taxId ?? '-')}`);
    lines.push(`${csvCell('Periodo')};${csvCell(`${formatDate(from)} a ${formatDate(to)}`)}`);
    lines.push(
      `${csvCell('Tasa BCV aplicada')};${bsRate ? csvNumber(bsRate, 4) : csvCell('no disponible')};${csvCell('Bs/USD')}`,
    );
    lines.push(`${csvCell('Generado')};${csvCell(formatDate(new Date()))}`);
    lines.push('');

    // --- Resumen ----------------------------------------------------------
    lines.push(csvCell('RESUMEN'));
    lines.push(['Concepto', 'Monto USD', 'Monto Bs'].map(csvCell).join(';'));

    const summaryRows: Array<[string, number]> = [
      ['Ingresos totales', summary.totalRevenueCents],
      ['Ganancia de la clinica', summary.clinicEarningsCents],
      ['Devengado odontologos', summary.dentistEarningsCents],
      ['Deuda pendiente por liquidar', summary.outstandingPayoutsCents],
    ];

    for (const [label, cents] of summaryRows) {
      lines.push(
        [
          csvCell(label),
          csvNumber(fromCents(cents)),
          bsRate ? csvNumber(centsToBs(cents, bsRate)) : '',
        ].join(';'),
      );
    }
    lines.push('');

    // --- Operación --------------------------------------------------------
    lines.push(csvCell('OPERACION'));
    lines.push(['Indicador', 'Cantidad'].map(csvCell).join(';'));
    lines.push(`${csvCell('Citas completadas')};${summary.completedAppointments}`);
    lines.push(`${csvCell('Citas canceladas')};${summary.cancelledAppointments}`);
    lines.push(`${csvCell('Inasistencias')};${summary.noShowAppointments}`);
    lines.push(`${csvCell('Agendadas por la IA')};${summary.aiBookedAppointments}`);
    lines.push('');

    // --- Detalle por odontólogo -------------------------------------------
    lines.push(csvCell('LIQUIDACION POR ODONTOLOGO'));
    lines.push(
      [
        'Odontologo',
        'Citas',
        'Produccion USD',
        'Comision %',
        'Clinica USD',
        'Odontologo USD',
        'Por pagar USD',
        'Por pagar Bs',
      ]
        .map(csvCell)
        .join(';'),
    );

    for (const row of earnings.filter((item) => item.grossCents > 0)) {
      lines.push(
        [
          csvCell(row.dentistName),
          row.appointmentCount,
          csvNumber(fromCents(row.grossCents)),
          row.commissionPercent,
          csvNumber(fromCents(row.clinicShareCents)),
          csvNumber(fromCents(row.dentistShareCents)),
          csvNumber(fromCents(row.outstandingCents)),
          bsRate ? csvNumber(centsToBs(row.outstandingCents, bsRate)) : '',
        ].join(';'),
      );
    }

    // Fila de totales: es lo primero que se busca al abrir el archivo.
    const active = earnings.filter((item) => item.grossCents > 0);
    lines.push('');
    lines.push(
      [
        csvCell('TOTAL'),
        active.reduce((sum, r) => sum + r.appointmentCount, 0),
        csvNumber(fromCents(active.reduce((s, r) => s + r.grossCents, 0))),
        '',
        csvNumber(fromCents(active.reduce((s, r) => s + r.clinicShareCents, 0))),
        csvNumber(fromCents(active.reduce((s, r) => s + r.dentistShareCents, 0))),
        csvNumber(fromCents(active.reduce((s, r) => s + r.outstandingCents, 0))),
        bsRate ? csvNumber(centsToBs(active.reduce((s, r) => s + r.outstandingCents, 0), bsRate)) : '',
      ].join(';'),
    );

    // `﻿` = BOM UTF-8. Sin él Excel destroza los acentos.
    const csv = `﻿${lines.join('\r\n')}`;

    const filename = `finanzas-${to.toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        // `attachment` fuerza la descarga en vez de mostrarlo en el navegador.
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return failInternal(error, requestId);
  }
}
