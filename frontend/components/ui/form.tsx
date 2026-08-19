'use client';

import { useState, useTransition, type ReactNode } from 'react';
import type { ActionResult } from '@/app/actions/admin.actions';

/**
 * ===========================================================================
 *  Primitivas de formulario + lógica compartida de CRUD
 * ===========================================================================
 *  Las cuatro secciones administrativas (pacientes, odontólogos, precios y
 *  consultorios) hacen exactamente lo mismo: abrir un modal, enviar, mostrar
 *  el error del campo que falló, cerrar y refrescar.
 *
 *  Todo eso vive aquí una sola vez. Cada sección aporta únicamente sus
 *  campos, que es lo que realmente cambia entre ellas.
 * ===========================================================================
 */

// --- Campos -----------------------------------------------------------------

interface FieldProps {
  label: string;
  name: string;
  hint?: string;
  /** Mensaje de error del servidor para ESTE campo. */
  error?: string;
  required?: boolean;
  full?: boolean;
  children?: ReactNode;
}

function FieldShell({ label, name, hint, error, required, full, children }: FieldProps) {
  return (
    <div className={`field ${full ? 'form-grid--full' : ''}`}>
      <label className="field__label" htmlFor={name}>
        {label}
        {required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
      </label>
      {children}
      {/* El error del servidor tiene prioridad sobre la pista. */}
      {error ? (
        <span className="field__error">{error}</span>
      ) : (
        hint && <span className="field__hint">{hint}</span>
      )}
    </div>
  );
}

export function TextField({
  label,
  name,
  hint,
  error,
  required,
  full,
  type = 'text',
  defaultValue,
  placeholder,
  suggestions,
  ...rest
}: FieldProps & {
  type?: string;
  defaultValue?: string | number;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Valores sugeridos, sin cerrar el campo.
   *
   * Se usa para las especialidades: son texto libre a propósito —mañana
   * aparece una nueva— pero sin sugerencias acaban conviviendo «CIRUGÍA
   * ORAL», «Cirugia oral» y «cirujano» como si fueran cosas distintas, y el
   * bot no encuentra al especialista que le piden.
   */
  suggestions?: string[];
  /** Permite reaccionar al tecleo (ej: convertir a bolívares en vivo). */
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}) {
  const listId = suggestions && suggestions.length > 0 ? `${name}-sugerencias` : undefined;

  return (
    <FieldShell {...{ label, name, hint, error, required, full }}>
      <input
        id={name}
        name={name}
        type={type}
        className="input"
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        list={listId}
        // Señala el campo inválido a los lectores de pantalla, no sólo con color.
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions?.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  name,
  hint,
  error,
  full = true,
  defaultValue,
  placeholder,
}: FieldProps & { defaultValue?: string; placeholder?: string }) {
  return (
    <FieldShell {...{ label, name, hint, error, full }}>
      <textarea
        id={name}
        name={name}
        className="textarea"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-invalid={error ? 'true' : undefined}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  name,
  hint,
  error,
  required,
  full,
  defaultValue,
  options,
  onChange,
}: FieldProps & {
  defaultValue?: string;
  options: Array<{ value: string; label: string }>;
  /**
   * Permite reaccionar a la elección sin controlar el campo, igual que en
   * `TextField`: el formulario sigue enviándose por `FormData` y esto sólo
   * alimenta la previsualización (ej: avisar de que un tratamiento no tiene
   * precio cerrado en cuanto se elige).
   */
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
}) {
  return (
    <FieldShell {...{ label, name, hint, error, required, full }}>
      <select
        id={name}
        name={name}
        className="select"
        defaultValue={defaultValue}
        onChange={onChange}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/**
 * Casilla de verificación.
 *
 * Detalle importante: se acompaña de un input oculto con valor "false". Un
 * checkbox desmarcado NO se envía en el FormData, así que sin este truco el
 * servidor no podría distinguir "desmarcado" de "campo ausente" — y
 * `z.coerce.boolean()` interpretaría la ausencia como `undefined`.
 */
export function CheckboxField({
  label,
  name,
  hint,
  defaultChecked,
}: {
  label: string;
  name: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <div className="field form-grid--full">
      <label className="row" style={{ cursor: 'pointer', gap: '0.5rem' }}>
        <input type="hidden" name={name} value="" />
        <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} />
        <span className="text-sm" style={{ fontWeight: 500 }}>
          {label}
        </span>
      </label>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

// --- Hook de CRUD ------------------------------------------------------------

export type CrudMode<T> = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; item: T };

export interface CrudController<T> {
  mode: CrudMode<T>;
  openCreate: () => void;
  openEdit: (item: T) => void;
  close: () => void;
  isPending: boolean;
  /** Error general del formulario (no ligado a un campo concreto). */
  formError: string | null;
  /** Error por campo, para resaltar el input que falló. */
  fieldError: string | null;
  fieldName: string | null;
  /**
   * Aviso de una operación que SÍ salió bien.
   *
   * Sobrevive al cierre del modal a propósito: describe algo que pasó después
   * de guardar —el alta se hizo, el correo no salió— y si se limpiara junto
   * con los errores, quien lo hizo no llegaría a leerlo nunca.
   */
  warning: string | null;
  /** Descarta el aviso una vez leído. */
  dismissWarning: () => void;
  /** Envía el formulario invocando la Server Action correspondiente. */
  submit: (formData: FormData) => void;
  /** Elimina un registro, pidiendo confirmación primero. */
  remove: (item: T, label: string) => void;
}

/**
 * Concentra el ciclo completo de un CRUD: abrir, enviar, mostrar error,
 * cerrar. Cada sección le pasa sus tres acciones y se despreocupa.
 */
export function useCrud<T extends { id: string }>(actions: {
  create: (input: unknown) => Promise<ActionResult>;
  update: (id: string, input: unknown) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
}): CrudController<T> {
  const [mode, setMode] = useState<CrudMode<T>>({ kind: 'closed' });
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [fieldName, setFieldName] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  function clearErrors() {
    setFormError(null);
    setFieldError(null);
    setFieldName(null);
  }

  function applyResult(result: ActionResult) {
    if (result.ok) {
      setMode({ kind: 'closed' });
      clearErrors();
      // El aviso se guarda DESPUÉS de limpiar: no es un error del formulario
      // y tiene que seguir visible con el modal ya cerrado.
      setWarning(result.warning ?? null);
      return;
    }
    // Si el servidor señaló un campo, el error se muestra junto a él; si no,
    // como aviso general en la cabecera del modal.
    if (result.field) {
      setFieldName(result.field);
      setFieldError(result.error ?? 'Valor inválido');
      setFormError(null);
    } else {
      setFormError(result.error ?? 'No se pudo guardar');
      setFieldError(null);
      setFieldName(null);
    }
  }

  return {
    mode,
    isPending,
    formError,
    fieldError,
    fieldName,
    warning,
    dismissWarning: () => setWarning(null),

    openCreate() {
      clearErrors();
      setMode({ kind: 'create' });
    },
    openEdit(item) {
      clearErrors();
      setMode({ kind: 'edit', item });
    },
    close() {
      clearErrors();
      setMode({ kind: 'closed' });
    },

    submit(formData) {
      clearErrors();
      // `Object.fromEntries` colapsa claves repetidas quedándose con la
      // última. Es justo lo que se necesita para el par
      // hidden("") + checkbox("true") de `CheckboxField`.
      const payload = Object.fromEntries(formData.entries());

      startTransition(async () => {
        const result =
          mode.kind === 'edit'
            ? await actions.update(mode.item.id, payload)
            : await actions.create(payload);
        applyResult(result);
      });
    },

    remove(item, label) {
      // Confirmación explícita: borrar es destructivo aunque sea lógico.
      if (!window.confirm(`¿Eliminar "${label}"?\n\nEsta acción se puede auditar.`)) {
        return;
      }
      startTransition(async () => {
        const result = await actions.remove(item.id);
        if (!result.ok) window.alert(result.error ?? 'No se pudo eliminar');
      });
    },
  };
}

/** Pie de modal estándar: cancelar + guardar con estado de carga. */
export function FormFooter({
  onCancel,
  isPending,
  submitLabel = 'Guardar',
  formId = 'crud-form',
}: {
  onCancel: () => void;
  isPending: boolean;
  submitLabel?: string;
  /**
   * Id del `<form>` que envía este botón.
   *
   * El botón vive en el pie del modal, FUERA del formulario, así que se
   * enlaza por `form=`. Por defecto es `crud-form`, que es el que usan los
   * CRUD; hay que darlo cuando una pantalla tiene más de un formulario —si
   * dos compartieran id, el botón enviaría el que encontrara primero.
   */
  formId?: string;
}) {
  return (
    <>
      <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={isPending}>
        Cancelar
      </button>
      <button type="submit" form={formId} className="btn btn--primary" disabled={isPending}>
        {isPending ? 'Guardando…' : submitLabel}
      </button>
    </>
  );
}
