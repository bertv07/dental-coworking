'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  searchPatientsForInvoiceAction,
  createBackdatedInvoiceAction,
  consultarTasaDelDiaAction,
} from '@/app/actions/invoice.actions';
import type { TasaDelDiaConsulta } from '@/app/actions/invoice.actions';
import { Modal } from '@/frontend/components/motion';
import { Notice } from '@/frontend/components/ui/primitives';
import { IconPlus } from '@/frontend/components/ui/icons';

interface DentistOption {
  id: string;
  fullName: string;
}

/**
 * "Registrar venta atrasada" — abre una factura SIN pasar por la agenda,
 * para la venta que se olvidó registrar el día que pasó (o cualquier venta
 * de mostrador sin cita). Fecha la factura, no el cobro: el cobro se fecha
 * aparte, al registrarlo dentro de la factura ya creada.
 */
export function RegisterBackdatedSale({
  dentists,
  todayKey,
}: {
  dentists: DentistOption[];
  todayKey: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: string; fullName: string; phoneE164: string }>>(
    [],
  );
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<{ id: string; fullName: string } | null>(null);

  /*
   * La tasa del día que se está fechando.
   *
   * Aparece en cuanto se elige la fecha y se puede corregir: el sistema sabe
   * la tasa oficial de ese día, pero el recibo que recepción tiene en la
   * mano es la última palabra sobre a cuánto se cobró de verdad. Lo que
   * quede aquí es lo que usará el cobro después.
   */
  const [fecha, setFecha] = useState('');
  const [tasaDelDia, setTasaDelDia] = useState<TasaDelDiaConsulta | null>(null);
  const [tasaEscrita, setTasaEscrita] = useState('');
  const [consultandoTasa, setConsultandoTasa] = useState(false);

  useEffect(() => {
    if (fecha === '' || fecha === todayKey) {
      setTasaDelDia(null);
      setTasaEscrita('');
      return;
    }
    // `cancelado`: si se cambia de fecha dos veces seguidas, la primera
    // consulta puede volver la última y dejar en pantalla una tasa que no es.
    let cancelado = false;
    setConsultandoTasa(true);
    consultarTasaDelDiaAction(fecha)
      .then((r) => {
        if (cancelado) return;
        setTasaDelDia(r);
        // Se precarga la oficial, o la más cercana si no hay: así lo normal
        // es no tocar nada, y corregir es la excepción.
        setTasaEscrita(String(r?.rate ?? r?.aproximada?.rate ?? ''));
      })
      .finally(() => {
        if (!cancelado) setConsultandoTasa(false);
      });
    return () => {
      cancelado = true;
    };
  }, [fecha, todayKey]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function onQueryChange(value: string) {
    setQuery(value);
    setChosen(null);
    clearTimeout(searchTimer.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      searchPatientsForInvoiceAction(value)
        .then(setResults)
        .finally(() => setSearching(false));
    }, 300);
  }

  function cerrar() {
    setOpen(false);
    setError(null);
    setQuery('');
    setResults([]);
    setChosen(null);
    // También la fecha y la tasa: si no, al abrir el modal para la siguiente
    // venta seguiría puesta la del día anterior y se fecharía ahí sin querer.
    setFecha('');
    setTasaDelDia(null);
    setTasaEscrita('');
  }

  return (
    <>
      <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
        <IconPlus size={16} /> Registrar venta atrasada
      </button>

      <Modal
        open={open}
        onClose={cerrar}
        title="Registrar venta atrasada"
        subtitle="Para la venta que se te olvidó registrar el día que pasó"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cerrar}>
              Cancelar
            </button>
            <button
              type="submit"
              form="venta-atrasada"
              className="btn btn--primary"
              disabled={isPending || !chosen}
            >
              {isPending ? 'Abriendo…' : 'Abrir factura'}
            </button>
          </>
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}
        <Notice tone="info">
          Esto sólo abre la factura vacía. Los tratamientos y el cobro —con su propia fecha— se
          añaden después, dentro de ella.
        </Notice>

        <form
          id="venta-atrasada"
          className="form-grid"
          action={(fd) => {
            if (!chosen) return;
            setError(null);
            startTransition(async () => {
              const result = await createBackdatedInvoiceAction({
                patientId: chosen.id,
                dentistId: fd.get('dentistId'),
                fecha: fd.get('fecha'),
                tasa: fd.get('tasa'),
              });
              if (!result.ok) {
                setError(result.error ?? 'No se pudo abrir la factura');
                return;
              }
              cerrar();
              if (result.invoiceId) router.push(`/facturas/${result.invoiceId}`);
            });
          }}
        >
          <div className="field form-grid--full">
            <label className="field__label" htmlFor="pacienteBuscar">
              Paciente
            </label>
            {chosen ? (
              <div className="row row--between" style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 10px)' }}>
                <strong>{chosen.fullName}</strong>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setChosen(null)}>
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <input
                  id="pacienteBuscar"
                  className="input"
                  placeholder="Nombre, teléfono o cédula…"
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  autoComplete="off"
                />
                {searching && <span className="text-xs subtle">Buscando…</span>}
                {results.length > 0 && (
                  <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {results.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        className="btn btn--ghost btn--sm"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => setChosen({ id: p.id, fullName: p.fullName })}
                      >
                        {p.fullName} <span className="subtle">· {p.phoneE164}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="dentistId">
              Odontólogo
            </label>
            <select id="dentistId" name="dentistId" className="select" defaultValue="">
              <option value="">— Venta directa, sin odontólogo —</option>
              {dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="fecha">
              Fecha de la venta
            </label>
            <input
              id="fecha"
              name="fecha"
              type="date"
              className="input"
              max={todayKey}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
            <span className="field__hint">Vacío = hoy.</span>
          </div>

          {/*
            La tasa de ESE día, no la de hoy.

            Fechar una venta el 3 de septiembre y cobrarla a la tasa de tres
            semanas después escribe en la factura unos bolívares que nunca
            entraron en la gaveta. Se enseña al elegir la fecha y queda
            guardada para cuando se registre el cobro.
          */}
          {fecha !== '' && fecha !== todayKey && (
            <div className="field form-grid--full">
              <label className="field__label" htmlFor="tasa">
                Tasa {tasaDelDia?.source ?? 'del día'} (Bs por dólar)
              </label>
              <input
                id="tasa"
                name="tasa"
                type="number"
                min={0.01}
                step={0.0001}
                className="input"
                value={tasaEscrita}
                onChange={(e) => setTasaEscrita(e.target.value)}
                placeholder={consultandoTasa ? 'Buscando…' : 'Ej: 926,5530'}
              />
              <span className="field__hint">
                {consultandoTasa
                  ? 'Buscando la tasa de ese día…'
                  : tasaDelDia?.rate != null
                    ? `Es la oficial del ${tasaDelDia.fechaLabel}. Cámbiala sólo si no coincide con el recibo.`
                    : tasaDelDia?.aproximada
                      ? `No tengo la oficial de ese día; ésta es la de ${tasaDelDia.aproximada.fechaLabel}. Corrígela con la del recibo.`
                      : 'No tengo la tasa de ese día: escribe la que aparece en el recibo.'}
              </span>
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}
