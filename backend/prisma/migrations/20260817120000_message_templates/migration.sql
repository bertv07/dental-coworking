-- ===========================================================================
--  Plantillas de respuesta + archivar/eliminar conversaciones
-- ===========================================================================

-- Los mensajes que recepción usa una y otra vez.
--
-- Viven en la base y no en un documento aparte porque cambian: una hoja de
-- Word con las respuestas se queda desactualizada el día que suben un precio,
-- y nadie se entera hasta que un paciente llega al mostrador con otra cifra.
CREATE TABLE "message_templates" (
  "id"              TEXT NOT NULL,
  "category"        TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  -- El texto con sus marcadores `[Precio]` sin rellenar: la asistente los
  -- sustituye antes de enviar.
  "body"            TEXT NOT NULL,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  -- Cuántas veces se insertó. Ordena por uso real y delata las plantillas que
  -- nadie abre, que normalmente están mal escritas más que sobrar.
  "usageCount"      INTEGER NOT NULL DEFAULT 0,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(3) NOT NULL,
  "deletedAt"       TIMESTAMPTZ(3),
  CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "message_templates_isActive_category_sortOrder_idx"
  ON "message_templates"("isActive", "category", "sortOrder");

-- Ni el título ni el cuerpo pueden quedar vacíos: una plantilla sin texto
-- ocupa sitio en la lista y no sirve para nada.
ALTER TABLE "message_templates"
  ADD CONSTRAINT "message_templates_not_empty"
  CHECK (length(btrim("title")) > 0 AND length(btrim("body")) > 0);

-- --- Conversaciones: archivar y eliminar -----------------------------------

-- Archivada: sale de la lista principal pero se conserva entera. Es lo que
-- hace usable el monitor a los seis meses.
ALTER TABLE "whatsapp_conversations" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

-- Borrado LÓGICO. La fila no se elimina nunca: una conversación es la prueba
-- de lo que se le prometió a un paciente —qué precio, qué hora— y quien la
-- borra suele ser justo quien tiene motivos para hacerla desaparecer.
ALTER TABLE "whatsapp_conversations" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

CREATE INDEX "whatsapp_conversations_deleted_archived_last_idx"
  ON "whatsapp_conversations"("deletedAt", "archivedAt", "lastMessageAt" DESC);
