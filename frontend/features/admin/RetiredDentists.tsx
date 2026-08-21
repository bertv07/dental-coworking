'use client';

import { useState, useTransition } from 'react';
import { reactivateDentistAction } from '@/app/actions/admin.actions';
import { Badge, Card, Notice } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Dados de baja
 * ===========================================================================
 *  Quien deja la clínica NO se borra de la tabla: sus citas, sus cobros y sus
 *  liquidaciones cuelgan de su ficha, y borrarla descuadraría la contabilidad
 *  histórica. Se marca la baja y deja de aparecer en los listados.
 *
 *  El efecto secundario es el que hacía falta resolver: su número de colegio
 *  y su correo son ÚNICOS y siguen ocupados. Si vuelve, darla de alta otra
 *  vez fallaba con «ya existe» y no había forma de ver quién lo ocupaba,
 *  porque el panel no listaba a los dados de baja en ningún sitio.
 *
 *  Aquí se ven y se reactivan. Reactivar es lo correcto frente a crear una
 *  ficha nueva: **conserva su historial**. Duplicarla partiría su historia en
 *  dos y las cuentas de antes dejarían de encontrarla.
 * ===========================================================================
 */

export interface OdontologoDeBaja {
  id: string;
  fullName: string;
  licenseNumber: string;
  email: string;
  specialties: string[];
  appointmentCount: number;
}

export function RetiredDentists({ dentists }: { dentists: OdontologoDeBaja[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Nadie de baja: no se enseña una tarjeta vacía que sólo añade ruido a la
  // pantalla que se usa a diario.
  if (dentists.length === 0) return null;

  function reactivar(dentist: OdontologoDeBaja) {
    if (
      !window.confirm(
        `¿Devolver a ${dentist.fullName} al servicio?\n\n` +
          'Su ficha vuelve con el historial intacto y con el mismo número de colegio.',
      )
    ) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await reactivateDentistAction(dentist.id);
      if (!result.ok) setError(result.error ?? 'No se pudo reactivar');
    });
  }

  return (
    <Card
      title="Dados de baja"
      subtitle="Siguen ocupando su número de colegio y su correo"
      actions={<Badge tone="neutral">{dentists.length}</Badge>}
      flush
    >
      {error && <Notice tone="danger">{error}</Notice>}

      <div style={{ padding: '0 1rem' }}>
        <Notice tone="info">
          Si alguno vuelve, <strong>reactívalo aquí</strong> en vez de crearlo de
          nuevo: así conserva sus citas y sus liquidaciones. Crear una ficha nueva
          partiría su historial en dos.
        </Notice>
      </div>

      <div className="table-wrap">
        <table className="table table--cards">
          <thead>
            <tr>
              <th>Odontólogo</th>
              <th>Nº de colegio</th>
              <th>Correo</th>
              <th className="table__num">Citas</th>
              <th style={{ textAlign: 'right' }} />
            </tr>
          </thead>
          <tbody>
            {dentists.map((dentist) => (
              <tr key={dentist.id}>
                <td data-label="Odontólogo">
                  <div className="table__strong">{dentist.fullName}</div>
                  <div className="row row--wrap text-xs subtle" style={{ gap: '0.25rem' }}>
                    {dentist.specialties.join(' · ')}
                  </div>
                </td>
                <td className="mono" data-label="Nº de colegio">
                  {dentist.licenseNumber}
                </td>
                <td className="text-xs subtle" data-label="Correo">
                  {dentist.email}
                </td>
                <td className="table__num mono" data-label="Citas">
                  {dentist.appointmentCount}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => reactivar(dentist)}
                    disabled={isPending}
                  >
                    Reactivar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
