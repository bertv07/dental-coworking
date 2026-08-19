'use client';

import { useState, useTransition } from 'react';
import type { Dentist, DentistEarnings } from '@/backend/domain/types';
import { formatCents } from '@/backend/domain/money';
import {
  createDentistAction,
  updateDentistAction,
  deleteDentistAction,
} from '@/app/actions/admin.actions';
import { resetDentistPasswordAction } from '@/app/actions/account.actions';
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
  /**
   * Especialidades ya en uso, para sugerirlas.
   *
   * «Cirujanos y tal»: el bot enruta al especialista por este campo, así que
   * si conviven «CIRUGÍA ORAL» y «cirujano» como valores distintos, a quien
   * pida un cirujano se le ofrece medio equipo o ninguno.
   */
  knownSpecialties: string[];
  dentists: Dentist[];
  /** Producción del periodo, indexada por id de odontólogo. */
  earningsByDentist: Record<string, DentistEarnings | undefined>;
}

export function DentistsManager({
  dentists,
  earningsByDentist,
  knownSpecialties,
}: DentistsManagerProps) {
  const crud = useCrud<Dentist>({
    create: createDentistAction,
    update: updateDentistAction,
    remove: deleteDentistAction,
  });

  const [isResetting, startReset] = useTransition();
  const [resetNotice, setResetNotice] = useState<{ tone: 'info' | 'danger' | 'warning'; text: string } | null>(null);

  /**
   * Le genera una clave nueva y se la manda por correo.
   *
   * No "recupera" la que tenía: nadie la sabe, está hasheada. Se confirma
   * porque además CIERRA sus sesiones abiertas — si estaba trabajando, se
   * queda fuera en ese momento.
   */
  function resetPassword(dentist: Dentist) {
    if (
      !window.confirm(
        `¿Restablecer la contraseña de ${dentist.fullName}?\n\n` +
          'Se le enviará una clave temporal por correo y se cerrarán sus sesiones abiertas.',
      )
    ) {
      return;
    }

    setResetNotice(null);
    startReset(async () => {
      const result = await resetDentistPasswordAction(dentist.id);
      if (!result.ok) {
        setResetNotice({ tone: 'danger', text: result.error ?? 'No se pudo restablecer' });
        return;
      }
      setResetNotice(
        result.warning
          ? { tone: 'warning', text: result.warning }
          : {
              tone: 'info',
              text: `Listo: se le envió una clave temporal a ${dentist.email}. Tendrá que cambiarla al entrar.`,
            },
      );
    });
  }

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
                              {/*
                                Restablecer sólo tiene sentido si tiene cuenta.
                                Sin `userId` no hay contraseña que regenerar:
                                ese odontólogo no entra al panel.
                              */}
                              {dentist.userId && (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  onClick={() => resetPassword(dentist)}
                                  disabled={isResetting}
                                  title="Le genera una clave nueva y se la envía por correo"
                                >
                                  Restablecer clave
                                </button>
                              )}
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

      {/*
        Aviso posterior al alta: se creó, pero el correo no salió. Va fuera
        del modal porque para cuando se muestra el modal ya se cerró — la
        operación tuvo éxito.
      */}
      {resetNotice && (
        <Notice tone={resetNotice.tone}>
          {resetNotice.text}{' '}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setResetNotice(null)}
          >
            Entendido
          </button>
        </Notice>
      )}

      {crud.warning && (
        <Notice tone="warning">
          {crud.warning}{' '}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={crud.dismissWarning}
          >
            Entendido
          </button>
        </Notice>
      )}

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
            hint="Separadas por comas. Reutiliza las que ya existen: el bot busca por ellas."
            suggestions={knownSpecialties}
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

          {/*
            Sólo al dar de alta. En edición no aparece porque crear la cuenta
            de alguien que ya la tiene no es una casilla: es restablecerle la
            clave, que es otra operación y con otras consecuencias.
          */}
          {!editing && (
            <>
              <CheckboxField
                label="Crear su cuenta de acceso al panel"
                name="createAccount"
                hint="Se le envía un correo con una clave temporal que deberá cambiar al entrar."
                defaultChecked={false}
              />

              <div className="form-grid--full">
                <Notice tone="info">
                  La contraseña la genera el sistema y se manda por correo a través de
                  n8n. Nadie del equipo llega a verla, y el panel obliga a cambiarla en
                  el primer inicio de sesión.
                </Notice>
              </div>
            </>
          )}
        </form>
      </Modal>
    </>
  );
}
