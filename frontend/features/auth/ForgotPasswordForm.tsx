'use client';

import { useState, useTransition } from 'react';
import { requestPasswordResetAction } from '@/app/actions/account.actions';
import { TextField } from '@/frontend/components/ui/form';
import { Notice } from '@/frontend/components/ui/primitives';

/**
 * Pedir un enlace de recuperación.
 *
 * ⚠️  El mensaje de éxito es SIEMPRE el mismo, exista la cuenta o no. Si
 *  dijera «ese correo no está registrado», esta pantalla se convertiría en una
 *  forma de averiguar qué correos tienen cuenta en la clínica. La respuesta
 *  uniforme es la funcionalidad, no un descuido.
 */
export function ForgotPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await requestPasswordResetAction(Object.fromEntries(formData.entries()));
      if (result.ok) {
        setSent(true);
        return;
      }
      setError(result.error ?? 'No se pudo procesar la solicitud');
    });
  }

  if (sent) {
    return (
      <Notice tone="info">
        Si ese correo tiene una cuenta, le acabamos de enviar un enlace para poner una
        contraseña nueva. <strong>Caduca en una hora</strong> y sólo se puede usar una vez.
        <br />
        <br />
        Revisa también la carpeta de spam.
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

      <TextField
        label="Tu correo"
        name="email"
        type="email"
        required
        full
        placeholder="nombre@dentalcoworking.com.ve"
      />

      <div className="form-grid--full">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={isPending}
          style={{ width: '100%' }}
        >
          {isPending ? 'Enviando…' : 'Enviarme el enlace'}
        </button>
      </div>
    </form>
  );
}
