import 'server-only';
import { repository } from '@/backend/repositories';
import { addDays, clinicDayKey, clinicWallClockToInstant } from '@/backend/domain/clinic-calendar';
import { calcularCierre, rangoDelCierre, type Cierre } from '@/backend/domain/cierre';

/**
 * Reúne TODO lo de Administración para el cierre de un mes o de un año.
 *
 * Lo usan la pantalla y la acción de cerrar, las dos: así lo que se guarda
 * al cerrar es lo mismo que se estaba viendo, calculado aquí y no enviado
 * por el navegador.
 */

export interface CierreCompleto {
  cierre: Cierre;
  /** Lo cobrado de verdad en Caja en el periodo. */
  cobrado: {
    totalCents: number;
    clinicShareCents: number;
    dentistShareCents: number;
    paymentCount: number;
    /** Por día, 'YYYY-MM-DD'. */
    porDia: Map<string, number>;
  };
}

/** 'YYYY-MM' o 'YYYY', y no en el futuro. */
export function esPeriodoValido(period: unknown): period is string {
  if (typeof period !== 'string' || !/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(period)) return false;
  const hoy = clinicDayKey(new Date());
  return period >= '2020' && period <= hoy.slice(0, period.length);
}

export async function obtenerCierre(period: string): Promise<CierreCompleto> {
  const { desde, hasta } = rangoDelCierre(period);

  const [libro, cajaChica, dentists, caja] = await Promise.all([
    repository.listAdminLedgerEntries({ book: 'GASTOS_ADMIN' }),
    repository.listAdminLedgerEntries({ book: 'CAJA_CHICA' }),
    // También las inactivas: su libro del año pasado sigue contando.
    repository.listDentists({ includeInactive: true }),
    repository.getCashReport({
      from: clinicWallClockToInstant(desde, 0),
      to: clinicWallClockToInstant(addDays(hasta, 1), 0),
    }),
  ]);

  const libros = await Promise.all(
    dentists.map(async (d) => ({
      dentistId: d.id,
      dentistName: d.fullName,
      filas: await repository.listDentistLedgerEntries({ dentistId: d.id }),
    })),
  );

  return {
    cierre: calcularCierre({
      period,
      libro,
      cajaChica,
      libros,
    }),
    cobrado: {
      totalCents: caja.totalCents,
      clinicShareCents: caja.clinicShareCents,
      dentistShareCents: caja.dentistShareCents,
      paymentCount: caja.paymentCount,
      porDia: new Map(caja.byDay.map((d) => [d.day, d.cents])),
    },
  };
}
