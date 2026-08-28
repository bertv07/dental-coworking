'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PAPER_SIZES } from '@/backend/domain/prescription';
import {
  createPrescriptionTemplateAction,
  type PrescriptionResult,
} from '@/app/actions/prescription.actions';
import { Card, Notice } from '@/frontend/components/ui/primitives';

/**
 * Alta de un recetario.
 *
 * Pide sólo el nombre y el tamaño del papel: todo lo demás se hace dentro del
 * editor. Un formulario largo antes de poder ver la hoja haría que nadie
 * llegara a subir su recipe.
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
  const medidas = PAPER_SIZES[papel];

  const [estado, crear, creando] = useActionState<PrescriptionResult | null, FormData>(
    async (_previo, formData) => createPrescriptionTemplateAction(formData),
    null,
  );

  /*
   * Al crearlo se entra directo al editor: crear un recetario y quedarse en
   * la lista mirándolo vacío no le sirve a nadie.
   */
  useEffect(() => {
    if (estado?.ok && estado.id) router.push(`/recetarios/${estado.id}`);
  }, [estado, router]);

  if (!tieneFicha) {
    return (
      <Card title="Nuevo recetario">
        <Notice tone="warning">
          Tu cuenta no está enlazada a una ficha de odontólogo, así que no se puede saber
          de quién sería el recetario. Pídele a recepción que enlace tu ficha.
        </Notice>
      </Card>
    );
  }

  return (
    <Card title="Nuevo recetario" subtitle="Después subes tu recipe y lo ajustas">
      {estado?.error && <Notice tone="danger">{estado.error}</Notice>}

      {/* Con id: en esta página hay más de un formulario (el buscador de la
          barra superior es uno) y hace falta poder señalar el correcto. */}
      <form id="new-recipe" action={crear} className="form-grid">
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
        </label>

        {/*
          Las medidas viajan en píxeles, no como clave del tamaño: así el
          servidor no tiene que traducir nada y el lienzo se puede ajustar a
          mano después sin que exista un «tamaño» que ya no cuadre.
        */}
        <input type="hidden" name="widthPx" value={medidas.width} readOnly />
        <input type="hidden" name="heightPx" value={medidas.height} readOnly />

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

        <div className="form-grid--full">
          <button type="submit" className="btn btn--primary" disabled={creando}>
            {creando ? 'Creando…' : 'Crear y abrir el editor'}
          </button>
        </div>
      </form>

    </Card>
  );
}
