'use client';

import { useState, useTransition } from 'react';
import type { Treatment } from '@/backend/domain/types';
import { createOwnAppointmentAction } from '@/app/actions/admin.actions';
import { Modal } from '@/frontend/components/motion';
import {
  SelectField,
  TextField,
  TextAreaField,
  FormFooter,
} from '@/frontend/components/ui/form';
import { Notice } from '@/frontend/components/ui/primitives';
import { IconPlus } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  La doctora agenda su propia cita
 * ===========================================================================
 *  Una odontóloga cierra citas por su cuenta: un paciente le escribe directo,
 *  o acuerdan el control al terminar la consulta. Antes tenía que pedírselo a
 *  recepción o escribirle al bot; esto es lo mismo desde su agenda.
 *
 *  TRES COSAS QUE ESTE FORMULARIO NO PREGUNTA, A PROPÓSITO:
 *
 *  1. **Para quién es.** Es para ella. El servidor lo resuelve desde su
 *     sesión. Un campo aquí permitiría meterle una cita a una compañera.
 *  2. **Qué consultorio.** Lo asigna el servidor, probando primero el suyo si
 *     tiene uno fijo. Elegir sala a mano dejaría ocupar la de otra persona.
 *  3. **Cuánto cuesta.** El precio lo congela el servidor desde el
 *     tratamiento. La odontóloga cobra por liquidación, no por cita, y en
 *     toda su parte del panel no viaja ni un importe.
 *
 *  El paciente se identifica por TELÉFONO y no con un selector: ella no tiene
 *  acceso al listado de pacientes de la clínica —son de toda la consulta, no
 *  suyos— y no debe tenerlo. Si el número ya existe se reutiliza su ficha; si
 *  no, se crea. Es exactamente lo que hace el bot.
 * ===========================================================================
 */

export function BookOwnAppointment({ treatments }: { treatments: Treatment[] }) {
  const [isOpen, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(
    null,
  );

  const activos = treatments.filter((treatment) => treatment.isActive);

  function submit(formData: FormData) {
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const result = await createOwnAppointmentAction(Object.fromEntries(formData.entries()));
      if (result.ok) {
        setOpen(false);
        return;
      }
      if (result.field) {
        setFieldError({ field: result.field, message: result.error ?? 'Valor inválido' });
        return;
      }
      setError(result.error ?? 'No se pudo agendar');
    });
  }

  const errorFor = (field: string) =>
    fieldError?.field === field ? fieldError.message : undefined;

  return (
    <>
      <button type="button" className="btn btn--primary btn--sm" onClick={() => setOpen(true)}>
        <IconPlus size={15} /> Agendar
      </button>

      <Modal
        open={isOpen}
        onClose={() => setOpen(false)}
        title="Agendar una cita"
        subtitle="Se agenda contigo, en tu horario"
        footer={
          <FormFooter
            isPending={isPending}
            onCancel={() => setOpen(false)}
            formId="own-appointment-form"
            submitLabel="Agendar"
          />
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}

        <form id="own-appointment-form" action={submit} className="form-grid">
          <TextField
            label="Teléfono del paciente"
            name="patientPhone"
            required
            full
            placeholder="+584141234567"
            hint="Si ya es paciente de la clínica, se usa su ficha. Si no, se crea."
            error={errorFor('patientPhone')}
          />

          <TextField
            label="Nombre del paciente"
            name="patientName"
            full
            placeholder="Sólo si es paciente nuevo"
            hint="Si el teléfono ya existe, se conserva el nombre que tenga."
            error={errorFor('patientName')}
          />

          <SelectField
            label="Tratamiento"
            name="treatmentCode"
            required
            full
            options={[
              { value: '', label: 'Elige un tratamiento…' },
              ...activos.map((treatment) => ({
                value: treatment.code,
                // Sin precio: en la vista del odontólogo no viaja ningún importe.
                label: `${treatment.name} · ${treatment.durationMinutes} min`,
              })),
            ]}
            error={errorFor('treatmentCode')}
          />

          <TextField
            label="Fecha y hora"
            name="startsAt"
            type="datetime-local"
            required
            full
            hint="La duración la calcula el sistema según el tratamiento."
            error={errorFor('startsAt')}
          />

          <TextAreaField
            label="Notas"
            name="notes"
            placeholder="Lo que recepción deba saber…"
          />

          <div className="form-grid--full">
            <Notice tone="info">
              El consultorio se asigna solo. Si a esa hora ya tienes una cita, o no
              queda sala libre, se te proponen horas alternativas.
            </Notice>
          </div>
        </form>
      </Modal>
    </>
  );
}
