-- Gastos de la clínica y de cada odontóloga: lo que sale, para saber lo que
-- queda de verdad después de la luz, el condominio, la publicidad y los
-- materiales. Ver el comentario del modelo `Expense`.
CREATE TYPE "ExpenseRecurrence" AS ENUM ('ONE_TIME', 'MONTHLY');
CREATE TYPE "ExpenseScope" AS ENUM ('CLINIC', 'DENTIST');

CREATE TABLE "expenses" (
  "id"              TEXT NOT NULL,
  "scope"           "ExpenseScope" NOT NULL,
  "dentistId"       TEXT,
  "category"        TEXT NOT NULL,
  "description"     TEXT NOT NULL,
  "amountCents"     INTEGER NOT NULL,
  "recurrence"      "ExpenseRecurrence" NOT NULL DEFAULT 'ONE_TIME',
  "startsOn"        DATE NOT NULL,
  "endsOn"          DATE,
  "notes"           TEXT,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(3) NOT NULL,
  "deletedAt"       TIMESTAMPTZ(3),
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_dentistId_fkey"
  FOREIGN KEY ("dentistId") REFERENCES "dentists"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Un gasto no puede ser negativo: eso sería un ingreso, y los ingresos son
-- los cobros.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amountCents" >= 0);

CREATE INDEX "expenses_scope_dentistId_deletedAt_idx" ON "expenses"("scope", "dentistId", "deletedAt");
CREATE INDEX "expenses_startsOn_idx" ON "expenses"("startsOn");
