import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Card, Notice } from '@/frontend/components/ui/primitives';
import { PrescriptionActions } from '@/frontend/features/prescriptions/PrescriptionActions';

/**
 * ===========================================================================
 *  /recetarios/[id] — ver el recipe e imprimirlo
 * ===========================================================================
 *  AQUÍ YA NO SE EDITA NADA.
 *
 *  Había un editor para colocar cajas de texto, líneas y recuadros encima de
 *  la hoja. Se quitó entero: el recipe que vale es el que la odontóloga ya
 *  usa en papel, y recomponerlo dentro del panel sólo creaba una segunda
 *  versión que podía acabar distinta de la impresa.
 *
 *  El flujo es: la odontóloga lo sube → queda aquí → recepción lo imprime.
 * ===========================================================================
 */

export const dynamic = 'force-dynamic';

export default async function RecetarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole('DENTIST');
  const { id } = await params;

  const template = await repository.getPrescriptionTemplate(id);
  if (!template) notFound();

  /*
   * Una odontóloga ve los suyos y los de la clínica, nunca los de otra: el
   * membrete y la firma de una compañera no son cosa suya.
   */
  const perfil =
    user.role === 'DENTIST' ? await repository.findDentistByUserId(user.id) : null;

  if (user.role === 'DENTIST') {
    const esSuyo = template.dentistId && template.dentistId === perfil?.id;
    const esDeLaClinica = template.dentistId === null;
    if (!esSuyo && !esDeLaClinica) notFound();
  }

  // Sólo se borra el propio. Recepción y el admin pueden borrar cualquiera.
  const puedeBorrar = user.role !== 'DENTIST' || template.dentistId === perfil?.id;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title={template.name}
          subtitle={template.dentistName ?? 'De la clínica'}
          actions={
            <PrescriptionActions
              templateId={template.id}
              nombre={template.name}
              tieneImagen={template.imageAssetId !== null}
              puedeBorrar={puedeBorrar}
            />
          }
        />
      </FadeIn>

      <FadeIn delay={0.06}>
        <Card title="El recipe" subtitle="Tal cual se va a imprimir">
          {template.imageAssetId === null ? (
            <Notice tone="warning">
              Este recetario no tiene imagen: la ficha se creó pero la subida falló.
              Bórralo y vuelve a subirlo desde la lista de recetarios.
            </Notice>
          ) : (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                background: 'var(--color-surface-2, #f4f4f5)',
                padding: '1rem',
                borderRadius: 'var(--radius-md, 10px)',
              }}
            >
              {/*
                `img` a secas y no `next/image`: el archivo lo sirve una ruta
                propia detrás de la sesión, no es un asset estático que Next
                pueda optimizar en build.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/recetarios/${template.id}/imagen/${template.imageAssetId}`}
                alt={`Recetario ${template.name}`}
                style={{ maxWidth: '100%', height: 'auto', boxShadow: '0 1px 6px rgba(0,0,0,.15)' }}
              />
            </div>
          )}
        </Card>
      </FadeIn>

      <FadeIn delay={0.1}>
        <p className="text-sm">
          <Link href="/recetarios">Volver a recetarios</Link>
        </p>
      </FadeIn>
    </div>
  );
}
