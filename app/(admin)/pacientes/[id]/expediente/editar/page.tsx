import { notFound } from 'next/navigation';
import { requireRole } from '@/backend/auth/guards';
import { prisma } from '@/backend/db/client';
import { cuidSchema } from '@/backend/validators/common';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { RecordForm } from '@/frontend/features/clinical/RecordForm';
import type { OdontogramaDatos } from '@/frontend/features/clinical/Odontogram';

/**
 * /pacientes/[id]/expediente/editar — transcripción del expediente.
 *
 * ACCESO: asistente o superior. El odontólogo rellena el PAPEL; recepción lo
 * pasa al sistema. Una sola vía de entrada evita acabar con dos versiones del
 * mismo expediente que no coinciden.
 */

export const metadata = { title: 'Transcribir expediente' };
export const dynamic = 'force-dynamic';

export default async function EditarExpedientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('ASSISTANT');

  const { id } = await params;
  const validation = cuidSchema.safeParse(id);
  if (!validation.success) notFound();

  const [paciente, dentistas] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: validation.data, deletedAt: null },
      select: {
        id: true, fullName: true,
        clinicalRecord: {
          select: {
            hypertension: true, diabetes: true, heartDisease: true,
            anticoagulants: true, pregnant: true, allergies: true,
            currentMedications: true, medicalNotes: true, chiefComplaint: true,
            treatmentPlan: true, odontogram: true,
          },
        },
      },
    }),
    prisma.dentist.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);

  if (!paciente) notFound();

  const ficha = paciente.clinicalRecord;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Transcribir expediente"
          subtitle={`${paciente.fullName} · copia aquí lo que el odontólogo escribió a mano`}
          actions={
            <a href={`/pacientes/${paciente.id}/expediente`} className="btn btn--ghost">
              Ver e imprimir
            </a>
          }
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <RecordForm
          patientId={paciente.id}
          patientName={paciente.fullName}
          dentistas={dentistas}
          inicial={
            ficha
              ? { ...ficha, odontogram: (ficha.odontogram ?? null) as OdontogramaDatos | null }
              : null
          }
        />
      </FadeIn>
    </div>
  );
}
