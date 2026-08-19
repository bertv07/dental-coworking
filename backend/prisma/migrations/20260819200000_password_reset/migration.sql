-- ===========================================================================
--  Recuperación de contraseña
-- ===========================================================================
--  Para quien olvidó su clave y no puede entrar a cambiarla desde dentro.
--
--  ---------------------------------------------------------------------
--  SE GUARDA EL HASH DEL TOKEN, NO EL TOKEN
--  ---------------------------------------------------------------------
--  Si se guardara en claro, cualquiera con acceso de lectura a la base
--  —un volcado, una copia de seguridad, una consulta de soporte— podría
--  tomar el control de cualquier cuenta sin saber ninguna contraseña.
--
--  SHA-256 basta aquí, a diferencia de las contraseñas: el token lo genera
--  el servidor con 256 bits de entropía real, así que no hay diccionario que
--  lo ataque. El coste de Argon2 sólo se justifica frente a secretos de baja
--  entropía elegidos por humanos. Es el mismo criterio que en
--  `automation_api_keys`.
CREATE TABLE "password_reset_tokens" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,

  -- SHA-256 hex del token que viajó por correo.
  "tokenHash" TEXT NOT NULL,

  -- Caduca pronto: un enlace de recuperación que vale una semana es una
  -- llave de repuesto olvidada en el buzón.
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,

  -- Un solo uso. Sin esto, quien reenvíe el correo entra otra vez.
  "usedAt"    TIMESTAMPTZ(3),

  -- Para poder investigar un uso sospechoso después.
  "requestedIp" TEXT,

  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- Único: la búsqueda al canjear es por hash, y dos iguales serían ambiguos.
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key"
  ON "password_reset_tokens"("tokenHash");

-- Para invalidar de golpe los pendientes de un usuario al emitir uno nuevo.
CREATE INDEX "password_reset_tokens_userId_idx"
  ON "password_reset_tokens"("userId");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
