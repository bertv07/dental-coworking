'use client';

import { useState, useTransition } from 'react';
import { updateDentistAction } from '@/app/actions/admin.actions';
import { Modal } from '@/frontend/components/motion';
import { TextField, FormFooter } from '@/frontend/components/ui/form';
import { Badge, Card, EmptyState, Notice, Avatar } from '@/frontend/components/ui/primitives';
import { IconEdit } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  El equipo, como lo ve recepción
 * ===========================================================================
 *  «Odontólogos para asistente.» Recepción necesita saber QUIÉN hay y QUÉ
 *  hace cada quien: es lo que usa para agendar, para saber a quién derivar un
 *  paciente que pide un cirujano, y para localizar a alguien.
 *
 *  Lo que NO ve es el dinero: ni su comisión, ni lo que produjo, ni lo que la
 *  clínica le debe. Eso es una negociación entre la clínica y cada persona, y
 *  no hace falta para el trabajo del mostrador.
 *
 *  ⚠️  No se oculta con CSS ni con condicionales aquí: la página de recepción
 *   NO CONSULTA esas cifras. Este componente ni siquiera recibe un campo
 *   donde pudieran venir, así que no hay forma de que se filtren al HTML.
 *
 *  SÍ puede EDITAR: corregir un teléfono mal tecleado, añadir una especialidad
 *  o actualizar un correo es trabajo de mostrador y no tenía por qué esperar
 *  al administrador.
 *
 *  Lo que no puede es dar de ALTA ni cambiar la COMISIÓN. Crear a alguien
 *  implica fijarle cuánto cobra, y eso vuelve a ser de administración. El
 *  formulario de aquí ni siquiera tiene ese campo, y el servidor reescribe el
 *  porcentaje con el guardado por si alguien lo manda a mano.
 * ===========================================================================
 */

/** Lo único que recepción necesita de un odontólogo. Sin un solo importe. */
export interface FichaOdontologo {
  id: string;
  fullName: string;
  licenseNumber: string;
  email: string;
  phone: string;
  specialties: string[];
  isActive: boolean;
}

export function DentistRoster({
  dentists,
  knownSpecialties = [],
}: {
  dentists: FichaOdontologo[];
  /** Especialidades ya en uso, para sugerirlas y no inventar variantes. */
  knownSpecialties?: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(
    null,
  );
  const [editing, setEditing] = useState<FichaOdontologo | null>(null);

  function submit(formData: FormData) {
    if (!editing) return;
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const result = await updateDentistAction(
        editing.id,
        Object.fromEntries(formData.entries()),
      );
      if (result.ok) {
        setEditing(null);
        return;
      }
      if (result.field) {
        setFieldError({ field: result.field, message: result.error ?? 'Valor inválido' });
        return;
      }
      setError(result.error ?? 'No se pudo guardar');
    });
  }

  const errorFor = (field: string) =>
    fieldError?.field === field ? fieldError.message : undefined;

  if (dentists.length === 0) {
    return (
      <Card>
        <EmptyState>Todavía no hay odontólogos registrados.</EmptyState>
      </Card>
    );
  }

  return (
    <>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card
        title="Cuerpo odontológico"
        subtitle={`${dentists.length} en activo`}
        flush
      >
      <div className="table-wrap">
        <table className="table table--cards">
          <thead>
            <tr>
              <th>Odontólogo</th>
              <th>Especialidades</th>
              <th>Registro</th>
              <th>Contacto</th>
              <th style={{ textAlign: 'right' }} />
            </tr>
          </thead>
          <tbody>
            {dentists.map((dentist) => (
              <tr key={dentist.id}>
                <td data-label="Odontólogo">
                  <div className="row">
                    <Avatar name={dentist.fullName} small />
                    <div className="table__strong">{dentist.fullName}</div>
                  </div>
                </td>
                <td data-label="Especialidades">
                  {/*
                    Es la columna que de verdad usa recepción: cuando alguien
                    pide «un cirujano», esto es lo que se mira.
                  */}
                  <div className="row row--wrap" style={{ gap: '0.25rem' }}>
                    {dentist.specialties.map((specialty) => (
                      <Badge key={specialty} tone="accent">
                        {specialty}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="mono text-xs muted" data-label="Registro">
                  {dentist.licenseNumber}
                </td>
                <td className="text-xs" data-label="Contacto">
                  <div className="mono">{dentist.phone}</div>
                  <div className="subtle">{dentist.email}</div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setEditing(dentist)}
                    aria-label={`Editar ${dentist.fullName}`}
                  >
                    <IconEdit size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Editar odontólogo"
        subtitle={editing?.fullName}
        footer={
          <FormFooter
            isPending={isPending}
            onCancel={() => setEditing(null)}
            formId="roster-form"
          />
        }
      >
        {editing && (
          <form id="roster-form" action={submit} className="form-grid" key={editing.id}>
            <TextField
              label="Nombre completo"
              name="fullName"
              required
              defaultValue={editing.fullName}
              error={errorFor('fullName')}
            />
            <TextField
              label="Nº de colegio"
              name="licenseNumber"
              required
              defaultValue={editing.licenseNumber}
              error={errorFor('licenseNumber')}
            />
            <TextField
              label="Correo electrónico"
              name="email"
              type="email"
              required
              defaultValue={editing.email}
              error={errorFor('email')}
            />
            <TextField
              label="Teléfono"
              name="phone"
              required
              defaultValue={editing.phone}
              error={errorFor('phone')}
            />
            <TextField
              label="Especialidades"
              name="specialties"
              required
              full
              hint="Separadas por comas. Reutiliza las que ya existen: el bot busca por ellas."
              suggestions={knownSpecialties}
              defaultValue={editing.specialties.join(', ')}
              error={errorFor('specialties')}
            />

            {/*
              El checkbox de activo va oculto con su valor actual: el esquema
              lo exige y aquí no se está decidiendo dar de baja a nadie, que es
              una acción con más consecuencias y vive en administración.
            */}
            <input type="hidden" name="isActive" value={String(editing.isActive)} />

            <div className="form-grid--full">
              <Notice tone="info">
                La comisión no se toca desde aquí: la fija administración en su propia
                pantalla.
              </Notice>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
