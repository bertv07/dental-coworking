'use client';

import { useMemo, useState, useTransition } from 'react';
import type { MessageTemplate } from '@/backend/domain/types';
import {
  guardarPlantillaAction,
  eliminarPlantillaAction,
} from '@/app/actions/plantillas.actions';
import { Modal } from '@/frontend/components/motion';
import { Card, Badge, Notice, EmptyState } from '@/frontend/components/ui/primitives';
import { IconPlus, IconEdit, IconTrash, IconSearch } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Gestor de plantillas de respuesta
 * ===========================================================================
 *  Los mensajes que recepción usa una y otra vez. Se editan aquí y se usan en
 *  el monitor de WhatsApp con un clic.
 *
 *  ---------------------------------------------------------------------
 *  LOS CORCHETES SE QUEDAN
 *  ---------------------------------------------------------------------
 *  `[Precio]`, `[Hora]`, `[Nombre del paciente]` se guardan tal cual. No se
 *  rellenan solos, y es deliberado: la mitad de esos datos —la hora que se
 *  acordó, el nombre que dio el paciente— sólo los sabe quien está
 *  escribiendo en ese momento.
 *
 *  Lo que sí hace el sistema es CONTARLOS y avisar, porque enviar un mensaje
 *  con «Hola [Nombre del paciente]» sin sustituir es el error que este
 *  formato invita a cometer.
 * ===========================================================================
 */

/** Encuentra los marcadores sin rellenar de un texto. */
export function marcadoresDe(texto: string): string[] {
  return [...new Set(texto.match(/\[[^\]]+\]/g) ?? [])];
}

const VACIA: MessageTemplate = {
  id: '',
  category: '',
  title: '',
  body: '',
  sortOrder: 0,
  usageCount: 0,
  isActive: true,
};

export function PlantillasManager({ plantillas }: { plantillas: MessageTemplate[] }) {
  const [editando, setEditando] = useState<MessageTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [isPending, startTransition] = useTransition();

  /** Categorías existentes, para no reinventar el nombre en cada alta. */
  const categorias = useMemo(
    () => [...new Set(plantillas.map((p) => p.category))].sort(),
    [plantillas],
  );

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return plantillas;
    // Se busca también en el cuerpo: recepción recuerda una frase suelta
    // («cordales») antes que el nombre que alguien le puso a la plantilla.
    return plantillas.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q),
    );
  }, [plantillas, busqueda]);

  const porCategoria = useMemo(() => {
    const mapa = new Map<string, MessageTemplate[]>();
    for (const p of filtradas) mapa.set(p.category, [...(mapa.get(p.category) ?? []), p]);
    return [...mapa.entries()];
  }, [filtradas]);

  function guardar(plantilla: MessageTemplate) {
    setError(null);
    startTransition(async () => {
      const r = await guardarPlantillaAction({
        id: plantilla.id,
        category: plantilla.category,
        title: plantilla.title,
        body: plantilla.body,
        sortOrder: plantilla.sortOrder,
        isActive: plantilla.isActive,
      });
      if (!r.ok) setError(r.error ?? 'No se pudo guardar');
      else setEditando(null);
    });
  }

  function eliminar(plantilla: MessageTemplate) {
    if (!window.confirm(`¿Eliminar «${plantilla.title}»? Dejará de aparecer en el monitor.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await eliminarPlantillaAction({ id: plantilla.id });
      if (!r.ok) setError(r.error ?? 'No se pudo eliminar');
    });
  }

  return (
    <>
      <div className="row row--between" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div className="topbar__search" style={{ maxWidth: '22rem', flex: 1 }}>
          <IconSearch size={16} />
          <input
            type="search"
            placeholder="Buscar por nombre o por una frase del mensaje…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            aria-label="Buscar plantillas"
          />
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setEditando(VACIA)}>
          <IconPlus size={16} /> Nueva plantilla
        </button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {porCategoria.length === 0 ? (
        <Card>
          <EmptyState>
            {busqueda ? 'Ninguna plantilla coincide con esa búsqueda.' : 'Todavía no hay plantillas.'}
          </EmptyState>
        </Card>
      ) : (
        porCategoria.map(([categoria, items]) => (
          <Card key={categoria} title={categoria} subtitle={`${items.length} plantillas`}>
            <div className="stack">
              {items.map((plantilla) => {
                const marcadores = marcadoresDe(plantilla.body);
                return (
                  <div key={plantilla.id} className="plantilla">
                    <div className="plantilla__info">
                      <div className="row" style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="table__strong">{plantilla.title}</span>
                        {!plantilla.isActive && <Badge tone="warning">Inactiva</Badge>}
                        {plantilla.usageCount > 0 && (
                          <Badge tone="neutral">{plantilla.usageCount} usos</Badge>
                        )}
                      </div>
                      <p className="plantilla__cuerpo">{plantilla.body}</p>
                      {marcadores.length > 0 && (
                        <div className="plantilla__marcadores">
                          {marcadores.map((m) => (
                            <code key={m}>{m}</code>
                          ))}
                          <span className="text-xs subtle">se sustituyen antes de enviar</span>
                        </div>
                      )}
                    </div>

                    <div className="table__actions">
                      <button type="button" className="btn btn--ghost btn--sm"
                        onClick={() => setEditando(plantilla)} aria-label={`Editar ${plantilla.title}`}>
                        <IconEdit size={14} />
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm"
                        onClick={() => eliminar(plantilla)} disabled={isPending}
                        aria-label={`Eliminar ${plantilla.title}`}>
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))
      )}

      <Modal
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando?.id ? 'Editar plantilla' : 'Nueva plantilla'}
        subtitle="Usa corchetes para lo que cambia en cada mensaje: [Precio], [Hora]"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEditando(null)}
              disabled={isPending}>
              Cancelar
            </button>
            <button type="button" className="btn btn--primary"
              onClick={() => editando && guardar(editando)}
              disabled={isPending || !editando?.title.trim() || !editando?.body.trim()}>
              {isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </>
        }
      >
        {editando && (
          <div className="stack">
            <div className="form-grid">
              <div className="field">
                <label className="field__label" htmlFor="tpl-cat">Categoría</label>
                <input id="tpl-cat" className="input" list="categorias-existentes"
                  value={editando.category} placeholder="Precios directos"
                  onChange={(e) => setEditando({ ...editando, category: e.target.value })} />
                {/* Sugerencias sin obligar: se puede escribir una nueva. */}
                <datalist id="categorias-existentes">
                  {categorias.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="tpl-orden">Orden</label>
                <input id="tpl-orden" type="number" className="input" min={0} max={999}
                  value={editando.sortOrder}
                  onChange={(e) => setEditando({ ...editando, sortOrder: Number(e.target.value) || 0 })} />
                <span className="field__hint">Más bajo, más arriba</span>
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="tpl-titulo">Situación</label>
              <input id="tpl-titulo" className="input" value={editando.title}
                placeholder="Paciente con dolor (urgencia)"
                onChange={(e) => setEditando({ ...editando, title: e.target.value })} />
              <span className="field__hint">Es lo que se busca al elegir plantilla</span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="tpl-cuerpo">Mensaje</label>
              <textarea id="tpl-cuerpo" className="input" rows={7} value={editando.body}
                onChange={(e) => setEditando({ ...editando, body: e.target.value.slice(0, 4096) })} />
              <span className="field__hint">
                {marcadoresDe(editando.body).length > 0
                  ? `Marcadores: ${marcadoresDe(editando.body).join(' ')}`
                  : 'Sin marcadores: se envía tal cual'}
                {' · '}{editando.body.length}/4096
              </span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="tpl-activa">Estado</label>
              <select id="tpl-activa" className="select" value={editando.isActive ? 'si' : 'no'}
                onChange={(e) => setEditando({ ...editando, isActive: e.target.value === 'si' })}>
                <option value="si">Activa</option>
                <option value="no">Inactiva</option>
              </select>
              <span className="field__hint">Inactiva = no aparece en el monitor</span>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
