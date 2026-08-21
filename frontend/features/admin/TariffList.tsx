import { formatCents } from '@/backend/domain/money';
import { Card, EmptyState } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Tarifas, como las ve recepción
 * ===========================================================================
 *  Sólo lo aprobado, y sólo el PRECIO. Recepción cotiza por teléfono y
 *  factura en el mostrador: necesita saber que con la Dra. X la exodoncia son
 *  $50 y no los $30 de lista.
 *
 *  Lo que no lleva —ni como columna oculta ni como campo en el payload— es el
 *  reparto. Cuánto de ese precio se queda la clínica y cuánto el odontólogo
 *  es una negociación entre ellos, y no hace falta para cobrar.
 * ===========================================================================
 */

export interface TarifaVisible {
  id: string;
  dentistName: string;
  treatmentName: string;
  listPriceCents: number;
  priceCents: number;
}

export function TariffList({ tariffs }: { tariffs: TarifaVisible[] }) {
  if (tariffs.length === 0) {
    return (
      <Card>
        <EmptyState>
          No hay tarifas especiales.
          <br />
          Todos los tratamientos se cobran a su precio de lista.
        </EmptyState>
      </Card>
    );
  }

  // Agrupado por odontólogo: la pregunta real del mostrador es «¿cuánto cobra
  // esta doctora?», no «¿quién cobra distinto por esto?».
  const porOdontologo = new Map<string, TarifaVisible[]>();
  for (const t of tariffs) {
    porOdontologo.set(t.dentistName, [...(porOdontologo.get(t.dentistName) ?? []), t]);
  }

  return (
    <>
      {[...porOdontologo.entries()].map(([dentista, filas]) => (
        <Card key={dentista} title={dentista} subtitle={`${filas.length} tarifas`} flush>
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th>Tratamiento</th>
                  <th className="table__num">Precio de lista</th>
                  <th className="table__num">Se le cobra</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Tratamiento">
                      <div className="table__strong">{t.treatmentName}</div>
                    </td>
                    <td className="table__num mono muted" data-label="Precio de lista">
                      {formatCents(t.listPriceCents)}
                    </td>
                    <td
                      className="table__num mono table__strong"
                      data-label="Se le cobra"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {formatCents(t.priceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </>
  );
}
