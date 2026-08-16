'use client';

import { useState, useTransition } from 'react';
import type { PaymentMethodOption } from '@/backend/domain/types';
import {
  savePaymentMethodAction,
  deletePaymentMethodAction,
} from '@/app/actions/admin.actions';
import { Modal } from '@/frontend/components/motion';
import { Card, Badge, Notice, EmptyState } from '@/frontend/components/ui/primitives';
import { IconPlus, IconEdit, IconTrash } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Medios de pago
 * ===========================================================================
 *  Lo que la clínica acepta y, sobre todo, LO QUE SE LE DICE AL PACIENTE:
 *  banco, teléfono de pago móvil, correo de Zelle.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ ESTO ESTÁ AQUÍ Y NO EN EL FLUJO DE n8n
 *  ---------------------------------------------------------------------
 *  Porque cambia, y cuando cambia hay dinero de por medio. Si el número de
 *  pago móvil vive dentro del bot y la clínica cambia de banco, el bot sigue
 *  mandando a los pacientes a una cuenta ajena hasta que alguien se acuerde
 *  de editar el flujo. Aquí lo cambia el administrador y el bot lo lee en la
 *  siguiente conversación, sin tocar n8n.
 *
 *  ---------------------------------------------------------------------
 *  DOS CONCEPTOS DISTINTOS QUE CONVIENE NO MEZCLAR
 *  ---------------------------------------------------------------------
 *  · CATEGORÍA CONTABLE (`kind`): efectivo, tarjeta, transferencia, seguro.
 *    Son cuatro y no cambian. Es lo que agrupa el cierre de caja: el efectivo
 *    se cuenta a mano, la transferencia se concilia con el banco.
 *
 *  · MEDIO CONCRETO (esta lista): "Pago móvil Banesco" y "Pago móvil
 *    Mercantil" son DOS entradas, aunque contablemente ambas sean
 *    transferencia, porque para el paciente son dos instrucciones distintas.
 * ===========================================================================
 */

const KIND_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  INSURANCE: 'Seguro',
};

/** Estado inicial de una entrada nueva. */
const EMPTY: PaymentMethodOption = {
  id: '',
  label: '',
  kind: 'TRANSFER',
  instructions: '',
  currency: 'VES',
  sortOrder: 0,
  isActive: true,
};

export function PaymentMethodsPanel({ methods }: { methods: PaymentMethodOption[] }) {
  const [editing, setEditing] = useState<PaymentMethodOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(form: PaymentMethodOption) {
    setError(null);
    startTransition(async () => {
      const result = await savePaymentMethodAction({
        ...(form.id ? { id: form.id } : {}),
        label: form.label,
        kind: form.kind,
        instructions: form.instructions ?? '',
        currency: form.currency,
        sortOrder: form.sortOrder,
        isActive: form.isActive,
      });
      if (!result.ok) setError(result.error ?? 'No se pudo guardar');
      else setEditing(null);
    });
  }

  function remove(method: PaymentMethodOption) {
    if (
      !window.confirm(
        `¿Quitar «${method.label}»? El bot dejará de ofrecerlo. Los cobros ya registrados con este medio no se tocan.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deletePaymentMethodAction({ id: method.id });
      if (!result.ok) setError(result.error ?? 'No se pudo eliminar');
    });
  }

  return (
    <>
      <Card
        title="Medios de pago"
        subtitle="Lo que el bot le dice al paciente cuando pregunta cómo pagar"
        actions={
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => setEditing(EMPTY)}
          >
            <IconPlus size={15} /> Añadir
          </button>
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}

        <Notice tone="info">
          Estos datos viajan al bot de WhatsApp. Revísalos antes de conectarlo: un
          número de cuenta equivocado manda a los pacientes a pagarle a otro.
        </Notice>

        {methods.length === 0 ? (
          <EmptyState>
            Todavía no hay medios de pago configurados.
            <br />
            Mientras la lista esté vacía, el bot no puede decir cómo pagar.
          </EmptyState>
        ) : (
          <div style={{ marginTop: '0.75rem' }}>
            {methods.map((method) => (
              <div key={method.id} className="pay-method">
                <div className="pay-method__main">
                  <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                    <span className="table__strong">{method.label}</span>
                    <Badge tone="neutral">{KIND_LABEL[method.kind] ?? method.kind}</Badge>
                    <Badge tone={method.currency === 'USD' ? 'accent' : 'info'}>
                      {method.currency === 'USD' ? '$' : 'Bs'}
                    </Badge>
                    {!method.isActive && <Badge tone="warning">Inactivo</Badge>}
                  </div>
                  {method.instructions && (
                    // `pre-wrap`: los datos bancarios se escriben en varias
                    // líneas y así se leen igual que se dictan.
                    <p className="pay-method__instructions">{method.instructions}</p>
                  )}
                </div>

                <div className="table__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setEditing(method)}
                    aria-label={`Editar ${method.label}`}
                  >
                    <IconEdit size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => remove(method)}
                    disabled={isPending}
                    aria-label={`Eliminar ${method.label}`}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar medio de pago' : 'Nuevo medio de pago'}
        subtitle="El texto de las instrucciones es literalmente lo que el bot le dicta al paciente"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setEditing(null)}
              disabled={isPending}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => editing && save(editing)}
              disabled={isPending || !editing?.label.trim()}
            >
              {isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </>
        }
      >
        {editing && (
          <div className="stack">
            <div className="field">
              <label className="field__label" htmlFor="pm-label">
                Nombre
              </label>
              <input
                id="pm-label"
                className="input"
                value={editing.label}
                placeholder="Pago móvil Banesco"
                onChange={(event) => setEditing({ ...editing, label: event.target.value })}
              />
              <span className="field__hint">Así se lo ofrece el bot al paciente.</span>
            </div>

            <div className="form-grid">
              <div className="field">
                <label className="field__label" htmlFor="pm-kind">
                  Categoría contable
                </label>
                <select
                  id="pm-kind"
                  className="select"
                  value={editing.kind}
                  onChange={(event) =>
                    setEditing({ ...editing, kind: event.target.value as typeof editing.kind })
                  }
                >
                  {Object.entries(KIND_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="field__hint">Es lo que agrupa el cierre de caja.</span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="pm-currency">
                  Moneda
                </label>
                <select
                  id="pm-currency"
                  className="select"
                  value={editing.currency}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      currency: event.target.value as 'VES' | 'USD',
                    })
                  }
                >
                  <option value="VES">Bolívares</option>
                  <option value="USD">Dólares</option>
                </select>
                <span className="field__hint">Un Zelle se paga en dólares.</span>
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="pm-instructions">
                Instrucciones para el paciente
              </label>
              <textarea
                id="pm-instructions"
                className="input"
                rows={5}
                placeholder={'Banco: 0102 Banco de Venezuela\nTeléfono: 0412-000-0000\nRIF: J-40123456-7'}
                value={editing.instructions ?? ''}
                onChange={(event) =>
                  setEditing({ ...editing, instructions: event.target.value.slice(0, 500) })
                }
              />
              <span className="field__hint">
                Una línea por dato. El bot lo transcribe tal cual.
              </span>
            </div>

            <div className="form-grid">
              <div className="field">
                <label className="field__label" htmlFor="pm-order">
                  Orden
                </label>
                <input
                  id="pm-order"
                  className="input"
                  type="number"
                  min={0}
                  max={99}
                  value={editing.sortOrder}
                  onChange={(event) =>
                    setEditing({ ...editing, sortOrder: Number(event.target.value) || 0 })
                  }
                />
                <span className="field__hint">El más bajo se ofrece primero.</span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="pm-active">
                  Estado
                </label>
                <select
                  id="pm-active"
                  className="select"
                  value={editing.isActive ? 'si' : 'no'}
                  onChange={(event) =>
                    setEditing({ ...editing, isActive: event.target.value === 'si' })
                  }
                >
                  <option value="si">Activo</option>
                  <option value="no">Inactivo</option>
                </select>
                <span className="field__hint">Inactivo = el bot no lo menciona.</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
