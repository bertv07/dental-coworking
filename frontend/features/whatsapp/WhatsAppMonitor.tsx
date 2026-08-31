'use client';

import { useRef, useState, useTransition, useOptimistic } from 'react';
import type { ConversationListItem, WhatsAppMessage } from '@/backend/domain/types';
import {
  toggleConversationAiAction,
  sendWhatsAppMessageAction,
} from '@/app/actions/whatsapp.actions';
import { Badge, EmptyState, Notice } from '@/frontend/components/ui/primitives';
import { IconDownload, IconPlus } from '@/frontend/components/ui/icons';

/**
 * ===========================================================================
 *  Monitor de WhatsApp — interfaz
 * ===========================================================================
 *  Componente de CLIENTE: necesita estado local (chat seleccionado) e
 *  interactividad (el toggle de la IA).
 *
 *  Es de los pocos componentes `'use client'` del proyecto. El resto del
 *  panel se renderiza en el servidor; aquí el JavaScript se paga porque
 *  aporta algo real.
 * ===========================================================================
 */

interface WhatsAppMonitorProps {
  conversations: ConversationListItem[];
  initialConversationId: string | null;
  initialMessages: WhatsAppMessage[];
  /** `false` si falta WHATSAPP_OUTBOUND_WEBHOOK_URL: se avisa en la UI. */
  outboundConfigured: boolean;
}

/** Límite de WhatsApp para mensajes de texto. */
const MAX_MESSAGE_LENGTH = 4096;

const AUTHOR_LABEL: Record<string, string> = {
  PATIENT: 'Paciente',
  AI_BOT: '🤖 IA',
  HUMAN_AGENT: '👤 Agente',
  SYSTEM: 'Sistema',
};

/** "hace 3 min", "hace 2 h", "hace 5 d". */
function formatRelativeTime(date: Date | null): string {
  if (!date) return '—';

  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return 'ahora';
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;

  return `hace ${Math.round(diffHours / 24)} d`;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Caracas',
  }).format(date);
}

/**
 * «vuelve a las 3:40 p. m.» o «vuelve mañana a las 8:00 a. m.».
 *
 * Se dice la hora concreta y no «en 4 horas» a propósito: recepción necesita
 * saber si el bot va a retomar el chat antes o después de que cierre la
 * clínica, y eso una cuenta atrás no lo responde.
 */
function formatVuelta(date: Date): string {
  /*
   * El «mismo día» se compara EN CARACAS, no en la hora del servidor.
   *
   * El servidor corre en UTC: a las 9 de la noche en la clínica allí ya es el
   * día siguiente, y comparar con `getDate()` haría decir «vuelve el 27» de
   * algo que pasa esta misma tarde.
   */
  return formatDay(date) === formatDay(new Date())
    ? `a las ${formatTime(date)}`
    : `el ${formatDay(date)} a las ${formatTime(date)}`;
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('es-VE', {
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Caracas',
  }).format(date);
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function WhatsAppMonitor({
  conversations,
  initialConversationId,
  initialMessages,
  outboundConfigured,
}: WhatsAppMonitorProps) {
  const [selectedId, setSelectedId] = useState(initialConversationId);
  const [messages, setMessages] = useState(initialMessages);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // --- Estado del compositor ---------------------------------------------
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [adjunto, setAdjunto] = useState<File | null>(null);
  const adjuntoRef = useRef<HTMLInputElement>(null);
  const [sendWarning, setSendWarning] = useState<string | null>(null);

  /**
   * Estado optimista del toggle.
   *
   * `useOptimistic` pinta el cambio de inmediato y React lo revierte solo si
   * la Server Action falla. Sin esto, el interruptor se quedaría "pegado"
   * durante el viaje al servidor y daría sensación de que no respondió.
   */
  const [optimisticConversations, setOptimisticAi] = useOptimistic(
    conversations,
    (current, update: { id: string; aiEnabled: boolean }) =>
      current.map((conversation) =>
        conversation.id === update.id
          ? { ...conversation, aiEnabled: update.aiEnabled }
          : conversation,
      ),
  );

  const selected = optimisticConversations.find(
    (conversation) => conversation.id === selectedId,
  );

  /** Carga los mensajes del chat elegido. */
  function handleSelect(conversationId: string) {
    setSelectedId(conversationId);
    setErrorMessage(null);
    // El borrador es de ESTE chat: arrastrarlo a otro provocaría enviarle a
    // un paciente lo que se estaba escribiendo para otro.
    setDraft('');
    setSendWarning(null);

    startTransition(async () => {
      const response = await fetch(`/api/whatsapp/conversations/${conversationId}/messages`);
      if (!response.ok) {
        setErrorMessage('No se pudieron cargar los mensajes');
        return;
      }
      const payload = await response.json();
      // Las fechas viajan como string en JSON: hay que rehidratarlas a `Date`.
      setMessages(
        payload.data.messages.map((message: WhatsAppMessage) => ({
          ...message,
          sentAt: new Date(message.sentAt),
        })),
      );
    });
  }

  /** EL TOGGLE: apaga o enciende la IA en el chat seleccionado. */
  function handleToggleAi(conversation: ConversationListItem) {
    const nextEnabled = !conversation.aiEnabled;
    setErrorMessage(null);

    // Al APAGAR se pide motivo. El servidor lo exige igualmente (`toggleAiSchema`);
    // preguntarlo aquí es sólo para no provocar un error evitable.
    let reason: string | undefined;
    if (!nextEnabled) {
      const input = window.prompt(
        '¿Por qué desactivas la IA en este chat?\n(Queda registrado en la auditoría)',
      );
      // `null` = el usuario canceló el diálogo → no se hace nada.
      if (input === null) return;
      reason = input.trim() || 'Sin motivo especificado';
    }

    startTransition(async () => {
      setOptimisticAi({ id: conversation.id, aiEnabled: nextEnabled });

      const result = await toggleConversationAiAction({
        conversationId: conversation.id,
        aiEnabled: nextEnabled,
        reason,
      });

      // Si falla, React revierte el estado optimista automáticamente al
      // terminar la transición. Sólo hay que mostrar el motivo.
      if (!result.ok) {
        setErrorMessage(result.error ?? 'No se pudo cambiar el estado de la IA');
      }
    });
  }

  /**
   * Envía el mensaje escrito por el agente.
   *
   * Tras enviar se RECARGA el hilo desde el servidor en vez de añadir el
   * mensaje a mano al estado local: así se ve su estado de entrega real
   * (entregado / falló) en lugar de una copia optimista que siempre parece
   * correcta.
   */
  async function sendMessage() {
    const body = draft.trim();
    // Con archivo, el texto es opcional: en WhatsApp el pie de una foto lo es.
    if ((!body && !adjunto) || !selectedId || isSending) return;

    setIsSending(true);
    setErrorMessage(null);
    setSendWarning(null);

    /*
     * `FormData` sólo cuando hay archivo. El mensaje de texto suelto —que es
     * casi todo lo que se manda— sigue yendo como objeto, sin montar un
     * multipart para un «ok, te espero».
     */
    let payload: { conversationId: string; body: string } | FormData;
    if (adjunto) {
      payload = new FormData();
      payload.set('conversationId', selectedId);
      payload.set('body', body);
      payload.set('file', adjunto);
    } else {
      payload = { conversationId: selectedId, body };
    }

    /*
     * TODO dentro de try/finally.
     *
     * Sin esto, cualquier excepción —la petición rechazada por tamaño, la red
     * caída a mitad— dejaba el botón en «Enviando…» PARA SIEMPRE: la promesa
     * se rechazaba y `setIsSending(false)` no llegaba a ejecutarse nunca. Un
     * fallo hay que poder verlo y reintentarlo, no quedarse mirando.
     */
    try {
      const result = await sendWhatsAppMessageAction(payload);

      if (!result.ok) {
        setErrorMessage(result.error ?? 'No se pudo enviar el mensaje');
        return;
      }

      // Se guardó: se limpia el borrador aunque la entrega haya fallado,
      // porque el mensaje YA está en el historial y reenviarlo lo duplicaría.
      setDraft('');
      quitarAdjunto();
      if (result.warning) setSendWarning(result.warning);

      const response = await fetch(`/api/whatsapp/conversations/${selectedId}/messages`);
      if (response.ok) {
        const recibido = await response.json();
        setMessages(
          recibido.data.messages.map((message: WhatsAppMessage) => ({
            ...message,
            sentAt: new Date(message.sentAt),
          })),
        );
      }
    } catch (error) {
      /*
       * El caso típico es el archivo demasiado grande: Next corta la petición
       * antes de que la acción llegue a ejecutarse, así que aquí no hay
       * ningún mensaje del servidor que enseñar. Se dice lo que se puede
       * hacer, que es lo único útil en ese momento.
       */
      const grande = adjunto && adjunto.size > 15 * 1024 * 1024;
      setErrorMessage(
        grande
          ? 'El archivo es demasiado grande para enviarlo por WhatsApp (máximo 16 MB).'
          : 'No se pudo enviar. Revisa la conexión e inténtalo otra vez.',
      );
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'whatsapp.send_failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setIsSending(false);
    }
  }

  /** Quita el archivo elegido y limpia el input, para poder repetir el mismo. */
  function quitarAdjunto() {
    setAdjunto(null);
    if (adjuntoRef.current) adjuntoRef.current.value = '';
  }

  /** Enter envía; Shift+Enter hace salto de línea, como en WhatsApp. */
  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div className="whatsapp-layout">
      {/* ---------------- Lista de conversaciones ---------------- */}
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Conversaciones</h2>
            <p className="card__subtitle">{optimisticConversations.length} activas</p>
          </div>
        </div>

        <div className="conversation-list">
          {optimisticConversations.length === 0 ? (
            <EmptyState>No hay conversaciones.</EmptyState>
          ) : (
            optimisticConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`conversation-item ${
                  conversation.id === selectedId ? 'conversation-item--active' : ''
                }`}
                onClick={() => handleSelect(conversation.id)}
                aria-current={conversation.id === selectedId ? 'true' : undefined}
              >
                <div className="conversation-item__avatar" aria-hidden="true">
                  {getInitials(conversation.patientName ?? conversation.phoneE164)}
                </div>

                <div className="conversation-item__content">
                  <div className="conversation-item__top">
                    <span className="conversation-item__name">
                      {conversation.patientName ?? conversation.phoneE164}
                    </span>
                    <span className="conversation-item__time">
                      {formatRelativeTime(conversation.lastMessageAt)}
                    </span>
                  </div>

                  <p className="conversation-item__preview">
                    {conversation.lastMessageAuthor === 'AI_BOT' && '🤖 '}
                    {conversation.lastMessagePreview ?? 'Sin mensajes'}
                  </p>

                  <div className="conversation-item__tags">
                    {/* El estado de la IA, visible sin abrir el chat. */}
                    {conversation.aiEnabled ? (
                      <Badge tone="success">IA activa</Badge>
                    ) : (
                      <Badge tone="danger">IA apagada</Badge>
                    )}

                    {conversation.needsHumanAttention && (
                      <Badge tone="warning">Requiere atención</Badge>
                    )}

                    {conversation.unreadCount > 0 && (
                      <Badge tone="info">{conversation.unreadCount} sin leer</Badge>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ---------------- Hilo del chat ---------------- */}
      <div className="card">
        {!selected ? (
          <EmptyState>Selecciona una conversación para ver el historial.</EmptyState>
        ) : (
          <div className="chat">
            <div className="chat__header">
              <div>
                <h2 className="card__title">
                  {selected.patientName ?? selected.phoneE164}
                </h2>
                <p className="card__subtitle mono">{selected.phoneE164}</p>
              </div>

              {/* ============================================================
                  TOGGLE APAGAR / ENCENDER IA
                  ============================================================
                  Es un <input type="checkbox"> real, visualmente oculto pero
                  presente en el DOM. Así el lector de pantalla lo anuncia
                  como interruptor y el teclado lo alcanza con Tab — cosa que
                  un <div onClick> no consigue.
              */}
              <label className="toggle">
                <input
                  type="checkbox"
                  className="toggle__input"
                  checked={selected.aiEnabled}
                  disabled={isPending}
                  onChange={() => handleToggleAi(selected)}
                />
                <span
                  className={`toggle__track ${selected.aiEnabled ? 'toggle__track--on' : ''}`}
                  aria-hidden="true"
                >
                  <span className="toggle__thumb" />
                </span>
                <span className="toggle__label">
                  {selected.aiEnabled ? 'IA activa' : 'IA apagada'}
                </span>
              </label>
            </div>

            {/* Avisos contextuales */}
            <div style={{ padding: '0 1.5rem', paddingTop: '1rem' }}>
              {errorMessage && <Notice tone="warning">{errorMessage}</Notice>}

              {!selected.aiEnabled && (
                <Notice tone="warning">
                  La IA está desactivada en este chat. Los mensajes del paciente NO
                  reciben respuesta automática.
                  {selected.aiDisabledReason && (
                    <>
                      {' '}
                      Motivo: <strong>{selected.aiDisabledReason}</strong>
                    </>
                  )}
                  {/*
                    Se dice si el bot vuelve solo y cuándo. Antes esto no se
                    veía en ninguna parte: había que acordarse de encenderlo, y
                    el chat se quedaba mudo para siempre.
                  */}
                  <div style={{ marginTop: '0.4rem' }}>
                    {selected.aiAutoResumeAt ? (
                      <>
                        El bot vuelve solo{' '}
                        <strong>{formatVuelta(new Date(selected.aiAutoResumeAt))}</strong> si
                        el chat sigue en silencio.
                      </>
                    ) : (
                      <>
                        No vuelve solo: la apagó una persona, así que sigue apagada
                        hasta que la enciendas aquí.
                      </>
                    )}
                  </div>
                </Notice>
              )}

              {selected.needsHumanAttention && selected.aiEnabled && (
                <Notice tone="info">
                  La IA marcó esta conversación como pendiente de revisión humana.
                </Notice>
              )}
            </div>

            {/* Historial de mensajes */}
            <div className="chat__messages">
              {messages.length === 0 ? (
                <EmptyState>Sin mensajes en esta conversación.</EmptyState>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`message message--${message.direction.toLowerCase()} ${
                      message.author === 'SYSTEM' ? 'message--system' : ''
                    }`}
                  >
                    {/*
                      El cuerpo se interpola como texto: React lo escapa.
                      NUNCA `dangerouslySetInnerHTML` aquí — el contenido viene
                      de un tercero (el paciente) y es el vector de XSS más
                      evidente de toda la aplicación.
                      Los saltos de línea se conservan con `white-space: pre-wrap`.
                    */}
                    <div className="message__bubble">
                      {message.body}
                      {/* Los dos casos: URL de WhatsApp al entrar, archivo
                          nuestro al salir. El componente resuelve cuál es. */}
                      {(message.mediaUrl || message.attachmentId) && (
                        <Adjunto message={message} />
                      )}
                    </div>

                    <div className="message__meta">
                      <span>{AUTHOR_LABEL[message.author] ?? message.author}</span>
                      <span>·</span>
                      <span>{formatTime(message.sentAt)}</span>

                      {/* Estado de entrega, sólo en los salientes. Un mensaje
                          que no salió DEBE verse: si no, el agente cree que
                          respondió y el paciente sigue esperando. */}
                      {message.direction === 'OUTBOUND' &&
                        message.deliveryStatus === 'FAILED' && (
                          <>
                            <span>·</span>
                            <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
                              ⚠ no entregado
                            </span>
                          </>
                        )}
                      {message.direction === 'OUTBOUND' &&
                        message.deliveryStatus === 'PENDING' && (
                          <>
                            <span>·</span>
                            <span style={{ color: 'var(--color-warning)' }}>pendiente</span>
                          </>
                        )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* ============================================================
                COMPOSITOR — responder desde el panel
                ============================================================
                Sin esto, apagar la IA dejaba el chat mudo: nadie podía
                contestar. El toggle sólo tiene sentido si un humano puede
                tomar el relevo.
            */}
            <div className="composer">
              {sendWarning && <Notice tone="warning">{sendWarning}</Notice>}

              {!outboundConfigured && (
                <Notice tone="info">
                  La salida a WhatsApp no está configurada
                  (<code className="mono">WHATSAPP_OUTBOUND_WEBHOOK_URL</code>). Los mensajes
                  se guardan en el historial pero no llegan al paciente.
                </Notice>
              )}

              {/* Archivo elegido: se ve ANTES de enviarlo. Mandar una
                  radiografía equivocada no tiene vuelta atrás. */}
              {adjunto && (
                <div className="composer__adjunto">
                  <span className="composer__adjunto-nombre">{adjunto.name}</span>
                  <span className="text-xs subtle">
                    {(adjunto.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={quitarAdjunto}
                    disabled={isSending}
                  >
                    Quitar
                  </button>
                </div>
              )}

              <div className="composer__row">
                <input
                  ref={adjuntoRef}
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/ogg,audio/mp4,audio/aac,audio/amr,video/mp4,video/3gpp"
                  onChange={(e) => setAdjunto(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="btn btn--ghost composer__adjuntar"
                  onClick={() => adjuntoRef.current?.click()}
                  disabled={isSending}
                  title="Adjuntar foto, PDF o audio"
                  aria-label="Adjuntar archivo"
                >
                  <IconPlus size={16} />
                </button>
                <textarea
                  className="composer__input"
                  placeholder={
                    selected.aiEnabled
                      ? 'Escribe para tomar la conversación (esto apagará la IA)…'
                      : 'Escribe tu respuesta…'
                  }
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                  onKeyDown={onComposerKeyDown}
                  disabled={isSending}
                  rows={2}
                  aria-label="Escribir mensaje"
                />
                <button
                  type="button"
                  className="btn btn--primary composer__send"
                  onClick={() => void sendMessage()}
                  disabled={isSending || (draft.trim().length === 0 && !adjunto)}
                >
                  {isSending ? 'Enviando…' : 'Enviar'}
                </button>
              </div>

              <div className="composer__hint">
                <span>
                  Enter envía · Shift+Enter salto de línea · fotos, PDF y audio hasta 16 MB
                  {selected.aiEnabled && ' · al escribir, la IA se apaga automáticamente'}
                </span>
                {draft.length > MAX_MESSAGE_LENGTH - 500 && (
                  <span className={draft.length >= MAX_MESSAGE_LENGTH ? 'composer__count--limit' : ''}>
                    {draft.length}/{MAX_MESSAGE_LENGTH}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Un adjunto del chat: foto, nota de voz, vídeo o archivo.
 *
 * ---------------------------------------------------------------------
 *  POR QUÉ SE MIRA EL TIPO Y NO LA EXTENSIÓN
 * ---------------------------------------------------------------------
 *  Las URLs de WhatsApp no traen extensión: son identificadores. Con
 *  `mediaType` se sabe qué es sin adivinar, y cuando no viene se cae al enlace
 *  genérico, que funciona siempre.
 *
 *  La URL ya llegó validada como http/https (`automation.schema.ts`), así que
 *  no puede colarse un `javascript:` en un `href`. Aun así los enlaces llevan
 *  `noreferrer`: son de un tercero y no tienen por qué saber de dónde vienen.
 */
function Adjunto({ message }: { message: WhatsAppMessage }) {
  /*
   * Dos orígenes, misma burbuja.
   *
   * Lo que ENTRA trae una URL de WhatsApp; lo que SALE lo guardamos nosotros
   * y se pide al panel con la sesión. Resolverlo aquí evita que cada sitio
   * que pinta un mensaje tenga que saber de dónde viene el archivo.
   */
  const fuente = message.mediaUrl ?? (message.attachmentId
    ? `/api/whatsapp/adjuntos/${message.attachmentId}`
    : null);
  if (!fuente) return null;
  const tipo = message.mediaType ?? '';

  if (tipo.startsWith('image/')) {
    return (
      <a href={fuente} target="_blank" rel="noreferrer" className="message__media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={fuente}
          alt={message.direction === 'INBOUND' ? 'Imagen del paciente' : 'Imagen enviada'}
          loading="lazy"
        />
      </a>
    );
  }

  if (tipo.startsWith('audio/')) {
    // Reproductor nativo: las notas de voz son la mitad de lo que manda un
    // paciente, y abrirlas en otra pestaña para oírlas rompe la conversación.
    return <audio className="message__audio" controls preload="none" src={fuente} />;
  }

  if (tipo.startsWith('video/')) {
    return <video className="message__media" controls preload="none" src={fuente} />;
  }

  return (
    <a href={fuente} target="_blank" rel="noreferrer" className="message__file">
      <IconDownload size={14} /> {tipo === 'application/pdf' ? 'Ver el PDF' : 'Abrir el archivo'}
    </a>
  );
}
