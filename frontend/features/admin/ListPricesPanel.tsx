'use client';

import { Fragment, useState, useTransition } from 'react';
import { formatCents } from '@/backend/domain/money';
import { updateTreatmentPriceAction } from '@/app/actions/admin.actions';
import { Badge, Card, Notice } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Precios de lista, editables desde Tarifas
 * ===========================================================================
 *  El mismo precio que se ve en Precios, aquí al lado de las tarifas pactadas
 *  por odontóloga. Están juntos porque son la misma pregunta desde dos
 *  ángulos: «¿cuánto cuesta esto?» y «¿cuánto cuesta esto CON ella?».
 *
 *  Se edita en la propia fila: quien cotiza por teléfono no debería tener que
 *  cambiar de pantalla, buscar el tratamiento otra vez y abrir un formulario
 *  de ocho campos para subir un precio dos dólares.
 *
 *  Cada cambio queda en el historial de precios y en la auditoría, igual que
 *  desde la pantalla de siempre: el importe se guarda por la misma vía.
 * ===========================================================================
 */

interface Precio {
  id: string;
  code: string;
  name: string;
  category: string;
  basePriceCents: number;
  /** Cuántas odontólogas tienen un precio pactado distinto para esto. */
  pactadas: number;
}

export function ListPricesPanel({ treatments }: { treatments: Precio[] }) {
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function abrir(t: Precio) {
    setEditando(t.id);
    // En dólares, que es como lo piensa quien lo escribe.
    setValor((t.basePriceCents / 100).toFixed(2));
    setError(null);
    setGuardado(null);
  }

  function guardar(id: string) {
    const priceUsd = Number(valor.replace(',', '.'));
    if (!Number.isFinite(priceUsd) || priceUsd < 0) {
      setError('Ese precio no se entiende. Escribe algo como 35 o 35,50.');
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await updateTreatmentPriceAction({ id, priceUsd });
      if (!result.ok) {
        setError(result.error ?? 'No se pudo cambiar el precio');
        return;
      }
      setEditando(null);
      setGuardado(id);
    });
  }

  const porCategoria = treatments.reduce<Record<string, Precio[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});

  return (
    <Card
      title="Precios de lista"
      subtitle="Lo que se cobra cuando no hay una tarifa pactada de por medio"
    >
      {error && <Notice tone="danger">{error}</Notice>}

      <Notice tone="info">
        Cambiar un precio aquí lo cambia en <strong>todo el sistema</strong>: cotizaciones,
        facturas nuevas y lo que responde el bot. Las citas ya agendadas conservan el
        precio que se le prometió al paciente.
      </Notice>

      <div className="table-wrap">
        <table className="table table--cards">
          <thead>
            <tr>
              <th>Tratamiento</th>
              <th className="table__num">Precio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {Object.entries(porCategoria).map(([categoria, filas]) => (
              <Fragment key={categoria}>
                <tr className="table__group">
                  <td colSpan={3} className="text-xs subtle">
                    {categoria}
                  </td>
                </tr>
                {filas.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Tratamiento">
                      <div className="table__strong">{t.name}</div>
                      <div className="text-xs subtle mono">{t.code}</div>
                      {t.pactadas > 0 && (
                        <div className="text-xs">
                          <Badge tone="warning">
                            {t.pactadas} con tarifa propia
                          </Badge>
                        </div>
                      )}
                    </td>
                    <td className="table__num mono" data-label="Precio">
                      {editando === t.id ? (
                        <input
                          className="input"
                          value={valor}
                          onChange={(e) => setValor(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') guardar(t.id);
                            if (e.key === 'Escape') setEditando(null);
                          }}
                          autoFocus
                          inputMode="decimal"
                          style={{ maxWidth: '7rem', textAlign: 'right' }}
                          aria-label={`Precio de ${t.name}`}
                        />
                      ) : (
                        <strong>{formatCents(t.basePriceCents)}</strong>
                      )}
                    </td>
                    <td data-label="">
                      {editando === t.id ? (
                        <div className="row" style={{ gap: '0.3rem' }}>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => guardar(t.id)}
                            disabled={isPending}
                          >
                            {isPending ? 'Guardando…' : 'Guardar'}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setEditando(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => abrir(t)}
                          >
                            Cambiar precio
                          </button>
                          {guardado === t.id && (
                            <span className="text-xs" style={{ color: 'var(--color-success)' }}>
                              Guardado
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
