-- Conecta el libro de Administración con los cobros reales: cada fila puede
-- venir de un pago de verdad (`sourcePaymentId`) en vez de escribirse a
-- mano. `null` sigue significando "fila manual", como hasta ahora.
ALTER TABLE "admin_ledger_entries" ADD COLUMN "sourcePaymentId" TEXT;
CREATE INDEX "admin_ledger_entries_sourcePaymentId_idx" ON "admin_ledger_entries"("sourcePaymentId");

ALTER TABLE "dentist_ledger_entries" ADD COLUMN "sourcePaymentId" TEXT;
CREATE UNIQUE INDEX "dentist_ledger_entries_sourcePaymentId_key" ON "dentist_ledger_entries"("sourcePaymentId");
