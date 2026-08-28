'use client';

import { useState, useTransition } from 'react';
import type { StaffUser } from '@/backend/domain/types';
import {
  createStaffUserAction,
  updateStaffUserAction,
  setStaffUserStatusAction,
  resendStaffCredentialsAction,
} from '@/app/actions/staff.actions';
import { Badge, Card, EmptyState, Notice } from '@/frontend/components/ui/primitives';

/**
 * ===========================================================================
 *  Cuentas del panel
 * ===========================================================================
 *  Dar de alta a otro administrador, a una asistente o a una odontóloga, y
 *  que le llegue la clave por correo.
 *
 *  LA CLAVE NO SE PIDE NI SE ENSEÑA. La genera el servidor y viaja por
 *  correo. Si esta pantalla la mostrara, quedaría en el HTML y en cualquier
 *  captura — y con eso ya la sabrían tres partes en vez de una.
 * ===========================================================================
 */

interface Props {
  users: StaffUser[];
  /** Fichas de odontólogo sin cuenta, para poder enlazarlas al dar de alta. */
  dentistsSinCuenta: Array<{ id: string; name: string }>;
  /** Quién está mirando: su propia fila se marca y no se puede suspender. */
  currentUserId: string;
}

const ROL_LEGIBLE: Record<string, string> = {
  SUPER_ADMIN: 'Administrador',
  ASSISTANT: 'Asistente',
  DENTIST: 'Odontólogo',
};

const ROL_TONO: Record<string, 'success' | 'warning' | 'neutral'> = {
  SUPER_ADMIN: 'warning',
  ASSISTANT: 'neutral',
  DENTIST: 'success',
};

export function StaffUsersManager({ users, dentistsSinCuenta, currentUserId }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<StaffUser | null>(null);
  const [rol, setRol] = useState<string>('ASSISTANT');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function abrir(u: StaffUser | null) {
    setEditando(u);
    setRol(u?.role ?? 'ASSISTANT');
    setError(null);
    setAviso(null);
    setAbierto(true);
  }

  function guardar(formData: FormData) {
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const result = editando
        ? await updateStaffUserAction(formData)
        : await createStaffUserAction(formData);

      if (!result.ok) {
        setError(result.error ?? 'No se pudo guardar');
        return;
      }
      setAbierto(false);
      setEditando(null);
      setAviso(
        result.warning ??
          (editando ? 'Cuenta actualizada.' : 'Cuenta creada y clave enviada por correo.'),
      );
    });
  }

  function cambiarEstado(u: StaffUser) {
    const suspender = u.status === 'ACTIVE';
    if (
      suspender &&
      !window.confirm(
        `¿Suspender a ${u.fullName}?\n\nDeja de poder entrar y se cierran sus sesiones abiertas. Su historial se conserva.`,
      )
    ) {
      return;
    }

    setError(null);
    setAviso(null);
    startTransition(async () => {
      const result = await setStaffUserStatusAction({
        id: u.id,
        status: suspender ? 'SUSPENDED' : 'ACTIVE',
      });
      if (!result.ok) setError(result.error ?? 'No se pudo cambiar el estado');
      else setAviso(result.warning ?? 'Cuenta reactivada.');
    });
  }

  function reenviar(u: StaffUser) {
    if (
      !window.confirm(
        `¿Enviarle una clave nueva a ${u.fullName}?\n\nLa clave que tenga ahora DEJA DE FUNCIONAR en el acto.`,
      )
    ) {
      return;
    }

    setError(null);
    setAviso(null);
    startTransition(async () => {
      const result = await resendStaffCredentialsAction(u.id);
      if (!result.ok) setError(result.error ?? 'No se pudo reenviar');
      else setAviso(result.warning ?? 'Clave nueva enviada.');
    });
  }

  return (
    <>
      <Card
        title="Cuentas del panel"
        subtitle={`${users.filter((u) => u.status === 'ACTIVE').length} activas de ${users.length}`}
        actions={
          <button type="button" className="pill-btn" onClick={() => abrir(null)}>
            Nueva cuenta
          </button>
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}
        {aviso && <Notice tone="info">{aviso}</Notice>}

        {users.length === 0 ? (
          <EmptyState>No hay cuentas todavía.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Último acceso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Persona">
                      <div className="table__strong">
                        {u.fullName}
                        {u.id === currentUserId && (
                          <span className="text-xs subtle"> · tú</span>
                        )}
                      </div>
                      <div className="text-xs subtle">{u.email}</div>
                      {u.dentistName && (
                        <div className="text-xs subtle">Ficha: {u.dentistName}</div>
                      )}
                    </td>
                    <td data-label="Rol">
                      <Badge tone={ROL_TONO[u.role] ?? 'neutral'}>
                        {ROL_LEGIBLE[u.role] ?? u.role}
                      </Badge>
                    </td>
                    <td data-label="Estado">
                      {u.status === 'SUSPENDED' ? (
                        <Badge tone="danger">Suspendida</Badge>
                      ) : u.mustChangePassword ? (
                        // Se distingue de «activa» a propósito: significa que
                        // la clave temporal sigue viva y nadie la ha cambiado.
                        <Badge tone="warning">Clave sin estrenar</Badge>
                      ) : (
                        <Badge tone="success">Activa</Badge>
                      )}
                    </td>
                    <td data-label="Último acceso" className="text-xs">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleDateString('es-VE')
                        : <span className="subtle">Nunca entró</span>}
                    </td>
                    <td data-label="">
                      <div className="row row--wrap" style={{ gap: '0.3rem' }}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => abrir(u)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => reenviar(u)}
                          disabled={isPending}
                        >
                          Clave nueva
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => cambiarEstado(u)}
                          /* La propia cuenta no se suspende: quien lo hiciera
                             se quedaría fuera del panel al instante. */
                          disabled={isPending || (u.id === currentUserId && u.status === 'ACTIVE')}
                          title={
                            u.id === currentUserId && u.status === 'ACTIVE'
                              ? 'No puedes suspender tu propia cuenta'
                              : undefined
                          }
                        >
                          {u.status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}
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

      {abierto && (
        <Card title={editando ? `Editar ${editando.fullName}` : 'Nueva cuenta'}>
          <Notice tone="info">
            La contraseña <strong>la genera el sistema</strong> y se envía por correo. No
            se escribe aquí ni se muestra en ninguna pantalla. Quien la reciba está
            obligado a cambiarla al entrar.
          </Notice>

          <form id="staff-form" action={guardar} className="form-grid">
            {editando && <input type="hidden" name="id" value={editando.id} />}

            <label className="field">
              <span className="field__label">Nombre completo</span>
              <input
                className="input"
                name="fullName"
                required
                maxLength={120}
                defaultValue={editando?.fullName}
              />
            </label>

            <label className="field">
              <span className="field__label">Correo</span>
              <input
                className="input"
                name="email"
                type="email"
                required
                maxLength={160}
                defaultValue={editando?.email}
                /* El correo es la llave de la cuenta: cambiarlo en caliente
                   sería mover a qué buzón llegan las claves. Se da de alta
                   otra cuenta si hace falta. */
                readOnly={Boolean(editando)}
              />
              {editando && (
                <span className="field__hint">
                  El correo no se cambia: es a donde van las claves.
                </span>
              )}
            </label>

            <label className="field">
              <span className="field__label">Rol</span>
              <select
                className="input"
                name="role"
                value={rol}
                onChange={(e) => setRol(e.target.value)}
              >
                <option value="ASSISTANT">Asistente — agenda, pacientes, caja</option>
                <option value="DENTIST">Odontólogo — su agenda y sus liquidaciones</option>
                <option value="SUPER_ADMIN">Administrador — acceso total</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">WhatsApp</span>
              <input
                className="input"
                name="phoneE164"
                maxLength={20}
                placeholder="+584141234567"
                defaultValue={editando?.phoneE164 ?? ''}
              />
              <span className="field__hint">
                Opcional. Con él, el bot sabe que quien escribe es del equipo y no un
                paciente.
              </span>
            </label>

            <label className="field">
              <span className="field__label">Fecha de nacimiento</span>
              <input
                className="input"
                name="birthDate"
                type="date"
                defaultValue={
                  editando?.birthDate
                    ? new Date(editando.birthDate).toISOString().slice(0, 10)
                    : ''
                }
              />
              <span className="field__hint">Opcional. Sale en los cumpleaños de Inicio.</span>
            </label>

            {!editando && rol === 'DENTIST' && dentistsSinCuenta.length > 0 && (
              <label className="field">
                <span className="field__label">Enlazar con una ficha existente</span>
                <select className="input" name="dentistId" defaultValue="">
                  <option value="">No enlazar</option>
                  {dentistsSinCuenta.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <span className="field__hint">
                  Si ya tiene ficha de odontóloga, enlázala: así ve su agenda y sus
                  liquidaciones desde el primer día.
                </span>
              </label>
            )}

            <div className="row form-grid--full" style={{ gap: '0.5rem' }}>
              <button type="submit" className="btn btn--primary" disabled={isPending}>
                {isPending ? 'Guardando…' : editando ? 'Guardar' : 'Crear y enviar la clave'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setAbierto(false)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
