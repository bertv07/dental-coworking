'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveClinicalRecordAction,
  addClinicalEntryAction,
} from '@/app/actions/clinical.actions';
import { Card, Notice, Badge } from '@/frontend/components/ui/primitives';
import { IconPlus } from '@/frontend/components/ui/icons';
import {
  ESTADOS_PIEZA,
  TODAS_LAS_PIEZAS,
  type EstadoPieza,
  type OdontogramaDatos,
} from '@/frontend/features/clinical/Odontogram';

/**
 * ===========================================================================
 *  Transcripción del expediente
 * ===========================================================================
 *  El paso 3 del proceso: la asistente pasa al sistema el papel que el
 *  odontólogo rellenó a mano.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ EL ODONTOGRAMA SE MARCA A CLICS Y NO CON 32 DESPLEGABLES
 *  ---------------------------------------------------------------------
 *  Porque esto es TRANSCRIBIR, no diagnosticar: la persona tiene el papel al
 *  lado y va copiando marcas. Con desplegables serían 32 × (abrir, buscar,
 *  elegir) y nadie transcribiría un expediente entero.
 *
 *  Cada clic avanza al siguiente estado. La mayoría de las piezas están sanas
 *  y se quedan sin tocar; sólo se pulsan las que tienen algo.
 * ===========================================================================
 */

/** Orden del ciclo al hacer clic. `SANO` cierra la vuelta para poder corregir. */
const CICLO: EstadoPieza[] = [
  'SANO', 'CARIES', 'OBTURADO', 'ENDODONCIA', 'CORONA', 'AUSENTE', 'EXTRACCION', 'IMPLANTE',
];

interface RecordFormProps {
  patientId: string;
  patientName: string;
  inicial: {
    hypertension: boolean; diabetes: boolean; heartDisease: boolean;
    anticoagulants: boolean; pregnant: boolean;
    allergies: string | null; currentMedications: string | null;
    medicalNotes: string | null; chiefComplaint: string | null;
    treatmentPlan: string | null; odontogram: OdontogramaDatos | null;
  } | null;
  dentistas: Array<{ id: string; fullName: string }>;
}

export function RecordForm({ patientId, patientName, inicial, dentistas }: RecordFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const [odonto, setOdonto] = useState<OdontogramaDatos>(inicial?.odontogram ?? {});

  function ciclarPieza(numero: string) {
    setOdonto((actual) => {
      const estadoActual = actual[numero]?.estado ?? 'SANO';
      const siguiente = CICLO[(CICLO.indexOf(estadoActual) + 1) % CICLO.length]!;
      const copia = { ...actual };
      // Sano es la ausencia de dato: no se guarda, para que el JSON sólo
      // contenga lo que de verdad tiene algo.
      if (siguiente === 'SANO') delete copia[numero];
      else copia[numero] = { estado: siguiente };
      return copia;
    });
  }

  function guardar(formData: FormData) {
    setError(null);
    setGuardado(false);
    startTransition(async () => {
      const result = await saveClinicalRecordAction({
        ...Object.fromEntries(formData.entries()),
        patientId,
        odontogram: JSON.stringify(odonto),
      });
      if (!result.ok) setError(result.error ?? 'No se pudo guardar');
      else {
        setGuardado(true);
        router.refresh();
      }
    });
  }

  function agregarEvolucion(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addClinicalEntryAction({
        ...Object.fromEntries(formData.entries()),
        patientId,
      });
      if (!result.ok) setError(result.error ?? 'No se pudo guardar la evolución');
      else {
        (document.getElementById('form-evolucion') as HTMLFormElement | null)?.reset();
        router.refresh();
      }
    });
  }

  const marcadas = Object.keys(odonto).length;

  return (
    <div className="stack">
      {error && <Notice tone="danger">{error}</Notice>}
      {guardado && <Notice tone="info">Expediente guardado.</Notice>}

      <form action={guardar} className="stack">
        <Card title="Antecedentes médicos" subtitle={patientName}>
          <div className="exp-form__checks">
            {[
              ['hypertension', 'Hipertensión'],
              ['diabetes', 'Diabetes'],
              ['heartDisease', 'Cardiopatía'],
              ['anticoagulants', 'Anticoagulantes'],
              ['pregnant', 'Embarazo'],
            ].map(([campo, etiqueta]) => (
              <label key={campo} className="exp-form__check">
                <input
                  type="checkbox"
                  name={campo}
                  defaultChecked={Boolean(inicial?.[campo as keyof typeof inicial])}
                />
                {etiqueta}
              </label>
            ))}
          </div>

          <div className="form-grid" style={{ marginTop: '1rem' }}>
            <div className="field form-grid--full">
              <label className="field__label" htmlFor="allergies">Alergias</label>
              <input id="allergies" name="allergies" className="input"
                defaultValue={inicial?.allergies ?? ''} placeholder="Penicilina, látex…" />
            </div>
            <div className="field form-grid--full">
              <label className="field__label" htmlFor="currentMedications">Medicamentos que toma</label>
              <input id="currentMedications" name="currentMedications" className="input"
                defaultValue={inicial?.currentMedications ?? ''} />
            </div>
            <div className="field form-grid--full">
              <label className="field__label" htmlFor="medicalNotes">Otros antecedentes</label>
              <textarea id="medicalNotes" name="medicalNotes" className="input" rows={2}
                defaultValue={inicial?.medicalNotes ?? ''} />
            </div>
            <div className="field form-grid--full">
              <label className="field__label" htmlFor="chiefComplaint">Motivo de consulta</label>
              <textarea id="chiefComplaint" name="chiefComplaint" className="input" rows={2}
                defaultValue={inicial?.chiefComplaint ?? ''} />
            </div>
          </div>
        </Card>

        <Card
          title="Odontograma"
          subtitle="Pulsa cada pieza hasta que coincida con el papel"
          actions={<Badge tone={marcadas > 0 ? 'info' : 'neutral'}>{marcadas} marcadas</Badge>}
        >
          <div className="exp-form__odonto">
            {TODAS_LAS_PIEZAS.map((numero, i) => {
              const estado = odonto[numero]?.estado;
              const meta = estado ? ESTADOS_PIEZA[estado] : null;
              return (
                <div key={numero} style={{ display: 'contents' }}>
                  <button
                    type="button"
                    className="exp-form__pieza"
                    onClick={() => ciclarPieza(numero)}
                    style={meta ? { color: meta.color, borderColor: meta.color, fontWeight: 700 } : undefined}
                    aria-label={`Pieza ${numero}: ${meta?.etiqueta ?? 'sano'}`}
                    title={meta?.etiqueta ?? 'Sano'}
                  >
                    <span className="exp-form__abrev">{meta?.abreviatura ?? '·'}</span>
                    <span className="exp-form__num">{numero}</span>
                  </button>
                  {/* Separadores que reproducen la línea media y los cuadrantes
                      del impreso, para poder copiar sin perderse. */}
                  {(i === 7 || i === 23) && <span className="exp-form__media" />}
                  {i === 15 && <span className="exp-form__salto" />}
                </div>
              );
            })}
          </div>

          <div className="odonto__leyenda" style={{ justifyContent: 'flex-start' }}>
            {Object.entries(ESTADOS_PIEZA).filter(([, m]) => m.abreviatura).map(([k, m]) => (
              <span key={k} className="odonto__leyenda-item">
                <b style={{ color: m.color }}>{m.abreviatura}</b> {m.etiqueta}
              </span>
            ))}
          </div>
        </Card>

        <Card title="Plan de tratamiento">
          <textarea name="treatmentPlan" className="input" rows={4}
            defaultValue={inicial?.treatmentPlan ?? ''}
            placeholder="Lo acordado con el paciente…" />
          <button type="submit" className="btn btn--primary" disabled={isPending}
            style={{ marginTop: '1rem' }}>
            {isPending ? 'Guardando…' : 'Guardar expediente'}
          </button>
        </Card>
      </form>

      {/* La evolución se guarda por separado: es un añadido, no una edición
          del expediente. Meterla en el mismo formulario obligaría a reenviar
          todo el expediente para apuntar una línea. */}
      <Card title="Añadir a la evolución" subtitle="Una línea por atención, con la fecha del papel">
        <form action={agregarEvolucion} id="form-evolucion" className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="performedOn">Fecha de la atención</label>
            <input id="performedOn" name="performedOn" type="date" className="input" required
              defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="dentistId">Odontólogo</label>
            <select id="dentistId" name="dentistId" className="select">
              <option value="">— sin especificar —</option>
              {dentistas.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
          </div>
          <div className="field form-grid--full">
            <label className="field__label" htmlFor="procedure">Procedimiento</label>
            <input id="procedure" name="procedure" className="input" required
              placeholder="Obturación con resina" />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="teeth">Piezas</label>
            <input id="teeth" name="teeth" className="input mono" placeholder="16, 17" />
            <span className="field__hint">Notación FDI, separadas por coma</span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="entryNotes">Observaciones</label>
            <input id="entryNotes" name="notes" className="input" />
          </div>
          <div className="form-grid--full">
            <button type="submit" className="btn btn--primary btn--sm" disabled={isPending}>
              <IconPlus size={15} /> Añadir línea
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
