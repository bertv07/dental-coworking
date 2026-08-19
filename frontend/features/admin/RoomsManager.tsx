'use client';

import type { Room } from '@/backend/domain/types';
import {
  createRoomAction,
  updateRoomAction,
  deleteRoomAction,
} from '@/app/actions/admin.actions';
import { Modal, StaggerItem, Stagger, HoverCard } from '@/frontend/components/motion';
import {
  useCrud,
  TextField,
  SelectField,
  TextAreaField,
  CheckboxField,
  FormFooter,
} from '@/frontend/components/ui/form';
import { Badge, EmptyState, Notice } from '@/frontend/components/ui/primitives';

/**
 * Gestión de consultorios.
 *
 * Se presenta como REJILLA de tarjetas y no como tabla: son tres o cuatro
 * espacios físicos con equipamiento asociado. Una tarjeta por sala se parece
 * más a lo que el admin tiene en la cabeza que una fila de tabla.
 */

interface RoomsManagerProps {
  rooms: Room[];
  /** Para elegir el dueño fijo del consultorio. */
  dentists: Array<{ id: string; fullName: string }>;
  /** Citas programadas por sala en los próximos 7 días. */
  upcomingByRoom: Record<string, number>;
}

export function RoomsManager({ rooms, dentists, upcomingByRoom }: RoomsManagerProps) {
  const crud = useCrud<Room>({
    create: createRoomAction,
    update: updateRoomAction,
    remove: deleteRoomAction,
  });

  const editing = crud.mode.kind === 'edit' ? crud.mode.item : null;
  const errorFor = (field: string) =>
    crud.fieldName === field ? crud.fieldError ?? undefined : undefined;

  return (
    <>
      <div className="row row--between" style={{ marginBottom: '0.25rem' }}>
        <p className="text-sm muted">
          {rooms.filter((room) => room.isActive).length} consultorios activos
        </p>
        <button type="button" className="btn btn--primary" onClick={crud.openCreate}>
          + Nuevo consultorio
        </button>
      </div>

      {rooms.length === 0 ? (
        <div className="card">
          <EmptyState>Aún no hay consultorios registrados.</EmptyState>
        </div>
      ) : (
        <Stagger className="stat-grid" gap={0.07}>
          {rooms.map((room) => (
            <StaggerItem key={room.id}>
              <HoverCard>
                <div className="card" style={{ height: '100%' }}>
                  <div className="card__header">
                    <div>
                      <h2 className="card__title">{room.name}</h2>
                      <p className="card__subtitle">
                        {upcomingByRoom[room.id] ?? 0} citas en 7 días
                      </p>
                    </div>
                    <Badge tone={room.isActive ? 'success' : 'neutral'}>
                      {room.code}
                    </Badge>
                  </div>

                  <div className="card__body">
                    <div className="stack">
                      <div>
                        <div className="field__label" style={{ marginBottom: '0.375rem' }}>
                          Equipamiento
                        </div>
                        <div className="row row--wrap" style={{ gap: '0.25rem' }}>
                          {/* Quién manda en la sala, de un vistazo. */}
                          {(() => {
                            const duenio = dentists.find((d) => d.id === room.assignedDentistId);
                            return (
                              <Badge tone={duenio ? 'info' : 'neutral'}>
                                {duenio ? duenio.fullName : 'Rotativo'}
                              </Badge>
                            );
                          })()}
                          {room.equipment.length === 0 ? (
                            <span className="text-xs subtle">Sin registrar</span>
                          ) : (
                            room.equipment.map((item) => (
                              <Badge key={item} tone="accent">
                                {item}
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>

                      {room.notes && <p className="text-xs muted">{room.notes}</p>}

                      <div className="row" style={{ gap: '0.5rem' }}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => crud.openEdit(room)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => crud.remove(room, room.name)}
                          disabled={crud.isPending}
                        >
                          Desactivar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </HoverCard>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <Modal
        open={crud.mode.kind !== 'closed'}
        onClose={crud.close}
        title={editing ? 'Editar consultorio' : 'Nuevo consultorio'}
        subtitle={editing?.name ?? 'Espacio físico donde se atienden las citas'}
        footer={<FormFooter onCancel={crud.close} isPending={crud.isPending} />}
      >
        {crud.formError && <Notice tone="danger">{crud.formError}</Notice>}

        {editing && (
          <Notice tone="warning">
            Desactivar un consultorio no cancela sus citas ya agendadas: sólo evita que se
            asignen nuevas.
          </Notice>
        )}

        <form id="crud-form" action={crud.submit} className="form-grid" key={editing?.id ?? 'new'}>
          <TextField
            label="Nombre"
            name="name"
            required
            placeholder="Consultorio 4"
            defaultValue={editing?.name}
            error={errorFor('name')}
          />
          <TextField
            label="Código corto"
            name="code"
            required
            placeholder="C4"
            hint="Se muestra en la agenda y en los mensajes del bot"
            defaultValue={editing?.code}
            error={errorFor('code')}
          />
          <TextField
            label="Equipamiento"
            name="equipment"
            full
            placeholder="Unidad odontológica, Rayos X, Lámpara LED"
            hint="Separado por comas"
            defaultValue={editing?.equipment.join(', ')}
            error={errorFor('equipment')}
          />

          {/*
            Fijo o rotativo. Vacío = rotativo, que es el caso por defecto en un
            coworking: la sala se reparte según la especialidad del día.

            Asignarlo NO bloquea la agenda — es una preferencia fuerte. Un
            candado dejaría el consultorio vacío los días que su dueño no viene.
          */}
          <SelectField
            label="Odontólogo fijo"
            name="assignedDentistId"
            full
            defaultValue={editing?.assignedDentistId ?? ''}
            hint="Vacío = consultorio rotativo, se reparte por especialidad"
            options={[
              { value: '', label: '— rotativo —' },
              ...dentists.map((d) => ({ value: d.id, label: d.fullName })),
            ]}
            error={errorFor('assignedDentistId')}
          />
          <TextAreaField
            label="Notas"
            name="notes"
            placeholder="Uso preferente, restricciones…"
            defaultValue={editing?.notes ?? ''}
          />
          <CheckboxField
            label="Consultorio activo"
            name="isActive"
            defaultChecked={editing?.isActive ?? true}
          />
        </form>
      </Modal>
    </>
  );
}
