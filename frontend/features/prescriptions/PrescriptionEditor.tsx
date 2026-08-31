'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { PrescriptionElement } from '@/backend/domain/prescription';
import { PAPER_SIZES, PLACEHOLDERS } from '@/backend/domain/prescription';
import {
  savePrescriptionTemplateAction,
  uploadPrescriptionAssetAction,
} from '@/app/actions/prescription.actions';
import { Notice } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Editor de recetarios
 * ===========================================================================
 *  La odontóloga sube su recipe tal cual lo usa en papel y encima coloca lo
 *  que quiera: desde un punto hasta un cuadro que ocupe la hoja entera. Todo
 *  se mueve, se estira y se ordena en capas.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ NO HAY UNA LIBRERÍA DE LIENZO
 *  ---------------------------------------------------------------------
 *  Un editor de este tipo suele resolverse con una librería de canvas. Aquí
 *  cada elemento es un `<div>` posicionado: pesa cero kilobytes de más, se
 *  imprime desde el navegador sin exportar nada, el texto es texto de verdad
 *  (se puede seleccionar y sale nítido en papel) y hereda los estilos y los
 *  colores del panel. En un canvas, imprimir obliga a rasterizar y el recipe
 *  saldría borroso.
 *
 *  ---------------------------------------------------------------------
 *  LAS COORDENADAS SON DE LA HOJA, NO DE LA PANTALLA
 *  ---------------------------------------------------------------------
 *  El zoom es sólo un `scale` al pintar. Cada arrastre divide el movimiento
 *  del ratón entre el zoom antes de guardarlo, así que editar al 50 % o al
 *  150 % deja el elemento exactamente en el mismo sitio del papel.
 * ===========================================================================
 */

interface Props {
  template: {
    id: string;
    name: string;
    widthPx: number;
    heightPx: number;
    elements: PrescriptionElement[];
    dentistName: string | null;
  };
  /** Sólo lectura cuando el recetario no es de quien lo abre. */
  readOnly?: boolean;
}

type Herramienta = PrescriptionElement['type'];

/** Un tirador de redimensión: qué bordes mueve. */
const TIRADORES = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
] as const;

const FUENTES: Record<string, string> = {
  sans: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

let contador = 0;
function nuevoId(): string {
  contador += 1;
  return `e${Date.now().toString(36)}${contador}`;
}

export function PrescriptionEditor({ template, readOnly = false }: Props) {
  const [elementos, setElementos] = useState<PrescriptionElement[]>(template.elements);
  const [nombre, setNombre] = useState(template.name);
  const [ancho, setAncho] = useState(template.widthPx);
  const [alto, setAlto] = useState(template.heightPx);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinGuardar, setSinGuardar] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [subiendo, setSubiendo] = useState(false);

  const hojaRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /*
   * Historial para deshacer.
   *
   * Se guarda una copia ANTES de cada cambio, no después: así el primer
   * Ctrl+Z devuelve al estado previo a lo último que se hizo, que es lo que
   * espera cualquiera. Tope de 50 pasos para no acumular memoria en una
   * sesión larga de ajustes finos.
   */
  const historial = useRef<PrescriptionElement[][]>([]);

  const recordar = useCallback((actuales: PrescriptionElement[]) => {
    historial.current.push(actuales);
    if (historial.current.length > 50) historial.current.shift();
  }, []);

  const actual = elementos.find((e) => e.id === seleccionado) ?? null;

  const cambiar = useCallback(
    (fn: (previos: PrescriptionElement[]) => PrescriptionElement[], conHistorial = true) => {
      setElementos((previos) => {
        if (conHistorial) recordar(previos);
        return fn(previos);
      });
      setSinGuardar(true);
      setMensaje(null);
    },
    [recordar],
  );

  function deshacer() {
    const anterior = historial.current.pop();
    if (!anterior) return;
    setElementos(anterior);
    setSinGuardar(true);
  }

  // --- Añadir ------------------------------------------------------------

  function añadir(tipo: Herramienta, extra: Partial<PrescriptionElement> = {}) {
    const base = {
      id: nuevoId(),
      // Se coloca hacia arriba y a la izquierda, no en el centro: en una hoja
      // larga el centro cae fuera de la vista y parece que no pasó nada.
      x: 40,
      y: 40,
      rot: 0,
      locked: false,
    };

    let elemento: PrescriptionElement;
    switch (tipo) {
      case 'text':
        elemento = {
          ...base,
          type: 'text',
          w: 260,
          h: 40,
          content: 'Escribe aquí',
          fontSize: 14,
          fontFamily: 'sans',
          bold: false,
          italic: false,
          align: 'left',
          color: '#000000',
          lineHeight: 1.3,
        };
        break;
      case 'box':
        elemento = {
          ...base,
          type: 'box',
          w: 200,
          h: 100,
          fill: 'none',
          stroke: '#000000',
          strokeWidth: 1,
          radius: 0,
        };
        break;
      case 'ellipse':
        elemento = {
          ...base,
          type: 'ellipse',
          w: 120,
          h: 120,
          fill: 'none',
          stroke: '#000000',
          strokeWidth: 1,
        };
        break;
      case 'line':
        elemento = { ...base, type: 'line', w: 220, h: 1, stroke: '#000000', strokeWidth: 1 };
        break;
      case 'image':
        elemento = { ...base, type: 'image', w: 200, h: 200, assetId: '', opacity: 1 };
        break;
    }

    const conExtra = { ...elemento, ...extra } as PrescriptionElement;
    cambiar((previos) => [...previos, conExtra]);
    setSeleccionado(conExtra.id);
  }

  // --- Subir una imagen ---------------------------------------------------

  /**
   * Convierte la PRIMERA página de un PDF en una imagen.
   *
   * Las odontólogas tienen su recipe en PDF tan a menudo como en JPG, y
   * mandarlas a «exportarlo como imagen» es mandarlas a otro programa. Se
   * rasteriza aquí, en el navegador: el servidor sigue guardando sólo bytes
   * de imagen y no hay que meterle un lector de PDF.
   *
   * A 2x para que el membrete no salga pixelado al imprimir.
   */
  async function pdfAImagen(file: File): Promise<File> {
    const pdfjs = await import('pdfjs-dist');
    // El worker se sirve desde el propio paquete; sin esta línea, pdf.js
    // intenta bajarlo de un CDN y la CSP del panel lo bloquea.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();

    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pagina = await doc.getPage(1);
    const escala = 2;
    const vista = pagina.getViewport({ scale: escala });

    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(vista.width);
    lienzo.height = Math.round(vista.height);
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error('sin contexto de dibujo');

    // Fondo blanco: un PDF sin fondo se convertiría en un PNG transparente y
    // al imprimirlo saldría lo que hubiera debajo.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);

    await pagina.render({ canvasContext: ctx, viewport: vista }).promise;

    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, 'image/png'));
    if (!blob) throw new Error('no se pudo convertir el PDF');

    return new File([blob], file.name.replace(/\.pdf$/i, '') + '.png', { type: 'image/png' });
  }

  async function subirImagen(entrada: File) {
    setError(null);
    setSubiendo(true);
    try {
      const file =
        entrada.type === 'application/pdf' ? await pdfAImagen(entrada) : entrada;
      /*
       * Se miden ancho y alto en el navegador ANTES de subir.
       *
       * Con eso la imagen entra en la hoja con su proporción real en vez de
       * un cuadrado por defecto que habría que corregir a mano cada vez. El
       * servidor no decodifica imágenes: sólo guarda los bytes.
       */
      const url = URL.createObjectURL(file);
      const medidas = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('no se pudo leer la imagen'));
        img.src = url;
      });
      URL.revokeObjectURL(url);

      const formData = new FormData();
      formData.set('templateId', template.id);
      formData.set('file', file);
      formData.set('naturalWidth', String(medidas.w));
      formData.set('naturalHeight', String(medidas.h));

      const result = await uploadPrescriptionAssetAction(formData);
      if (!result.ok || !result.assetId) {
        setError(result.error ?? 'No se pudo subir la imagen');
        return;
      }

      // Se encaja a lo ancho de la hoja conservando la proporción: es lo que
      // se quiere el 99 % de las veces con un recipe escaneado.
      const escala = ancho / Math.max(1, medidas.w);
      añadir('image', {
        assetId: result.assetId,
        x: 0,
        y: 0,
        w: ancho,
        h: Math.round(medidas.h * escala),
      });
    } catch (e) {
      setError(
        entrada.type === 'application/pdf'
          ? 'No se pudo leer ese PDF. Prueba a exportarlo como imagen (PNG o JPG).'
          : 'No se pudo leer la imagen. Prueba con un PNG o un JPG.',
      );
      console.error(e);
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // --- Arrastrar y redimensionar -----------------------------------------

  function empezarArrastre(
    evento: React.PointerEvent,
    id: string,
    tirador: string | null,
  ) {
    if (readOnly) return;
    const elemento = elementos.find((e) => e.id === id);
    if (!elemento || elemento.locked) return;

    evento.stopPropagation();
    evento.preventDefault();
    setSeleccionado(id);
    recordar(elementos);

    const inicioX = evento.clientX;
    const inicioY = evento.clientY;
    const origen = { x: elemento.x, y: elemento.y, w: elemento.w, h: elemento.h };
    const objetivo = evento.currentTarget as HTMLElement;
    objetivo.setPointerCapture(evento.pointerId);

    const mover = (e: PointerEvent) => {
      // El movimiento del ratón se divide entre el zoom: sin esto, arrastrar
      // al 50 % movería el elemento el doble de lo que se ve.
      const dx = (e.clientX - inicioX) / zoom;
      const dy = (e.clientY - inicioY) / zoom;

      setElementos((previos) =>
        previos.map((el) => {
          if (el.id !== id) return el;

          if (!tirador) return { ...el, x: Math.round(origen.x + dx), y: Math.round(origen.y + dy) };

          let { x, y, w, h } = origen;
          if (tirador.includes('e')) w = origen.w + dx;
          if (tirador.includes('s')) h = origen.h + dy;
          if (tirador.includes('w')) {
            w = origen.w - dx;
            x = origen.x + dx;
          }
          if (tirador.includes('n')) {
            h = origen.h - dy;
            y = origen.y + dy;
          }

          // Mínimo de 1 px: es lo que permite el punto diminuto que se pidió,
          // sin que un elemento pueda quedarse en cero y volverse imposible
          // de volver a agarrar.
          return {
            ...el,
            x: Math.round(x),
            y: Math.round(y),
            w: Math.round(Math.max(1, w)),
            h: Math.round(Math.max(1, h)),
          };
        }),
      );
      setSinGuardar(true);
    };

    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  // --- Teclado -------------------------------------------------------------

  useEffect(() => {
    if (readOnly) return undefined;

    function alPulsar(e: KeyboardEvent) {
      const dentroDeUnCampo =
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (dentroDeUnCampo) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        deshacer();
        return;
      }
      if (!seleccionado) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        cambiar((previos) => previos.filter((el) => el.id !== seleccionado));
        setSeleccionado(null);
        return;
      }

      // Flechas para el ajuste fino: 1 px, o 10 con Shift. Colocar una firma
      // al píxel con el ratón es imposible; con el teclado es trivial.
      const pasos: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const paso = pasos[e.key];
      if (paso) {
        e.preventDefault();
        const factor = e.shiftKey ? 10 : 1;
        cambiar(
          (previos) =>
            previos.map((el) =>
              el.id === seleccionado
                ? { ...el, x: el.x + paso[0] * factor, y: el.y + paso[1] * factor }
                : el,
            ),
          false,
        );
      }
    }

    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [seleccionado, readOnly, cambiar]);

  // --- Guardar -------------------------------------------------------------

  function guardar() {
    setError(null);
    startTransition(async () => {
      const result = await savePrescriptionTemplateAction({
        id: template.id,
        name: nombre,
        widthPx: ancho,
        heightPx: alto,
        elements: elementos,
      });
      if (!result.ok) {
        setError(result.error ?? 'No se pudo guardar');
        return;
      }
      setSinGuardar(false);
      setMensaje('Recetario guardado.');
    });
  }

  /** Avisa antes de cerrar con cambios sin guardar. */
  useEffect(() => {
    if (!sinGuardar) return undefined;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [sinGuardar]);

  // --- Pintado de un elemento ---------------------------------------------

  function pintar(el: PrescriptionElement) {
    const comun: React.CSSProperties = {
      position: 'absolute',
      left: el.x,
      top: el.y,
      width: el.w,
      height: el.h,
      transform: el.rot ? `rotate(${el.rot}deg)` : undefined,
      cursor: readOnly || el.locked ? 'default' : 'move',
    };

    switch (el.type) {
      case 'text':
        return (
          <div
            style={{
              ...comun,
              fontFamily: FUENTES[el.fontFamily],
              fontSize: el.fontSize,
              fontWeight: el.bold ? 700 : 400,
              fontStyle: el.italic ? 'italic' : 'normal',
              textAlign: el.align,
              color: el.color,
              lineHeight: el.lineHeight,
              // Texto plano y respetando saltos de línea. Nunca `innerHTML`:
              // el contenido lo escribe una persona y podría traer etiquetas.
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
            }}
          >
            {el.content}
          </div>
        );
      case 'box':
        return (
          <div
            style={{
              ...comun,
              background: el.fill === 'none' ? 'transparent' : el.fill,
              border: el.strokeWidth > 0 ? `${el.strokeWidth}px solid ${el.stroke}` : 'none',
              borderRadius: el.radius,
            }}
          />
        );
      case 'ellipse':
        return (
          <div
            style={{
              ...comun,
              background: el.fill === 'none' ? 'transparent' : el.fill,
              border: el.strokeWidth > 0 ? `${el.strokeWidth}px solid ${el.stroke}` : 'none',
              borderRadius: '50%',
            }}
          />
        );
      case 'line':
        return (
          <svg style={{ ...comun, overflow: 'visible' }} viewBox={`0 0 ${el.w} ${el.h}`}>
            <line
              x1={0}
              y1={0}
              x2={el.w}
              y2={el.h}
              stroke={el.stroke}
              strokeWidth={el.strokeWidth}
              strokeLinecap="round"
            />
          </svg>
        );
      case 'image':
        return el.assetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/recetarios/${template.id}/imagen/${el.assetId}`}
            alt=""
            draggable={false}
            style={{ ...comun, opacity: el.opacity, objectFit: 'fill' }}
          />
        ) : (
          <div style={{ ...comun, border: '1px dashed #999' }} />
        );
    }
  }

  const puedeEditar = !readOnly;

  return (
    <div className="recipe-editor">
      {/* ---------------- Barra superior ---------------- */}
      <div className="recipe-editor__bar">
        <input
          className="input"
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            setSinGuardar(true);
          }}
          disabled={!puedeEditar}
          aria-label="Nombre del recetario"
          style={{ maxWidth: '16rem' }}
        />

        {puedeEditar && (
          <>
            <div className="recipe-editor__group">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => añadir('text')}>
                Texto
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => añadir('box')}>
                Cuadro
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => añadir('ellipse')}
              >
                Círculo
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => añadir('line')}>
                Línea
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => añadir('box', { w: 6, h: 6, radius: 3, fill: '#000000', strokeWidth: 0 })}
              >
                Punto
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => fileRef.current?.click()}
                disabled={subiendo}
              >
                {subiendo ? 'Subiendo…' : 'Imagen'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void subirImagen(f);
                }}
              />
            </div>

            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={deshacer}
              title="Ctrl+Z"
            >
              Deshacer
            </button>
          </>
        )}

        <div className="recipe-editor__group" style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.25) * 100) / 100))}
          >
            −
          </button>
          <span className="text-xs mono">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
          >
            +
          </button>
          <a href={`/imprimir/recetario/${template.id}`} target="_blank" className="btn btn--ghost btn--sm" rel="noreferrer">
            Imprimir
          </a>
          {puedeEditar && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={guardar}
              disabled={isPending}
            >
              {isPending ? 'Guardando…' : sinGuardar ? 'Guardar cambios' : 'Guardado'}
            </button>
          )}
        </div>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {mensaje && <Notice tone="info">{mensaje}</Notice>}
      {readOnly && (
        <Notice tone="warning">
          Este recetario es de {template.dentistName ?? 'otra persona'}. Puedes verlo e
          imprimirlo, pero no modificarlo.
        </Notice>
      )}

      <div className="recipe-editor__body">
        {/* ---------------- La hoja ---------------- */}
        <div className="recipe-editor__canvas-wrap">
          <div
            ref={hojaRef}
            className="recipe-sheet"
            style={{
              width: ancho,
              height: alto,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
            onPointerDown={() => setSeleccionado(null)}
          >
            {/*
              LA HOJA VACÍA PIDE EL RECIPE, no un papel en blanco.

              Nadie va a dibujar su recetario desde cero: lo tiene escaneado o
              en PDF y lo que quiere es ajustarle cosas encima. Enseñarle un
              folio en blanco y seis botones de formas es empezar por el paso
              que no va a dar.
            */}
            {elementos.length === 0 && puedeEditar && (
              <button
                type="button"
                className="recipe-sheet__vacia"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.dataset.encima = 'si';
                }}
                onDragLeave={(e) => delete e.currentTarget.dataset.encima}
                onDrop={(e) => {
                  e.preventDefault();
                  delete e.currentTarget.dataset.encima;
                  const f = e.dataTransfer.files?.[0];
                  if (f) void subirImagen(f);
                }}
                disabled={subiendo}
              >
                <span className="recipe-sheet__vacia-icono" aria-hidden="true">
                  ＋
                </span>
                <strong>{subiendo ? 'Subiendo tu recipe…' : 'Sube tu recipe'}</strong>
                <span className="recipe-sheet__vacia-nota">
                  Arrástralo aquí o pulsa para elegirlo.
                  <br />
                  Vale PDF, JPG o PNG — el que ya usas en papel.
                </span>
              </button>
            )}

            {elementos.map((el) => (
              <div
                key={el.id}
                onPointerDown={(e) => empezarArrastre(e, el.id, null)}
                style={{ position: 'absolute', inset: 0 }}
              >
                {pintar(el)}

                {/* Marco y tiradores del seleccionado */}
                {seleccionado === el.id && puedeEditar && !el.locked && (
                  <>
                    <div
                      style={{
                        position: 'absolute',
                        left: el.x,
                        top: el.y,
                        width: el.w,
                        height: el.h,
                        outline: '1px solid var(--color-primary, #2563eb)',
                        pointerEvents: 'none',
                      }}
                    />
                    {TIRADORES.map((t) => (
                      <div
                        key={t.id}
                        onPointerDown={(e) => empezarArrastre(e, el.id, t.id)}
                        style={{
                          position: 'absolute',
                          // Los tiradores se dibujan a tamaño constante en
                          // pantalla: si escalaran con el zoom, al 25 % serían
                          // invisibles y al 300 % taparían el elemento.
                          left: el.x + el.w * t.x - 4 / zoom,
                          top: el.y + el.h * t.y - 4 / zoom,
                          width: 8 / zoom,
                          height: 8 / zoom,
                          background: '#fff',
                          border: `${1 / zoom}px solid var(--color-primary, #2563eb)`,
                          cursor: t.cursor,
                        }}
                      />
                    ))}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ---------------- Panel de propiedades ---------------- */}
        {puedeEditar && (
          <aside className="recipe-editor__panel">
            {!actual ? (
              <div className="stack">
                <h3 className="card__title">Hoja</h3>
                <label className="field">
                  <span className="field__label">Tamaño</span>
                  <select
                    className="input"
                    value={`${ancho}x${alto}`}
                    onChange={(e) => {
                      const [w, h] = e.target.value.split('x').map(Number);
                      setAncho(w!);
                      setAlto(h!);
                      setSinGuardar(true);
                    }}
                  >
                    {Object.entries(PAPER_SIZES).map(([clave, s]) => (
                      <option key={clave} value={`${s.width}x${s.height}`}>
                        {s.label}
                      </option>
                    ))}
                    {/* El tamaño actual siempre presente: si no está en la
                        lista, el select se quedaría sin opción elegida y
                        parecería que no se ha configurado nada. */}
                    {!Object.values(PAPER_SIZES).some(
                      (s) => s.width === ancho && s.height === alto,
                    ) && (
                      <option value={`${ancho}x${alto}`}>
                        A medida ({ancho} × {alto})
                      </option>
                    )}
                  </select>
                </label>

                {/*
                  Medidas libres. Un recetario impreso no siempre cae en un
                  tamaño estándar: si el de la imprenta mide 1200 × 850, se
                  escribe y ya, en vez de pelearse con el más parecido.
                */}
                <div className="form-grid form-grid--tight">
                  <label className="field">
                    <span className="field__label">Ancho (px)</span>
                    <input
                      type="number"
                      className="input"
                      value={ancho}
                      min={100}
                      max={5000}
                      onChange={(e) => {
                        setAncho(Math.min(5000, Math.max(100, Number(e.target.value))));
                        setSinGuardar(true);
                      }}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Alto (px)</span>
                    <input
                      type="number"
                      className="input"
                      value={alto}
                      min={100}
                      max={5000}
                      onChange={(e) => {
                        setAlto(Math.min(5000, Math.max(100, Number(e.target.value))));
                        setSinGuardar(true);
                      }}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    /*
                     * Ajustar la hoja a la imagen que se subió.
                     *
                     * Es lo que se quiere casi siempre con un recipe escaneado:
                     * que el lienzo mida exactamente lo que mide el diseño, sin
                     * márgenes blancos que luego salen impresos.
                     */
                    const imagen = elementos.find((e) => e.type === 'image');
                    if (!imagen) return;
                    setAncho(Math.round(imagen.w));
                    setAlto(Math.round(imagen.h));
                    setSinGuardar(true);
                  }}
                  disabled={!elementos.some((e) => e.type === 'image')}
                >
                  Ajustar la hoja a mi recipe
                </button>

                <p className="text-sm subtle">
                  Selecciona un elemento para editarlo. Con las flechas lo mueves al
                  píxel; con Shift, de diez en diez.
                </p>

                <h3 className="card__title" style={{ marginTop: '1rem' }}>
                  Datos que se rellenan solos
                </h3>
                <p className="text-xs subtle">
                  Escribe estas claves dentro de un texto y al emitir el recipe se
                  sustituyen por los datos del paciente.
                </p>
                <div className="stack" style={{ gap: '0.25rem' }}>
                  {PLACEHOLDERS.map((p) => (
                    <div key={p.clave} className="text-xs">
                      <code>{p.clave}</code> — {p.descripcion}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <PropiedadesDelElemento
                elemento={actual}
                onCambiar={(cambios) =>
                  cambiar((previos) =>
                    previos.map((el) =>
                      el.id === actual.id ? ({ ...el, ...cambios } as PrescriptionElement) : el,
                    ),
                  )
                }
                onSubir={() =>
                  cambiar((previos) => {
                    const i = previos.findIndex((e) => e.id === actual.id);
                    if (i === previos.length - 1) return previos;
                    const copia = [...previos];
                    [copia[i], copia[i + 1]] = [copia[i + 1]!, copia[i]!];
                    return copia;
                  })
                }
                onBajar={() =>
                  cambiar((previos) => {
                    const i = previos.findIndex((e) => e.id === actual.id);
                    if (i <= 0) return previos;
                    const copia = [...previos];
                    [copia[i], copia[i - 1]] = [copia[i - 1]!, copia[i]!];
                    return copia;
                  })
                }
                onDuplicar={() => {
                  const copia = { ...actual, id: nuevoId(), x: actual.x + 12, y: actual.y + 12 };
                  cambiar((previos) => [...previos, copia]);
                  setSeleccionado(copia.id);
                }}
                onBorrar={() => {
                  cambiar((previos) => previos.filter((el) => el.id !== actual.id));
                  setSeleccionado(null);
                }}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
//  Panel de propiedades del elemento seleccionado
// ===========================================================================

function PropiedadesDelElemento({
  elemento,
  onCambiar,
  onSubir,
  onBajar,
  onDuplicar,
  onBorrar,
}: {
  elemento: PrescriptionElement;
  onCambiar: (cambios: Partial<PrescriptionElement>) => void;
  onSubir: () => void;
  onBajar: () => void;
  onDuplicar: () => void;
  onBorrar: () => void;
}) {
  const num = (
    etiqueta: string,
    valor: number,
    alCambiar: (v: number) => void,
    paso = 1,
  ) => (
    <label className="field">
      <span className="field__label">{etiqueta}</span>
      <input
        type="number"
        className="input"
        value={valor}
        step={paso}
        onChange={(e) => alCambiar(Number(e.target.value))}
      />
    </label>
  );

  const color = (etiqueta: string, valor: string, alCambiar: (v: string) => void) => (
    <label className="field">
      <span className="field__label">{etiqueta}</span>
      <input
        type="color"
        className="input"
        value={valor === 'none' ? '#ffffff' : valor}
        onChange={(e) => alCambiar(e.target.value)}
      />
    </label>
  );

  return (
    <div className="stack">
      <h3 className="card__title">
        {
          {
            text: 'Texto',
            box: 'Cuadro',
            ellipse: 'Círculo',
            line: 'Línea',
            image: 'Imagen',
          }[elemento.type]
        }
      </h3>

      <div className="form-grid form-grid--tight">
        {num('X', elemento.x, (v) => onCambiar({ x: v }))}
        {num('Y', elemento.y, (v) => onCambiar({ y: v }))}
        {num('Ancho', elemento.w, (v) => onCambiar({ w: Math.max(1, v) }))}
        {num('Alto', elemento.h, (v) => onCambiar({ h: Math.max(1, v) }))}
        {num('Giro', elemento.rot, (v) => onCambiar({ rot: v }), 5)}
      </div>

      {elemento.type === 'text' && (
        <>
          <label className="field">
            <span className="field__label">Contenido</span>
            <textarea
              className="input"
              rows={4}
              value={elemento.content}
              onChange={(e) => onCambiar({ content: e.target.value })}
            />
          </label>
          <div className="form-grid form-grid--tight">
            {num('Tamaño', elemento.fontSize, (v) => onCambiar({ fontSize: v }))}
            <label className="field">
              <span className="field__label">Fuente</span>
              <select
                className="input"
                value={elemento.fontFamily}
                onChange={(e) =>
                  onCambiar({ fontFamily: e.target.value as 'sans' | 'serif' | 'mono' })
                }
              >
                <option value="sans">Sans</option>
                <option value="serif">Serif</option>
                <option value="mono">Mono</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Alineación</span>
              <select
                className="input"
                value={elemento.align}
                onChange={(e) =>
                  onCambiar({ align: e.target.value as 'left' | 'center' | 'right' })
                }
              >
                <option value="left">Izquierda</option>
                <option value="center">Centro</option>
                <option value="right">Derecha</option>
              </select>
            </label>
            {color('Color', elemento.color, (v) => onCambiar({ color: v }))}
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <label className="row text-sm" style={{ gap: '0.35rem' }}>
              <input
                type="checkbox"
                checked={elemento.bold}
                onChange={(e) => onCambiar({ bold: e.target.checked })}
              />
              Negrita
            </label>
            <label className="row text-sm" style={{ gap: '0.35rem' }}>
              <input
                type="checkbox"
                checked={elemento.italic}
                onChange={(e) => onCambiar({ italic: e.target.checked })}
              />
              Cursiva
            </label>
          </div>
        </>
      )}

      {(elemento.type === 'box' || elemento.type === 'ellipse') && (
        <div className="form-grid form-grid--tight">
          {color('Relleno', elemento.fill, (v) => onCambiar({ fill: v }))}
          {color('Borde', elemento.stroke, (v) => onCambiar({ stroke: v }))}
          {num('Grosor', elemento.strokeWidth, (v) => onCambiar({ strokeWidth: v }))}
          {elemento.type === 'box' && num('Redondeo', elemento.radius, (v) => onCambiar({ radius: v }))}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onCambiar({ fill: 'none' })}
          >
            Sin relleno
          </button>
        </div>
      )}

      {elemento.type === 'line' && (
        <div className="form-grid form-grid--tight">
          {color('Color', elemento.stroke, (v) => onCambiar({ stroke: v }))}
          {num('Grosor', elemento.strokeWidth, (v) => onCambiar({ strokeWidth: v }))}
        </div>
      )}

      {elemento.type === 'image' && (
        <div className="form-grid form-grid--tight">
          {num('Opacidad %', Math.round(elemento.opacity * 100), (v) =>
            onCambiar({ opacity: Math.min(1, Math.max(0, v / 100)) }),
          )}
        </div>
      )}

      <label className="row text-sm" style={{ gap: '0.35rem' }}>
        <input
          type="checkbox"
          checked={elemento.locked}
          onChange={(e) => onCambiar({ locked: e.target.checked })}
        />
        Bloquear (se ve pero no se mueve)
      </label>

      <div className="row row--wrap" style={{ gap: '0.4rem' }}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onSubir}>
          Traer al frente
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBajar}>
          Enviar atrás
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDuplicar}>
          Duplicar
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBorrar}>
          Borrar
        </button>
      </div>
    </div>
  );
}
