'use client';

import { useState, useTransition } from 'react';
import type { CashClosing } from '@/backend/repositories/types';
import { formatBs } from '@/backend/domain/money';
import { closeCashAction, reopenCashAction } from '@/app/actions/admin.actions';
import { Card, Badge, Notice } from '@/frontend/components/ui/primitives';
import { IconCurrency, IconRefresh } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Cierre de caja
 * ===========================================================================
 *  El resto de la pantalla de caja es un INFORME: suma lo que ya está
 *  registrado. Esto es lo contrario — es el único punto donde entra un dato
 *  del mundo físico: cuánto efectivo hay realmente en la gaveta.
 *
 *  Y es justo el dato que no se puede reconstruir después. Un informe siempre
 *  cuadra consigo mismo; sólo comparándolo con el conteo a mano aparece que
 *  el martes faltaban 300 Bs.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ SÓLO SE CUENTA EL EFECTIVO
 *  ---------------------------------------------------------------------
 *  Tarjeta, transferencia y seguro se concilian con el banco. Pedirle a
 *  recepción que "cuente" una transferencia es pedirle que copie un número
 *  de la pantalla, y eso no verifica nada: siempre daría cero de diferencia.
 * ===========================================================================
 */

interface CashClosePanelProps {
  /** Día que se está viendo, 'YYYY-MM-DD' en hora de la clínica. */
  businessDate: string;
  dateLabel: string;
  /** Efectivo que deberían sumar los cobros del día, en bolívares. */
  expectedCashBs: number;
  /** Total del día (todos los medios), sólo informativo. */
  totalBs: number;
  paymentCount: number;
  /** Arqueo ya firmado, si el día está cerrado. */
  closing: CashClosing | null;
  /** Reabrir es cosa del administrador. */
  canReopen: boolean;
  /** Un día futuro no se puede cerrar. */
  isFuture: boolean;
}

export function CashClosePanel({
  businessDate,
  dateLabel,
  expectedCashBs,
  totalBs,
  paymentCount,
  closing,
  canReopen,
  isFuture,
}: CashClosePanelProps) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /*
   * La diferencia se previsualiza mientras se teclea para que quien cuenta
   * vea el descuadre ANTES de firmar, no después. El número que se guarda lo
   * vuelve a calcular el servidor: esto es sólo ayuda visual.
   */
  const countedNumber = counted.trim() === '' ? null : Number(counted.replace(',', '.'));
  const isValidNumber = countedNumber !== null && Number.isFinite(countedNumber) && countedNumber >= 0;
  const difference = isValidNumber ? Math.round((countedNumber - expectedCashBs) * 100) / 100 : null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await closeCashAction({ businessDate, countedCashBs: countedNumber, notes });
      if (!result.ok) setError(result.error ?? 'No se pudo cerrar la caja');
      else {
        setCounted('');
        setNotes('');
      }
    });
  }

  function reopen() {
    if (!window.confirm('¿Reabrir el arqueo de este día? Quedará registrado en la auditoría.')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await reopenCashAction({ businessDate });
      if (!result.ok) setError(result.error ?? 'No se pudo reabrir');
    });
  }

  // --- Día ya cerrado -----------------------------------------------------
  if (closing) {
    const tone = closing.differenceBs === 0 ? 'success' : 'warning';
    const closedAtLabel = new Intl.DateTimeFormat('es-VE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Caracas',
    }).format(closing.closedAt);

    return (
      <Card
        title="Caja cerrada"
        subtitle={`${closing.closedByName} · ${closedAtLabel}`}
        actions={<Badge tone={tone}>{closing.differenceBs === 0 ? 'Cuadrada' : 'Con diferencia'}</Badge>}
      >
        {error && <Notice tone="danger">{error}</Notice>}

        <dl className="detail-list">
          <div className="detail-list__row">
            <dt>Efectivo esperado</dt>
            <dd className="mono">{formatBs(closing.expectedCashBs)}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Efectivo contado</dt>
            <dd className="mono">{formatBs(closing.countedCashBs)}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Diferencia</dt>
            <dd className={`mono cash-diff cash-diff--${diffClass(closing.differenceBs)}`}>
              {formatDifference(closing.differenceBs)}
            </dd>
          </div>
          <div className="detail-list__row">
            <dt>Cobros del día</dt>
            <dd>{closing.paymentCount}</dd>
          </div>
        </dl>

        {closing.notes && (
          <div className="cal__detail-notes">
            <div className="cal__detail-notes-title">Observaciones</div>
            <p>{closing.notes}</p>
          </div>
        )}

        {canReopen && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={reopen}
            disabled={isPending}
            style={{ marginTop: '1rem' }}
          >
            <IconRefresh size={14} /> Reabrir arqueo
          </button>
        )}
      </Card>
    );
  }

  // --- Día futuro ---------------------------------------------------------
  if (isFuture) {
    return (
      <Card title="Cierre de caja">
        <Notice tone="info">Este día todavía no ha llegado.</Notice>
      </Card>
    );
  }

  // --- Formulario de cierre ----------------------------------------------
  return (
    <Card title="Cerrar caja" subtitle={dateLabel}>
      {error && <Notice tone="danger">{error}</Notice>}

      <dl className="detail-list">
        <div className="detail-list__row">
          <dt>Efectivo esperado</dt>
          <dd className="mono">{formatBs(expectedCashBs)}</dd>
        </div>
        <div className="detail-list__row">
          <dt>Total del día (todos los medios)</dt>
          <dd className="mono subtle">{formatBs(totalBs)}</dd>
        </div>
      </dl>

      <div className="field" style={{ marginTop: '1rem' }}>
        <label className="field__label" htmlFor="conteo">
          Efectivo contado en la gaveta (Bs)
        </label>
        <input
          id="conteo"
          className="input mono"
          // `inputMode="decimal"` saca el teclado numérico en el móvil sin
          // perder la posibilidad de escribir decimales.
          inputMode="decimal"
          placeholder="0,00"
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
          disabled={isPending}
        />
        <p className="field__hint">
          Sólo billetes y monedas. Tarjeta y transferencia se cuadran con el banco.
        </p>
      </div>

      {difference !== null && (
        <div className={`cash-diff-box cash-diff-box--${diffClass(difference)}`}>
          <span>Diferencia</span>
          <strong className="mono">{formatDifference(difference)}</strong>
          <span className="text-xs">
            {difference === 0
              ? 'La caja cuadra'
              : difference > 0
                ? 'Sobra dinero en la gaveta'
                : 'Falta dinero en la gaveta'}
          </span>
        </div>
      )}

      <div className="field" style={{ marginTop: '0.75rem' }}>
        <label className="field__label" htmlFor="notas-caja">
          Observaciones
        </label>
        <textarea
          id="notas-caja"
          className="input"
          rows={2}
          placeholder="Ej.: se pagó el delivery con caja chica"
          value={notes}
          onChange={(event) => setNotes(event.target.value.slice(0, 300))}
          disabled={isPending}
        />
      </div>

      <button
        type="button"
        className="btn btn--primary"
        onClick={submit}
        disabled={isPending || !isValidNumber}
        style={{ marginTop: '1rem', width: '100%' }}
      >
        <IconCurrency size={16} />
        {isPending ? 'Cerrando…' : `Cerrar caja · ${paymentCount} cobros`}
      </button>

      <p className="field__hint" style={{ marginTop: '0.5rem' }}>
        Una vez cerrada, sólo el administrador puede reabrirla.
      </p>
    </Card>
  );
}

/** Clase de color según sobre, falta o cuadra. */
function diffClass(value: number): 'ok' | 'over' | 'short' {
  if (value === 0) return 'ok';
  return value > 0 ? 'over' : 'short';
}

/** Con signo explícito: «+150,00» se lee distinto que «150,00». */
function formatDifference(value: number): string {
  const formatted = formatBs(Math.abs(value));
  if (value === 0) return formatted;
  return `${value > 0 ? '+' : '−'}${formatted.replace('Bs ', 'Bs ')}`;
}
