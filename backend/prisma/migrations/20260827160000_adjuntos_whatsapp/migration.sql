-- ===========================================================================
--  ADJUNTOS QUE SALEN POR WHATSAPP
-- ===========================================================================
--  Fotos, PDF y notas de voz que envia la clinica desde el panel.
--
--  Los bytes viven aqui y n8n los recoge con POST /api/automation/media,
--  firmado con el mismo HMAC que el resto de la integracion. Se descarto una
--  URL con token temporal (seria otra credencial que generar, caducar y
--  vigilar, y una radiografia detras de un enlace reenviado por error es un
--  problema serio) y mandar el archivo dentro del webhook (lo infla un 33 %
--  en base64 y deja radiografias en el historial de ejecuciones de n8n).
--
--  Uno por mensaje: WhatsApp tampoco admite mas de un adjunto por mensaje.
-- ===========================================================================

CREATE TABLE "whatsapp_attachments" (
  "id"               TEXT PRIMARY KEY,
  "messageId"        TEXT NOT NULL UNIQUE,
  "fileName"         TEXT NOT NULL,
  "mimeType"         TEXT NOT NULL,
  "sizeBytes"        INTEGER NOT NULL,
  "content"          BYTEA NOT NULL,
  "uploadedByUserId" TEXT,
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),

  CONSTRAINT "whatsapp_attachments_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "whatsapp_messages"("id") ON DELETE CASCADE,

  -- 16 MB es el tope de WhatsApp para documentos y audio. Un archivo mayor no
  -- se puede entregar, asi que no tiene sentido guardarlo.
  CONSTRAINT "whatsapp_attachments_size_check"
    CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 16777216)
);
