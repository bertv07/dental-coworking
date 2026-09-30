-- El libro administrativo que se llevaba en Excel, ahora en el panel.
-- Ver los comentarios de los modelos `AdminLedgerEntry` y `DentistLedgerEntry`.
CREATE TYPE "AdminLedgerBook" AS ENUM ('GASTOS_ADMIN', 'CAJA_CHICA');

CREATE TABLE "admin_ledger_entries" (
  "id"              TEXT NOT NULL,
  "book"            "AdminLedgerBook" NOT NULL,
  "date"            DATE NOT NULL,
  "description"     TEXT NOT NULL,
  "incomeCents"     INTEGER NOT NULL DEFAULT 0,
  "expenseCents"    INTEGER NOT NULL DEFAULT 0,
  "notes"           TEXT,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(3) NOT NULL,
  "deletedAt"       TIMESTAMPTZ(3),
  CONSTRAINT "admin_ledger_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_ledger_entries_book_deletedAt_date_idx" ON "admin_ledger_entries"("book", "deletedAt", "date");

CREATE TABLE "dentist_ledger_entries" (
  "id"                TEXT NOT NULL,
  "dentistId"         TEXT NOT NULL,
  "date"              DATE NOT NULL,
  "patientName"       TEXT NOT NULL,
  "budgetCents"       INTEGER NOT NULL,
  "depositCents"      INTEGER NOT NULL DEFAULT 0,
  "dentistPercent"    INTEGER NOT NULL DEFAULT 0,
  "dentistShareCents" INTEGER NOT NULL DEFAULT 0,
  "clinicShareCents"  INTEGER NOT NULL DEFAULT 0,
  "notes"             TEXT,
  "createdByUserId"   TEXT,
  "createdAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMPTZ(3) NOT NULL,
  "deletedAt"         TIMESTAMPTZ(3),
  CONSTRAINT "dentist_ledger_entries_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "dentist_ledger_entries"
  ADD CONSTRAINT "dentist_ledger_entries_dentistId_fkey"
  FOREIGN KEY ("dentistId") REFERENCES "dentists"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "dentist_ledger_entries_dentistId_deletedAt_date_idx" ON "dentist_ledger_entries"("dentistId", "deletedAt", "date");
