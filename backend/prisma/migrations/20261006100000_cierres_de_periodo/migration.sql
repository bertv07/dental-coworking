-- Cierre mensual y anual de Administración.
-- Ver el comentario del modelo `PeriodClosing`.
CREATE TABLE "period_closings" (
  "id"             TEXT NOT NULL,
  "period"         VARCHAR(7) NOT NULL,
  "incomeCents"    INTEGER NOT NULL,
  "expenseCents"   INTEGER NOT NULL,
  "collectedCents" INTEGER NOT NULL DEFAULT 0,
  "pettyCashCents" INTEGER NOT NULL DEFAULT 0,
  "notes"          TEXT,
  "closedByUserId" TEXT NOT NULL,
  "closedByName"   TEXT NOT NULL,
  "closedAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "period_closings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "period_closings_period_key" ON "period_closings"("period");
