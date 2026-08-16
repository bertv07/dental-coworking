import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { PatientsManager } from '@/frontend/features/admin/PatientsManager';
import { FadeIn } from '@/frontend/components/motion';

/**
 * ===========================================================================
 *  /pacientes — Base de datos de pacientes (CRUD)
 * ===========================================================================
 *  ACCESO: asistente o superior. Recepción da de alta pacientes a diario;
 *  exigir Super Admin haría el sistema inservible en el mostrador.
 *
 *  BÚSQUEDA Y PAGINACIÓN EN EL SERVIDOR:
 *  El filtro llega por `searchParams` y se aplica en la consulta, no en el
 *  navegador. Con 5.000 pacientes, filtrar en el cliente significaría enviar
 *  los 5.000 al navegador para esconder 4.980 — lento y, además, una fuga de
 *  datos personales innecesaria.
 * ===========================================================================
 */

export const metadata = { title: 'Pacientes' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 12;

export default async function PatientsPage({
  searchParams,
}: {
  // En Next.js 15 los searchParams son asíncronos.
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await requireRole('ASSISTANT');
  const params = await searchParams;

  const search = params.q?.slice(0, 100) ?? '';
  // `Number.parseInt` de una query manipulada puede dar NaN: se acota.
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const { items, total } = await repository.listPatients({
    search: search || undefined,
    page,
    limit: PAGE_SIZE,
  });

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Pacientes"
          subtitle={
            search
              ? `${total} resultados para "${search}"`
              : `${total} pacientes registrados en la clínica`
          }
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <PatientsManager
          patients={items}
          total={total}
          page={page}
          limit={PAGE_SIZE}
          search={search}
        />
      </FadeIn>
    </div>
  );
}
