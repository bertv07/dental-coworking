import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { prisma } from '@/backend/db/client';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Card, Notice } from '@/frontend/components/ui/primitives';
import { PatientDocuments } from '@/frontend/features/patients/PatientDocuments';

/**
 * Formularios reales de la clínica, en blanco, tal cual los diseñó ella —
 * no una recreación. Viven en /public y se abren directo, así lo que se
 * imprime es el PDF exacto.
 */
const FORMULARIOS = [
  { href: '/formularios/historia-clinica.pdf', label: 'Historia clínica' },
] as const;

/**
 * ===========================================================================
 *  /pacientes/{id}/expediente
 * ===========================================================================
 *  El expediente del paciente: los papeles que él rellenó y firmó, escaneados.
 *
 *  ---------------------------------------------------------------------
 *  AQUÍ NO SE ESCRIBE NADA CLÍNICO
 *  ---------------------------------------------------------------------
 *  Hubo una versión donde recepción transcribía antecedentes, odontograma y
 *  evolución. Se quitó: el paciente rellena el papel entero de su puño y
 *  letra y firma el consentimiento, así que teclearlo otra vez creaba una
 *  segunda versión capaz de contradecir a la que vale legalmente — la firmada.
 *
 *  El trabajo de recepción es: imprimir el formulario en blanco, dárselo,
 *  recibirlo firmado, escanearlo y anexarlo. Eso es todo lo que hace esta
 *  pantalla.
 *
 *  ACCESO: asistente o superior. El odontólogo no entra: los documentos son
 *  de toda la clínica y quien los custodia es recepción.
 * ===========================================================================
 */

export const metadata = { title: 'Expediente' };
export const dynamic = 'force-dynamic';

export default async function ExpedientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('ASSISTANT');

  const { id } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, fullName: true, phoneE164: true, documentId: true },
  });

  if (!patient) notFound();

  const documents = await repository.listPatientDocuments(patient.id);

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title={patient.fullName}
          subtitle={`Expediente · ${patient.documentId ?? patient.phoneE164}`}
        />
      </FadeIn>

      <FadeIn delay={0.06}>
        <Notice tone="info">
          El expediente y el consentimiento los rellena y firma <strong>el paciente</strong>.
          Imprime el formulario en blanco, dáselo, y cuando te lo devuelva firmado
          escanéalo y súbelo aquí. No hay nada que teclear.
        </Notice>
      </FadeIn>

      <FadeIn delay={0.1}>
        <Card
          title="Formularios para imprimir"
          subtitle="En blanco, para que los rellene el paciente"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {FORMULARIOS.map((f) => (
              <Link key={f.href} href={f.href} className="btn btn--ghost" target="_blank">
                Imprimir {f.label.toLowerCase()}
              </Link>
            ))}
          </div>
        </Card>
      </FadeIn>

      <FadeIn delay={0.14}>
        <PatientDocuments patientId={patient.id} documents={documents} />
      </FadeIn>

      <FadeIn delay={0.18}>
        <p className="text-sm">
          <Link href="/pacientes">Volver a pacientes</Link>
        </p>
      </FadeIn>
    </div>
  );
}
