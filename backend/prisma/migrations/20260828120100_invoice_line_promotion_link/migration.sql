-- Enlace entre una línea de factura y la promoción que la generó.
--
-- SET NULL y no CASCADE: si se borra la promoción del catálogo más adelante,
-- la línea ya facturada tiene que seguir existiendo tal cual se le entregó al
-- paciente — sólo se pierde el enlace, nunca el cobro.
ALTER TABLE "invoice_lines" ADD COLUMN "promotionId" TEXT;

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_promotionId_fkey"
  FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "invoice_lines_promotionId_idx" ON "invoice_lines"("promotionId");
