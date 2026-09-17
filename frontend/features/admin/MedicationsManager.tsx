'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Medication } from '@/backend/domain/types';
import {
  saveMedicationAction,
  deleteMedicationAction,
  uploadMedicationImageAction,
} from '@/app/actions/medication.actions';
import { Modal } from '@/frontend/components/motion';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';
import { IconPlus, IconEdit, IconTrash } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  El vademécum, para marcar e imprimir
 * ===========================================================================
 *  Recepción marca lo que la odontóloga indicó y lo imprime: eso es lo que se
 *  lleva el paciente a la farmacia.
 *
 *  Se marca y se imprime en la MISMA pantalla, sin pasos intermedios. El
 *  paciente está de pie en el mostrador esperando: cualquier «siguiente» de
 *  más se acaba resolviendo dictándolo a mano en un papel.
 *
 *  ⚠️  Esto NO sustituye a la receta. La receta la firma la odontóloga en su
 *   recetario; esta hoja son las indicaciones en limpio y legibles.
 * ===========================================================================
 */
export function MedicationsManager({ medications }: { medications: Medication[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /** Lo marcado para imprimir. Se pierde al recargar, y está bien: es de un paciente. */
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());

  const [editando, setEditando] = useState<Medication | null>(null);
  const [abierto, setAbierto] = useState(false);
  /** Foto elegida en el formulario. Se sube DESPUÉS de guardar la ficha. */
  const [foto, setFoto] = useState<File | null>(null);

  // Agrupados por categoría: una lista plana de cuarenta medicamentos no se
  // recorre con el paciente delante.
  const porCategoria = useMemo(() => {
    const mapa = new Map<string, Medication[]>();
    for (const m of medications) {
      if (!mapa.has(m.category)) mapa.set(m.category, []);
      mapa.get(m.category)!.push(m);
    }
    return [...mapa.entries()];
  }, [medications]);

  function alternar(id: string) {
    setElegidos((previos) => {
      const copia = new Set(previos);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  }

  function imprimir() {
    if (elegidos.size === 0) return;
    window.open(`/imprimir/medicamentos?ids=${[...elegidos].join(',')}`, '_blank');
  }

  function guardar(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await saveMedicationAction(
        editando?.id ?? null,
        Object.fromEntries(formData.entries()),
      );
      if (!r.ok) {
        setError(r.error ?? 'No se pudo guardar');
        return;
      }

      /*
       * La foto va en un segundo paso, y sólo si se eligió una.
       *
       * Si falla, la ficha YA está guardada: se avisa y se queda sin foto, en
       * vez de perder también el nombre y la pauta que acaban de teclear.
       */
      if (foto && editando?.id) {
        const subida = new FormData();
        subida.set('id', editando.id);
        subida.set('file', foto);
        const img = await uploadMedicationImageAction(subida);
        if (!img.ok) {
          setError(`Se guardó, pero la foto no subió: ${img.error}`);
          setFoto(null);
          router.refresh();
          return;
        }
      }

      setFoto(null);
      setAbierto(false);
      setEditando(null);
      router.refresh();
    });
  }

  return (
    <>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card
        title="Vademécum"
        subtitle={
          elegidos.size > 0
            ? `${elegidos.size} marcado${elegidos.size === 1 ? '' : 's'} para imprimir`
            : 'Marca lo que indicó la odontóloga'
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn--primary"
              disabled={elegidos.size === 0}
              onClick={imprimir}
            >
              Imprimir selección
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setEditando(null);
                setAbierto(true);
              }}
            >
              <IconPlus size={14} /> Nuevo
            </button>
          </>
        }
      >
        {medications.length === 0 ? (
          <EmptyState>
            El vademécum está vacío. Añade los medicamentos que la clínica indica
            habitualmente y quedarán listos para marcar e imprimir.
          </EmptyState>
        ) : (
          porCategoria.map(([categoria, lista]) => (
            <div key={categoria} style={{ marginBottom: '1.25rem' }}>
              <div className="field__label" style={{ marginBottom: '0.4rem' }}>
                {categoria}
              </div>

              {lista.map((m) => (
                <label
                  key={m.id}
                  className="row"
                  style={{
                    gap: '0.6rem',
                    alignItems: 'flex-start',
                    padding: '0.5rem 0',
                    borderBottom: '1px solid var(--color-border)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={elegidos.has(m.id)}
                    onChange={() => alternar(m.id)}
                    style={{ marginTop: '0.2rem' }}
                  />

                  {/*
                    La miniatura, junto al nombre: recepción reconoce la caja
                    antes de leer el principio activo, igual que el paciente.
                  */}
                  {m.hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/medicamentos/${m.id}/imagen`}
                      alt=""
                      style={{
                        width: 44,
                        height: 44,
                        objectFit: 'contain',
                        borderRadius: 6,
                        background: 'var(--color-surface-2, #f4f4f5)',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 6,
                        background: 'var(--color-surface-2, #f4f4f5)',
                        flexShrink: 0,
                      }}
                    />
                  )}

                  <span style={{ flex: 1 }}>
                    <span className="table__strong">{m.name}</span>
                    {!m.isActive && (
                      <>
                        {' '}
                        <Badge tone="neutral">Inactivo</Badge>
                      </>
                    )}
                    {m.presentation && (
                      <div className="text-xs subtle">{m.presentation}</div>
                    )}
                    {m.posology && <div className="text-xs">{m.posology}</div>}
                  </span>

                  <span className="table__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditando(m);
                        setAbierto(true);
                      }}
                      aria-label={`Editar ${m.name}`}
                    >
                      <IconEdit size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={isPending}
                      onClick={(e) => {
                        e.preventDefault();
                        if (!window.confirm(`¿Quitar "${m.name}" del vademécum?`)) return;
                        startTransition(async () => {
                          const r = await deleteMedicationAction(m.id);
                          if (!r.ok) setError(r.error ?? 'No se pudo quitar');
                          else router.refresh();
                        });
                      }}
                      aria-label={`Quitar ${m.name}`}
                    >
                      <IconTrash size={14} />
                    </button>
                  </span>
                </label>
              ))}
            </div>
          ))
        )}
      </Card>

      <Modal
        open={abierto}
        onClose={() => {
          setAbierto(false);
          setEditando(null);
        }}
        title={editando ? 'Editar medicamento' : 'Nuevo medicamento'}
        subtitle="Lo que se indica habitualmente"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setAbierto(false);
                setEditando(null);
              }}
            >
              Cancelar
            </button>
            <button type="submit" form="med" className="btn btn--primary" disabled={isPending}>
              {isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </>
        }
      >
        <form id="med" className="form-grid" action={guardar} key={editando?.id ?? 'nuevo'}>
          <div className="field form-grid--full">
            <label className="field__label" htmlFor="name">
              Medicamento <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              id="name"
              name="name"
              className="input"
              required
              defaultValue={editando?.name}
              placeholder="Amoxicilina 500 mg"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="presentation">
              Presentación
            </label>
            <input
              id="presentation"
              name="presentation"
              className="input"
              defaultValue={editando?.presentation ?? ''}
              placeholder="Tabletas, caja de 21"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="category">
              Categoría
            </label>
            <input
              id="category"
              name="category"
              className="input"
              defaultValue={editando?.category ?? ''}
              placeholder="Antibióticos"
            />
            <span className="field__hint">Vacío = General.</span>
          </div>

          <div className="field form-grid--full">
            <label className="field__label" htmlFor="posology">
              Indicación habitual
            </label>
            <input
              id="posology"
              name="posology"
              className="input"
              defaultValue={editando?.posology ?? ''}
              placeholder="1 cada 8 horas por 7 días"
            />
            <span className="field__hint">
              Sale impresa tal cual. Si en un caso concreto cambia, se corrige a mano en la hoja.
            </span>
          </div>

          <div className="field form-grid--full">
            <label className="field__label" htmlFor="foto">
              Foto de la caja
            </label>
            <input
              id="foto"
              type="file"
              className="input"
              accept="image/png,image/jpeg,image/webp"
              disabled={!editando}
              onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
            />
            <span className="field__hint">
              {editando
                ? 'PNG, JPG o WEBP, hasta 4 MB. Sale en la hoja que se lleva el paciente.'
                : 'Primero guarda el medicamento; después ábrelo para ponerle la foto.'}
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sortOrder">
              Orden
            </label>
            <input
              id="sortOrder"
              name="sortOrder"
              type="number"
              min={0}
              max={999}
              className="input"
              defaultValue={editando?.sortOrder ?? 0}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="isActive">
              Activo
            </label>
            <input
              id="isActive"
              name="isActive"
              type="checkbox"
              value="true"
              defaultChecked={editando?.isActive ?? true}
            />
          </div>
        </form>
      </Modal>
    </>
  );
}
