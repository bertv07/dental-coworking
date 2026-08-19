-- ===========================================================================
--  Credenciales del personal: alta con invitación y cambio de clave
-- ===========================================================================

-- Obliga a cambiar la contraseña en el próximo inicio de sesión.
--
-- Se enciende cuando la cuenta nace de una invitación: el administrador da de
-- alta al odontólogo, el sistema genera una clave temporal y se la manda por
-- correo. Esa clave la ha visto un tercero —el correo, n8n, quien mire la
-- pantalla— así que no puede quedarse como la definitiva.
--
-- Las cuentas que ya existen nacen en `false`: activarlo de golpe dejaría a
-- todo el personal bloqueado en la pantalla de cambio de clave sin previo
-- aviso.
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Cuándo se cambió la contraseña por última vez.
--
-- No es decorativo: es lo que permite responder «¿esta cuenta sigue con la
-- clave temporal de hace tres meses?» sin mirar el hash. NULL = nunca se ha
-- cambiado desde que se creó.
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMPTZ(3);

-- ---------------------------------------------------------------------------
--  Revocación de sesiones
-- ---------------------------------------------------------------------------
-- `sessionsValidFrom` ya existía y se comparaba en NINGÚN sitio: el campo se
-- escribía pero nadie lo leía, así que cambiar la contraseña no cerraba las
-- sesiones abiertas. El índice lo añade esta migración porque a partir de
-- ahora sí se consulta, y se consulta en cada petición autenticada.
CREATE INDEX IF NOT EXISTS "users_sessions_valid_from_idx"
  ON "users"("id", "sessionsValidFrom");
