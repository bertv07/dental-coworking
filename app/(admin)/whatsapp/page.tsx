import { requireRole } from '@/backend/auth/guards';
import { repository } from '@/backend/repositories';
import { PageHead } from '@/frontend/components/layout/Topbar';
import { FadeIn } from '@/frontend/components/motion';
import { WhatsAppMonitor } from '@/frontend/features/whatsapp/WhatsAppMonitor';
import { isOutboundConfigured } from '@/backend/services/whatsapp-outbound.service';

/**
 * ===========================================================================
 *  /whatsapp — Monitor de conversaciones
 * ===========================================================================
 *  Requisito 4: leer los chats, ver el estado de la IA y poder apagarla o
 *  encenderla en un chat concreto.
 *
 *  ACCESO: asistente o superior. Recepción tiene que poder tomar un chat sin
 *  esperar al Super Admin — si no, la escalada a humano no funciona en la
 *  práctica.
 *
 *  SOBRE EL "TIEMPO REAL":
 *  Esta versión renderiza en el servidor y refresca al navegar o al ejecutar
 *  una acción. Para actualización push de verdad, las dos vías razonables son:
 *
 *   a) Server-Sent Events (`/api/whatsapp/stream`) — unidireccional, encaja
 *      perfecto aquí: el servidor empuja, el panel escucha. Simple y sin
 *      dependencias.
 *   b) WebSocket con un servicio externo (Pusher, Ably) si además hiciera
 *      falta que el panel envíe mensajes por el mismo canal.
 *
 *  Se deja fuera por ahora a propósito: el polling del layout ya cubre el
 *  caso de uso y añadir infraestructura de tiempo real antes de tener el
 *  flujo funcionando sería optimizar a ciegas.
 * ===========================================================================
 */

export const metadata = { title: 'Monitor WhatsApp' };
export const dynamic = 'force-dynamic';

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archivadas?: string }>;
}) {
  await requireRole('ASSISTANT');

  const { q, archivadas } = await searchParams;
  const busqueda = (q ?? '').trim().toLowerCase();
  // Activas y archivadas son dos listas distintas, nunca mezcladas: el sentido
  // de archivar es sacarlas de en medio.
  const viendoArchivadas = archivadas === '1';

  const [todas, plantillas] = await Promise.all([
    repository.listConversations({ limit: 50, archived: viendoArchivadas }),
    // Sólo las activas: el monitor es para usarlas, no para gestionarlas.
    repository.listMessageTemplates(),
  ]);

  /*
   * El filtro se aplica sobre la lista ya traída y no en la consulta.
   *
   * Son como mucho cincuenta chats y el criterio incluye el nombre que da
   * WhatsApp para números que aún no son pacientes: eso no está en ninguna
   * tabla que se pueda cruzar limpiamente. Con cincuenta filas, filtrar aquí
   * es instantáneo; si algún día son cinco mil, se baja a la consulta.
   */
  /*
   * Los dígitos de la búsqueda se sacan aparte y SÓLO se comparan si hay
   * alguno.
   *
   * Antes se comparaba siempre: buscar «María» dejaba una cadena de dígitos
   * vacía, y `telefono.includes('')` es verdadero para cualquier número, así
   * que el filtro devolvía la lista entera fingiendo que había filtrado.
   */
  const digitos = busqueda.replace(/\D/g, '');

  const conversations = busqueda
    ? todas.filter((c) => {
        const nombre = (c.patientName ?? c.displayName ?? '').toLowerCase();
        if (nombre.includes(busqueda)) return true;
        // El teléfono se compara sin signos: nadie escribe «+58» al buscar.
        return digitos.length > 0 && c.phoneE164.replace(/\D/g, '').includes(digitos);
      })
    : todas;

  // Mensajes de la primera conversación, para que la vista no arranque vacía.
  const firstConversation = conversations[0];
  const initialMessages = firstConversation
    ? await repository.getConversationMessages(firstConversation.id)
    : [];

  // Los contadores hablan de TODO el monitor, no del filtro: si dijeran
  // «0 requieren atención» por estar buscando otra cosa, se perdería de vista
  // que hay gente esperando.
  const pendingCount = todas.filter((c) => c.needsHumanAttention).length;
  const aiOffCount = todas.filter((c) => !c.aiEnabled).length;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title={viendoArchivadas ? 'Conversaciones archivadas' : 'Monitor de WhatsApp'}
          subtitle={
            busqueda
              ? `${conversations.length} de ${todas.length} chats coinciden con «${q}»`
              : viendoArchivadas
                ? `${todas.length} archivadas · se conservan enteras`
                : `${todas.length} conversaciones · ${pendingCount} requieren atención · ${aiOffCount} con IA apagada`
          }
          actions={
            <>
              <a
                href={viendoArchivadas ? '/whatsapp' : '/whatsapp?archivadas=1'}
                className="btn btn--ghost"
              >
                {viendoArchivadas ? 'Ver activas' : 'Ver archivadas'}
              </a>
              <a href="/plantillas" className="btn btn--ghost">
                Plantillas
              </a>
            </>
          }
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <WhatsAppMonitor
          conversations={conversations}
          initialConversationId={firstConversation?.id ?? null}
          initialMessages={initialMessages}
          outboundConfigured={isOutboundConfigured()}
          plantillas={plantillas}
          viendoArchivadas={viendoArchivadas}
        />
      </FadeIn>
    </div>
  );
}
