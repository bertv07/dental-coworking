'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePrescriptionTemplateAction } from '@/app/actions/prescription.actions';
import { Notice } from '@/frontend/components/ui/primitives';

/**
 * Los dos únicos botones que necesita un recetario: imprimirlo y borrarlo.
 *
 * Imprimir abre la hoja sola, en pestaña nueva y fuera del panel — una hoja
 * de impresión con el menú lateral encima sale impresa con el menú encima.
 */
export function PrescriptionActions({
  templateId,
  nombre,
  tieneImagen,
  puedeBorrar,
}: {
  templateId: string;
  nombre: string;
  tieneImagen: boolean;
  puedeBorrar: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {error && <Notice tone="danger">{error}</Notice>}

      {tieneImagen && (
        <a
          href={`/imprimir/recetario/${templateId}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn--primary"
        >
          Imprimir
        </a>
      )}

      {puedeBorrar && (
        <button
          type="button"
          className="btn btn--ghost"
          style={{ color: 'var(--color-danger)' }}
          disabled={isPending}
          onClick={() => {
            if (!window.confirm(`¿Borrar el recetario «${nombre}»?`)) return;
            setError(null);
            startTransition(async () => {
              const r = await deletePrescriptionTemplateAction(templateId);
              if (!r.ok) {
                setError(r.error ?? 'No se pudo borrar el recetario');
                return;
              }
              router.push('/recetarios');
            });
          }}
        >
          {isPending ? 'Borrando…' : 'Borrar'}
        </button>
      )}
    </>
  );
}
