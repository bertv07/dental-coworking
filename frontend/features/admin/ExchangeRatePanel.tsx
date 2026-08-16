'use client';

import { useState, useTransition } from 'react';
import { refreshExchangeRateAction } from '@/app/actions/admin.actions';
import { Card, Badge, Notice, EmptyState } from '@/frontend/components/ui/primitives';
import { IconRefresh } from '@/frontend/components/ui/icons';
import { formatBs } from '@/backend/domain/money';

/**
 * Panel de control cambiario.
 *
 * Muestra las tasas vigentes y permite forzar la actualización contra
 * DolarAPI. El botón existe porque el BCV publica a una hora impredecible:
 * el administrador necesita poder traer la tasa nueva sin esperar a que
 * venza la caché de una hora.
 */

interface RateInfo {
  source: string;
  rate: number;
  publishedAt: string;
  fetchedAt: string;
  isStale: boolean;
}

interface HistoryRow {
  id: string;
  rate: number;
  publishedAt: string;
  isCurrent: boolean;
}

interface ExchangeRatePanelProps {
  bcv: RateInfo | null;
  paralelo: RateInfo | null;
  history: HistoryRow[];
  /** Ejemplos de conversión con precios reales del catálogo. */
  samples: Array<{ name: string; usdCents: number }>;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Caracas',
  }).format(new Date(iso));
}

export function ExchangeRatePanel({ bcv, paralelo, history, samples }: ExchangeRatePanelProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);

  function refresh(source: 'BCV' | 'PARALELO') {
    setMessage(null);
    startTransition(async () => {
      const result = await refreshExchangeRateAction(source);
      setMessage(
        result.ok
          ? { tone: 'info', text: result.message ?? 'Tasa actualizada' }
          : { tone: 'danger', text: result.error ?? 'No se pudo actualizar' },
      );
    });
  }

  // Diferencia porcentual entre paralelo y oficial: el dato que de verdad
  // interesa cuando hay dos mercados.
  const spread =
    bcv && paralelo ? ((paralelo.rate - bcv.rate) / bcv.rate) * 100 : null;

  return (
    <>
      {message && <Notice tone={message.tone === 'danger' ? 'danger' : 'info'}>{message.text}</Notice>}

      {bcv?.isStale && (
        <Notice tone="warning">
          La tasa BCV lleva más de una hora sin actualizarse. Refréscala antes de cobrar
          en bolívares.
        </Notice>
      )}

      <div className="stat-grid">
        {/* --- BCV: la tasa con la que factura la clínica --- */}
        <div className="rate-card rate-card--primary">
          <div className="rate-card__label">Tasa BCV (oficial)</div>
          <div className="rate-card__value">
            {bcv ? bcv.rate.toLocaleString('es-VE', { minimumFractionDigits: 4 }) : '—'}
          </div>
          <div className="rate-card__meta">
            Bs por dólar
            {bcv && <> · publicada {formatDateTime(bcv.publishedAt)}</>}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ marginTop: '1rem', background: 'rgba(255,255,255,0.15)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
            onClick={() => refresh('BCV')}
            disabled={isPending}
          >
            <IconRefresh size={14} /> {isPending ? 'Consultando…' : 'Actualizar'}
          </button>
        </div>

        {/* --- Paralelo: sólo referencia, la clínica no factura con esta --- */}
        <div className="rate-card">
          <div className="rate-card__label muted">Paralelo (referencia)</div>
          <div className="rate-card__value">
            {paralelo ? paralelo.rate.toLocaleString('es-VE', { minimumFractionDigits: 4 }) : '—'}
          </div>
          <div className="rate-card__meta">
            Bs por dólar
            {paralelo && <> · {formatDateTime(paralelo.publishedAt)}</>}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ marginTop: '1rem' }}
            onClick={() => refresh('PARALELO')}
            disabled={isPending}
          >
            <IconRefresh size={14} /> Actualizar
          </button>
        </div>

        <div className="rate-card">
          <div className="rate-card__label muted">Brecha cambiaria</div>
          <div className="rate-card__value">
            {spread !== null ? `${spread.toFixed(1)}%` : '—'}
          </div>
          <div className="rate-card__meta">
            Diferencia del paralelo sobre el oficial
          </div>
        </div>

        <div className="rate-card">
          <div className="rate-card__label muted">Fuente</div>
          <div className="rate-card__value" style={{ fontSize: '1.25rem' }}>
            DolarAPI
          </div>
          <div className="rate-card__meta">
            ve.dolarapi.com · se consulta como máximo una vez por hora
            {bcv && <> · última consulta {formatDateTime(bcv.fetchedAt)}</>}
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* --- Conversión de precios reales del catálogo --- */}
        <Card
          title="Equivalencia de tratamientos"
          subtitle="Precios del catálogo convertidos a la tasa BCV vigente"
          flush
        >
          {!bcv ? (
            <EmptyState>Sin tasa disponible para convertir.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tratamiento</th>
                    <th className="table__num">USD</th>
                    <th className="table__num">Bolívares</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((sample) => (
                    <tr key={sample.name}>
                      <td className="table__strong">{sample.name}</td>
                      <td className="table__num mono">
                        ${(sample.usdCents / 100).toFixed(2)}
                      </td>
                      <td className="table__num mono" style={{ color: 'var(--color-primary)' }}>
                        {formatBs(Math.round((sample.usdCents / 100) * bcv.rate * 100) / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* --- Historial: permite auditar con qué tasa se cobró cada día --- */}
        <Card title="Historial BCV" subtitle="Últimas tasas registradas" flush>
          {history.length === 0 ? (
            <EmptyState>Aún no hay historial.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Publicada</th>
                    <th className="table__num">Bs/USD</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td className="text-xs muted">{formatDateTime(row.publishedAt)}</td>
                      <td className="table__num mono table__strong">
                        {row.rate.toLocaleString('es-VE', { minimumFractionDigits: 4 })}
                      </td>
                      <td>
                        {row.isCurrent ? (
                          <Badge tone="success">Vigente</Badge>
                        ) : (
                          <Badge tone="neutral">Histórica</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
