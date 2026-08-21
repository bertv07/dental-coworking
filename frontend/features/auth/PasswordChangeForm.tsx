'use client';

import { useState, useTransition } from 'react';
import { changePasswordAction } from '@/app/actions/account.actions';
import { TextField } from '@/frontend/components/ui/form';
import { Notice } from '@/frontend/components/ui/primitives';

/**
 * Formulario de cambio de contraseña.
 *
 * No hay estado de «guardado con éxito»: al terminar, el servidor cierra la
 * sesión y manda al login. Es deliberado —el cambio invalida este mismo
 * token— y además es la única confirmación que vale: si la contraseña nueva
 * entra, quedó puesta.
 */
export function PasswordChangeForm({ isForced }: { isForced: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(
    null,
  );

  function submit(formData: FormData) {
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const result = await changePasswordAction(Object.fromEntries(formData.entries()));
      // Si todo va bien no se vuelve de aquí: la acción redirige al login.
      if (result?.ok === false) {
        if (result.field) {
          setFieldError({ field: result.field, message: result.error ?? 'Valor inválido' });
          return;
        }
        setError(result.error ?? 'No se pudo cambiar la contraseña');
      }
    });
  }

  const errorFor = (field: string) =>
    fieldError?.field === field ? fieldError.message : undefined;

  return (
    <form action={submit} className="form-grid">
      {error && (
        <div className="form-grid--full">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      {isForced && (
        <div className="form-grid--full">
          <Notice tone="warning">
            Entraste con una contraseña temporal que se te envió por correo. Como esa
            clave viajó por email, tienes que cambiarla antes de seguir.
          </Notice>
        </div>
      )}

      <TextField
        label="Contraseña actual"
        name="currentPassword"
        type="password"
        required
        full
        error={errorFor('currentPassword')}
      />

      <TextField
        label="Contraseña nueva"
        name="newPassword"
        type="password"
        required
        full
        hint="Mínimo 6 caracteres. Cuantos más, mejor: una palabra corta se adivina."
        error={errorFor('newPassword')}
      />

      <TextField
        label="Repite la contraseña nueva"
        name="confirmPassword"
        type="password"
        required
        full
        error={errorFor('confirmPassword')}
      />

      <div className="form-grid--full">
        <Notice tone="info">
          Al cambiarla se cierran todas las sesiones, también la de este navegador.
          Tendrás que entrar otra vez con la contraseña nueva.
        </Notice>
      </div>

      <div className="form-grid--full">
        <button type="submit" className="btn btn--primary" disabled={isPending}>
          {isPending ? 'Cambiando…' : 'Cambiar contraseña'}
        </button>
      </div>
    </form>
  );
}
