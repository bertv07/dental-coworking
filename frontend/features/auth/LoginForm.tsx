'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { loginAction, type LoginState } from '@/app/actions/auth.actions';

/**
 * Formulario de acceso.
 *
 * Usa `useActionState` con una Server Action en lugar de `fetch`. Ventajas
 * concretas frente al enfoque manual:
 *
 *  · Protección CSRF automática (validación de Origin por parte de Next.js).
 *  · Funciona SIN JavaScript: es un <form> real con `action`. Si el bundle
 *    no carga, el login sigue operativo.
 *  · La contraseña nunca pasa por el estado de React — va directa al
 *    servidor en el FormData.
 */

/** Botón separado para poder usar `useFormStatus`, que sólo lee del <form> padre. */
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="btn btn--primary" disabled={pending} style={{ width: '100%' }}>
      {pending ? 'Verificando…' : 'Ingresar'}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="stack">
      <div>
        <label htmlFor="email" className="text-xs subtle" style={{ display: 'block', marginBottom: '0.25rem' }}>
          Correo electrónico
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          // `maxLength` en el cliente es sólo comodidad. La cota real la
          // aplica Zod en el servidor — el atributo HTML se puede quitar
          // desde las herramientas de desarrollo en dos clics.
          maxLength={255}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
          }}
        />
      </div>

      <div>
        <label htmlFor="password" className="text-xs subtle" style={{ display: 'block', marginBottom: '0.25rem' }}>
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          maxLength={128}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
          }}
        />
      </div>

      {/*
        Mensaje de error genérico: nunca revela si el fallo fue por el correo
        o por la contraseña. Distinguirlos permitiría enumerar qué cuentas
        existen en el sistema.
        `role="alert"` hace que el lector de pantalla lo anuncie al aparecer.
      */}
      {state.error && (
        <div className="notice notice--warning" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{state.error}</span>
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
