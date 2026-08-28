-- ===========================================================================
--  RECETARIOS
-- ===========================================================================
--  Cada odontologa sube SU recipe y lo edita dentro del panel: mover, cambiar
--  de tamano y anadir cajas, lineas, puntos o texto encima.
--
--  `elements` es JSONB y no una tabla por tipo de forma: el editor lee y
--  escribe la hoja entera de una vez, y una tabla por tipo obligaria a migrar
--  el esquema cada vez que se anada una forma nueva.
-- ===========================================================================

CREATE TABLE "prescription_templates" (
  "id"              TEXT PRIMARY KEY,
  "dentistId"       TEXT,
  "name"            TEXT NOT NULL,
  "widthPx"         INTEGER NOT NULL DEFAULT 528,
  "heightPx"        INTEGER NOT NULL DEFAULT 816,
  "elements"        JSONB NOT NULL DEFAULT '[]',
  "isDefault"       BOOLEAN NOT NULL DEFAULT FALSE,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "deletedAt"       TIMESTAMPTZ(3),

  CONSTRAINT "prescription_templates_dentistId_fkey"
    FOREIGN KEY ("dentistId") REFERENCES "dentists"("id") ON DELETE CASCADE,

  -- Un lienzo de 0 px o de un millon no es un recetario: es un error de
  -- entrada que reventaria el editor y la impresion.
  CONSTRAINT "prescription_templates_size_check"
    CHECK ("widthPx" BETWEEN 100 AND 5000 AND "heightPx" BETWEEN 100 AND 5000)
);

CREATE INDEX "prescription_templates_dentistId_idx"
  ON "prescription_templates" ("dentistId", "deletedAt");

CREATE TABLE "prescription_assets" (
  "id"               TEXT PRIMARY KEY,
  "templateId"       TEXT NOT NULL,
  "fileName"         TEXT NOT NULL,
  "mimeType"         TEXT NOT NULL,
  "sizeBytes"        INTEGER NOT NULL,
  "widthPx"          INTEGER NOT NULL,
  "heightPx"         INTEGER NOT NULL,
  "content"          BYTEA NOT NULL,
  "uploadedByUserId" TEXT,
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),

  CONSTRAINT "prescription_assets_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "prescription_templates"("id") ON DELETE CASCADE
);

CREATE INDEX "prescription_assets_templateId_idx"
  ON "prescription_assets" ("templateId");
