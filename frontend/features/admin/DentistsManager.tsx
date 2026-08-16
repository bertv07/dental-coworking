'use client';

import type { Dentist, DentistEarnings } from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import {
  createDentistAction,
  updateDentistAction,
  deleteDentistAction,
} from '@/app/actions/admin.actions';
import { Modal, MotionRow, AnimatePresence } from '@/frontend/components/motion';
import {
  useCrud,
  TextField,
  CheckboxField,
  FormFooter,
} from '@/frontend/components/ui/form';
import { Badge, EmptyState, Avatar, Notice } from '@/frontend/components/ui/primitives';

/**
 * Gestión de odontólogos (CRUD) con su producción del periodo.
 *
 * El dato más delicado de esta pantalla es `clinicCommissionPercent`:
 * determina cuánto cobra una persona real cada quincena. Por eso se muestra
 * siempre junto al reparto resultante — para que el admin vea la
 * consecuencia del número, no sólo el número.
 */

interface DentistsManagerProps {
  dentists: Dentist[];
  /** Producción del periodo, indexada por id de odontólogo. */
  earningsByDentist: Record<string, DentistEarnings | undefined>;
}

export function DentistsManager({ dentists, earningsByDentist }: DentistsManagerProps) {
  const crud = useCrud<Dentist>({
    create: createDentistAction,
    update: updateDentistAction,
    remove: deleteDentistAction,
  });

  const editing = crud.mode.kind === 'edit' ? crud.mode.item : null;

  /** Error del servidor para un campo concreto, si corresponde. */
  const errorFor = (field: string) =>
    crud.fieldName === field ? crud.fieldError ?? undefined : undefined;

  return (
    <>
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Cuerpo odontológico</h2>
            <p className="card__subtitle">
              {dentists.filter((d) => d.isActive).length} activos de {dentists.length}
            </p>
          </div>
          <button type="button" className="btn btn--primary" onClick={crud.openCreate}>
            + Nuevo odontólogo
          </button>
        </div>

        <div className="card__body card__body--flush">
          {dentists.length === 0 ? (
            <EmptyState>Aún no hay odontólogos registrados.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Odontólogo</th>
                    <th>Especialidades</th>
                    <th>Registro</th>
                    <th className="table__num">Comisión</th>
                    <th className="table__num">Producción 30d</th>
                    <th className="table__num">Le corresponde</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {dentists.map((dentist, index) => {
                      const earnings = earningsByDentist[dentist.id];

                      return (
                        <MotionRow key={dentist.id} index={index}>
                          <td>
                            <div className="row">
                              <Avatar name={dentist.fullName} small />
                              <div>
                                <div className="table__strong">{dentist.fullName}</div>
                                <div className="text-xs subtle">{dentist.email}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="row row--wrap" style={{ gap: '0.25rem' }}>
                              {dentist.specialties.map((specialty) => (
                                <Badge key={specialty} tone="accent">
                                  {specialty}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="mono text-xs muted">{dentist.licenseNumber}</td>
                          <td className="table__num">
                            {/*
                              Comisión distinta de la estándar (40%) → se
                              resalta. El admin debe poder detectar los
                              acuerdos especiales de un vistazo.
                            */}
                            <Badge
                              tone={dentist.clinicCommissionPercent === 40 ? 'neutral' : 'warning'}
                            >
                              {dentist.clinicCommissionPercent}% / {100 - dentist.clinicCommissionPercent}%
                            </Badge>
                          </td>
                          <td className="table__num mono">
                            {earnings ? formatCents(earnings.grossCents) : '—'}
                          </td>
                          <td
                            className="table__num mono table__strong"
                            style={{ color: 'var(--color-primary)' }}
                          >
                            {earnings ? formatCents(earnings.dentistShareCents) : '—'}
                          </td>
                          <td>
                            {dentist.isActive ? (
                              <Badge tone="success">Activo</Badge>
                            ) : (
                              <Badge tone="neutral">Inactivo</Badge>
                            )}
                          </td>
                          <td>
                            <div className="table__actions">
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => crud.openEdit(dentist)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                onClick={() => crud.remove(dentist, dentist.fullName)}
                                disabled={crud.isPending}
                              >
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </MotionRow>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={crud.mode.kind !== 'closed'}
        onClose={crud.close}
        title={editing ? 'Editar odontólogo' : 'Nuevo odontólogo'}
        subtitle={editing?.fullName ?? 'Define su comisión y especialidades'}
        footer={<FormFooter onCancel={crud.close} isPending={crud.isPending} />}
      >
        {crud.formError && <Notice tone="danger">{crud.formError}</Notice>}

        <form id="crud-form" action={crud.submit} className="form-grid" key={editing?.id ?? 'new'}>
          <TextField
            label="Nombre completo"
            name="fullName"
            required
            defaultValue={editing?.fullName}
            error={errorFor('fullName')}
          />
          <TextField
            label="Registro profesional"
            name="licenseNumber"
            required
            placeholder="RM-10000"
            defaultValue={editing?.licenseNumber}
            error={errorFor('licenseNumber')}
          />
          <TextField
            label="Correo electrónico"
            name="email"
            type="email"
            required
            defaultValue={editing?.email}
            error={errorFor('email')}
          />
          <TextField
            label="Teléfono"
            name="phone"
            required
            placeholder="+573001234567"
            defaultValue={editing?.phone}
            error={errorFor('phone')}
          />
          <TextField
            label="Especialidades"
            name="specialties"
            required
            full
            placeholder="ORTODONCIA, ESTÉTICA DENTAL"
            hint="Separadas por comas"
            defaultValue={editing?.specialties.join(', ')}
            error={errorFor('specialties')}
          />
          <TextField
            label="Comisión de la clínica (%)"
            name="clinicCommissionPercent"
            type="number"
            required
            min={0}
            max={100}
            hint="El odontólogo recibe el porcentaje restante. Estándar: 40 / 60."
            defaultValue={editing?.clinicCommissionPercent ?? 40}
            error={errorFor('clinicCommissionPercent')}
          />
          <CheckboxField
            label="Odontólogo activo"
            name="isActive"
            hint="Los inactivos no se asignan a citas nuevas, pero conservan su historial."
            defaultChecked={editing?.isActive ?? true}
          />
        </form>
      </Modal>
    </>
  );
}
