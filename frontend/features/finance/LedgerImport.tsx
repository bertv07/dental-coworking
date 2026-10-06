'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCents } from '@/backend/domain/money';
import {
  previewLedgerImportAction,
  applyLedgerImportAction,
  type LedgerPreviewResult,
} from '@/app/actions/ledger-import.actions';
import { Badge, Card, Notice } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Cargar el libro desde Excel
 * ===========================================================================
 *  Se elige el archivo y A DÓNDE VA —General, Caja Chica o una odontóloga—,
 *  se revisa lo que se leyó y sólo entonces se guarda.
 *
 *  La vista previa enseña la fecha YA interpretada y la suma de la hoja: son
 *  las dos cosas que delatan un archivo mal leído («9/1» entendido como 9 de
 *  enero, o un total que no coincide con el del pie del Excel) antes de que
 *  esté en el libro.
 *
 *  Las filas que ya están en el libro se marcan y no se vuelven a guardar,
 *  así que la hoja del mes se puede subir tantas veces como crezca.
 * ===========================================================================
 */

const ESTADO: Record<string, { label: string; tone: 'success' | 'danger' | 'neutral' }> = {
  NUEVA: { label: 'Nueva', tone: 'success' },
  YA_ESTA: { label: 'Ya está', tone: 'neutral' },
  ERROR: { label: 'Error', tone: 'danger' },
};

function fechaCorta(k: string) {
  if (!k) return '—';
  return new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${k}T12:00:00Z`));
}

export function LedgerImport({
  destinos,
  destinoInicial,
}: {
  /** Las mismas pestañas de la página: `id` es el de la pestaña. */
  destinos: Array<{ id: string; label: string }>;
  destinoInicial: string;
}) {
  const router = useRouter();
  // `useActionState`, igual que en la carga de precios: la acción ES la del
  // formulario y el resultado vuelve en el estado.
  const [preview, leer, isReading] = useActionState<LedgerPreviewResult | null, FormData>(
    async (_previo, formData) => previewLedgerImportAction(formData),
    null,
  );
  const [isApplying, startTransition] = useTransition();
  const [destino, setDestino] = useState(destinoInicial);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [descartado, setDescartado] = useState(false);
  /** Filas nuevas que se dejan fuera a mano, por su número en el Excel. */
  const [excluidas, setExcluidas] = useState<ReadonlySet<number>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);

  const isPending = isReading || isApplying;
  const vista = descartado ? null : preview;
  const filas = vista?.ok ? (vista.filas ?? []) : [];

  const nuevas = filas.filter((f) => f.estado === 'NUEVA');
  const aGuardar = nuevas.filter((f) => !excluidas.has(f.fila));
  const yaEstan = filas.filter((f) => f.estado === 'YA_ESTA').length;
  const conError = filas.filter((f) => f.estado === 'ERROR').length;
  const esDentista = filas[0]?.tipo === 'DENTISTA';

  // La suma de TODA la hoja (lo nuevo y lo que ya estaba): es la cifra que se
  // puede comparar con el total que trae el propio Excel al pie.
  const legibles = filas.filter((f) => f.estado !== 'ERROR');
  const sumaIngreso = legibles.reduce((s, f) => s + (f.tipo === 'GENERAL' ? f.incomeCents : f.budgetCents), 0);
  const sumaEgreso = legibles.reduce((s, f) => s + (f.tipo === 'GENERAL' ? f.expenseCents : f.dentistShareCents), 0);

  function limpiar() {
    setDone(null);
    setError(null);
    setExcluidas(new Set());
  }

  function alternar(fila: number) {
    setExcluidas((previas) => {
      const siguientes = new Set(previas);
      if (!siguientes.delete(fila)) siguientes.add(fila);
      return siguientes;
    });
  }

  function guardar() {
    if (!vista?.destino || aGuardar.length === 0) return;
    const destinoGuardado = vista.destino;
    const etiqueta = vista.destinoLabel ?? '';
    // El libro se ve por mes: se abre el de lo que se acaba de cargar.
    const mesCargado = aGuardar[0]?.date.slice(0, 7) ?? '';

    startTransition(async () => {
      const r = await applyLedgerImportAction(destinoGuardado, aGuardar);
      if (!r.ok) {
        setError(r.error ?? 'No se pudieron guardar las filas');
        return;
      }
      setError(null);
      setDone(
        `Listo: ${r.creadas} filas guardadas en ${etiqueta}` +
          (r.repetidas ? ` (${r.repetidas} ya estaban y no se repitieron).` : '.'),
      );
      setDescartado(true);
      setExcluidas(new Set());
      formRef.current?.reset();
      // A la pestaña donde acaban de caer, con la carga todavía abierta.
      router.push(`/administracion?tab=${destinoGuardado}${mesCargado ? `&mes=${mesCargado}` : ''}&cargar=1`);
      router.refresh();
    });
  }

  return (
    <Card title="Cargar desde Excel" subtitle="Sube la hoja y elige a qué libro va">
      {done && <Notice tone="info">{done}</Notice>}
      {(error ?? vista?.error) && <Notice tone="danger">{error ?? vista?.error}</Notice>}

      <form
        ref={formRef}
        action={leer}
        onSubmit={() => {
          setDescartado(false);
          limpiar();
        }}
        className="form-grid"
      >
        <div className="field">
          <label className="field__label" htmlFor="ledger-destino">
            ¿A dónde va?
          </label>
          <select
            id="ledger-destino"
            name="destino"
            className="select"
            value={destino}
            onChange={(e) => {
              setDestino(e.target.value);
              // Lo leído era para otro libro: ni las columnas ni lo que «ya
              // está» valen para el nuevo.
              setDescartado(true);
            }}
          >
            {destinos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="ledger-file">
            Archivo
          </label>
          <input
            id="ledger-file"
            name="file"
            type="file"
            className="input"
            required
            accept=".xlsx,.csv"
            onChange={() => setDescartado(true)}
          />
          <span className="field__hint">Excel (.xlsx) o CSV.</span>
        </div>

        {/* Sólo cuando el archivo trae varias hojas, y ya se sabe cuáles. */}
        {vista?.hojas && vista.hojas.length > 1 && (
          <div className="field form-grid--full">
            <label className="field__label" htmlFor="ledger-hoja">
              Hoja del archivo
            </label>
            <select
              id="ledger-hoja"
              name="hoja"
              className="select"
              key={vista.hoja}
              defaultValue={vista.hoja}
              disabled={isPending}
              onChange={() => formRef.current?.requestSubmit()}
            >
              {vista.hojas.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <span className="field__hint">Se carga una hoja cada vez. Al cambiarla se vuelve a leer.</span>
          </div>
        )}

        <div className="form-grid--full">
          <Notice tone="info">
            {destino.startsWith('dr-') ? (
              <>
                Columnas de la hoja de una odontóloga: <strong>Fecha</strong>, <strong>Paciente</strong> y{' '}
                <strong>Presupuesto</strong>. Opcionales: Abono, el reparto (una columna «%», o las columnas
                40&nbsp;% / 50&nbsp;% / 60&nbsp;% de siempre) e Información.
              </>
            ) : (
              <>
                Columnas: <strong>Fecha</strong>, <strong>Descripción</strong>, <strong>Ingreso</strong> y{' '}
                <strong>Egreso</strong>. Opcional: Información. El título de arriba y los totales del final se
                saltan solos.
              </>
            )}
          </Notice>
        </div>

        <div className="form-grid--full">
          <button type="submit" className="btn btn--ghost" disabled={isPending}>
            {isReading ? 'Leyendo…' : 'Revisar archivo'}
          </button>
        </div>
      </form>

      {/* --- Vista previa ------------------------------------------------ */}
      {vista?.ok && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="row row--wrap" style={{ gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Badge tone="info">Va a: {vista.destinoLabel}</Badge>
            <Badge tone="success">{nuevas.length} nuevas</Badge>
            <Badge tone="neutral">{yaEstan} ya están</Badge>
            {conError > 0 && <Badge tone="danger">{conError} con error</Badge>}
          </div>

          <p className="text-sm muted" style={{ marginBottom: '0.75rem' }}>
            La hoja suma{' '}
            {esDentista ? (
              <>
                <strong>{formatCents(sumaIngreso)}</strong> de presupuesto, <strong>{formatCents(sumaEgreso)}</strong>{' '}
                para la doctora y <strong>{formatCents(sumaIngreso - sumaEgreso)}</strong> para la clínica.
              </>
            ) : (
              <>
                <strong>{formatCents(sumaIngreso)}</strong> de ingreso y <strong>{formatCents(sumaEgreso)}</strong> de
                egreso: total <strong>{formatCents(sumaIngreso - sumaEgreso)}</strong>.
              </>
            )}{' '}
            Compáralo con el total del Excel antes de guardar.
          </p>

          {conError > 0 && (
            <Notice tone="warning">
              Hay {conError} filas que no se pudieron leer. Se guardan las demás; corrige esas en el Excel
              (te digo el número de fila) y vuelve a subirlo: lo que ya entró no se repite.
            </Notice>
          )}

          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th />
                  <th className="table__num">Fila</th>
                  <th>Fecha</th>
                  <th>{esDentista ? 'Paciente' : 'Descripción'}</th>
                  {esDentista ? (
                    <>
                      <th className="table__num">Presupuesto</th>
                      <th className="table__num">Abono</th>
                      <th className="table__num">% Doctora</th>
                      <th className="table__num">Doctora</th>
                      <th className="table__num">Clínica</th>
                    </>
                  ) : (
                    <>
                      <th className="table__num">Ingreso</th>
                      <th className="table__num">Egreso</th>
                    </>
                  )}
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.fila} style={{ opacity: f.estado === 'YA_ESTA' ? 0.55 : undefined }}>
                    <td data-label="Guardar">
                      {f.estado === 'NUEVA' && (
                        <input
                          type="checkbox"
                          checked={!excluidas.has(f.fila)}
                          onChange={() => alternar(f.fila)}
                          disabled={isPending}
                          aria-label={`Guardar la fila ${f.fila}`}
                        />
                      )}
                    </td>
                    <td className="table__num mono text-xs muted" data-label="Fila">{f.fila}</td>
                    <td className="mono text-xs" data-label="Fecha">{fechaCorta(f.date)}</td>
                    <td data-label={esDentista ? 'Paciente' : 'Descripción'}>
                      <span className="table__strong">
                        {(f.tipo === 'GENERAL' ? f.description : f.patientName) || '—'}
                      </span>
                      {f.notes && <div className="text-xs subtle">{f.notes}</div>}
                      {f.error && (
                        <div className="text-xs" style={{ color: 'var(--color-danger)' }}>{f.error}</div>
                      )}
                    </td>
                    {f.tipo === 'DENTISTA' ? (
                      <>
                        <td className="table__num mono" data-label="Presupuesto">{formatCents(f.budgetCents)}</td>
                        <td className="table__num mono" data-label="Abono">
                          {f.depositCents > 0 ? formatCents(f.depositCents) : '—'}
                        </td>
                        <td className="table__num mono" data-label="% Doctora">{f.dentistPercent}%</td>
                        <td className="table__num mono" data-label="Doctora">{formatCents(f.dentistShareCents)}</td>
                        <td className="table__num mono" data-label="Clínica">{formatCents(f.clinicShareCents)}</td>
                      </>
                    ) : (
                      <>
                        <td className="table__num mono" data-label="Ingreso" style={{ color: f.incomeCents > 0 ? 'var(--color-success)' : undefined }}>
                          {f.incomeCents > 0 ? formatCents(f.incomeCents) : '—'}
                        </td>
                        <td className="table__num mono" data-label="Egreso" style={{ color: f.expenseCents > 0 ? 'var(--color-danger)' : undefined }}>
                          {f.expenseCents > 0 ? formatCents(f.expenseCents) : '—'}
                        </td>
                      </>
                    )}
                    <td data-label="Estado">
                      <Badge tone={ESTADO[f.estado]!.tone}>{ESTADO[f.estado]!.label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ gap: '0.5rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn--primary" onClick={guardar} disabled={isPending || aGuardar.length === 0}>
              {isApplying ? 'Guardando…' : `Guardar ${aGuardar.length} filas en ${vista.destinoLabel}`}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setDescartado(true)} disabled={isPending}>
              Descartar
            </button>
          </div>

          {nuevas.length === 0 && (
            <p className="text-sm subtle" style={{ marginTop: '0.5rem' }}>
              No hay nada nuevo: todo lo que trae esta hoja ya está en el libro.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
