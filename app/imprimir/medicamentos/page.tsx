import { notFound } from 'next/navigation';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { env } from '@/backend/config/env';
import { PrintOnLoad } from '@/frontend/features/admin/PrintOnLoad';

/**
 * ===========================================================================
 *  /imprimir/medicamentos?ids=… — la hoja que se lleva el paciente
 * ===========================================================================
 *  Fuera del grupo (admin) a propósito: sin menú lateral ni barra superior.
 *
 *  Los ids van en la URL y no en el cuerpo porque esto se abre en una pestaña
 *  nueva desde un `window.open`, y porque así recepción puede volver a
 *  imprimir la misma hoja recargando, sin rehacer la selección.
 *
 *  Lleva un espacio para escribir a mano: la pauta de un caso concreto casi
 *  siempre difiere en algo de la habitual, y sin ese hueco se acaba tachando
 *  encima de lo impreso.
 * ===========================================================================
 */

export const metadata = { title: 'Indicaciones' };
export const dynamic = 'force-dynamic';

export default async function ImprimirMedicamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  await requireRole('ASSISTANT');

  const { ids } = await searchParams;
  const lista = (ids ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (lista.length === 0) notFound();

  const [medicamentos, ajustes] = await Promise.all([
    repository.listMedicationsByIds(lista),
    repository.getClinicSettings(),
  ]);

  if (medicamentos.length === 0) notFound();

  const fecha = new Intl.DateTimeFormat('es-VE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: env.CLINIC_TIMEZONE,
  }).format(new Date());

  return (
    <main className="print-sheet">
      <PrintOnLoad />

      <header className="print-sheet__head">
        <div>
          <h1 className="print-sheet__clinic">{ajustes.clinicName}</h1>
          {ajustes.address && <p className="print-sheet__meta">{ajustes.address}</p>}
          {ajustes.phone && <p className="print-sheet__meta">{ajustes.phone}</p>}
        </div>
        <div className="print-sheet__number">
          <div className="print-sheet__number-label">Indicaciones</div>
          <div className="print-sheet__meta">{fecha}</div>
        </div>
      </header>

      <section className="print-sheet__party">
        <div style={{ flex: 1 }}>
          <span className="print-sheet__label">Paciente</span>
          {/* En blanco a propósito: lo escribe recepción al entregarla. */}
          <div style={{ borderBottom: '0.5pt solid #999', height: '6mm' }} />
        </div>
      </section>

      <table className="print-sheet__table">
        <thead>
          <tr>
            <th>Medicamento</th>
            <th>Indicación</th>
          </tr>
        </thead>
        <tbody>
          {medicamentos.map((m) => (
            <tr key={m.id}>
              <td>
                <strong>{m.name}</strong>
                {m.presentation && <div className="print-sheet__note">{m.presentation}</div>}
              </td>
              <td>{m.posology ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section style={{ marginTop: '6mm' }}>
        <span className="print-sheet__label">Observaciones</span>
        <div style={{ borderBottom: '0.5pt solid #ccc', height: '7mm' }} />
        <div style={{ borderBottom: '0.5pt solid #ccc', height: '7mm' }} />
      </section>

      <footer className="print-sheet__foot">
        Indicaciones entregadas por la clínica. No sustituye a la receta médica
        firmada por su odontólogo.
      </footer>
    </main>
  );
}
