'use client';

import { useState, useTransition } from 'react';
import type { Invoice, InvoiceLine, PaymentMethodOption, Promotion, Treatment } from '@/backend/domain/types';
import { formatCents, formatBs, centsToBs } from '@/backend/domain/money';
import {
  addInvoiceLineAction,
  updateInvoiceLineAction,
  removeInvoiceLineAction,
  registerInvoicePaymentAction,
  voidInvoiceAction,
  applyPromotionAction,
} from '@/app/actions/invoice.actions';
import { Modal } from '@/frontend/components/motion';
import { Badge, Card, Notice } from '@/frontend/components/ui/primitives';
import { IconPlus, IconTrash, IconEdit, IconCurrency, IconTag } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  La factura de recepción
 * ===========================================================================
 *  El papel que se le entrega al paciente. NO es fiscal.
 *
 *  Resuelve las tres cosas que pidió la clínica:
 *
 *  1. **Editarla.** Entró a consulta y se le hizo algo más: se añade la línea
 *     y el total se recalcula solo. No hay que rehacer nada.
 *  2. **Descuentos.** El «si haces esto, esto va gratis» — que no es gratis,
 *     porque lo otro sube. Se marca como REBAJA sobre el precio real, nunca
 *     poniendo la línea a cero: así queda escrito cuánto se regaló y por qué.
 *  3. **Pagar en dos partes.** Se registra lo que entra HOY; la factura queda
 *     abierta con su saldo hasta que se complete.
 *
 *  Los totales no se editan a mano en ningún sitio: salen de las líneas. Es
 *  lo que impide que el papel entregado diga una cosa y la caja otra.
 * ===========================================================================
 */

interface InvoiceEditorProps {
  invoice: Invoice;
  treatments: Treatment[];
  paymentMethods: PaymentMethodOption[];
  exchangeRate: number | null;
  rateSource: string;
  /** Sólo las vigentes ahora mismo: el servidor ya filtró fecha y `isActive`. */
  promotions: Promotion[];
}

const ESTADO: Record<Invoice['status'], { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  PAID: { label: 'Saldada', tone: 'success' },
  OPEN: { label: 'Pendiente', tone: 'warning' },
  VOID: { label: 'Anulada', tone: 'danger' },
};

export function InvoiceEditor({
  invoice,
  treatments,
  paymentMethods,
  exchangeRate,
  rateSource,
  promotions,
}: InvoiceEditorProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceLine | null>(null);
  const [charging, setCharging] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoElegida, setPromoElegida] = useState('');

  // Ya aplicada a esta factura = no se ofrece otra vez; el botón de aplicar
  // ya se encarga de rechazarla, pero quitarla de la lista evita el segundo
  // clic inútil.
  const promocionesAplicadasIds = new Set(
    invoice.lines.map((l) => l.promotionId).filter((id): id is string => id !== null),
  );
  const promocionesDisponibles = promotions.filter((p) => !promocionesAplicadasIds.has(p.id));

  const anulada = invoice.status === 'VOID';
  const saldada = invoice.balanceCents <= 0;
  const activos = treatments.filter((t) => t.isActive);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        onOk?.();
        return;
      }
      setError(result.error ?? 'No se pudo completar la operación');
    });
  }

  return (
    <>
      {error && <Notice tone="danger">{error}</Notice>}

      {anulada && (
        <Notice tone="danger">
          Esta factura está anulada. Se conserva porque el papel se entregó, pero no
          se puede editar ni cobrar.
        </Notice>
      )}

      {/* --- Las líneas ------------------------------------------------- */}
      <Card
        title={`Factura Nº ${invoice.number}`}
        subtitle={`${invoice.patientName}${invoice.dentistName ? ` · ${invoice.dentistName}` : ''}`}
        actions={<Badge tone={ESTADO[invoice.status].tone}>{ESTADO[invoice.status].label}</Badge>}
        flush
      >
        <div className="table-wrap">
          <table className="table table--cards">
            <thead>
              <tr>
                <th>Concepto</th>
                <th className="table__num">Cant.</th>
                <th className="table__num">Precio</th>
                <th className="table__num">Descuento</th>
                <th className="table__num">Total</th>
                <th style={{ textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td data-label="Concepto">
                    <div className="table__strong">{line.description}</div>
                    {/*
                      El motivo de la rebaja se enseña aquí, no escondido: es
                      lo que a fin de mes explica por qué esta factura cobró
                      menos que la lista.
                    */}
                    {line.promotionName && (
                      <Badge tone="info">Promoción: {line.promotionName}</Badge>
                    )}
                    {line.discountReason && (
                      <div className="text-xs subtle">Rebaja: {line.discountReason}</div>
                    )}
                    {line.commissionPercent === 100 && (
                      <div className="text-xs subtle">100 % clínica</div>
                    )}
                  </td>
                  <td className="table__num mono" data-label="Cant.">
                    {line.quantity}
                  </td>
                  <td className="table__num mono" data-label="Precio">
                    {formatCents(line.unitPriceCents)}
                  </td>
                  <td className="table__num mono" data-label="Descuento">
                    {line.discountCents > 0 ? (
                      <span style={{ color: 'var(--color-danger)' }}>
                        −{formatCents(line.discountCents)}
                      </span>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                  <td className="table__num mono table__strong" data-label="Total">
                    {formatCents(line.totalCents)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!anulada && (
                      <div className="table__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setEditing(line)}
                          aria-label={`Ajustar ${line.description}`}
                        >
                          <IconEdit size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() =>
                            window.confirm(`¿Quitar "${line.description}"?`) &&
                            run(() => removeInvoiceLineAction(line.id, invoice.id))
                          }
                          disabled={isPending}
                          aria-label={`Quitar ${line.description}`}
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!anulada && (
          <div className="row" style={{ padding: '0.75rem 1rem', gap: '0.5rem' }}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAddOpen(true)}>
              <IconPlus size={14} /> Añadir concepto
            </button>
            {promocionesDisponibles.length > 0 && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setPromoElegida(promocionesDisponibles[0]?.id ?? '');
                  setPromoOpen(true);
                }}
              >
                <IconTag size={14} /> Aplicar promoción
              </button>
            )}
          </div>
        )}
      </Card>

      {/* --- Los números ------------------------------------------------ */}
      <Card title="Totales">
        <div className="row row--between text-sm">
          <span className="muted">Subtotal</span>
          <span className="mono">{formatCents(invoice.subtotalCents)}</span>
        </div>

        {invoice.discountCents > 0 && (
          <div className="row row--between text-sm">
            <span className="muted">Descuentos</span>
            <span className="mono" style={{ color: 'var(--color-danger)' }}>
              −{formatCents(invoice.discountCents)}
            </span>
          </div>
        )}

        <div
          className="row row--between"
          style={{
            borderTop: '1px solid var(--color-border)',
            paddingTop: '0.5rem',
            marginTop: '0.5rem',
          }}
        >
          <span style={{ fontWeight: 600 }}>Total</span>
          <span className="mono" style={{ fontSize: '1.25rem', fontWeight: 700 }}>
            {formatCents(invoice.totalCents)}
            {exchangeRate !== null && (
              <span className="amount-bs">
                {formatBs(centsToBs(invoice.totalCents, exchangeRate))}
              </span>
            )}
          </span>
        </div>

        {invoice.paidCents > 0 && (
          <>
            <div className="row row--between text-sm" style={{ marginTop: '0.5rem' }}>
              <span className="muted">Cobrado</span>
              <span className="mono">{formatCents(invoice.paidCents)}</span>
            </div>
            <div className="row row--between">
              <span style={{ fontWeight: 600 }}>Falta por cobrar</span>
              <span
                className="mono"
                style={{
                  fontWeight: 700,
                  color: saldada ? 'var(--color-success)' : 'var(--color-primary)',
                }}
              >
                {formatCents(invoice.balanceCents)}
              </span>
            </div>
          </>
        )}

        {!anulada && !saldada && (
          <div style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setCharging(true)}
              disabled={exchangeRate === null}
            >
              <IconCurrency size={16} /> Registrar cobro
            </button>
            {exchangeRate === null && (
              <Notice tone="danger">
                No hay tasa de cambio. Actualízala en «Tasa de cambio» antes de cobrar.
              </Notice>
            )}
          </div>
        )}
      </Card>

      {/* --- Los cobros -------------------------------------------------- */}
      {invoice.payments.length > 0 && (
        <Card title="Cobros" subtitle="Cada uno con su fecha y su tasa" flush>
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Medio</th>
                  <th className="table__num">Importe</th>
                  <th className="table__num">En bolívares</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="mono text-xs" data-label="Fecha">
                      {new Intl.DateTimeFormat('es-VE', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                        timeZone: 'America/Caracas',
                      }).format(p.paidAt)}
                    </td>
                    <td className="muted" data-label="Medio">
                      {p.methodLabel ?? p.method}
                    </td>
                    <td className="table__num mono" data-label="Importe">
                      {formatCents(p.amountCents)}
                    </td>
                    <td className="table__num mono muted" data-label="En bolívares">
                      {formatBs(p.amountBs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* --- Aplicar promoción -------------------------------------------- */}
      <Modal
        open={promoOpen}
        onClose={() => setPromoOpen(false)}
        title="Aplicar promoción"
        subtitle="Añade lo que haga falta y calcula el descuento solo"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setPromoOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={isPending || !promoElegida}
              onClick={() =>
                run(
                  () => applyPromotionAction({ invoiceId: invoice.id, promotionId: promoElegida }),
                  () => setPromoOpen(false),
                )
              }
            >
              {isPending ? 'Aplicando…' : 'Aplicar'}
            </button>
          </>
        }
      >
        <div className="field form-grid--full">
          <label className="field__label" htmlFor="promoElegida">
            Promoción
          </label>
          <select
            id="promoElegida"
            className="select"
            value={promoElegida}
            onChange={(e) => setPromoElegida(e.target.value)}
          >
            {promocionesDisponibles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {promoElegida && (
            <p className="text-xs subtle" style={{ marginTop: '0.4rem' }}>
              {promocionesDisponibles.find((p) => p.id === promoElegida)?.description ??
                'Se añaden los tratamientos que haga falta y se reparte el descuento entre ellos.'}
            </p>
          )}
        </div>
      </Modal>

      {/* --- Añadir concepto -------------------------------------------- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Añadir concepto"
        subtitle="Lo que se hizo de más en la consulta"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setAddOpen(false)}>
              Cancelar
            </button>
            <button type="submit" form="add-line" className="btn btn--primary" disabled={isPending}>
              {isPending ? 'Añadiendo…' : 'Añadir'}
            </button>
          </>
        }
      >
        <form
          id="add-line"
          className="form-grid"
          action={(fd) =>
            run(
              () => addInvoiceLineAction(Object.fromEntries(fd.entries())),
              () => setAddOpen(false),
            )
          }
        >
          <input type="hidden" name="invoiceId" value={invoice.id} />

          <div className="field form-grid--full">
            <label className="field__label" htmlFor="treatmentId">
              Tratamiento
            </label>
            <select id="treatmentId" name="treatmentId" className="select" defaultValue="">
              <option value="">— Escribir un concepto libre —</option>
              {activos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {formatCents(t.basePriceCents)}
                </option>
              ))}
            </select>
            <span className="field__hint">
              Del catálogo se toma el precio y el reparto que corresponda.
            </span>
          </div>

          <div className="field form-grid--full">
            <label className="field__label" htmlFor="description">
              Concepto libre
            </label>
            <input
              id="description"
              name="description"
              className="input"
              placeholder="Sólo si no está en el catálogo"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="quantity">
              Cantidad
            </label>
            <input
              id="quantity"
              name="quantity"
              type="number"
              min={1}
              defaultValue={1}
              className="input"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="priceInUsd">
              Precio en dólares
            </label>
            <input
              id="priceInUsd"
              name="priceInUsd"
              type="number"
              min={0}
              step={0.01}
              className="input"
              placeholder="Precio de lista"
            />
            <span className="field__hint">Vacío = el que corresponda.</span>
          </div>
        </form>
      </Modal>

      {/* --- Ajustar línea / descuento ----------------------------------- */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Ajustar concepto"
        subtitle={editing?.description}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button type="submit" form="edit-line" className="btn btn--primary" disabled={isPending}>
              {isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </>
        }
      >
        {editing && (
          <form
            id="edit-line"
            className="form-grid"
            key={editing.id}
            action={(fd) =>
              run(
                () => updateInvoiceLineAction(Object.fromEntries(fd.entries())),
                () => setEditing(null),
              )
            }
          >
            <input type="hidden" name="id" value={editing.id} />
            <input type="hidden" name="invoiceId" value={invoice.id} />

            <div className="field">
              <label className="field__label" htmlFor="e-quantity">
                Cantidad
              </label>
              <input
                id="e-quantity"
                name="quantity"
                type="number"
                min={1}
                defaultValue={editing.quantity}
                className="input"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="e-price">
                Precio en dólares
              </label>
              <input
                id="e-price"
                name="priceInUsd"
                type="number"
                min={0}
                step={0.01}
                defaultValue={(editing.unitPriceCents / 100).toFixed(2)}
                className="input"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="e-discount">
                Descuento en dólares
              </label>
              <input
                id="e-discount"
                name="discountInUsd"
                type="number"
                min={0}
                step={0.01}
                defaultValue={(editing.discountCents / 100).toFixed(2)}
                className="input"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="e-reason">
                Motivo de la rebaja
              </label>
              <input
                id="e-reason"
                name="discountReason"
                className="input"
                defaultValue={editing.discountReason ?? ''}
                placeholder="Va incluida con la limpieza"
              />
            </div>

            <div className="form-grid--full">
              <Notice tone="info">
                Para dejar algo «gratis», <strong>no pongas el precio a cero</strong>:
                deja el precio real y descuéntalo entero. Así queda escrito cuánto se
                regaló y a cambio de qué.
              </Notice>
            </div>
          </form>
        )}
      </Modal>

      {/* --- Registrar cobro --------------------------------------------- */}
      <Modal
        open={charging}
        onClose={() => setCharging(false)}
        title="Registrar cobro"
        subtitle={`Falta por cobrar ${formatCents(invoice.balanceCents)}`}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setCharging(false)}>
              Cancelar
            </button>
            <button type="submit" form="charge" className="btn btn--primary" disabled={isPending}>
              {isPending ? 'Registrando…' : 'Registrar'}
            </button>
          </>
        }
      >
        <form
          id="charge"
          className="form-grid"
          action={(fd) =>
            run(
              () => registerInvoicePaymentAction(Object.fromEntries(fd.entries())),
              () => setCharging(false),
            )
          }
        >
          <input type="hidden" name="invoiceId" value={invoice.id} />

          <div className="field">
            <label className="field__label" htmlFor="amountInUsd">
              Importe en dólares <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              id="amountInUsd"
              name="amountInUsd"
              type="number"
              min={0.01}
              step={0.01}
              required
              className="input"
              defaultValue={(invoice.balanceCents / 100).toFixed(2)}
            />
            {/*
              Viene relleno con el saldo porque lo normal es cobrar todo. Para
              un abono se escribe menos y la factura queda abierta.
            */}
            <span className="field__hint">
              Para cobrar sólo una parte, escribe menos: queda pendiente el resto.
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="methodChoice">
              Medio de pago <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <select id="methodChoice" name="methodChoice" className="select" required>
              {paymentMethods.map((m) => (
                <option key={`${m.kind}|${m.label}`} value={`${m.kind}|${m.label}`}>
                  {m.currency === 'USD' ? `${m.label} ($)` : m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field form-grid--full">
            <label className="field__label" htmlFor="externalReference">
              Referencia
            </label>
            <input
              id="externalReference"
              name="externalReference"
              className="input"
              placeholder="Nº de operación, voucher…"
            />
          </div>

          {exchangeRate !== null && (
            <div className="form-grid--full">
              <Notice tone="info">
                Tasa {rateSource}{' '}
                {exchangeRate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs/USD.
                Queda congelada en este cobro.
              </Notice>
            </div>
          )}
        </form>
      </Modal>

      {/* Anular: sólo si no ha entrado dinero. */}
      {!anulada && invoice.payments.length === 0 && (
        <p className="text-sm">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              const motivo = window.prompt('¿Por qué se anula esta factura?');
              if (motivo?.trim()) run(() => voidInvoiceAction(invoice.id, motivo));
            }}
            disabled={isPending}
          >
            Anular factura
          </button>
        </p>
      )}
    </>
  );
}
