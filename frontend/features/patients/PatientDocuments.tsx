'use client';

import { useState, useTransition, useRef } from 'react';
import type { PatientDocument } from '@/backend/domain/types';
import {
  uploadPatientDocumentAction,
  deletePatientDocumentAction,
} from '@/app/actions/documents.actions';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';
import { IconTrash, IconDownload } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Documentos escaneados del paciente
 * ===========================================================================
 *  El expediente lo rellena EL PACIENTE, entero, a mano. El consentimiento lo
 *  firma. Recepción imprime el formulario en blanco, se lo da, y cuando vuelve
 *  firmado lo escanea y lo anexa aquí.
 *
 *  NO se transcribe nada. El original es el papel firmado; teclearlo otra vez
 *  crearía una segunda versión capaz de contradecir a la que vale legalmente.
 *  Por eso esta pantalla no tiene ni un campo clínico: sube, mira y descarga.
 * ===========================================================================
 */

const KIND_LABEL: Record<PatientDocument['kind'], { label: string; tone: 'accent' | 'neutral' }> = {
  EXPEDIENTE: { label: 'Expediente', tone: 'accent' },
  CONSENTIMIENTO: { label: 'Consentimiento', tone: 'accent' },
  RADIOGRAFIA: { label: 'Radiografía', tone: 'neutral' },
  OTRO: { label: 'Otro', tone: 'neutral' },
};

/** "245 KB". El tamaño ayuda a detectar un escaneo que salió en blanco. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PatientDocuments({
  patientId,
  documents,
}: {
  patientId: string;
  documents: PatientDocument[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await uploadPatientDocumentAction(formData);
      if (result.ok) {
        // Se vacía para poder subir el siguiente sin recargar: lo normal es
        // escanear expediente y consentimiento uno detrás de otro.
        formRef.current?.reset();
        return;
      }
      setError(result.error ?? 'No se pudo subir el documento');
    });
  }

  function remove(doc: PatientDocument) {
    if (!window.confirm(`¿Quitar "${doc.fileName}" del expediente?`)) return;

    setError(null);
    startTransition(async () => {
      const result = await deletePatientDocumentAction(doc.id);
      if (!result.ok) setError(result.error ?? 'No se pudo quitar');
    });
  }

  const dateFormatter = new Intl.DateTimeFormat('es-VE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Caracas',
  });

  return (
    <>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card
        title="Documentos del paciente"
        subtitle="Lo que el paciente rellenó y firmó, escaneado"
        flush
      >
        {documents.length === 0 ? (
          <EmptyState>
            Todavía no hay nada escaneado.
            <br />
            Imprime el formulario en blanco, que lo rellene el paciente, y súbelo aquí
            firmado.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Tipo</th>
                  <th>Subido</th>
                  <th className="table__num">Tamaño</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td data-label="Documento">
                      <div className="table__strong">{doc.fileName}</div>
                      {doc.notes && <div className="text-xs subtle">{doc.notes}</div>}
                    </td>
                    <td data-label="Tipo">
                      <Badge tone={KIND_LABEL[doc.kind].tone}>{KIND_LABEL[doc.kind].label}</Badge>
                    </td>
                    <td className="muted text-xs" data-label="Subido">
                      {dateFormatter.format(doc.createdAt)}
                    </td>
                    <td className="table__num mono text-xs" data-label="Tamaño">
                      {formatSize(doc.sizeBytes)}
                    </td>
                    <td data-label="Acciones">
                      <div className="table__actions">
                        {/*
                          Enlace normal, no descarga forzada: un PDF se abre en
                          el visor del navegador y desde ahí se imprime, que es
                          lo que recepción hace la mayoría de las veces.
                        */}
                        <a
                          className="btn btn--ghost btn--sm"
                          href={`/api/documentos/${doc.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <IconDownload size={14} /> Abrir
                        </a>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => remove(doc)}
                          disabled={isPending}
                          aria-label={`Quitar ${doc.fileName}`}
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Subir un escaneo" subtitle="PDF o foto, hasta 20 MB">
        <form ref={formRef} action={submit} className="form-grid">
          <input type="hidden" name="patientId" value={patientId} />

          <div className="field form-grid--full">
            <label className="field__label" htmlFor="file">
              Archivo <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              id="file"
              name="file"
              type="file"
              className="input"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp"
            />
            <span className="field__hint">
              Lo que salga del escáner. También vale una foto nítida del papel.
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="kind">
              Tipo
            </label>
            <select id="kind" name="kind" className="select" defaultValue="EXPEDIENTE">
              <option value="EXPEDIENTE">Expediente</option>
              <option value="CONSENTIMIENTO">Consentimiento informado</option>
              <option value="RADIOGRAFIA">Radiografía</option>
              <option value="OTRO">Otro</option>
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="notes">
              Nota
            </label>
            <input
              id="notes"
              name="notes"
              className="input"
              placeholder="Consentimiento de endodoncia…"
            />
            <span className="field__hint">Opcional. Para distinguirlo de otros.</span>
          </div>

          <div className="form-grid--full">
            <button type="submit" className="btn btn--primary" disabled={isPending}>
              {isPending ? 'Subiendo…' : 'Subir documento'}
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
