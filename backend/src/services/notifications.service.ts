import 'server-only';
import { repository } from '@/backend/repositories';
import { getCurrentRate } from '@/backend/services/exchange-rate.service';
import type { NotificationItem } from '@/frontend/components/layout/TopbarMenus';

/**
 * ===========================================================================
 *  Avisos de la barra superior
 * ===========================================================================
 *  Genera las dos listas que alimentan los desplegables. Todo se calcula en
 *  el SERVIDOR a partir del estado real del sistema — no hay una tabla de
 *  "notificaciones" que alguien tenga que mantener al día.
 *
 *  Criterio de qué merece un aviso: sólo aquello sobre lo que se puede
 *  ACTUAR hoy. Una notificación que no se traduce en una acción es ruido, y
 *  el ruido enseña al usuario a ignorar la campanita.
 * ===========================================================================
 */

const CARACAS = 'America/Caracas';

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: CARACAS,
  }).format(date);
}

function formatRelative(date: Date | null): string {
  if (!date) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/**
 * Notificaciones operativas: lo que hay que resolver hoy.
 */
export async function getNotifications(): Promise<NotificationItem[]> {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const [todayAppointments, rate] = await Promise.all([
    repository.listAppointments({ range: { from: now, to: endOfDay }, limit: 100 }),
    getCurrentRate('BCV'),
  ]);

  const items: NotificationItem[] = [];

  // --- Citas de hoy aún sin confirmar -------------------------------------
  // Es lo más accionable del día: hay tiempo de llamar al paciente.
  const unconfirmed = todayAppointments.filter((a) => a.status === 'PENDING');
  for (const appointment of unconfirmed.slice(0, 5)) {
    items.push({
      id: `pending-${appointment.id}`,
      title: `Cita sin confirmar: ${appointment.patient.fullName}`,
      detail: `${appointment.treatment.name} · ${appointment.dentist.fullName}`,
      href: '/agenda',
      tone: 'warning',
      time: formatTime(appointment.startsAt),
    });
  }

  // --- Próxima cita del día ------------------------------------------------
  const nextAppointment = todayAppointments
    .filter((a) => a.startsAt > now && a.status !== 'CANCELLED')
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

  if (nextAppointment) {
    items.push({
      id: `next-${nextAppointment.id}`,
      title: `Próxima cita: ${nextAppointment.patient.fullName}`,
      detail: `${nextAppointment.treatment.name} · ${nextAppointment.room.code}`,
      href: '/agenda',
      tone: 'info',
      time: formatTime(nextAppointment.startsAt),
    });
  }

  // --- Tasa de cambio desactualizada ---------------------------------------
  // Importa de verdad: si la tasa está vieja, se está cobrando mal en Bs.
  if (!rate) {
    items.push({
      id: 'rate-missing',
      title: 'Sin tasa de cambio',
      detail: 'No hay tasa BCV registrada. Los importes en bolívares no se pueden calcular.',
      href: '/tasa-cambio',
      tone: 'danger',
    });
  } else if (rate.isStale) {
    items.push({
      id: 'rate-stale',
      title: 'Tasa BCV desactualizada',
      detail: `Última consulta hace ${formatRelative(rate.fetchedAt)}. Actualízala antes de cobrar.`,
      href: '/tasa-cambio',
      tone: 'warning',
    });
  }

  return items;
}

/**
 * Mensajes: conversaciones de WhatsApp donde la IA no basta.
 */
export async function getMessageAlerts(): Promise<NotificationItem[]> {
  const conversations = await repository.listConversations({ limit: 50 });

  return conversations
    // Requiere humano, o alguien apagó la IA y el chat quedó sin atender.
    .filter((conversation) => conversation.needsHumanAttention || !conversation.aiEnabled)
    .slice(0, 8)
    .map((conversation) => ({
      id: conversation.id,
      title: conversation.patientName ?? conversation.phoneE164,
      detail: conversation.aiEnabled
        ? (conversation.lastMessagePreview ?? 'Requiere atención humana')
        : `IA apagada${conversation.aiDisabledReason ? `: ${conversation.aiDisabledReason}` : ''}`,
      href: '/whatsapp',
      tone: conversation.aiEnabled ? ('warning' as const) : ('danger' as const),
      time: formatRelative(conversation.lastMessageAt),
    }));
}
