import { notFound } from 'next/navigation';
import { requireRole } from '@/backend/auth/guards';
import { prisma } from '@/backend/db/client';
import { cuidSchema } from '@/backend/validators/common';
import {
  Odontogram,
  Renglones,
  type OdontogramaDatos,
} from '@/frontend/features/clinical/Odontogram';
import { PrintButton } from '@/frontend/features/clinical/PrintButton';

/**
 * ===========================================================================
 *  /pacientes/[id]/expediente — Expediente clínico imprimible
 * ===========================================================================
 *  ACCESO: asistente o superior. Es quien transcribe el papel al sistema.
 *
 *  ---------------------------------------------------------------------
 *  UNA SOLA PÁGINA PARA LOS DOS PASOS DEL PROCESO
 *  ---------------------------------------------------------------------
 *  El flujo de la clínica es:
 *
 *    1. Se imprime el expediente EN BLANCO  →  ?blanco=1
 *    2. El odontólogo lo rellena a mano en la consulta
 *    3. La asistente lo transcribe al sistema
 *    4. Se imprime la copia ya transcrita     →  sin parámetro
 *
 *  Los pasos 1 y 4 son la MISMA página. Si fueran dos plantillas distintas
 *  acabarían divergiendo, y el odontólogo marcaría a mano una casilla que
 *  luego no existe en el formulario de transcripción.
 *
 *  Lo único que cambia es de dónde salen los datos: en blanco se pintan
 *  renglones vacíos; transcrito, lo que hay en la base.
 *
 *  ---------------------------------------------------------------------
 *  POR QUÉ NO GENERA UN PDF EN EL SERVIDOR
 *  ---------------------------------------------------------------------
 *  Porque no hace falta. El navegador ya sabe imprimir y guardar como PDF, y
 *  una librería de PDF en el servidor significa otra dependencia, otro juego
 *  de fuentes y un renderizado distinto al de la pantalla. Con `@media print`
 *  lo que se ve es exactamente lo que sale por la impresora.
 * ===========================================================================
 */

export const metadata = { title: 'Expediente clínico' };
export const dynamic = 'force-dynamic';

export default async function ExpedientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ blanco?: string }>;
}) {
  await requireRole('ASSISTANT');

  const { id } = await params;
  // El id viene de la URL: es entrada del usuario y se valida la forma antes
  // de tocar la base.
  const validation = cuidSchema.safeParse(id);
  if (!validation.success) notFound();

  const enBlanco = (await searchParams).blanco === '1';

  const [paciente, ajustes] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: validation.data, deletedAt: null },
      select: {
        id: true, fullName: true, phoneE164: true, documentId: true, birthDate: true,
        clinicalRecord: {
          select: {
            hypertension: true, diabetes: true, heartDisease: true,
            anticoagulants: true, pregnant: true,
            allergies: true, currentMedications: true, medicalNotes: true,
            chiefComplaint: true, odontogram: true, treatmentPlan: true,
            updatedAt: true,
            entries: {
              orderBy: { performedOn: 'desc' },
              take: 20,
              select: {
                id: true, performedOn: true, procedure: true, teeth: true, notes: true,
                dentist: { select: { fullName: true } },
              },
            },
          },
        },
      },
    }),
    prisma.clinicSettings.findUnique({ where: { id: 'singleton' } }),
  ]);

  if (!paciente) notFound();

  // En blanco se ignora deliberadamente lo que haya en la base: el papel sale
  // vacío aunque el paciente ya tenga expediente, porque puede ser para una
  // consulta nueva.
  const ficha = enBlanco ? null : paciente.clinicalRecord;
  const odontograma = (ficha?.odontogram ?? null) as OdontogramaDatos | null;

  const fecha = new Intl.DateTimeFormat('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Caracas',
  });

  const edad = paciente.birthDate
    ? Math.floor((Date.now() - paciente.birthDate.getTime()) / 31_557_600_000)
    : null;

  /** Casilla de antecedente: marcada o vacía para marcar a mano. */
  const casilla = (marcado: boolean | undefined, etiqueta: string) => (
    <span className="exp__check">
      <i className={marcado ? 'exp__box exp__box--on' : 'exp__box'}>{marcado ? '✕' : ''}</i>
      {etiqueta}
    </span>
  );

  return (
    <div className="page-body expediente-body">
      {/* Barra de acciones: no se imprime. */}
      <div className="exp__acciones no-print">
        <a href={`/pacientes/${paciente.id}/expediente${enBlanco ? '' : '?blanco=1'}`} className="btn btn--ghost">
          {enBlanco ? 'Ver el transcrito' : 'Imprimir en blanco'}
        </a>
        <a href="/pacientes" className="btn btn--ghost">Volver a pacientes</a>
        <PrintButton />
      </div>

      <article className="exp">
        <header className="exp__cabecera">
          <div>
            <h1 className="exp__titulo">Expediente clínico</h1>
            <p className="exp__clinica">{ajustes?.clinicName ?? 'Dental Coworking'}</p>
          </div>
          <div className="exp__fecha">
            <span>Fecha</span>
            <strong>{enBlanco ? '____ / ____ / ______' : fecha.format(ficha?.updatedAt ?? new Date())}</strong>
          </div>
        </header>

        {/* --- Identificación --- */}
        <section className="exp__seccion">
          <div className="exp__campos">
            <div className="exp__campo exp__campo--ancho">
              <span>Paciente</span><strong>{paciente.fullName}</strong>
            </div>
            <div className="exp__campo">
              <span>Cédula</span><strong>{paciente.documentId ?? '________________'}</strong>
            </div>
            <div className="exp__campo">
              <span>Edad</span><strong>{edad !== null ? `${edad} años` : '______'}</strong>
            </div>
            <div className="exp__campo">
              <span>Teléfono</span><strong>{paciente.phoneE164}</strong>
            </div>
          </div>
        </section>

        {/* --- Antecedentes --- */}
        <section className="exp__seccion">
          <h2 className="exp__h2">Antecedentes médicos</h2>
          <div className="exp__checks">
            {casilla(ficha?.hypertension, 'Hipertensión')}
            {casilla(ficha?.diabetes, 'Diabetes')}
            {casilla(ficha?.heartDisease, 'Cardiopatía')}
            {casilla(ficha?.anticoagulants, 'Anticoagulantes')}
            {casilla(ficha?.pregnant, 'Embarazo')}
          </div>

          <div className="exp__campo exp__campo--bloque">
            <span>Alergias</span>
            <Renglones cantidad={1}>{ficha?.allergies}</Renglones>
          </div>
          <div className="exp__campo exp__campo--bloque">
            <span>Medicamentos que toma</span>
            <Renglones cantidad={1}>{ficha?.currentMedications}</Renglones>
          </div>
          <div className="exp__campo exp__campo--bloque">
            <span>Otros antecedentes</span>
            <Renglones cantidad={2}>{ficha?.medicalNotes}</Renglones>
          </div>
        </section>

        {/* --- Motivo --- */}
        <section className="exp__seccion">
          <h2 className="exp__h2">Motivo de consulta</h2>
          <Renglones cantidad={2}>{ficha?.chiefComplaint}</Renglones>
        </section>

        {/* --- Odontograma --- */}
        <section className="exp__seccion exp__seccion--odonto">
          <h2 className="exp__h2">Odontograma</h2>
          <Odontogram datos={odontograma} />
        </section>

        {/* --- Plan --- */}
        <section className="exp__seccion">
          <h2 className="exp__h2">Plan de tratamiento</h2>
          <Renglones cantidad={3}>{ficha?.treatmentPlan}</Renglones>
        </section>

        {/* --- Evolución --- */}
        <section className="exp__seccion">
          <h2 className="exp__h2">Evolución</h2>
          <table className="exp__tabla">
            <thead>
              <tr>
                <th style={{ width: '15%' }}>Fecha</th>
                <th style={{ width: '42%' }}>Procedimiento</th>
                <th style={{ width: '13%' }}>Piezas</th>
                <th style={{ width: '30%' }}>Odontólogo / firma</th>
              </tr>
            </thead>
            <tbody>
              {ficha && ficha.entries.length > 0
                ? ficha.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="mono">{fecha.format(e.performedOn)}</td>
                      <td>
                        {e.procedure}
                        {e.notes && <div className="exp__nota">{e.notes}</div>}
                      </td>
                      <td className="mono">{e.teeth.join(', ')}</td>
                      <td>{e.dentist?.fullName ?? ''}</td>
                    </tr>
                  ))
                : // En blanco: renglones para escribir a mano. Doce caben en
                  // una hoja sin obligar a una segunda página.
                  Array.from({ length: 12 }, (_, i) => (
                    <tr key={i}><td>&nbsp;</td><td /><td /><td /></tr>
                  ))}
            </tbody>
          </table>
        </section>

        <footer className="exp__pie">
          <div className="exp__firma">
            <span />
            <small>Firma y sello del odontólogo</small>
          </div>
          <div className="exp__firma">
            <span />
            <small>Firma del paciente</small>
          </div>
        </footer>
      </article>
    </div>
  );
}
