-- ===========================================================================
--  EL BOT PUEDE VOLVER SOLO
-- ===========================================================================
--  Hasta ahora, cuando la IA se apagaba en un chat -porque recepcion escribio
--  o porque el bot escalo- solo una persona podia volver a encenderla desde el
--  panel. En la practica no ocurre: se atiende al paciente, se cierra el chat
--  y el bot se queda mudo para siempre en ese numero.
--
--  `aiAutoResumeAt` marca a partir de cuando puede volver solo. Se rellena
--  unicamente cuando la IA se apago SOLA; si alguien la apaga a mano queda en
--  NULL y se respeta esa decision.
-- ===========================================================================

ALTER TABLE "whatsapp_conversations"
  ADD COLUMN "aiAutoResumeAt" TIMESTAMPTZ(3);

-- Horas de silencio tras las que el bot vuelve. 0 = no vuelve solo nunca.
ALTER TABLE "clinic_settings"
  ADD COLUMN "aiAutoResumeHours" INTEGER NOT NULL DEFAULT 4;

-- Los chats que YA estan apagados por una toma de control automatica entran
-- en el nuevo comportamiento: se les da fecha de regreso a partir de su
-- ultimo mensaje. Los que apago una persona a mano se quedan como estan.
UPDATE "whatsapp_conversations"
   SET "aiAutoResumeAt" = COALESCE("lastMessageAt", NOW()) + INTERVAL '4 hours'
 WHERE "aiEnabled" = FALSE
   AND "aiDisabledReason" IN (
     'Un agente tomo la conversacion',
     'Un agente tomó la conversación'
   );

-- Se consulta en cada mensaje entrante: sin indice, el chequeo recorreria la
-- tabla entera cada vez que escribe un paciente.
CREATE INDEX "whatsapp_conversations_aiAutoResumeAt_idx"
  ON "whatsapp_conversations" ("aiAutoResumeAt");
