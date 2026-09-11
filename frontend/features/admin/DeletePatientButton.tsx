'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePatientPermanentlyAction } from '@/app/actions/admin.actions';
import { Card, Notice } from '@/frontend/components/ui/primitives';

/**
 * Borra un paciente de PRUEBA de verdad — citas, facturas y cobros
 * desaparecen, y el teléfono y la cédula quedan libres para reusarse. Sólo
 * la ve Super Admin, y pide escribir el nombre completo para confirmar: no
 * basta un "aceptar" para algo que no tiene vuelta atrás.
 */
export function DeletePatientButton({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [escrito, setEscrito] = useState('');
  // Se activa cuando el borrado choca con una liquidación de odontólogo ya
  // hecha con alguno de los cobros de este paciente.
  const [puedeForzar, setPuedeForzar] = useState(false);

  const habilitado = escrito.trim() === patientName.trim();

  function intentar(force: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await deletePatientPermanentlyAction(patientId, force);
      if (!result.ok) {
        setError(result.error ?? 'No se pudo borrar el paciente');
        setPuedeForzar(result.field === 'PAID_OUT');
        return;
      }
      router.push('/pacientes');
    });
  }

  return (
    <Card title="Zona de peligro" subtitle="Sólo para pacientes de prueba">
      {error && <Notice tone="danger">{error}</Notice>}
      <Notice tone="warning">
        Esto borra a <strong>{patientName}</strong> PARA SIEMPRE: sus citas, facturas y cobros
        desaparecen (no quedan anuladas, desaparecen). El expediente escaneado y las
        conversaciones de WhatsApp no se borran — se archivan, igual que si se borraran uno a
        uno, porque esos dos nunca se destruyen del todo. No sirve para pacientes reales: para
        eso está «Eliminar» en la lista de pacientes, que sí se puede deshacer.
      </Notice>
      <div className="field" style={{ marginTop: '0.75rem' }}>
        <label className="field__label" htmlFor="confirmar-nombre">
          Escribe «{patientName}» para confirmar
        </label>
        <input
          id="confirmar-nombre"
          className="input"
          value={escrito}
          onChange={(e) => setEscrito(e.target.value)}
          placeholder={patientName}
        />
      </div>
      <button
        type="button"
        className="btn btn--danger"
        style={{ marginTop: '0.75rem' }}
        disabled={!habilitado || isPending}
        onClick={() => {
          setPuedeForzar(false);
          intentar(false);
        }}
      >
        {isPending ? 'Borrando…' : 'Borrar paciente definitivamente'}
      </button>

      {puedeForzar && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ marginTop: '0.5rem', marginLeft: '0.5rem', color: 'var(--color-danger)' }}
          disabled={isPending}
          onClick={() => {
            if (
              !window.confirm(
                'Esto AJUSTA la(s) liquidación(es) diaria(s) del odontólogo que ya incluían cobros de este paciente ' +
                  '— les resta su parte, o las borra enteras si no les quedaba nada más. Úsalo sólo si esas ' +
                  'liquidaciones también eran de prueba. ¿Forzar?',
              )
            ) {
              return;
            }
            intentar(true);
          }}
        >
          Forzar (ajusta la liquidación)
        </button>
      )}
    </Card>
  );
}
