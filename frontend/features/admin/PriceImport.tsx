'use client';

import { useActionState, useState, useTransition, useRef } from 'react';
import { formatCents } from '@/backend/domain/money';
import {
  previewPriceImportAction,
  applyPriceImportAction,
  type PreviewResult,
} from '@/app/actions/price-import.actions';
import { Badge, Card, Notice } from '@/frontend/components/ui/primitives';
import { IconDownload } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Cargar la lista de precios desde Excel
 * ===========================================================================
 *  DOS PASOS: primero se ve qué cambiaría, después se aplica.
 *
 *  Aplicar directo sería un clic menos y un riesgo enorme: una columna
 *  corrida o un separador decimal mal puesto cambiaría la lista entera y
 *  nadie lo notaría hasta que un paciente pregunte por qué le cobran diez
 *  veces más. Aquí se lee «Limpieza: $30 → $300» ANTES de que sea verdad.
 *
 *  Las filas con error no bloquean el archivo: se marcan y el resto se puede
 *  aplicar igual. Rechazar sesenta tratamientos por una celda mal escrita
 *  obligaría a corregir a ciegas.
 * ===========================================================================
 */

const ESTADO: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  NUEVO: { label: 'Nuevo', tone: 'success' },
  ACTUALIZA: { label: 'Cambia', tone: 'warning' },
  SIN_CAMBIO: { label: 'Igual', tone: 'neutral' },
  ERROR: { label: 'Error', tone: 'danger' },
};

export function PriceImport() {
  /*
   * `useActionState` y no un `startTransition` a mano.
   *
   * La primera versión envolvía la llamada en una transición dentro de un
   * `action={fn}`, y la Server Action no llegaba a dispararse: el formulario
   * se enviaba, React lo daba por atendido y no salía ni una petición. Con el
   * patrón estándar, la acción ES la acción del formulario y el resultado
   * vuelve en el estado — que es además como está hecho el login.
   */
  const [preview, leer, isReading] = useActionState<PreviewResult | null, FormData>(
    async (_previo, formData) => previewPriceImportAction(formData),
    null,
  );

  const [isApplying, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Apagado por defecto: subir media lista es lo normal, y dar por hecho que
  // lo que falta ya no se hace vaciaría el catálogo sin querer.
  const [desactivarSobrantes, setDesactivarSobrantes] = useState(false);
  const [descartado, setDescartado] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const isPending = isReading || isApplying;
  // Descartar no puede borrar el estado de la acción, así que se tapa.
  const vista = descartado ? null : preview;

  function aplicar() {
    if (!vista?.filas) return;


    const aplicables = vista.filas.filter(
      (f) => f.estado === 'NUEVO' || f.estado === 'ACTUALIZA',
    );

    const sobran = vista.sobran ?? [];
    if (
      !window.confirm(
        `¿Aplicar ${aplicables.length} cambios a la lista de precios?\n\n` +
          (desactivarSobrantes && sobran.length > 0
            ? `Además se DESACTIVAN ${sobran.length} tratamientos que no están en el ` +
              'archivo. No se borran: dejan de ofrecerse al agendar y su historial ' +
              'sigue intacto.\n\n'
            : '') +
          'Los precios de las citas ya agendadas NO cambian: cada una guarda el ' +
          'que se le prometió al paciente.',
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await applyPriceImportAction(aplicables, {
        desactivarSobrantes,
        // Todos los códigos del archivo, no sólo los que cambian: los que
        // quedan igual también «están en la lista» y no deben desactivarse.
        codigosDelArchivo: (vista.filas ?? [])
          .filter((f) => f.estado !== 'ERROR')
          .map((f) => f.code),
      });
      if (!result.ok) {
        setDone(null);
        setError(result.error ?? 'No se pudieron aplicar los cambios');
        return;
      }
      setError(null);
      setDone(
        `Listo: ${result.creados} tratamientos nuevos y ${result.actualizados} actualizados` +
          (result.desactivados ? `, y ${result.desactivados} desactivados.` : '.'),
      );
      setDescartado(true);
      formRef.current?.reset();
    });
  }

  const aplicables =
    vista?.filas?.filter((f) => f.estado === 'NUEVO' || f.estado === 'ACTUALIZA') ?? [];

  /*
   * Hay trabajo si hay filas que escribir O si se pidió apagar lo que sobra.
   * Lo segundo solo también cuenta: quien sube su lista definitiva, que ya
   * coincide con los precios, viene justo a eso.
   */
  const sobrantes = vista?.sobran?.length ?? 0;
  const hayAlgoQueHacer = aplicables.length > 0 || (desactivarSobrantes && sobrantes > 0);

  return (
    <Card
      title="Cargar precios desde Excel"
      subtitle="Sube la lista completa en vez de tratamiento por tratamiento"
    >
      {done && <Notice tone="info">{done}</Notice>}
      {(error ?? vista?.error) && <Notice tone="danger">{error ?? vista?.error}</Notice>}

      <form
        id="price-import"
        ref={formRef}
        action={leer}
        onSubmit={() => {
          // Se levanta el "descartado" al pedir una lectura nueva: si no, la
          // vista previa del archivo siguiente no aparecería.
          setDescartado(false);
          setDone(null);
          setError(null);
        }}
        className="form-grid"
      >
        <div className="field form-grid--full">
          <label className="field__label" htmlFor="price-file">
            Archivo
          </label>
          <input
            id="price-file"
            name="file"
            type="file"
            className="input"
            required
            accept=".xlsx,.csv"
          />
          <span className="field__hint">
            Excel (.xlsx) o CSV. La primera fila son los títulos de las columnas.
          </span>
        </div>

        <div className="form-grid--full">
          <Notice tone="info">
            Columnas obligatorias: <strong>código</strong>, <strong>nombre</strong> y{' '}
            <strong>precio</strong>. Opcionales: categoría, duración y buffer. El
            precio admite <code>30</code>, <code>30,50</code> o <code>1.234,56</code>.
            <br />
            <a href="/api/plantilla-precios" download>
              <IconDownload size={14} /> Descargar plantilla con tu lista actual
            </a>
          </Notice>
        </div>

        <div className="form-grid--full">
          <button type="submit" className="btn btn--ghost" disabled={isPending}>
            {isPending ? 'Leyendo…' : 'Revisar archivo'}
          </button>
        </div>
      </form>

      {/* --- Vista previa ------------------------------------------------ */}
      {vista?.ok && vista.resumen && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="row row--wrap" style={{ gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Badge tone="success">{vista.resumen.nuevos} nuevos</Badge>
            <Badge tone="warning">{vista.resumen.actualizan} cambian</Badge>
            <Badge tone="neutral">{vista.resumen.sinCambio} igual</Badge>
            {vista.resumen.errores > 0 && (
              <Badge tone="danger">{vista.resumen.errores} con error</Badge>
            )}
          </div>

          {vista.resumen.errores > 0 && (
            <Notice tone="warning">
              Hay {vista.resumen.errores} filas con problemas. Se pueden aplicar las
              demás y corregir esas después: te digo el número de fila de cada una.
            </Notice>
          )}

          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th className="table__num">Fila</th>
                  <th>Código</th>
                  <th>Tratamiento</th>
                  <th className="table__num">Precio</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {vista.filas?.map((f) => (
                  <tr key={`${f.fila}-${f.code}`}>
                    <td className="table__num mono text-xs muted" data-label="Fila">
                      {f.fila}
                    </td>
                    <td className="mono text-xs" data-label="Código">
                      {f.code || '—'}
                    </td>
                    <td data-label="Tratamiento">
                      <div className="table__strong">{f.name || '—'}</div>
                      {f.error && (
                        <div className="text-xs" style={{ color: 'var(--color-danger)' }}>
                          {f.error}
                        </div>
                      )}
                      {f.tambienCambia && (
                        <div className="text-xs subtle">
                          También cambia {f.tambienCambia.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="table__num mono" data-label="Precio">
                      {f.estado === 'ERROR' ? (
                        <span className="subtle">—</span>
                      ) : (
                        <>
                          {/*
                            El precio viejo tachado al lado del nuevo: es la
                            comparación que hace que un «$30 → $300» salte a la
                            vista antes de aplicarlo.
                          */}
                          {/* El precio anterior sólo si de verdad cambia: una
                              fila que sólo corrige el nombre enseñaría el
                              mismo importe tachado a su propio lado. */}
                          {f.estado === 'ACTUALIZA' &&
                            f.precioActualCents !== undefined &&
                            f.precioActualCents !== f.priceCents && (
                              <span
                                className="subtle"
                                style={{ textDecoration: 'line-through', marginRight: '0.4rem' }}
                              >
                                {formatCents(f.precioActualCents)}
                              </span>
                            )}
                          <strong>{formatCents(f.priceCents)}</strong>
                        </>
                      )}
                    </td>
                    <td data-label="Estado">
                      <Badge tone={ESTADO[f.estado]!.tone}>{ESTADO[f.estado]!.label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* --- Lo que no viene en el archivo --------------------------- */}
          {(vista.sobran?.length ?? 0) > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <Notice tone="warning">
                <label className="row" style={{ gap: '0.5rem', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    name="desactivarSobrantes"
                    checked={desactivarSobrantes}
                    onChange={(e) => setDesactivarSobrantes(e.target.checked)}
                    disabled={isPending}
                    style={{ marginTop: '0.25rem' }}
                  />
                  <span>
                    Desactivar los <strong>{vista.sobran?.length}</strong> tratamientos que
                    NO están en este archivo. Dejan de ofrecerse al agendar;{' '}
                    <strong>no se borran</strong> y su historial de citas y facturas queda
                    intacto.
                    <span className="text-xs subtle" style={{ display: 'block', marginTop: '0.35rem' }}>
                      {vista.sobran?.map((t) => t.name).join(' · ')}
                    </span>
                  </span>
                </label>
              </Notice>
            </div>
          )}

          <div className="row" style={{ gap: '0.5rem', marginTop: '1rem' }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={aplicar}
              disabled={isPending || !hayAlgoQueHacer}
            >
              {isPending
                ? 'Aplicando…'
                : `Aplicar ${aplicables.length} cambios` +
                  (desactivarSobrantes && sobrantes ? ` y desactivar ${sobrantes}` : '')}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDescartado(true)}
              disabled={isPending}
            >
              Descartar
            </button>
          </div>

          {!hayAlgoQueHacer && (
            <p className="text-sm subtle" style={{ marginTop: '0.5rem' }}>
              No hay nada que cambiar: el archivo coincide con la lista actual.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
