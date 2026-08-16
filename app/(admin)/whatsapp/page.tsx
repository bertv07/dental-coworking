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

export default async function WhatsAppPage() {
  await requireRole('ASSISTANT');

  const conversations = await repository.listConversations({ limit: 50 });

  // Mensajes de la primera conversación, para que la vista no arranque vacía.
  const firstConversation = conversations[0];
  const initialMessages = firstConversation
    ? await repository.getConversationMessages(firstConversation.id)
    : [];

  const pendingCount = conversations.filter((c) => c.needsHumanAttention).length;
  const aiOffCount = conversations.filter((c) => !c.aiEnabled).length;

  return (
    <div className="page-body">
      <FadeIn>
        <PageHead
          title="Monitor de WhatsApp"
          subtitle={`${conversations.length} conversaciones · ${pendingCount} requieren atención · ${aiOffCount} con IA apagada`}
        />
      </FadeIn>

      <FadeIn delay={0.08}>
        <WhatsAppMonitor
          conversations={conversations}
          initialConversationId={firstConversation?.id ?? null}
          initialMessages={initialMessages}
          outboundConfigured={isOutboundConfigured()}
        />
      </FadeIn>
    </div>
  );
}
