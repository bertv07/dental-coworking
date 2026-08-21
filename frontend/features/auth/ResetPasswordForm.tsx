'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { redeemPasswordResetAction } from '@/app/actions/account.actions';
import { TextField } from '@/frontend/components/ui/form';
import { Notice } from '@/frontend/components/ui/primitives';

/**
 * Poner la contraseña nueva con el token del correo.
 *
 * El token viaja en un campo oculto, tal cual llegó en la URL. No se valida
 * en el cliente: lo comprueba el servidor al canjearlo, y allí «no existe»,
 * «caducado» y «ya usado» dan exactamente el mismo mensaje — distinguirlos
 * permitiría sondear tokens.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(
    null,
  );

  function submit(formData: FormData) {
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const result = await redeemPasswordResetAction(Object.fromEntries(formData.entries()));
      if (result.ok) {
        setDone(true);
        return;
      }
      if (result.field) {
        setFieldError({ field: result.field, message: result.error ?? 'Valor inválido' });
        return;
      }
      setError(result.error ?? 'No se pudo cambiar la contraseña');
    });
  }

  const errorFor = (field: string) =>
    fieldError?.field === field ? fieldError.message : undefined;

  // Enlace sin token: no tiene sentido enseñar el formulario.
  if (!token) {
    return (
      <Notice tone="danger">
        Este enlace está incompleto. Pide uno nuevo desde{' '}
        <Link href="/recuperar">recuperar contraseña</Link>.
      </Notice>
    );
  }

  if (done) {
    return (
      <Notice tone="info">
        Listo, tu contraseña quedó cambiada. Ya puedes{' '}
        <Link href="/login">iniciar sesión</Link> con la nueva.
        <br />
        <br />
        Se cerraron todas las sesiones que hubiera abiertas con la anterior.
      </Notice>
    );
  }

  return (
    <form action={submit} className="form-grid">
      {error && (
        <div className="form-grid--full">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <input type="hidden" name="token" value={token} />

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
        label="Repite la contraseña"
        name="confirmPassword"
        type="password"
        required
        full
        error={errorFor('confirmPassword')}
      />

      <div className="form-grid--full">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={isPending}
          style={{ width: '100%' }}
        >
          {isPending ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </div>
    </form>
  );
}
