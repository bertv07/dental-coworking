'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PAPER_SIZES } from '@/backend/domain/prescription';
import {
  createPrescriptionTemplateAction,
  uploadPrescriptionAssetAction,
} from '@/app/actions/prescription.actions';
import { Card, Notice } from '@/frontend/components/ui/primitives';

/**
 * Subir un recetario.
 *
 * ---------------------------------------------------------------------
 *  AQUÍ NO SE PERSONALIZA NADA
 * ---------------------------------------------------------------------
 *  Hubo un editor para colocar cajas de texto y líneas encima de la hoja.
 *  Se quitó: el recipe que vale es el que la odontóloga ya usa en papel, y
 *  recolocarlo dentro del panel sólo añadía una versión que podía acabar
 *  distinta de la impresa.
 *
 *  El flujo entero es: la odontóloga sube su recipe escaneado → queda en el
 *  panel → recepción lo imprime. Nada más.
 *
 *  El tamaño de la imagen lo mide el navegador antes de subirla, para no
 *  meter un decodificador de imágenes en el servidor sólo por leer dos
 *  números.
 */
export function NewPrescriptionTemplate({
  dentists,
  esOdontologo,
  tieneFicha,
}: {
  dentists: Array<{ id: string; name: string }>;
  esOdontologo: boolean;
  tieneFicha: boolean;
}) {
  const router = useRouter();
  const [papel, setPapel] = useState<keyof typeof PAPER_SIZES>('MEDIA_CARTA');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  /** Mide la imagen en el navegador. Si falla, se sube con 0 y no pasa nada. */
  async function medir(file: File): Promise<{ w: number; h: number }> {
    try {
      const bitmap = await createImageBitmap(file);
      const medidas = { w: bitmap.width, h: bitmap.height };
      bitmap.close();
      return medidas;
    } catch {
      return { w: 0, h: 0 };
    }
  }

  async function enviar(formData: FormData) {
    setError(null);

    if (!archivo) {
      setError('Elige la imagen de tu recipe.');
      return;
    }

    setSubiendo(true);
    try {
      // Paso 1: crear la ficha del recetario.
      const creado = await createPrescriptionTemplateAction(formData);
      if (!creado.ok || !creado.id) {
        setError(creado.error ?? 'No se pudo crear el recetario.');
        return;
      }

      // Paso 2: subirle la imagen. Si esto falla, el recetario queda creado
      // pero vacío — se ve marcado como «sin imagen» en la lista y se puede
      // reintentar desde ahí, en vez de perder también el nombre.
      const medidas = await medir(archivo);
      const subida = new FormData();
      subida.set('templateId', creado.id);
      subida.set('file', archivo);
      subida.set('naturalWidth', String(medidas.w));
      subida.set('naturalHeight', String(medidas.h));

      const resultado = await uploadPrescriptionAssetAction(subida);
      if (!resultado.ok) {
        setError(`El recetario se creó, pero la imagen no subió: ${resultado.error}`);
        router.refresh();
        return;
      }

      router.refresh();
    } finally {
      setSubiendo(false);
    }
  }

  if (!tieneFicha) {
    return (
      <Card title="Subir recetario">
        <Notice tone="warning">
          Tu cuenta no está enlazada a una ficha de odontólogo, así que no se puede saber
          de quién sería el recetario. Pídele a recepción que enlace tu ficha.
        </Notice>
      </Card>
    );
  }

  return (
    <Card title="Subir recetario" subtitle="Tu recipe escaneado, tal cual lo usas en papel">
      {error && <Notice tone="danger">{error}</Notice>}

      <form id="new-recipe" action={enviar} className="form-grid">
        <label className="field">
          <span className="field__label">Nombre</span>
          <input
            className="input"
            name="name"
            required
            maxLength={80}
            placeholder="Recetario principal"
          />
        </label>

        <label className="field">
          <span className="field__label">Tamaño del papel</span>
          <select
            className="input"
            value={papel}
            onChange={(e) => setPapel(e.target.value as keyof typeof PAPER_SIZES)}
          >
            {Object.entries(PAPER_SIZES).map(([clave, s]) => (
              <option key={clave} value={clave}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="field__hint">Es el papel en el que se va a imprimir.</span>
        </label>

        <input type="hidden" name="widthPx" value={PAPER_SIZES[papel].width} readOnly />
        <input type="hidden" name="heightPx" value={PAPER_SIZES[papel].height} readOnly />

        {!esOdontologo && (
          <label className="field">
            <span className="field__label">¿De quién es?</span>
            <select className="input" name="dentistId" defaultValue="">
              <option value="">De la clínica (lo ve todo el mundo)</option>
              {dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field form-grid--full">
          <span className="field__label">
            Imagen del recipe <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <input
            className="input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          />
          <span className="field__hint">PNG, JPG o WEBP. Hasta 8 MB.</span>
        </label>

        <div className="form-grid--full">
          <button type="submit" className="btn btn--primary" disabled={subiendo}>
            {subiendo ? 'Subiendo…' : 'Subir recetario'}
          </button>
        </div>
      </form>
    </Card>
  );
}
