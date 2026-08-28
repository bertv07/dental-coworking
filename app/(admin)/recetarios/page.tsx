import Link from 'next/link';
import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { Card, EmptyState, Badge } from '@/frontend/components/ui/primitives';
import { NewPrescriptionTemplate } from '@/frontend/features/prescriptions/NewPrescriptionTemplate';

/**
 * ===========================================================================
 *  /recetarios — los recipes de cada odontóloga
 * ===========================================================================
 *  Cada una sube el suyo y lo edita dentro del panel.
 *
 *  QUIÉN VE QUÉ
 *  Recepción y el admin ven todos, porque a menudo es recepción quien tiene
 *  el escáner y monta el recetario. Una odontóloga ve SÓLO los suyos y los
 *  de la clínica: el membrete y la firma de una compañera no son cosa suya.
 *
 *  Ese filtro se hace en la consulta, no ocultando tarjetas: lo que no se
 *  puede ver, no se consulta.
 * ===========================================================================
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Recetarios' };

export default async function RecetariosPage() {
  const user = await requireRole('DENTIST');

  const perfil =
    user?.role === 'DENTIST' ? await repository.findDentistByUserId(user.id) : null;

  const [templates, dentists] = await Promise.all([
    repository.listPrescriptionTemplates(
      user?.role === 'DENTIST' ? { dentistId: perfil?.id ?? '', includeClinic: true } : {},
    ),
    user?.role === 'DENTIST' ? Promise.resolve([]) : repository.listDentists(),
  ]);

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Recetarios"
          subtitle="Sube tu recipe y colócale encima lo que necesites"
        />
      </FadeIn>

      <FadeIn delay={0.06}>
        <NewPrescriptionTemplate
          dentists={dentists.map((d) => ({ id: d.id, name: d.fullName }))}
          esOdontologo={user?.role === 'DENTIST'}
          tieneFicha={user?.role !== 'DENTIST' || Boolean(perfil)}
        />
      </FadeIn>

      <FadeIn delay={0.12}>
        <Card title="Tus recetarios" subtitle={`${templates.length} en total`}>
          {templates.length === 0 ? (
            <EmptyState>
              Todavía no hay ninguno. Crea uno arriba y sube tu recipe escaneado.
            </EmptyState>
          ) : (
            <div className="row row--wrap" style={{ gap: '0.75rem' }}>
              {templates.map((t) => (
                <Link
                  key={t.id}
                  href={`/recetarios/${t.id}`}
                  className="recipe-card"
                  style={{
                    /* La miniatura respeta la proporción real de la hoja: un
                       recetario apaisado tiene que verse apaisado aquí. */
                    aspectRatio: `${t.widthPx} / ${t.heightPx}`,
                  }}
                >
                  <div className="recipe-card__name">{t.name}</div>
                  <div className="recipe-card__meta">
                    {t.dentistName ?? 'De la clínica'}
                  </div>
                  <div className="recipe-card__meta">
                    {t.elementCount === 0 ? (
                      <Badge tone="warning">Vacío</Badge>
                    ) : (
                      <>{t.elementCount} elementos</>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </FadeIn>
    </div>
  );
}
