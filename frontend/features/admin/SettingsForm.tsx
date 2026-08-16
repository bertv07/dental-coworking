'use client';

import { useState, useTransition } from 'react';
import { updateClinicSettingsAction } from '@/app/actions/admin.actions';
import { Card, Notice } from '@/frontend/components/ui/primitives';
import {
  TextField,
  SelectField,
} from '@/frontend/components/ui/form';

/**
 * Ajustes de la clínica, editables.
 *
 * Sólo contiene decisiones de NEGOCIO: identidad fiscal, comisión por
 * defecto, jornada y moneda. Lo que antes ocupaba media pantalla —claves de
 * n8n, estado del hasheo, origen de datos— era información de
 * infraestructura y no pinta nada aquí: el administrador de la clínica no
 * puede hacer nada con ella, y mostrarla sólo servía para confundir.
 */

interface SettingsFormProps {
  settings: {
    clinicName: string;
    taxId: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    defaultCommissionPercent: number;
    openingMinute: number;
    closingMinute: number;
    slotMinutes: number;
    displayCurrency: string;
    preferredRateSource: string;
  };
}

/** Minutos desde medianoche → "HH:MM" para el input `type="time"`. */
function toTimeValue(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function SettingsForm({ settings }: SettingsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  function onSubmit(formData: FormData) {
    setResult(null);
    setFieldError(null);

    startTransition(async () => {
      const response = await updateClinicSettingsAction(Object.fromEntries(formData.entries()));

      if (response.ok) {
        setResult({ ok: true, text: 'Ajustes guardados correctamente.' });
        return;
      }
      if (response.field) {
        setFieldError({ field: response.field, message: response.error ?? 'Valor inválido' });
      }
      setResult({ ok: false, text: response.error ?? 'No se pudieron guardar los ajustes.' });
    });
  }

  const errorFor = (field: string) =>
    fieldError?.field === field ? fieldError.message : undefined;

  return (
    <form action={onSubmit} className="stack">
      {result && (
        <Notice tone={result.ok ? 'info' : 'danger'}>{result.text}</Notice>
      )}

      <Card
        title="Identidad de la clínica"
        subtitle="Aparece en informes exportados y comprobantes"
      >
        <div className="form-grid">
          <TextField
            label="Nombre de la clínica"
            name="clinicName"
            required
            defaultValue={settings.clinicName}
            error={errorFor('clinicName')}
          />
          <TextField
            label="RIF"
            name="taxId"
            placeholder="J-40123456-7"
            defaultValue={settings.taxId ?? ''}
            error={errorFor('taxId')}
          />
          <TextField
            label="Teléfono"
            name="phone"
            defaultValue={settings.phone ?? ''}
            error={errorFor('phone')}
          />
          <TextField
            label="Correo de contacto"
            name="email"
            type="email"
            defaultValue={settings.email ?? ''}
            error={errorFor('email')}
          />
          <TextField
            label="Dirección"
            name="address"
            full
            defaultValue={settings.address ?? ''}
            error={errorFor('address')}
          />
        </div>
      </Card>

      <Card
        title="Reglas de negocio"
        subtitle="Comisión, jornada y granularidad de la agenda"
      >
        <div className="form-grid">
          <TextField
            label="Comisión de la clínica (%)"
            name="defaultCommissionPercent"
            type="number"
            required
            min={0}
            max={100}
            hint={`El odontólogo recibe el ${100 - settings.defaultCommissionPercent}% restante. Se aplica a los nuevos; los existentes conservan la suya.`}
            defaultValue={settings.defaultCommissionPercent}
            error={errorFor('defaultCommissionPercent')}
          />
          <TextField
            label="Hora de apertura"
            name="openingTime"
            type="time"
            required
            defaultValue={toTimeValue(settings.openingMinute)}
            error={errorFor('openingTime')}
          />
          <TextField
            label="Hora de cierre"
            name="closingTime"
            type="time"
            required
            defaultValue={toTimeValue(settings.closingMinute)}
            error={errorFor('closingTime')}
          />
          <SelectField
            label="Granularidad de la agenda"
            name="slotMinutes"
            defaultValue={String(settings.slotMinutes)}
            hint="Cada cuántos minutos puede empezar una cita"
            options={[
              { value: '15', label: '15 minutos' },
              { value: '20', label: '20 minutos' },
              { value: '30', label: '30 minutos' },
              { value: '60', label: '1 hora' },
            ]}
            error={errorFor('slotMinutes')}
          />
        </div>
      </Card>

      <Card
        title="Moneda"
        subtitle="Los precios se almacenan en dólares y se convierten a bolívares"
      >
        <div className="form-grid">
          <SelectField
            label="Moneda principal de visualización"
            name="displayCurrency"
            defaultValue={settings.displayCurrency}
            hint="En qué moneda se destacan los importes del panel"
            options={[
              { value: 'USD', label: 'Dólares (USD)' },
              { value: 'VES', label: 'Bolívares (Bs)' },
            ]}
          />
          <SelectField
            label="Fuente de la tasa"
            name="preferredRateSource"
            defaultValue={settings.preferredRateSource}
            hint="Con cuál se convierte a bolívares al cobrar"
            options={[
              { value: 'BCV', label: 'BCV (oficial)' },
              { value: 'PARALELO', label: 'Paralelo' },
            ]}
          />
        </div>

        <Notice tone="info">
          Cambiar la fuente de tasa NO altera los cobros ya registrados: cada pago guarda la
          tasa que se le aplicó.
        </Notice>
      </Card>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn--primary" disabled={isPending}>
          {isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
