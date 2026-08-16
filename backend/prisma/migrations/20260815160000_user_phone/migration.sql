-- Teléfono de WhatsApp del personal.
--
-- Es lo que permite al bot saber CON QUIÉN habla: sin este dato, un mensaje
-- de la asistente preguntando por el horario de una odontóloga se atendería
-- como si fuera un paciente pidiendo cita.
--
-- Nullable: no todo el personal usa WhatsApp con la clínica, y forzar el
-- campo obligaría a inventar números para las cuentas que no lo tienen.
ALTER TABLE "users" ADD COLUMN "phoneE164" TEXT;

-- Único cuando está presente. En Postgres, un índice único permite varios
-- NULL, que es justo lo que hace falta aquí: muchas cuentas sin teléfono,
-- ningún teléfono repetido.
CREATE UNIQUE INDEX "users_phoneE164_key" ON "users"("phoneE164");

-- Mismo formato E.164 que se exige a pacientes y odontólogos. Sin esto, un
-- "0414-555-1234" escrito a mano nunca casaría con el número que llega de
-- WhatsApp, y el rol se resolvería mal en silencio.
ALTER TABLE "users"
  ADD CONSTRAINT "users_phone_e164_format"
  CHECK ("phoneE164" IS NULL OR "phoneE164" ~ '^\+[1-9][0-9]{7,14}$');
