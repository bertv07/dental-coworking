'use client';

import { useState, useTransition } from 'react';
import type { Promotion } from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import {
  savePromotionAction,
  deletePromotionAction,
} from '@/app/actions/promotion.actions';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Promociones
 * ===========================================================================
 *  «Si te haces la limpieza, la consulta va gratis.»
 *
 *  Lo que hay que tener claro al usar esta pantalla, y por eso está escrito
 *  también dentro de ella: aquí NO se descuenta nada. Se guarda lo que la
 *  clínica ofrece. El descuento de cada factura lo sigue marcando recepción a
 *  mano, factura por factura.
 * ===========================================================================
 */

interface Props {
  promotions: Promotion[];
  treatments: Array<{ code: string; name: string }>;
}

const ETIQUETA_BENEFICIO: Record<Promotion['benefitKind'], string> = {
  FREE_TREATMENT: 'Un tratamiento gratis',
  PERCENT_OFF: 'Porcentaje de descuento',
  AMOUNT_OFF: 'Importe fijo de descuento',
};

function describir(p: Promotion, nombrePorCodigo: Map<string, string>): string {
  const beneficio =
    p.benefitKind === 'FREE_TREATMENT'
      ? `${nombrePorCodigo.get(p.benefitTreatmentCode ?? '') ?? p.benefitTreatmentCode} gratis`
      : p.benefitKind === 'PERCENT_OFF'
        ? `${p.benefitValue} % de descuento`
        : `${formatCents(p.benefitValue)} de descuento`;

  if (p.requiredTreatmentCodes.length === 0) return beneficio;

  const requisitos = p.requiredTreatmentCodes
    .map((c) => nombrePorCodigo.get(c) ?? c)
    .join(' y ');
  return `Si se hace ${requisitos} → ${beneficio}`;
}

export function PromotionsManager({ promotions, treatments }: Props) {
  const [editando, setEditando] = useState<Promotion | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<Promotion['benefitKind']>('FREE_TREATMENT');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const nombrePorCodigo = new Map(treatments.map((t) => [t.code, t.name]));

  function abrir(p: Promotion | null) {
    setEditando(p);
    setTipo(p?.benefitKind ?? 'FREE_TREATMENT');
    setError(null);
    setAbierto(true);
  }

  function guardar(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await savePromotionAction(formData);
      if (!result.ok) {
        setError(result.error ?? 'No se pudo guardar');
        return;
      }
      setAbierto(false);
      setEditando(null);
    });
  }

  function quitar(p: Promotion) {
    if (!window.confirm(`¿Quitar «${p.name}»?\n\nDeja de ofrecerse y el bot no la propone más.`)) {
      return;
    }
    startTransition(async () => {
      const result = await deletePromotionAction(p.id);
      if (!result.ok) setError(result.error ?? 'No se pudo quitar');
    });
  }

  const hoy = new Date();

  return (
    <>
      <Card
        title="Promociones"
        subtitle="Lo que la clínica ofrece; el descuento se sigue marcando en cada factura"
        actions={
          <button type="button" className="pill-btn" onClick={() => abrir(null)}>
            Nueva promoción
          </button>
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}

        <Notice tone="info">
          Esto <strong>no descuenta solo</strong>. Sirve para que el bot pueda ofrecerla
          por WhatsApp y para que veas al cobrar que una factura la cumple. Quien aplica
          el descuento sigues siendo tú, factura por factura.
        </Notice>

        {promotions.length === 0 ? (
          <EmptyState>Todavía no hay ninguna promoción.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th>Promoción</th>
                  <th>Qué ofrece</th>
                  <th>Vigencia</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => {
                  const caducada = p.endsAt ? new Date(p.endsAt) < hoy : false;
                  const sinEmpezar = p.startsAt ? new Date(p.startsAt) > hoy : false;

                  return (
                    <tr key={p.id}>
                      <td data-label="Promoción">
                        <div className="table__strong">{p.name}</div>
                        {p.description && (
                          <div className="text-xs subtle">{p.description}</div>
                        )}
                      </td>
                      <td data-label="Qué ofrece">
                        <div className="text-sm">{describir(p, nombrePorCodigo)}</div>
                        {p.botPitch && (
                          <div className="text-xs subtle">Bot: «{p.botPitch}»</div>
                        )}
                      </td>
                      <td data-label="Vigencia" className="text-xs">
                        {p.startsAt || p.endsAt ? (
                          <>
                            {p.startsAt ? new Date(p.startsAt).toLocaleDateString('es-VE') : '—'}
                            {' → '}
                            {p.endsAt ? new Date(p.endsAt).toLocaleDateString('es-VE') : 'sin fin'}
                          </>
                        ) : (
                          <span className="subtle">Siempre</span>
                        )}
                      </td>
                      <td data-label="Estado">
                        {/* Se distingue «apagada» de «caducada»: la primera se
                            resuelve con un clic y la segunda cambiando la
                            fecha. Un solo «inactiva» las confundiría. */}
                        {!p.isActive ? (
                          <Badge tone="neutral">Apagada</Badge>
                        ) : caducada ? (
                          <Badge tone="danger">Caducada</Badge>
                        ) : sinEmpezar ? (
                          <Badge tone="warning">Aún no empieza</Badge>
                        ) : (
                          <Badge tone="success">Activa</Badge>
                        )}
                      </td>
                      <td data-label="">
                        <div className="row" style={{ gap: '0.35rem' }}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => abrir(p)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => quitar(p)}
                            disabled={isPending}
                          >
                            Quitar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {abierto && (
        <Card title={editando ? 'Editar promoción' : 'Nueva promoción'}>
          <form id="promo-form" action={guardar} className="form-grid">
            {editando && <input type="hidden" name="id" value={editando.id} />}

            <label className="field form-grid--full">
              <span className="field__label">Nombre</span>
              <input
                className="input"
                name="name"
                required
                maxLength={80}
                defaultValue={editando?.name}
                placeholder="Limpieza con consulta gratis"
              />
            </label>

            <label className="field form-grid--full">
              <span className="field__label">Descripción</span>
              <input
                className="input"
                name="description"
                maxLength={400}
                defaultValue={editando?.description ?? ''}
                placeholder="Al hacerte la limpieza, la consulta de valoración no se cobra"
              />
            </label>

            <label className="field form-grid--full">
              <span className="field__label">Qué tiene que hacerse</span>
              <input
                className="input"
                name="requiredTreatmentCodes"
                maxLength={400}
                defaultValue={editando?.requiredTreatmentCodes.join(', ')}
                placeholder="LIMPIEZA, RX"
                list="codigos-tratamientos"
              />
              <span className="field__hint">
                Códigos separados por comas. Vacío = la promoción vale siempre.
              </span>
            </label>

            <label className="field">
              <span className="field__label">Beneficio</span>
              <select
                className="input"
                name="benefitKind"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as Promotion['benefitKind'])}
              >
                {Object.entries(ETIQUETA_BENEFICIO).map(([clave, etiqueta]) => (
                  <option key={clave} value={clave}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </label>

            {tipo === 'FREE_TREATMENT' ? (
              <label className="field">
                <span className="field__label">¿Qué va gratis?</span>
                <input
                  className="input"
                  name="benefitTreatmentCode"
                  required
                  maxLength={40}
                  defaultValue={editando?.benefitTreatmentCode ?? ''}
                  placeholder="CONSULTA"
                  list="codigos-tratamientos"
                />
              </label>
            ) : (
              <label className="field">
                <span className="field__label">
                  {tipo === 'PERCENT_OFF' ? 'Porcentaje (1-100)' : 'Importe en dólares'}
                </span>
                <input
                  className="input"
                  name="benefitValue"
                  type="number"
                  step={tipo === 'PERCENT_OFF' ? 1 : 0.01}
                  min={tipo === 'PERCENT_OFF' ? 1 : 0.01}
                  max={tipo === 'PERCENT_OFF' ? 100 : undefined}
                  required
                  defaultValue={
                    editando
                      ? editando.benefitKind === 'AMOUNT_OFF'
                        ? editando.benefitValue / 100
                        : editando.benefitValue
                      : ''
                  }
                />
              </label>
            )}

            <label className="field form-grid--full">
              <span className="field__label">Cómo lo dice el bot</span>
              <input
                className="input"
                name="botPitch"
                maxLength={300}
                defaultValue={editando?.botPitch ?? ''}
                placeholder="Si te haces la limpieza, la consulta va incluida."
              />
              <span className="field__hint">
                Opcional. Si lo dejas vacío, el bot la redacta con los datos de arriba.
              </span>
            </label>

            <label className="field">
              <span className="field__label">Desde</span>
              <input
                className="input"
                name="startsAt"
                type="date"
                defaultValue={
                  editando?.startsAt
                    ? new Date(editando.startsAt).toISOString().slice(0, 10)
                    : ''
                }
              />
            </label>

            <label className="field">
              <span className="field__label">Hasta</span>
              <input
                className="input"
                name="endsAt"
                type="date"
                defaultValue={
                  editando?.endsAt ? new Date(editando.endsAt).toISOString().slice(0, 10) : ''
                }
              />
            </label>

            <label className="row form-grid--full text-sm" style={{ gap: '0.4rem' }}>
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={editando?.isActive ?? true}
              />
              Activa (el bot la ofrece)
            </label>

            <div className="row form-grid--full" style={{ gap: '0.5rem' }}>
              <button type="submit" className="btn btn--primary" disabled={isPending}>
                {isPending ? 'Guardando…' : 'Guardar'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setAbierto(false)}
              >
                Cancelar
              </button>
            </div>
          </form>

          {/* Sugerencias de códigos reales: escribirlos de memoria es la vía
              rápida a una promoción que no cuadra con ningún tratamiento. */}
          <datalist id="codigos-tratamientos">
            {treatments.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </datalist>
        </Card>
      )}
    </>
  );
}
